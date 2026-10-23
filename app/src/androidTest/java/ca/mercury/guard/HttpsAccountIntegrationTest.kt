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
  val suffix=UUID.randomUUID().toString();val alias="test.https.$suffix";val marker="https-$suffix";val name="https-$suffix.db"
  val identity=DeviceIdentity(context,alias,marker);val db=ScopedEventStore(context,name)
  var session:GuardAccountClient.Session?=null
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
   val started=SystemClock.elapsedRealtime();val boot=Settings.Global.getInt(context.contentResolver,Settings.Global.BOOT_COUNT,-1)
   val response=client.grant(session,"fixture-phone",item.getString("assignmentId"),identity,"mercury-local")
   val config=JSONObject(instrumentation.context.assets.open("https-test-issuer.json").bufferedReader().use{it.readText()})
   val key=KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(Base64.getUrlDecoder().decode(config.getString("public_key_spki"))))
   val binding=GrantBinding("fixture-guard","fixture-site","fixture-shift",public.thumbprint,item.getLong("revocationVersion"))
   val grant=ShiftGrantVerifier("mercury-local","mercury-local",mapOf("https-fixture" to key)).verify(response.getString("key_id"),response.getString("payload"),response.getString("signature"),binding,ServerTimeAnchor(response.getLong("server_time_ms"),started,boot),SystemClock.elapsedRealtime(),boot)
   assertNotNull(grant)
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
   val photo=JSONObject().put("evidence_id",UUID.randomUUID().toString()).put("bytes",photoBytes.size).put("width",1).put("height",1).put("capture","camera_intent")
    .put("sha256",java.security.MessageDigest.getInstance("SHA-256").digest(photoBytes).joinToString(""){"%02x".format(it.toInt() and 255)})
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
   val receipt=transport.sendPilotBatch(session.bearer(),proof,batch.getString("batch_id"),ids)
   assertEquals(receipt,transport.sendPilotBatch(session.bearer(),proof,batch.getString("batch_id"),ids))
   db.recordPilotReceipt(JSONObject().put("batch_id",receipt.batchId).put("event_ids",JSONArray(receipt.eventIds.toList())).put("status","accepted_local_only"),"fixture-guard")
   assertEquals(0,db.pendingCount("fixture-guard"));assertEquals(5,fixture("/test/receipts").getInt("count"))
   val media=transport.sendPilotEvidence(session.bearer(),photoEvent,photo,photoBytes)
   assertEquals(media.toString(),transport.sendPilotEvidence(session.bearer(),photoEvent,photo,photoBytes).toString())
   assertEquals(1,fixture("/test/receipts").getInt("media_count"))
   db.recordMediaReceipt("fixture-guard",media);assertTrue(db.pendingPhotos("fixture-guard").isEmpty())
   val refreshed=client.grant(session,"fixture-phone",item.getString("assignmentId"),identity,"mercury-local")
   val delivery=refreshed.getJSONObject("check_in_status")
   assertEquals("fixture-shift",delivery.getString("assignment_id"))
   assertEquals("evidence_received",delivery.getJSONArray("slots").getJSONObject(0).getString("status"))
   assertEquals(0,delivery.getInt("total_deadlines_missed"))
   var rejected=false;try{fixture("/test/receipts",host="127.0.0.1")}catch(_:javax.net.ssl.SSLException){rejected=true};assertTrue("Untrusted host accepted",rejected)
   session.clear();try{client.profile(session);fail("Cleared session reused")}catch(_:IllegalStateException){}
  }finally{
   session?.clear();db.close();context.deleteDatabase(name)
   KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}
   File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()
  }
 }
}
