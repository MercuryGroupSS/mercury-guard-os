package ca.mercury.guard

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class IncomingStoreTest {
 private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
 private val binding = GrantBinding("guard-test","site-test","assignment-test","a".repeat(64),1)
 private fun scope(b: GrantBinding = binding) = JSONObject().put("guard_id",b.guardId).put("site_id",b.siteId).put("assignment_id",b.assignmentId).put("device_thumbprint",b.deviceThumbprint).put("revocation_version",b.revocationVersion)
 private fun change(id: String, version: Int = 1, deleted: Boolean = false, text: String = "SYNTHETIC INBOUND", type: String = "dispatch") = JSONObject().put("id",id).put("version",version).put("type",type).put("deleted",deleted).put("data",if(deleted) JSONObject() else JSONObject().put("text",text))
 private fun page(previous: String, next: String, vararg changes: JSONObject) = JSONObject().put("schema_version",1).put("scope",scope()).put("previous_cursor",previous).put("next_cursor",next).put("changes",JSONArray(changes.toList()))
 private fun reject(block: () -> Unit) { var failed = false; try { block() } catch (_: Exception) { failed = true }; assertTrue(failed) }
 private fun isolated(block: (IncomingStore,String) -> Unit) {
  val name = "incoming-${UUID.randomUUID()}.db"; val store = IncomingStore(context,name)
  try { block(store,name) } finally { store.close(); context.deleteDatabase(name) }
 }
 @Test fun encryptedRecordsAndCursorSurviveReopenAndStayScoped() = isolated { store,name ->
  val id = UUID.randomUUID().toString()
  assertTrue(store.applyPage(binding,page("","cursor-1",change(id,type="assignment"))))
  val reopened = IncomingStore(context,name)
  try {
   assertEquals("cursor-1",reopened.cursor(binding)); assertEquals("SYNTHETIC INBOUND",reopened.record(binding,id)!!.getJSONObject("data").getString("text"))
   for(other in listOf(binding.copy(siteId="other"),binding.copy(guardId="other"),binding.copy(assignmentId="other"),binding.copy(deviceThumbprint="b".repeat(64)),binding.copy(revocationVersion=2))) {
    assertEquals("",reopened.cursor(other)); assertNull(reopened.record(other,id)); assertTrue(reopened.records(other).isEmpty())
   }
   reopened.readableDatabase.rawQuery("SELECT scope,body FROM incoming_record",null).use { c -> c.moveToFirst(); assertFalse(c.getString(0).contains(binding.guardId)); assertFalse(c.getString(1).contains("SYNTHETIC INBOUND")) }
   reopened.readableDatabase.rawQuery("SELECT body FROM incoming_cursor",null).use { c -> c.moveToFirst(); assertFalse(c.getString(0).contains("cursor-1")) }
  } finally { reopened.close() }
 }
 @Test fun retriesCanonicalOrderingUpdatesAndTombstonesAreIdempotent() = isolated { store,_ ->
  val id = UUID.randomUUID().toString(); val first = page("","c1",change(id))
  assertTrue(store.applyPage(binding,first)); assertFalse(store.applyPage(binding,first))
  val reordered = JSONObject().put("changes",first.getJSONArray("changes")).put("next_cursor","c1").put("previous_cursor","").put("scope",scope()).put("schema_version",1)
  assertFalse(store.applyPage(binding,reordered))
  assertTrue(store.applyPage(binding,page("c1","c2",change(id,2,text="UPDATED"))))
  assertEquals("UPDATED",store.record(binding,id)!!.getJSONObject("data").getString("text"))
  assertTrue(store.applyPage(binding,page("c2","c3",change(id,3,deleted=true))))
  assertTrue(store.records(binding).isEmpty()); assertEquals(1,store.records(binding,true).size)
  assertTrue(store.record(binding,id)!!.getBoolean("deleted")); assertEquals(0,store.record(binding,id)!!.getJSONObject("data").length())
  reject { store.applyPage(binding,page("c3","c4",change(id,2))) }
  assertEquals("c3",store.cursor(binding)); assertTrue(store.record(binding,id)!!.getBoolean("deleted"))
 }
 @Test fun conflictsDuplicateIdsAndWrongScopesDoNotAdvanceCursor() = isolated { store,_ ->
  val id = UUID.randomUUID().toString(); store.applyPage(binding,page("","c1",change(id)))
  reject { store.applyPage(binding,page("c1","c2",change(id,text="CONFLICT"))) }
  reject { store.applyPage(binding,page("c1","c2",change(id,2,type="assignment"))) }
  reject { store.applyPage(binding,page("c1","c2",change(id,2),change(id,3))) }
  reject { store.applyPage(binding,page("c1","c2").put("scope",scope(binding.copy(siteId="other")))) }
  assertEquals("c1",store.cursor(binding)); assertEquals("SYNTHETIC INBOUND",store.record(binding,id)!!.getJSONObject("data").getString("text"))
 }
 @Test fun failedCursorWriteRollsBackAllRecordsAndCanRetry() = isolated { store,_ ->
  val a = UUID.randomUUID().toString(); val b = UUID.randomUUID().toString(); val incoming = page("","c1",change(a),change(b,type="assignment"))
  store.writableDatabase.execSQL("CREATE TRIGGER reject_cursor BEFORE INSERT ON incoming_cursor BEGIN SELECT RAISE(ABORT, 'test interrupted page'); END")
  reject { store.applyPage(binding,incoming) }
  assertEquals("",store.cursor(binding)); assertNull(store.record(binding,a)); assertNull(store.record(binding,b))
  store.writableDatabase.execSQL("DROP TRIGGER reject_cursor")
  assertTrue(store.applyPage(binding,incoming)); assertEquals("c1",store.cursor(binding)); assertEquals(2,store.records(binding).size)
 }
 @Test fun alteredCiphertextCannotMoveBetweenRecordIds() = isolated { store,_ ->
  val a = UUID.randomUUID().toString(); val b = UUID.randomUUID().toString()
  store.applyPage(binding,page("","c1",change(a),change(b)))
  store.writableDatabase.execSQL("UPDATE incoming_record SET body=(SELECT body FROM incoming_record WHERE id=?) WHERE id=?",arrayOf(a,b))
  reject { store.record(binding,b) }; assertNotNull(store.record(binding,a)); assertEquals("c1",store.cursor(binding))
  store.readableDatabase.rawQuery("SELECT count(*) FROM incoming_record",null).use { c -> c.moveToFirst(); assertEquals(2,c.getInt(0)) }
 }
 @Test fun malformedAndStalePagesAreRejectedWithoutPartialChanges() = isolated { store,_ ->
  val id = UUID.randomUUID().toString()
  reject { store.applyPage(binding,page("","c1",change(id).put("version","1"))) }
  reject { store.applyPage(binding,page("","c1",change(id).put("deleted","false"))) }
  reject { store.applyPage(binding,page("","c1").put("extra",true)) }
  reject { store.applyPage(binding,page("","c1",change(id,text="x".repeat(270000)))) }
  reject { store.applyPage(binding,page("","c1").put("changes",JSONArray((0..100).map { change(UUID.randomUUID().toString()) }))) }
  assertEquals("",store.cursor(binding)); assertTrue(store.records(binding).isEmpty())
  assertTrue(store.applyPage(binding,page("","c1",change(id))))
  assertTrue(store.applyPage(binding,page("c1","c2")))
  reject { store.applyPage(binding,page("","c1",change(id))) }
  reject { store.applyPage(binding,page("c2","c2")) }
  assertEquals("c2",store.cursor(binding)); assertEquals(1,store.records(binding).size)
 }
}
