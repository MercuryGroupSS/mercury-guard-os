package ca.mercury.guard

import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.URL
import java.security.KeyStore
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

/** Explicit local real PostgreSQL/Auth gate; ordinary API28/35 and stub HTTPS CI skip it. */
class HttpsEscalationIntegrationTest {
 private fun fixture(path:String,metadata:JSONObject,body:JSONObject?=null):JSONObject {
  val connection=URL("https://localhost:55444$path").openConnection() as HttpsURLConnection
  try{
   connection.connectTimeout=10000;connection.readTimeout=15000;connection.instanceFollowRedirects=false
   connection.setRequestProperty("X-Mercury-Test-Nonce",metadata.getString("test_nonce"))
   if(body!=null){connection.requestMethod="POST";connection.doOutput=true;connection.setRequestProperty("Content-Type","application/json");connection.outputStream.use{it.write(body.toString().toByteArray(Charsets.UTF_8))}}
   assertEquals("Synthetic fixture route $path",200,connection.responseCode)
   return JSONObject(connection.inputStream.bufferedReader().use{it.readText()})
  }finally{connection.disconnect()}
 }
 @Test fun realAuthPostgresAndKeystoreCompleteOfflineDeliveryUnknownOutcomeAndExplicitOperatorAcknowledgement(){
  assumeTrue(InstrumentationRegistry.getArguments().getString("escalationIntegration")=="true")
  val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
  assumeTrue(context.packageName.endsWith(".httpstest"))
  val metadata=try{JSONObject(instrumentation.context.assets.open("escalation-test-fixture.json").bufferedReader().use{it.readText()})}catch(_:java.io.FileNotFoundException){null}
  assumeTrue(metadata?.optString("fixture_type")=="real_pg_auth_escalations");val fixture=metadata!!
  val config=GuardServiceConfig.load(context)?:error("Explicit test-only trusted service required")
  assumeTrue(config.endpoint=="https://localhost:55444");assertEquals(fixture.getString("device_id"),config.deviceId)
  val identity=DeviceIdentity(context);val coordinator=UploadCoordinator(context);val db=EscalationStore(context)
  var session:GuardAccountClient.Session?=null
  try{
   val public=identity.create();fixture("/test/enroll",fixture,JSONObject().put("public_key_spki",public.publicKeySpki))
   val client=GuardAccountClient(config.endpoint);val password=fixture.getString("password").toCharArray()
   session=client.login(fixture.getString("guard_id"),password);assertTrue(password.all{it=='\u0000'})
   val profile=client.profile(session);assertTrue(EscalationRules.uuid(profile.getString("auth_subject")))
   assertEquals(fixture.getString("guard_id"),profile.getString("guard_id"));assertEquals(fixture.getString("vendor_id"),profile.getString("vendor_id"))
   val assignments=client.assignments(session,config.deviceId,identity,config.audience);assertEquals(1,assignments.getJSONArray("assignments").length())
   val at=assignments.getLong("server_time_ms")
   val scope=EscalationScope(config.uploadBinding(),config.deviceId,public.thumbprint,profile.getString("auth_subject"),profile.getString("guard_id"),profile.getString("vendor_id"))
   val authority=UploadAuthorityStore(context).authorize(config,session,scope.guardId,scope.vendorId,scope.subject,scope.thumbprint)
   fun request(assignment:String?=null)=EscalationIntent(UUID.randomUUID().toString(),scope.guardId,scope.vendorId,assignment,at,"assistance","Synthetic native acceptance only — Café 🚨. No real emergency or assistance requested.",null)
   val offShift=db.save(scope,request());assertEquals("Saved locally",offShift.state);assertNull(offShift.intent.assignmentId);assertNull(offShift.intent.location)
   EscalationDelivery(context,config,authority,null,UploadCancellation()).use{assertEquals("Service received",it.one(offShift.id)!!.state)}
   val stored=db.get(offShift.id,scope)!!;assertEquals(offShift.raw,stored.raw);assertEquals(offShift.hash,stored.hash)
   val duplicate=client.createEscalation(session,config.deviceId,identity,config.audience,offShift.raw)
   assertEquals(stored.receipt!!.toString(),duplicate.toString())
   fixture("/test/operator-ack",fixture,JSONObject().put("escalation_id",offShift.id))
   EscalationDelivery(context,config,authority,null,UploadCancellation()).use{assertEquals("Operator acknowledged",it.one(offShift.id)!!.state)}
   assertEquals(offShift.raw,db.get(offShift.id,scope)!!.raw);assertNotNull(db.get(offShift.id,scope)!!.snapshot!!.getJSONObject("acknowledgement"))

   // The service commits, but no receipt is persisted locally: simulate a lost create reply.
   val unknown=db.save(scope,request(fixture.getString("assignment_id")))
   val unknownReceipt=client.createEscalation(session,config.deviceId,identity,config.audience,unknown.raw)
   assertNull(db.get(unknown.id,scope)!!.receipt)
   fixture("/test/cancel-assignment",fixture,JSONObject())
   try{client.createEscalation(session,config.deviceId,identity,config.audience,unknown.raw);fail("Cancelled assignment create was accepted")}catch(e:GuardAccountClient.HttpFailure){assertEquals(403,e.statusCode)}
   EscalationDelivery(context,config,authority,null,UploadCancellation()).use{assertEquals("Service received",it.one(unknown.id)!!.state)}
   assertEquals(unknownReceipt.toString(),db.get(unknown.id,scope)!!.receipt!!.toString());assertEquals(unknown.raw,db.get(unknown.id,scope)!!.raw)
   assertEquals(fixture.getString("assignment_id"),db.get(unknown.id,scope)!!.intent.assignmentId)

   // This separate off-shift request must drain through the actual persisted JobService.
   val background=db.save(scope,request());val foregroundCopy=GuardAccountClient.Session(session.bearer(),session.expiresElapsed)
   coordinator.authorize(config,foregroundCopy,scope.guardId,scope.vendorId,scope.subject);foregroundCopy.clear()
   fun forceJob(){instrumentation.uiAutomation.executeShellCommand("cmd jobscheduler run -f ${context.packageName} ${UploadCoordinator.JOB_ID}").use{fd->java.io.FileInputStream(fd.fileDescriptor).use{it.readBytes()}}}
   forceJob();val deadline=SystemClock.elapsedRealtime()+45000
   while(SystemClock.elapsedRealtime()<deadline&&db.get(background.id,scope)!!.receipt==null)SystemClock.sleep(100)
   assertEquals("Actual background job failed to deliver retained escalation","Service received",db.get(background.id,scope)!!.state)
   assertEquals(background.raw,db.get(background.id,scope)!!.raw)

   // Same GuardID/vendor with another verified individual cannot read or adopt this queue.
   val other=scope.copy(subject=UUID.randomUUID().toString());assertNull(db.get(background.id,other));assertTrue(db.list(other).isEmpty())
   client.logout(session)
   try{client.profile(session);fail("Provider-revoked exact session reused")}catch(e:GuardAccountClient.HttpFailure){assertEquals(401,e.statusCode)}
   val afterRevocation=db.save(scope,request());coordinator.request();forceJob()
   val revokeDeadline=SystemClock.elapsedRealtime()+30000
   while(SystemClock.elapsedRealtime()<revokeDeadline&&UploadAuthorityStore(context).load(config,scope.thumbprint)!=null)SystemClock.sleep(100)
   assertNull(UploadAuthorityStore(context).load(config,scope.thumbprint));assertNull(db.get(afterRevocation.id,scope)!!.receipt)
   assertEquals("Saved locally",db.get(afterRevocation.id,scope)!!.state);assertEquals(afterRevocation.raw,db.get(afterRevocation.id,scope)!!.raw)
  }finally{
   coordinator.stop();session?.clear();db.close();context.deleteDatabase("mercury_escalations.db")
   KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry("mercury.device.signing.v1")}
   File(context.noBackupFilesDir,"device-identity-v1").delete();File(context.noBackupFilesDir,"device-identity-v1.bak").delete()
  }
 }
}
