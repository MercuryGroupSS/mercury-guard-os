package ca.mercury.guard

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.*
import android.provider.Settings
import java.util.UUID

internal object ConnectedLocationRuntime {
 class Run(val token:String,val config:GuardServiceConfig,val record:LocationConsentRecord,val authority:UploadAuthority,@Volatile var grant:VerifiedShiftGrant,@Volatile var anchor:ServerTimeAnchor){
  val cancellation=UploadCancellation();@Volatile var renewing=false
  @Volatile var renewAt=ConnectedLocationTiming.renewalAt(SystemClock.elapsedRealtime(),grant.expiresElapsed)
 }
 private val lock=Any();private var pending:Pair<Run,Long>?=null;private var active:Run?=null
 @Volatile var description="Connected location: stopped";private set
 fun prepare(context:Context,config:GuardServiceConfig,record:LocationConsentRecord,authority:UploadAuthority,grant:VerifiedShiftGrant,anchor:ServerTimeAnchor):String {
  val run=Run(UUID.randomUUID().toString(),config,record,authority,grant,anchor)
  synchronized(lock){check(active==null);check(pending==null||SystemClock.elapsedRealtime()>=pending!!.second);pending=run to (SystemClock.elapsedRealtime()+5000)}
  return run.token
 }
 fun claim(token:String?):Run?=synchronized(lock){val value=pending;pending=null;if(value==null||value.first.token!=token||SystemClock.elapsedRealtime()>=value.second)null else value.first.also{active=it;description="Connected location: starting"}}
 fun current(run:Run)=synchronized(lock){active===run&&!run.cancellation.cancelled()}
 fun stopIfUnavailable(context:Context,subject:String,activeAssignments:Set<String>){
  val task=synchronized(lock){active}?:return
  if(task.record.scope.account.subject!=subject||task.record.scope.binding.assignmentId !in activeAssignments)stop(context,"Service reported shift ended or unavailable")
 }
 fun activeConsent(id:String)=synchronized(lock){active?.record?.id==id}
 /** Closing one historical assignment must not interrupt another current assignment. */
 fun stopForAssignment(context:Context,scope:DispatchScope,reason:String):Boolean {
  fun matches(task:Run)=task.record.scope.binding==scope.binding&&task.record.scope.account.vendorId==scope.vendorId
  var running:Run?=null;var waiting:Run?=null
  synchronized(lock){
   running=active?.takeIf(::matches);waiting=pending?.first?.takeIf(::matches)
   if(running==null&&waiting==null)return false
   if(waiting!=null)pending=null
   if(running!=null){active=null;description="Connected location: stopped · $reason"}
  }
  running?.cancellation?.cancel();waiting?.cancellation?.cancel()
  if(running!=null)context.stopService(Intent(context,ConnectedLocationService::class.java))
  return true
 }
 fun observe(run:Run,text:String){synchronized(lock){if(active===run)description=text}}
 fun <T> whileCurrent(run:Run,action:()->T):T=synchronized(lock){check(active===run&&!run.cancellation.cancelled());action()}
 fun stop(context:Context,reason:String){val old=synchronized(lock){pending=null;active.also{active=null;description="Connected location: stopped · $reason"}};old?.cancellation?.cancel();context.stopService(Intent(context,ConnectedLocationService::class.java))}
 fun finished(run:Run?,reason:String){synchronized(lock){if(run!=null&&active===run){active=null;description="Connected location: stopped · $reason"}};run?.cancellation?.cancel()}
}

/** Visible-user started only. No persisted start authority, reboot receiver, sticky restart or demo session. */
class ConnectedLocationService:Service(){
 companion object {internal const val CHANNEL="mercury_connected_location";private const val NOTE=731;internal const val TOKEN="location_start_token";private const val WITHDRAW="withdraw_connected_location"}
 private val main=Handler(Looper.getMainLooper());private var run:ConnectedLocationRuntime.Run?=null
 private var manager:LocationManager?=null;private var listener:LocationListener?=null;private var db:ScopedEventStore?=null
 private var lastFix:Location?=null;private var lastSample=-1L
 override fun onBind(intent:Intent?):IBinder?=null
 private fun ready():Boolean {
  if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED)return false
  val nm=getSystemService(NOTIFICATION_SERVICE) as NotificationManager
  if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return false
  return nm.areNotificationsEnabled()&&nm.getNotificationChannel(CHANNEL)?.importance!=NotificationManager.IMPORTANCE_NONE&&(getSystemService(LOCATION_SERVICE) as LocationManager).isProviderEnabled(LocationManager.GPS_PROVIDER)
 }
 private fun valid(task:ConnectedLocationRuntime.Run):Boolean {
  if(!ConnectedLocationRuntime.current(task)||!ready())return false
  if(!task.grant.permits("location",task.record.scope.binding,SystemClock.elapsedRealtime(),Settings.Global.getInt(contentResolver,Settings.Global.BOOT_COUNT,-1)))return false
  if(task.grant.location?.id!=task.record.id||task.grant.location?.policy?.sha256!=task.record.policy.sha256||task.grant.location?.policy?.payload!=task.record.policy.payload)return false
  if(task.record.scope.account!=EscalationScope(task.config.uploadBinding(),task.config.deviceId,task.authority.thumbprint,task.authority.subject,task.authority.guardId,task.authority.vendorId))return false
  if(!UploadAuthorityStore(this).current(task.authority,task.config)||DeviceIdentity(this).publicIdentity()?.thumbprint!=task.authority.thumbprint)return false
  return LocationConsentStore(this).use{it.canUpload(task.record.id,task.record.scope,task.record.policy.sha256)}
 }
 private fun stop(reason:String){ConnectedLocationRuntime.finished(run,reason);stopSelf()}
 override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
  if(intent?.action==WITHDRAW){
   val current=run
   if(current!=null&&intent.getStringExtra(TOKEN)==current.token)withdraw(current)
   else stopSelf()
   return START_NOT_STICKY
  }
  if(run!=null){stop("A second collector start was rejected");return START_NOT_STICKY}
  val task=ConnectedLocationRuntime.claim(intent?.getStringExtra(TOKEN))
  if(task==null){stopSelf();return START_NOT_STICKY};run=task
  try{
   val nm=getSystemService(NOTIFICATION_SERVICE) as NotificationManager
   nm.createNotificationChannel(NotificationChannel(CHANNEL,"Consented shift location",NotificationManager.IMPORTANCE_LOW))
   if(!valid(task)){stop("Permission, notice consent or shift authority unavailable");return START_NOT_STICKY}
   val open=PendingIntent.getActivity(this,732,Intent(this,GuardAccountActivity::class.java),PendingIntent.FLAG_IMMUTABLE)
   val end=PendingIntent.getService(this,733,Intent(this,ConnectedLocationService::class.java).setAction(WITHDRAW).putExtra(TOKEN,task.token),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
   val notification=Notification.Builder(this,CHANNEL).setContentTitle("Mercury One · Shift location")
    .setContentText("Consented location requested for this shift. Tap Stop sharing to withdraw.").setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).setContentIntent(open).addAction(Notification.Action.Builder(null,"Stop sharing",end).build()).build()
   if(Build.VERSION.SDK_INT>=29)startForeground(NOTE,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)else startForeground(NOTE,notification)
   db=ScopedEventStore(this);manager=getSystemService(LOCATION_SERVICE) as LocationManager
   listener=object:LocationListener {
    override fun onLocationChanged(location:Location){capture(task,location)}
    override fun onProviderEnabled(provider:String){}
    override fun onProviderDisabled(provider:String){stop("Device GPS disabled")}
    @Deprecated("Required on Android 9")override fun onStatusChanged(provider:String?,status:Int,extras:Bundle?){}
   }
   // Visible activity must have obtained precise permission before the one-shot start.
   if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){stop("Precise permission withdrawn");return START_NOT_STICKY}
   manager!!.requestLocationUpdates(LocationManager.GPS_PROVIDER,task.record.policy.interval,task.record.policy.minDistance.toFloat(),listener!!,Looper.getMainLooper())
   ConnectedLocationRuntime.observe(task,"Connected location: requesting fresh policy-bound fixes; no presence is verified")
   main.post(heartbeat)
  }catch(_:SecurityException){stop("Location permission or foreground start unavailable")}
  catch(_:Exception){stop("Location or encrypted storage unavailable")}
  return START_NOT_STICKY
 }
 private fun capture(task:ConnectedLocationRuntime.Run,location:Location){
  try{
   if(!valid(task)){stop("Location authority ended");return}
   val elapsed=SystemClock.elapsedRealtime();val at=ConnectedLocationTiming.observationAt(task.anchor.epochMillis,task.anchor.elapsedMillis,elapsed)
   val sample=ConnectedLocationSample.fromLocation(location,task.grant,at,SystemClock.elapsedRealtimeNanos())?:return
   if(!ConnectedLocationTiming.sampleDue(elapsed,lastSample,task.record.policy.interval,lastFix?.distanceTo(location)?.toDouble(),task.record.policy.minDistance))return
   ConnectedLocationRuntime.whileCurrent(task){
    check(valid(task));val original=LocationConsentStore(this).use{it.get(task.record.id,task.record.scope)}?:error("Original consent unavailable")
    db!!.captureLocation(original,task.grant,DeviceIdentity(this),sample)
   }
   lastSample=elapsed;lastFix=Location(location);UploadCoordinator(this).request()
   ConnectedLocationRuntime.observe(task,"Connected location: sample saved encrypted; service receipt pending. Device report does not prove presence.")
  }catch(_:Exception){stop("Location authority, permission or encrypted save unavailable")}
 }
 private val heartbeat=object:Runnable {override fun run(){
  val task=run?:return
  try{
   if(!valid(task)){stop("Consent, permission, session or shift lease ended");return}
   if(!task.renewing&&SystemClock.elapsedRealtime()>=task.renewAt)renew(task)
   main.postDelayed(this,1000)
  }catch(_:Exception){stop("Authority or encrypted storage unavailable")}
 }}
 private fun renew(task:ConnectedLocationRuntime.Run){
  task.renewing=true
  Thread({
   try{
    val client=GuardAccountClient(task.config.endpoint,null,task.cancellation);val session=task.authority.session();val profile=client.profile(session)
    check(profile.getString("auth_subject")==task.record.scope.account.subject&&profile.getString("guard_id")==task.record.scope.account.guardId&&profile.getString("vendor_id")==task.record.scope.account.vendorId)
    val started=SystemClock.elapsedRealtime();val boot=Settings.Global.getInt(contentResolver,Settings.Global.BOOT_COUNT,-1)
    val response=client.grant(session,task.config.deviceId,task.record.scope.binding.assignmentId,DeviceIdentity(this),task.config.audience)
    val received=SystemClock.elapsedRealtime()
    val anchor=ServerTimeAnchor(response.getLong("server_time_ms"),started,boot)
    val grant=ShiftGrantVerifier(task.config.issuer,task.config.audience,task.config.keys).verify(response.getString("key_id"),response.getString("payload"),response.getString("signature"),task.record.scope.binding,anchor,SystemClock.elapsedRealtime(),boot)?:error("Fresh signed location lease required")
    check(grant.location?.id==task.record.id&&grant.location?.policy?.sha256==task.record.policy.sha256&&grant.location?.policy?.payload==task.record.policy.payload)
    main.post{if(ConnectedLocationRuntime.current(task)){
     task.grant=grant;task.anchor=anchor.copy(elapsedMillis=received);task.renewAt=ConnectedLocationTiming.renewalAt(SystemClock.elapsedRealtime(),grant.expiresElapsed);task.renewing=false
    }}
   }catch(_:Exception){main.post{if(ConnectedLocationRuntime.current(task))stop("Fresh server renewal unavailable; open the app to restart")}}
  },"mercury-location-renewal").start()
 }
 private fun withdraw(task:ConnectedLocationRuntime.Run){
  ConnectedLocationRuntime.finished(task,"Consent withdrawn locally")
  try{LocationConsentStore(this).use{it.withdraw(task.record.id,task.record.scope)};UploadRuntime.cancel();UploadCoordinator(this).request()}
  catch(_:Exception){UploadCoordinator(this).stop()}
  stopSelf()
 }
 override fun onTaskRemoved(rootIntent:Intent?){stop("App task closed; visible restart required");super.onTaskRemoved(rootIntent)}
 override fun onDestroy(){
  main.removeCallbacksAndMessages(null);ConnectedLocationRuntime.finished(run,"Collector closed; visible restart required");run=null
  try{listener?.let{manager?.removeUpdates(it)}}catch(_:SecurityException){}
  db?.close();db=null;listener=null;manager=null;lastFix=null;lastSample=-1L;stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy()
 }
}
