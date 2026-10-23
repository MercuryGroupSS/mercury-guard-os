package ca.mercury.guard

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.net.Network
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject

/** One upload runner per application process. No credentials are placed in system job extras. */
internal object UploadRuntime {
 data class Run(val authority:UploadAuthority,val cancellation:UploadCancellation){@Volatile var timedOut=false}
 private val lock=Any();private var active:Run?=null
 fun claim(authority:UploadAuthority):Run?=synchronized(lock){if(active!=null)null else Run(authority,UploadCancellation()).also{active=it}}
 fun current(run:Run)=synchronized(lock){active===run}
 fun finish(run:Run)=synchronized(lock){if(active===run)active=null}
 fun cancel(){val run=synchronized(lock){active.also{active=null}};run?.cancellation?.cancel()}
 fun running()=synchronized(lock){active!=null}
}

class UploadCoordinator(private val context:Context){
 companion object { const val JOB_ID=17804 }
 private val scheduler get()=context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
 internal fun authorize(config:GuardServiceConfig,session:GuardAccountClient.Session,guard:String,vendor:String){
  val identity=DeviceIdentity(context).publicIdentity()?:error("Phone identity required")
  val store=UploadAuthorityStore(context);val current=store.load(config,identity.thumbprint)
  // An ordinary assignment refresh does not reset retained review records or renew expiry.
  if(current!=null&&current.guardId==guard&&current.vendorId==vendor&&current.session().bearer()==session.bearer()) {request();return}
  clearLocal();store.authorize(config,session,guard,vendor,identity.thumbprint);request()
 }
 private fun clearLocal(){UploadAuthorityStore(context).clear();UploadRuntime.cancel();scheduler.cancel(JOB_ID)}
 fun stop(foreground:GuardAccountClient.Session?=null,trusted:GuardServiceConfig?=null){
  // Copy only an unexpired bearer bound to this exact packaged origin/trust. Local cancellation is immediate.
  var previous:GuardAccountClient.Session?=null
  val config=try{GuardServiceConfig.load(context)}catch(_:Exception){null}
  if(config!=null)try{
   val thumbprint=DeviceIdentity(context).publicIdentity()?.thumbprint
   if(thumbprint!=null)previous=UploadAuthorityStore(context).load(config,thumbprint)?.session()
   if(previous==null&&foreground!=null&&trusted?.uploadBinding()==config.uploadBinding())previous=GuardAccountClient.Session(foreground.bearer(),foreground.expiresElapsed)
  }catch(_:Exception){}
  clearLocal()
  val session=previous
  if(config!=null&&session!=null)Thread({try{GuardAccountClient(config.endpoint).logout(session)}catch(_:Exception){}finally{session.clear()}},"mercury-session-logout").start()
 }
 fun request():Boolean {
  return try{
   val config=GuardServiceConfig.load(context)?:return false
   val thumbprint=DeviceIdentity(context).publicIdentity()?.thumbprint?:return false
   UploadAuthorityStore(context).touch(config,thumbprint)?:return false
   if(UploadRuntime.running())return true
   // Replace a pending/finishing job. jobFinished is asynchronous: treating an old
   // getPendingJob result as a wakeup could otherwise lose a newly committed capture.
   scheduler.schedule(job(context))==JobScheduler.RESULT_SUCCESS
  }catch(_:Exception){false}
 }
 internal fun job(context:Context)=JobInfo.Builder(JOB_ID,ComponentName(context,UploadJobService::class.java))
  .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
  .setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_EXPONENTIAL).build()
}

class UploadJobService:JobService(){
 private val main=Handler(Looper.getMainLooper())
 private var run:UploadRuntime.Run?=null
 private var deadline:Runnable?=null
 override fun onStartJob(params:JobParameters):Boolean {
  val config=try{GuardServiceConfig.load(this)}catch(_:Exception){null}?:return false
  val identity=try{DeviceIdentity(this).publicIdentity()}catch(_:Exception){null}?:return false
  val store=UploadAuthorityStore(this);val authority=store.load(config,identity.thumbprint)?:return false
  val network=params.network
  val task=UploadRuntime.claim(authority)?:return false;run=task
  val limit=Runnable{if(run===task&&UploadRuntime.current(task)){task.timedOut=true;task.cancellation.cancel()}}
  deadline=limit;main.postDelayed(limit,95000)
  Thread({
   var retry=false
   try{if(network==null)retry=true else NativeUploadPort(applicationContext,config,authority,network,task.cancellation).use{retry=UploadDrain(it){SystemClock.elapsedRealtime()}.run()}}
   catch(_:Exception){retry=store.current(authority,config)&&!task.cancellation.cancelled()}
   main.post{
    if(UploadRuntime.current(task)&&run===task){
     main.removeCallbacks(limit);deadline=null
     val latest=store.load(config,identity.thumbprint)
     val changed=latest?.generation==authority.generation&&latest.workVersion!=authority.workVersion
     val permitted=latest?.generation==authority.generation&&(!task.cancellation.cancelled()||task.timedOut)
     UploadRuntime.finish(task);run=null;jobFinished(params,permitted&&(retry||changed||task.timedOut))
    }
   }
  },"mercury-scoped-upload").start()
  return true
 }
 override fun onStopJob(params:JobParameters):Boolean {
  deadline?.let{main.removeCallbacks(it)};deadline=null
  val task=run?:return false;run=null;task.cancellation.cancel();UploadRuntime.finish(task)
  return try{val config=GuardServiceConfig.load(this)?:return false;UploadAuthorityStore(this).current(task.authority,config)}catch(_:Exception){false}
 }
 override fun onDestroy(){deadline?.let{main.removeCallbacks(it)};deadline=null;run?.let{it.cancellation.cancel();UploadRuntime.finish(it)};run=null;super.onDestroy()}
}

/** Each receipt updates only its immutable original queue snapshot. Server authorization is checked again for every request. */
internal class NativeUploadPort(private val context:Context,private val config:GuardServiceConfig,
 private val authority:UploadAuthority,network:Network?,private val cancellation:UploadCancellation,
 private val db:ScopedEventStore=ScopedEventStore(context),private val identity:DeviceIdentity=DeviceIdentity(context)):
 UploadDrainPort<JSONObject,JSONObject>,java.io.Closeable {
 private val store=UploadAuthorityStore(context)
 private val client=GuardAccountClient(config.endpoint,network,cancellation)
 private val transport=GuardTransport(config.endpoint,network,cancellation)
 override fun permitted()=try{!cancellation.cancelled()&&store.current(authority,config)&&identity.publicIdentity()?.thumbprint==authority.thumbprint}catch(_:Exception){false}
 private fun check(){cancellation.check();check(permitted()){ "Upload authorization ended" }}
 private fun session():GuardAccountClient.Session {check();return authority.session()}
 override fun verify(){
  try{
   val s=session();val p=client.profile(s)
   if(p.getString("guard_id")!=authority.guardId||p.getString("vendor_id")!=authority.vendorId)throw UploadRequestFailure(401)
   check();client.assignments(s,config.deviceId,identity,config.audience);check()
  }catch(e:GuardAccountClient.HttpFailure){throw UploadRequestFailure(e.statusCode)}
 }
 override fun nextBatch():JSONObject? {check();return db.prepareUpload(identity,config.audience,authority.guardId,authority.generation)}
 override fun sendBatch(batch:JSONObject){
  val payload=JSONObject(String(java.util.Base64.getUrlDecoder().decode(batch.getString("payload")),Charsets.UTF_8))
  check(payload.getJSONObject("scope").getString("guard_id")==authority.guardId)
  val rows=payload.getJSONArray("events");val ids=(0 until rows.length()).map{rows.getJSONObject(it).getString("event_id")}.toSet()
  val receipt=try{transport.sendPilotBatch(session().bearer(),batch,payload.getString("batch_id"),ids)}catch(e:GuardTransport.HttpFailure){throw UploadRequestFailure(e.statusCode)}
  db.recordUploadReceipt(authority.guardId,JSONObject().put("batch_id",receipt.batchId).put("event_ids",org.json.JSONArray(receipt.eventIds.toList())).put("status","accepted_local_only"))
 }
 override fun reviewBatch(batch:JSONObject,status:Int){check();val payload=JSONObject(String(java.util.Base64.getUrlDecoder().decode(batch.getString("payload")),Charsets.UTF_8));db.retainUploadForReview(authority.guardId,payload.getString("batch_id"),authority.generation,status)}
 override fun nextPhoto():JSONObject? {check();return db.pendingUploadPhotos(authority.guardId,authority.generation,1).firstOrNull()}
 override fun sendPhoto(photo:JSONObject){
  check();check(photo.getJSONObject("scope").getString("guard_id")==authority.guardId)
  val event=photo.getJSONObject("event");val data=event.getJSONObject("data")
  val bytes=try{EvidenceStore(context).readPhoto(data.getString("evidence_id"))}catch(_:Exception){throw UploadEvidenceUnavailable()}
  val receipt=try{transport.sendPilotEvidence(session().bearer(),event.getString("event_id"),data,bytes)}catch(e:GuardTransport.HttpFailure){throw UploadRequestFailure(e.statusCode)}
  db.recordUploadMediaReceipt(authority.guardId,receipt)
 }
 override fun reviewPhoto(photo:JSONObject,status:Int){check();db.retainPhotoForReview(authority.guardId,photo.getJSONObject("event").getString("event_id"),authority.generation,status)}
 override fun stopAuthority(){store.clear(authority.generation);cancellation.cancel()}
 override fun close(){db.close()}
}
