package ca.mercury.guard

import androidx.test.platform.app.InstrumentationRegistry
import android.os.SystemClock
import android.provider.Settings
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import java.security.KeyFactory
import java.security.KeyStore
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.UUID
import java.io.File

class HttpsAccountIntegrationTest {
 private fun fixture(path:String,body:JSONObject?=null,host:String="localhost"):JSONObject {
  val connection=URL("https://$host:55443$path").openConnection() as HttpsURLConnection
  try{
   connection.connectTimeout=10000;connection.readTimeout=10000;connection.instanceFollowRedirects=false
   if(body!=null){connection.requestMethod="POST";connection.doOutput=true;connection.setRequestProperty("Content-Type","application/json");connection.outputStream.use{it.write(body.toString().toByteArray())}}
   check(connection.responseCode==200)
   return JSONObject(connection.inputStream.bufferedReader().use{it.readText()})
  }finally{connection.disconnect()}
 }
 @Test fun keystoreToHttpsBackendCompletesAccountAssignmentCaptureAndReceipt() {
  assumeTrue(InstrumentationRegistry.getArguments().getString("httpsIntegration")=="true")
  val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
  assertTrue(context.packageName.endsWith(".httpstest"))
  val suffix=UUID.randomUUID().toString();val alias="mercury.device.signing.v1";val marker="device-identity-v1";val name="mercury_scoped_events.db"
  val identity=DeviceIdentity(context,alias,marker);val db=ScopedEventStore(context,name)
  assertEquals("Test-only HTTP application must start with an empty authorized queue",0,db.pendingCount())
  var session:GuardAccountClient.Session?=null;var evidenceId:String?=null
  try{
   val public=identity.create();fixture("/test/enroll",JSONObject().put("public_key_spki",public.publicKeySpki))
   val client=GuardAccountClient("https://localhost:55443")
   val chars="synthetic-password-only".toCharArray();session=client.login("fixture-guard",chars);assertTrue(chars.all{it=='\u0000'})
   val profile=client.profile(session);assertEquals("fixture-guard",profile.getString("guard_id"))
   val assignments=client.assignments(session,"fixture-phone",identity,"mercury-local").getJSONArray("assignments");assertEquals(1,assignments.length())
   val item=assignments.getJSONObject(0);assertEquals(public.thumbprint,item.getString("deviceThumbprint"))
   val dispatch=client.dispatch(session,"fixture-phone",item.getString("assignmentId"),identity,"mercury-local",null)
   assertEquals("fixture-guard",dispatch.getJSONObject("scope").getString("guard_id"))
   assertEquals("fixture-message",dispatch.getJSONArray("changes").getJSONObject(0).getString("message_id"))
   val unchanged=client.dispatch(session,"fixture-phone",item.getString("assignmentId"),identity,"mercury-local",dispatch.getString("next_cursor"))
   assertEquals(0,unchanged.getJSONArray("changes").length())
   val transitionName="https-shift-${UUID.randomUUID()}.db"
   val shiftScope=DispatchScope(GrantBinding("fixture-guard","fixture-site","fixture-shift",public.thumbprint,item.getLong("revocationVersion")),"fixture-vendor")
   try {
    val intent=ShiftTransitionStore(context,transitionName).use{it.prepare(shiftScope,"start","")}
    val first=client.transition(session,"fixture-phone","fixture-shift",identity,"mercury-local",intent)
    ShiftTransitionStore(context,transitionName).use{pending->
     assertEquals(intent.toString(),pending.prepare(shiftScope,"start","").toString())
     val retry=client.transition(session,"fixture-phone","fixture-shift",identity,"mercury-local",intent)
     assertEquals(first.toString(),retry.toString());pending.accept(shiftScope,"start",retry)
     assertTrue(pending.saved(shiftScope,"start")!!.has("receipt"))
    }
   }finally{context.deleteDatabase(transitionName)}
   val started=SystemClock.elapsedRealtime();val boot=Settings.Global.getInt(context.contentResolver,Settings.Global.BOOT_COUNT,-1)
   val response=client.grant(session,"fixture-phone",item.getString("assignmentId"),identity,"mercury-local")
   val config=JSONObject(instrumentation.context.assets.open("https-test-issuer.json").bufferedReader().use{it.readText()})
   val key=KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(Base64.getUrlDecoder().decode(config.getString("public_key_spki"))))
   val binding=GrantBinding("fixture-guard","fixture-site","fixture-shift",public.thumbprint,item.getLong("revocationVersion"))
   val grant=ShiftGrantVerifier("mercury-local","mercury-local",mapOf("https-fixture" to key)).verify(response.getString("key_id"),response.getString("payload"),response.getString("signature"),binding,ServerTimeAnchor(response.getLong("server_time_ms"),started,boot),SystemClock.elapsedRealtime(),boot)
   assertNotNull(grant)
   db.acknowledgeDispatch(binding,grant!!,identity,"fixture-message",1,response.getLong("server_time_ms"))
   assertTrue(db.dispatchAcknowledged(binding,"fixture-message",1))
   val inboxName="https-inbox-${UUID.randomUUID()}.db"
   try {
    DispatchInbox(context,inboxName).use { inbox ->
     val scope=DispatchScope(binding,item.getString("vendorId"))
     assertFalse(inbox.apply(scope,null,dispatch))
     assertEquals("fixture-message",inbox.list(scope).single().getJSONObject("message").getString("message_id"))
     inbox.markRead(scope,"fixture-message",1,response.getLong("server_time_ms"))
     inbox.apply(scope,dispatch.getString("next_cursor"),unchanged)
    }
    DispatchInbox(context,inboxName).use { inbox ->
     val scope=DispatchScope(binding,item.getString("vendorId"))
     assertEquals(unchanged.getString("next_cursor"),inbox.cursor(scope))
     assertFalse(inbox.list(scope).single().isNull("read_at"))
    }
   } finally { context.deleteDatabase(inboxName) }
   db.capture("incident",JSONObject().put("description","HTTPS integration synthetic incident"),binding,grant!!,identity,response.getLong("server_time_ms"))
   val route=response.getJSONObject("patrol_route");assertEquals("fixture-route",route.getString("routeId"))
   db.captureCheckpoint(binding,grant,identity,"fixture-route",1,"perimeter",response.getLong("server_time_ms"))
   db.captureCheckpoint(binding,grant,identity,"fixture-route",1,"entrance",response.getLong("server_time_ms"))
   val bitmap=android.graphics.Bitmap.createBitmap(1,1,android.graphics.Bitmap.Config.ARGB_8888)
   val photoBytes=java.io.ByteArrayOutputStream().use{out->assertTrue(bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,90,out));out.toByteArray()};bitmap.recycle()
   val temporary=File(context.cacheDir,"https-job-${UUID.randomUUID()}.jpg")
   val photo=try{temporary.writeBytes(photoBytes);EvidenceStore(context).savePhoto(temporary)}finally{temporary.delete()}
   evidenceId=photo.getString("evidence_id")
   val at=response.getLong("server_time_ms")
   val policy=AuthorizedCheckInPolicy.parse(response.getJSONObject("check_in_policy"))
   // Synthetic evidence exercises protocol linkage; this does not simulate hardware verification.
   val evidence=AuthorizedCheckInEvidence(policy,policy.slotAt(at),at,JSONObject().put("at",at).put("latitude",45).put("longitude",-73).put("accuracy_m",5).put("mock",false))
   db.captureCheckIn(binding,grant,identity,evidence,photo,at)
   val proof=db.prepareSigned(identity,"mercury-local","fixture-guard")!!
   val batch=JSONObject(String(Base64.getUrlDecoder().decode(proof.getString("payload")),Charsets.UTF_8))
   val events=batch.getJSONArray("events");val ids=(0 until events.length()).map{events.getJSONObject(it).getString("event_id")}.toSet()
   val photoEvent=(0 until events.length()).map{events.getJSONObject(it)}.single{it.getString("kind")=="photo_evidence"}.getString("event_id")
   val transport=GuardTransport("https://localhost:55443")
   // Exercise the actual persisted JobService against HTTPS after foreground credential memory is cleared.
   val trusted=GuardServiceConfig.load(context)?:error("HTTPS debug-only packaged trust required")
   val uploadSession=GuardAccountClient.Session(session.bearer(),session.expiresElapsed)
   UploadCoordinator(context).authorize(trusted,uploadSession,"fixture-guard","fixture-vendor");uploadSession.clear()
   val command="cmd jobscheduler run -f ${context.packageName} ${UploadCoordinator.JOB_ID}"
   instrumentation.uiAutomation.executeShellCommand(command).use{fd->java.io.FileInputStream(fd.fileDescriptor).use{it.readBytes()}}
   val deadline=SystemClock.elapsedRealtime()+45000
   while(SystemClock.elapsedRealtime()<deadline&&(db.pendingCount("fixture-guard")>0||db.pendingPhotos("fixture-guard").isNotEmpty()))SystemClock.sleep(100)
   assertEquals("Scheduled JobService did not drain signed metadata",0,db.pendingCount("fixture-guard"))
   assertTrue("Scheduled JobService did not upload private photo bytes",db.pendingPhotos("fixture-guard").isEmpty())
   val receipt=transport.sendPilotBatch(session.bearer(),proof,batch.getString("batch_id"),ids)
   assertEquals(receipt,transport.sendPilotBatch(session.bearer(),proof,batch.getString("batch_id"),ids))
   db.recordUploadReceipt("fixture-guard",JSONObject().put("batch_id",receipt.batchId).put("event_ids",JSONArray(receipt.eventIds.toList())).put("status","accepted_local_only"))
   assertEquals(0,db.pendingCount("fixture-guard"));assertEquals(6,fixture("/test/receipts").getInt("count"))
   val media=transport.sendPilotEvidence(session.bearer(),photoEvent,photo,photoBytes)
   assertEquals(media.toString(),transport.sendPilotEvidence(session.bearer(),photoEvent,photo,photoBytes).toString())
   assertEquals(1,fixture("/test/receipts").getInt("media_count"))
   db.recordUploadMediaReceipt("fixture-guard",media);assertTrue(db.pendingPhotos("fixture-guard").isEmpty())
   val refreshed=client.grant(session,"fixture-phone",item.getString("assignmentId"),identity,"mercury-local")
   val delivery=refreshed.getJSONObject("check_in_status")
   assertEquals("fixture-shift",delivery.getString("assignment_id"))
   assertEquals("evidence_received",delivery.getJSONArray("slots").getJSONObject(0).getString("status"))
   assertEquals(0,delivery.getInt("total_deadlines_missed"))
   val endName="https-end-${UUID.randomUUID()}.db"
   try{ShiftTransitionStore(context,endName).use{pending->
    val invalid=pending.prepare(shiftScope,"end","")
    val refusal=client.transition(session,"fixture-phone","fixture-shift",identity,"mercury-local",invalid)
    assertFalse(pending.accept(shiftScope,"end",refusal));assertEquals("early_exit_reason_required",refusal.getString("code"))
    val intent=pending.prepare(shiftScope,"end","Synthetic integration early exit")
    val ended=client.transition(session,"fixture-phone","fixture-shift",identity,"mercury-local",intent)
    pending.accept(shiftScope,"end",ended);assertTrue(ended.getBoolean("early_exit"))
    assertEquals(ended.toString(),client.transition(session,"fixture-phone","fixture-shift",identity,"mercury-local",intent).toString())
    var denied=false;try{client.grant(session,"fixture-phone","fixture-shift",identity,"mercury-local")}catch(_:GuardAccountClient.HttpFailure){denied=true};assertTrue(denied)
    assertEquals(receipt,transport.sendPilotBatch(session.bearer(),proof,batch.getString("batch_id"),ids))
   }}finally{context.deleteDatabase(endName)}
   var rejected=false;try{fixture("/test/receipts",host="127.0.0.1")}catch(_:javax.net.ssl.SSLException){rejected=true};assertTrue("Untrusted host accepted",rejected)
   val independent=client.login("fixture-guard","synthetic-password-only".toCharArray())
   client.logout(session)
   try{client.profile(session);fail("Provider-revoked session reused")}catch(e:GuardAccountClient.HttpFailure){assertEquals(401,e.statusCode)}
   assertEquals("fixture-guard",client.profile(independent).getString("guard_id"));client.logout(independent);independent.clear()
   session.clear();try{client.profile(session);fail("Cleared session reused")}catch(_:IllegalStateException){}
  }finally{
   UploadCoordinator(context).stop();session?.clear();db.close();context.deleteDatabase(name);evidenceId?.let{EvidenceStore(context).remove(it)}
   KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}
   File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()
  }
 }
}
