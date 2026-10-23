package ca.mercury.guard
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID
import java.util.Base64
import java.security.KeyStore
import java.io.File
class ScopedEventStoreTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private fun payload(proof: JSONObject)=JSONObject(String(Base64.getUrlDecoder().decode(proof.getString("payload")),Charsets.UTF_8))
 private fun rejected(block:()->Unit){var failed=false;try{block()}catch(_:Exception){failed=true};assertTrue("Expected rejection",failed)}
 private fun isolated(block:(ScopedEventStore,DeviceIdentity,String)->Unit){
  val suffix=UUID.randomUUID().toString();val name="scoped-$suffix.db";val alias="test.scoped.$suffix";val marker="scoped-$suffix";val store=ScopedEventStore(context,name,{200},{1})
  try{block(store,DeviceIdentity(context,alias,marker),name)}finally{store.close();context.deleteDatabase(name);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)};File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()}
 }
 private fun binding(identity: DeviceIdentity,assignment: String="shift-a")=GrantBinding("guard","site",assignment,identity.create().thumbprint,1)
 private fun grant(b: GrantBinding)=VerifiedShiftGrant("grant-${b.assignmentId}",b,setOf("incident"),100,1000,1)
 private fun receipt(batch: JSONObject)=JSONObject().put("batch_id",batch.getString("batch_id")).put("event_ids",JSONArray((0 until batch.getJSONArray("events").length()).map{batch.getJSONArray("events").getJSONObject(it).getString("event_id")})).put("status","accepted_local_only")
 @Test fun originalScopeSurvivesAssignmentSwitchRestartAndReceipt(){isolated{store,identity,name->
  val a=binding(identity);val b=binding(identity,"shift-b")
  store.capture("incident",JSONObject().put("note","synthetic-a"),a,grant(a),identity,10000)
  store.capture("incident",JSONObject().put("note","synthetic-b"),b,grant(b),identity,10001)
  val first=payload(store.prepareSigned(identity,"mercury-local")!!)
  assertEquals("shift-a",first.getJSONObject("scope").getString("assignment_id"));assertEquals(1,first.getJSONArray("events").length())
  assertEquals("grant-shift-a",first.getJSONArray("events").getJSONObject(0).getJSONObject("data").getString("capture_grant_id"))
  store.close()
  val reopened=ScopedEventStore(context,name,{200},{1})
  try {
   assertEquals(first.toString(),payload(reopened.prepareSigned(identity,"mercury-local")!!).toString())
   reopened.recordPilotReceipt(receipt(first));assertEquals(1,reopened.pendingCount())
   val second=payload(reopened.prepareSigned(identity,"mercury-local")!!)
   assertEquals("shift-b",second.getJSONObject("scope").getString("assignment_id"))
   assertTrue(second.getJSONArray("events").getJSONObject(0).getLong("sequence")>first.getJSONArray("events").getJSONObject(0).getLong("sequence"))
  } finally { reopened.close() }
 }}
 @Test fun failedAuthorityCannotCreatePendingEvents(){isolated{store,identity,_->
  val a=binding(identity);val b=binding(identity,"shift-b")
  rejected{store.capture("incident",JSONObject(),b,grant(a),identity,10000)}
  rejected{store.capture("incident",JSONObject(),a,VerifiedShiftGrant("expired",a,setOf("incident"),100,200,1),identity,10000)}
  rejected{store.capture("incident",JSONObject(),a,VerifiedShiftGrant("other-boot",a,setOf("incident"),100,1000,2),identity,10000)}
  rejected{store.capture("check_in",JSONObject(),a,grant(a),identity,10000)}
  rejected{store.capture("incident",JSONObject().put("capture_grant_id","forged"),a,grant(a),identity,10000)}
  assertEquals(0,store.pendingCount());assertNull(store.prepareSigned(identity,"mercury-local"))
 }}
 @Test fun alteredReceiptCannotClearQueueAndPayloadIsEncrypted(){isolated{store,identity,_->
  val a=binding(identity);store.capture("incident",JSONObject().put("note","PRIVATE-SYNTHETIC-NOTE"),a,grant(a),identity,10000)
  val batch=payload(store.prepareSigned(identity,"mercury-local")!!)
  rejected{store.recordPilotReceipt(receipt(batch).put("batch_id",UUID.randomUUID().toString()))}
  assertEquals(1,store.pendingCount())
  store.readableDatabase.rawQuery("SELECT body FROM captured",null).use{assertTrue(it.moveToFirst());assertFalse(it.getString(0).contains("PRIVATE-SYNTHETIC-NOTE"))}
  store.recordPilotReceipt(receipt(batch));assertEquals(0,store.pendingCount());assertNull(store.prepareSigned(identity,"mercury-local"))
 }}
 @Test fun corruptedExistingCiphertextBlocksReopening(){isolated{store,identity,name->
  val a=binding(identity);store.capture("incident",JSONObject(),a,grant(a),identity,10000)
  store.writableDatabase.execSQL("UPDATE captured SET body='corrupt'")
  store.close()
  val reopened=ScopedEventStore(context,name,{200},{1})
  try { rejected{reopened.pendingCount()} } finally { reopened.close() }
 }}

}
