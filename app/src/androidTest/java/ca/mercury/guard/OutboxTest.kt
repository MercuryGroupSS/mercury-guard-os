package ca.mercury.guard

import android.database.sqlite.SQLiteDatabase
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import org.json.JSONArray
import java.util.UUID

class OutboxTest {
 private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
 private fun reject(block: () -> Unit) { var rejected = false; try { block() } catch (_: IllegalArgumentException) { rejected = true }; assertTrue(rejected) }
 @Test fun retriesReopenPartialReceiptsAndIsolation() {
  val name = "outbox-${UUID.randomUUID()}.db"
  var db = GuardStore(context, name)
  try {
   repeat(3) { db.record("test", JSONObject().put("n", it)) }
   val batch = db.prepareBatch(2)!!
   val batchId = batch.getString("batch_id")
   val events = batch.getJSONArray("events")
   val first = events.getJSONObject(0).getString("event_id")
   val second = events.getJSONObject(1).getString("event_id")
   assertNotEquals(first, second)
   assertTrue(events.getJSONObject(0).getLong("sequence") < events.getJSONObject(1).getLong("sequence"))
   assertEquals(batch.toString(), db.prepareBatch(1)!!.toString())
   db.close(); db = GuardStore(context, name)
   assertEquals(batch.toString(), db.prepareBatch()!!.toString())
   reject { db.acknowledgeBatch("wrong", setOf(first)) }
   reject { db.acknowledgeBatch(batchId, setOf(first, "not-in-batch")) }
   assertEquals(3, db.pendingCount())
   db.acknowledgeBatch(batchId, setOf(first))
   assertEquals(2, db.pendingCount())
   val retry = db.prepareBatch()!!
   assertNotEquals(batchId, retry.getString("batch_id"))
   assertEquals(second, retry.getJSONArray("events").getJSONObject(0).getString("event_id"))
   reject { db.acknowledgeBatch(batchId, setOf(second)) }
   db.acknowledgeBatch(retry.getString("batch_id"), setOf(second))
   assertEquals(1, db.pendingCount())
   val last = db.prepareBatch()!!
   assertEquals(1, last.getJSONArray("events").length())
   db.acknowledgeBatch(last.getString("batch_id"), setOf(last.getJSONArray("events").getJSONObject(0).getString("event_id")))
   assertEquals(0, db.pendingCount()); assertNull(db.prepareBatch()); assertEquals(3, db.count())
   assertEquals(3, JSONArray(db.exportJson()).length())
  } finally { db.close(); context.deleteDatabase(name) }
 }
 @Test fun versionTwoMigrationCreatesStableIdentities() {
  val name = "outbox-migrate-${UUID.randomUUID()}.db"
  val path = context.getDatabasePath(name).apply { parentFile!!.mkdirs() }
  val raw = SQLiteDatabase.openOrCreateDatabase(path, null)
  try {
   raw.execSQL("CREATE TABLE event (id INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0)")
   val body = DeviceCipher().encrypt(JSONObject().put("at", 123).put("kind", "test").put("data", JSONObject().put("note", "LEGACY SYNTHETIC")).toString().toByteArray(Charsets.UTF_8), "mercury-event-v1")
   raw.execSQL("INSERT INTO event(at_ms,kind,body) VALUES(0,'encrypted_v1',?)", arrayOf(body))
   raw.version = 2
  } finally { raw.close() }
  var db = GuardStore(context, name)
  try {
   val event = JSONArray(db.exportJson()).getJSONObject(0)
   val id = event.getString("event_id")
   UUID.fromString(id)
   assertEquals(123, event.getInt("at"))
   assertEquals("LEGACY SYNTHETIC", event.getJSONObject("data").getString("note"))
   db.close(); db = GuardStore(context, name)
   assertEquals(id, db.prepareBatch()!!.getJSONArray("events").getJSONObject(0).getString("event_id"))
   reject { db.prepareBatch(0) }; reject { db.prepareBatch(101) }
   db.readableDatabase.rawQuery("SELECT body FROM outbox", null).use { c -> assertTrue(c.moveToFirst()); assertFalse(c.getString(0).contains(id)); assertFalse(c.getString(0).contains("LEGACY SYNTHETIC")) }
  } finally { db.close(); context.deleteDatabase(name) }
 }
 @Test fun oversizedEventIsRetainedWithoutCreatingBatch() {
  val name = "outbox-large-${UUID.randomUUID()}.db"
  val db = GuardStore(context, name)
  try {
   db.record("test", JSONObject().put("note", "x".repeat(270000)))
   var rejected = false
   try { db.prepareBatch() } catch (_: IllegalStateException) { rejected = true }
   assertTrue(rejected); assertEquals(1, db.pendingCount()); assertEquals(1, db.count())
   db.readableDatabase.rawQuery("SELECT count(*) FROM outbox", null).use { c -> c.moveToFirst(); assertEquals(0, c.getInt(0)) }
  } finally { db.close(); context.deleteDatabase(name) }
 }
}
