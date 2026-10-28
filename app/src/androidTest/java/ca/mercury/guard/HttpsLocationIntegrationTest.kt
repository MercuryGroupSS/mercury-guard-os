package ca.mercury.guard

import android.app.job.JobScheduler
import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.SystemClock
import android.os.Bundle
import android.provider.Settings
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.URL
import java.security.KeyStore
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

/** Actual Auth/PG/TLS and collector lifecycle; explicit typed transport or separately required SDK GNSS. */
class HttpsLocationIntegrationTest {
 private data class PointRetry(val proof:JSONObject,val batch:JSONObject)
 /** Explicit typed fixture only; real Android Keystore proof and PG acceptance, no SDK GNSS claim. */
 private fun pointTransport(context:Context,m:JSONObject,c:GuardServiceConfig,client:GuardAccountClient,session:GuardAccountClient.Session,identity:DeviceIdentity,binding:GrantBinding,record:LocationConsentRecord):PointRetry {
  val started=SystemClock.elapsedRealtime();val boot=Settings.Global.getInt(context.contentResolver,Settings.Global.BOOT_COUNT,-1)
  val response=client.grant(session,c.deviceId,binding.assignmentId,identity,c.audience);val completed=SystemClock.elapsedRealtime()
  val authority=ServerTimeAnchor(response.getLong("server_time_ms"),started,boot)
  val grant=ShiftGrantVerifier(c.issuer,c.audience,c.keys).verify(response.getString("key_id"),response.getString("payload"),response.getString("signature"),binding,authority,completed,boot)?:error("Synthetic checkpoint signed grant missing")
  val anchor=authority.copy(elapsedMillis=completed);val plan=AuthorizedPatrolRoute.parse(response.getJSONObject("patrol_route"));assertTrue(plan.gpsRequired)
  assertEquals(record.id,grant.location!!.id);assertEquals(record.policy.payload,grant.location!!.policy.payload)
  val requested=SystemClock.elapsedRealtimeNanos();SystemClock.sleep(2)
  val fix=Location("gps").apply{latitude=0.0;longitude=0.0;accuracy=5f;elapsedRealtimeNanos=SystemClock.elapsedRealtimeNanos()}
  val sample=AuthorizedPatrolLocation.fromLocation(fix,grant,anchor,requested,SystemClock.elapsedRealtimeNanos())?:error("Explicit typed point fixture invalid")
  val transport=GuardTransport(c.endpoint)
  ScopedEventStore(context).use{db->
   assertEquals("Earlier location receipt was not retained before point fixture",0,db.pendingCount(binding.guardId))
   db.capturePatrolCheckpoint(ConnectedDispatchOwner(record.scope.account.configuration,record.scope.account.deviceId,record.scope.account.subject,DispatchScope(binding,record.scope.account.vendorId)),plan,plan.choice("entrance"),grant,identity,sample.at,record,sample.data())
   val proof=db.prepareUpload(identity,c.audience,record.scope.account,"point-interoperability")!!
   val originalBytes=proof.toString();val batch=JSONObject(String(java.util.Base64.getUrlDecoder().decode(proof.getString("payload")),Charsets.UTF_8))
   val event=batch.getJSONArray("events").getJSONObject(0);assertEquals(1,batch.getJSONArray("events").length());assertEquals("patrol_checkpoint",event.getString("kind"))
   val before=fixture(m,"/test/receipts").getInt("checkpoint_count")
   fun reject(change:(JSONObject)->Unit){
    val changed=JSONObject(event.toString()).put("event_id",UUID.randomUUID().toString());change(changed.getJSONObject("data"))
    val unsigned=JSONObject().put("batch_id",UUID.randomUUID().toString()).put("schema_version",1).put("events",JSONArray().put(changed))
    val invalid=identity.signScopedEventBatch(c.audience,unsigned,binding);val changedBatch=JSONObject(String(java.util.Base64.getUrlDecoder().decode(invalid.getString("payload")),Charsets.UTF_8))
    try{transport.sendPilotBatch(session.bearer(),invalid,changedBatch.getString("batch_id"),setOf(changed.getString("event_id")));fail("Invalid GPS checkpoint accepted by real service")}catch(e:GuardTransport.HttpFailure){assertEquals(400,e.statusCode)}
    assertEquals(before,fixture(m,"/test/receipts").getInt("checkpoint_count"))
   }
   reject{it.getJSONObject("location").put("fix_at_ms",sample.requestedAt-1)}
   reject{it.getJSONObject("location").put("consent_id",UUID.randomUUID().toString())}
   reject{it.remove("location")}
   val receipt=transport.sendPilotBatch(session.bearer(),proof,batch.getString("batch_id"),setOf(event.getString("event_id")))
   assertEquals(receipt,transport.sendPilotBatch(session.bearer(),proof,batch.getString("batch_id"),setOf(event.getString("event_id"))));assertEquals(originalBytes,proof.toString())
   val observed=fixture(m,"/test/receipts");assertEquals(before+1,observed.getInt("checkpoint_count"))
   val location=observed.getJSONObject("last_checkpoint").getJSONObject("observation").getJSONObject("data").getJSONObject("location")
   assertEquals(record.id,location.getString("consent_id"));assertEquals(record.policy.noticeSha256,location.getString("notice_sha256"));assertEquals("validated_device_observation",location.getJSONObject("server_validation").getString("status"));assertEquals(record.id,location.getJSONObject("server_validation").getString("consent_id"))
   db.recordUploadReceipt(binding.guardId,JSONObject().put("batch_id",receipt.batchId).put("event_ids",JSONArray(receipt.eventIds.toList())).put("status","accepted_local_only"));assertEquals(0,db.pendingCount(binding.guardId))
   return PointRetry(proof,batch)
  }
 }

 private fun fixture(metadata:JSONObject,path:String,body:JSONObject?=null):JSONObject {
  val c=URL("https://localhost:55446$path").openConnection() as HttpsURLConnection
  try{c.connectTimeout=10000;c.readTimeout=15000;c.instanceFollowRedirects=false;c.setRequestProperty("X-Mercury-Test-Nonce",metadata.getString("test_nonce"))
   if(body!=null){c.requestMethod="POST";c.doOutput=true;c.setRequestProperty("Content-Type","application/json");c.outputStream.use{it.write(body.toString().toByteArray(Charsets.UTF_8))}}
   assertEquals(path,200,c.responseCode);return JSONObject(c.inputStream.bufferedReader().use{it.readText()})
  }finally{c.disconnect()}
 }
 private fun active():ConnectedLocationRuntime.Run?=ConnectedLocationRuntime::class.java.getDeclaredField("active").apply{isAccessible=true}.get(ConnectedLocationRuntime) as ConnectedLocationRuntime.Run?
 private fun waitFor(message:String,limit:Long=20000,check:()->Boolean){val end=SystemClock.elapsedRealtime()+limit;while(SystemClock.elapsedRealtime()<end){if(check())return;SystemClock.sleep(100)};assertTrue("$message · ${ConnectedLocationRuntime.description}",check())}
 private fun present(activity:GuardAccountActivity,config:GuardServiceConfig,profile:JSONObject,session:GuardAccountClient.Session,item:JSONObject){
  fun field(name:String,value:Any){GuardAccountActivity::class.java.getDeclaredField(name).apply{isAccessible=true;set(activity,value)}}
  val type=GuardAccountActivity::class.java.declaredClasses.single{it.simpleName=="AccountIdentity"}
  field("config",config);field("session",GuardAccountClient.Session(session.bearer(),session.expiresElapsed))
  field("accountIdentity",type.getDeclaredConstructor(String::class.java,String::class.java,String::class.java).apply{isAccessible=true}.newInstance(profile.getString("auth_subject"),profile.getString("guard_id"),profile.getString("vendor_id")))
  GuardAccountActivity::class.java.getDeclaredMethod("locationScreen",JSONObject::class.java).apply{isAccessible=true;invoke(activity,item)}
 }
 @Test fun visibleConsentCollectorLeaseAndTypedFixtureDeliveryAreSeparatelyVerified(){
  assumeTrue(InstrumentationRegistry.getArguments().getString("locationIntegration")=="true")
  val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
  assumeTrue(context.packageName.endsWith(".httpstest"))
  val metadata=try{JSONObject(instrumentation.context.assets.open("location-test-fixture.json").bufferedReader().use{it.readText()})}catch(_:java.io.FileNotFoundException){null}
  assumeTrue(metadata?.optString("fixture_type")=="real_pg_auth_location");val m=metadata!!
  val config=GuardServiceConfig.load(context)?:error("Debug fixture trust required");assumeTrue(config.endpoint=="https://localhost:55446")
  val identity=DeviceIdentity(context);val coordinator=UploadCoordinator(context);val transitionName="location-transition-${UUID.randomUUID()}.db";var session:GuardAccountClient.Session?=null
  val readyFile=File(context.filesDir,"location-test-ready");readyFile.delete()
  try{
   val public=identity.create();fixture(m,"/test/enroll",JSONObject().put("public_key_spki",public.publicKeySpki))
   val client=GuardAccountClient(config.endpoint);session=client.login(m.getString("guard_id"),m.getString("password").toCharArray());val profile=client.profile(session)
   var assignments=client.assignments(session,config.deviceId,identity,config.audience);var item=assignments.getJSONArray("assignments").getJSONObject(0)
   val binding=GrantBinding(profile.getString("guard_id"),item.getString("siteId"),item.getString("assignmentId"),public.thumbprint,item.getLong("revocationVersion"))
   ShiftTransitionStore(context,transitionName).use{store->val scope=DispatchScope(binding,profile.getString("vendor_id"));val intent=store.prepare(scope,"start","");assertTrue(store.accept(scope,"start",client.transition(session,config.deviceId,binding.assignmentId,identity,config.audience,intent)))}
   assignments=client.assignments(session,config.deviceId,identity,config.audience);item=assignments.getJSONArray("assignments").getJSONObject(0)
   assertEquals("active",item.getJSONObject("shift_state").getString("state"))
   val policy=AuthorizedLocationPolicy.parse(item.getString("locationPolicyPayload"),item.getString("locationPolicySha256"))
   val account=EscalationScope(config.uploadBinding(),config.deviceId,public.thumbprint,profile.getString("auth_subject"),binding.guardId,profile.getString("vendor_id"));val scope=LocationConsentScope(account,binding)
   coordinator.authorize(config,session,binding.guardId,account.vendorId,account.subject)
   val before=client.grant(session,config.deviceId,binding.assignmentId,identity,config.audience);val beforeClaims=JSONObject(String(java.util.Base64.getUrlDecoder().decode(before.getString("payload")),Charsets.UTF_8));assertFalse(beforeClaims.has("location"))
   ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
    val laidOut=java.util.concurrent.CountDownLatch(1)
    scenario.onActivity{activity->
     val observer=activity.window.decorView.viewTreeObserver
     observer.addOnGlobalLayoutListener(object:android.view.ViewTreeObserver.OnGlobalLayoutListener{override fun onGlobalLayout(){if(observer.isAlive)observer.removeOnGlobalLayoutListener(this);laidOut.countDown()}})
     present(activity,config,profile,session,item)
    }
    assertTrue("Consent form never completed layout",laidOut.await(5,java.util.concurrent.TimeUnit.SECONDS))
    instrumentation.waitForIdleSync()
    // Use the same scroll gesture as a guard on the small cover-style viewport.
    onView(isAssignableFrom(android.widget.ScrollView::class.java)).perform(swipeUp())
    onView(withText("I have reviewed this exact notice and consent to this policy for this shift.")).perform(click())
    onView(withText("Consent and start visible shift location")).perform(click())
    waitFor("Visible service did not start"){active()!=null}
    val initial=active()!!;assertEquals(policy.sha256,initial.grant.location!!.policy.sha256);val firstGrant=initial.grant.grantId
    val typedFixture=InstrumentationRegistry.getArguments().getString("locationTypedFixture")=="true"
    if(typedFixture){
     // Explicit network-only fixture branch: this does not claim an SDK/receiver fix.
     val task=active()?:error("Visible collector stopped before typed fixture")
     val at=ConnectedLocationTiming.observationAt(task.anchor.epochMillis,task.anchor.elapsedMillis,SystemClock.elapsedRealtime())
     val typed=Location("gps").apply{latitude=0.0;longitude=0.0;accuracy=5f;elapsedRealtimeNanos=SystemClock.elapsedRealtimeNanos()}
     val sample=ConnectedLocationSample.fromLocation(typed,task.grant,at,SystemClock.elapsedRealtimeNanos())?:error("Typed synthetic sample rejected")
     ScopedEventStore(context).use{it.captureLocation(task.record,task.grant,identity,sample)};coordinator.request()
     println("LOCATION_ACCEPTANCE typed_synthetic_network_fixture=true sdk_gnss_delivery=not_verified")
    }else{
     readyFile.writeText("requesting") // Host harness targets only the disposable emulator.
     waitFor("Actual requested GNSS fix was not saved by collector",15000){ConnectedLocationRuntime.description.contains("sample saved")}
     println("LOCATION_ACCEPTANCE typed_synthetic_network_fixture=false sdk_gnss_delivery=observed")
    }
    instrumentation.uiAutomation.executeShellCommand("cmd jobscheduler run -f ${context.packageName} ${UploadCoordinator.JOB_ID}").use{fd->java.io.FileInputStream(fd.fileDescriptor).use{it.readBytes()}}
    waitFor("Policy-bound location fixture was not received by real PG service",30000){fixture(m,"/test/location-receipts").getInt("location_count")>0}
    val received=fixture(m,"/test/location-receipts");assertEquals("validated_device_observation",received.getJSONObject("last_location").getJSONObject("observation").getJSONObject("data").getJSONObject("server_validation").getString("status"))
    waitFor("Collector did not obtain a fresh server lease",policy.maxLease+5000){active()?.grant?.grantId?.let{it!=firstGrant}==true}
    val current=active()!!;assertEquals(initial.record.id,current.record.id)
    // Pause capture, then retain one exact typed sample and incident before withdrawing.
    ConnectedLocationRuntime.stop(context,"Synthetic acceptance pause before withdrawal")
    // Finish any already-captured location before pausing delivery; server receipt can precede the local atomic receipt write.
    coordinator.request()
    instrumentation.uiAutomation.executeShellCommand("cmd jobscheduler run -f ${context.packageName} ${UploadCoordinator.JOB_ID}").use{fd->java.io.FileInputStream(fd.fileDescriptor).use{it.readBytes()}}
    waitFor("Original location receipt not retained before checkpoint transport",30000){ScopedEventStore(context).use{it.pendingCount(binding.guardId)==0}}
    (context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler).cancel(UploadCoordinator.JOB_ID);UploadRuntime.cancel()
    val pointRetry=if(typedFixture)pointTransport(context,m,config,client,session,identity,binding,current.record)else null
    // Refresh a short lease after the bounded network checks, retaining the same consent.
    val queuedStart=SystemClock.elapsedRealtime();val boot=Settings.Global.getInt(context.contentResolver,Settings.Global.BOOT_COUNT,-1)
    val queuedResponse=client.grant(session,config.deviceId,binding.assignmentId,identity,config.audience);val queuedCompleted=SystemClock.elapsedRealtime()
    val queuedAuthority=ServerTimeAnchor(queuedResponse.getLong("server_time_ms"),queuedStart,boot)
    val queuedGrant=ShiftGrantVerifier(config.issuer,config.audience,config.keys).verify(queuedResponse.getString("key_id"),queuedResponse.getString("payload"),queuedResponse.getString("signature"),binding,queuedAuthority,queuedCompleted,boot)?:error("Fresh withdrawal fixture lease missing")
    val queuedAnchor=queuedAuthority.copy(elapsedMillis=queuedCompleted)
    val at=ConnectedLocationTiming.observationAt(queuedAnchor.epochMillis,queuedAnchor.elapsedMillis,SystemClock.elapsedRealtime())
    val fix=Location("gps").apply{latitude=0.0;longitude=0.0;accuracy=5f;elapsedRealtimeNanos=SystemClock.elapsedRealtimeNanos()}
    val sample=ConnectedLocationSample.fromLocation(fix,queuedGrant,at,SystemClock.elapsedRealtimeNanos())?:error("Synthetic typed sample unavailable within current lease")
    val db=ScopedEventStore(context)
    try{
     db.captureLocation(current.record,queuedGrant,identity,sample)
     if(typedFixture){
      val request=SystemClock.elapsedRealtimeNanos();SystemClock.sleep(2)
      val pointFix=Location("gps").apply{latitude=0.0;longitude=0.0;accuracy=5f;elapsedRealtimeNanos=SystemClock.elapsedRealtimeNanos()}
      val point=AuthorizedPatrolLocation.fromLocation(pointFix,queuedGrant,queuedAnchor,request,SystemClock.elapsedRealtimeNanos())?:error("Typed queued checkpoint fixture invalid")
      val plan=AuthorizedPatrolRoute.parse(queuedResponse.getJSONObject("patrol_route"))
      db.capturePatrolCheckpoint(ConnectedDispatchOwner(current.record.scope.account.configuration,current.record.scope.account.deviceId,current.record.scope.account.subject,DispatchScope(binding,current.record.scope.account.vendorId)),plan,plan.choice("perimeter"),queuedGrant,identity,point.at,current.record,point.data())
     }
     val incidentAt=ConnectedLocationTiming.observationAt(queuedAnchor.epochMillis,queuedAnchor.elapsedMillis,SystemClock.elapsedRealtime())
     db.captureIncident(ConnectedIncidentDraftScope(current.record.scope.account.configuration,current.record.scope.account.deviceId,binding.deviceThumbprint,current.record.scope.account.subject,binding.guardId,current.record.scope.account.vendorId,binding.siteId,binding.assignmentId),"Synthetic incident after location withdrawal; no real event",binding,queuedGrant,identity,incidentAt)
     val original=db.prepareUpload(identity,config.audience,binding.guardId,"synthetic-original")!!
     val body=JSONObject(String(java.util.Base64.getUrlDecoder().decode(original.getString("payload")),Charsets.UTF_8));val raw=body.toString();val rows=body.getJSONArray("events");assertEquals("location",rows.getJSONObject(0).getString("kind"))
     val countsBefore=fixture(m,"/test/location-receipts")
     onView(isAssignableFrom(android.widget.ScrollView::class.java)).perform(swipeUp())
     onView(withText("Withdraw consent and stop sharing")).perform(click())
     waitFor("Local withdrawal did not block original location"){!LocationConsentStore(context).use{it.canUpload(current.record.id,scope,policy.sha256)}}
     fun forceJob(){instrumentation.uiAutomation.executeShellCommand("cmd jobscheduler run -f ${context.packageName} ${UploadCoordinator.JOB_ID}").use{fd->java.io.FileInputStream(fd.fileDescriptor).use{it.readBytes()}}}
     forceJob()
     waitFor("Real service withdrawal not confirmed",30000){LocationConsentStore(context).use{it.get(current.record.id,scope)?.withdrawalReceipt!=null}}
     val settledLocationCount=fixture(m,"/test/location-receipts").getInt("location_count")
     waitFor("Withdrawn location blocked the independent incident",30000){fixture(m,"/test/location-receipts").getInt("incident_count")>countsBefore.getInt("incident_count")}
     assertEquals(settledLocationCount,fixture(m,"/test/location-receipts").getInt("location_count"))
     assertNull(active());assertEquals(raw,JSONObject(String(java.util.Base64.getUrlDecoder().decode(original.getString("payload")),Charsets.UTF_8)).toString())
     try{GuardTransport(config.endpoint).sendPilotBatch(session.bearer(),original,body.getString("batch_id"),(0 until rows.length()).map{rows.getJSONObject(it).getString("event_id")}.toSet());fail("Withdrawn original location accepted")}catch(e:GuardTransport.HttpFailure){assertEquals(400,e.statusCode)}
     assertTrue(db.pendingCount(binding.guardId)>0)
     if(pointRetry!=null){
      val old=pointRetry.batch;val oldRows=old.getJSONArray("events")
      try{GuardTransport(config.endpoint).sendPilotBatch(session.bearer(),pointRetry.proof,old.getString("batch_id"),setOf(oldRows.getJSONObject(0).getString("event_id")));fail("Withdrawn accepted GPS checkpoint retry accepted")}catch(e:GuardTransport.HttpFailure){assertEquals(400,e.statusCode)}
      assertEquals(countsBefore.getInt("checkpoint_count"),fixture(m,"/test/receipts").getInt("checkpoint_count"))
      assertTrue((0 until rows.length()).any{rows.getJSONObject(it).getString("kind")=="patrol_checkpoint"})
     }
     scenario.moveToState(Lifecycle.State.CREATED);scenario.moveToState(Lifecycle.State.RESUMED);assertNull("Background/resume restarted collector",active())
     if(pointRetry!=null)instrumentation.addResults(Bundle().apply{putString("required_gps_checkpoint_transport","verified_synthetic_0_0")})
    }finally{db.close()}
   }
  }finally{
   readyFile.delete();ConnectedLocationRuntime.stop(context,"Synthetic acceptance cleanup");coordinator.stop();session?.clear();context.deleteDatabase(transitionName)
   context.deleteDatabase("mercury_location_consents.db");context.deleteDatabase("mercury_scoped_events.db")
   KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry("mercury.device.signing.v1")};File(context.noBackupFilesDir,"device-identity-v1").delete();File(context.noBackupFilesDir,"device-identity-v1.bak").delete()
  }
 }
}
