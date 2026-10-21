package ca.mercury.guard

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.content.ContentValues
import org.json.JSONObject
import org.json.JSONArray
import java.util.UUID

/** Whole event payload is encrypted; row IDs/counts remain visible. Not a tamper-evident history. */
class GuardStore(context: Context, databaseName: String = "mercury_demo.db") : SQLiteOpenHelper(context, databaseName, null, 3) {
 private val cipher = DeviceCipher()
 override fun onConfigure(db: SQLiteDatabase) {
  super.onConfigure(db)
  db.rawQuery("PRAGMA secure_delete=ON", null).use { cursor ->
   check(cursor.moveToFirst() && cursor.getInt(0) == 1) { "SQLite secure deletion unavailable" }
  }
 }
 override fun onOpen(db: SQLiteDatabase) {
  super.onOpen(db)
  // Authenticate an existing record before permitting new writes with a missing/replaced key.
  db.rawQuery("SELECT body FROM event ORDER BY id LIMIT 1", null).use { cursor ->
   if (cursor.moveToFirst()) cipher.decrypt(cursor.getString(0), "mercury-event-v1")
  }
 }
 override fun onCreate(db: SQLiteDatabase) {
  db.execSQL("CREATE TABLE outbox (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)")
  db.execSQL("CREATE TABLE event (id INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0)")
 }
 private fun protectedValues(at: Long, kind: String, body: JSONObject): ContentValues {
  val event = JSONObject().put("event_id", UUID.randomUUID().toString()).put("at", at).put("kind", kind).put("data", body)
  return ContentValues().apply {
   put("at_ms", 0L); put("kind", "encrypted_v1")
   put("body", cipher.encrypt(event.toString().toByteArray(Charsets.UTF_8), "mercury-event-v1"))
  }
 }
 override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
  if (oldVersion < 2) {
   db.rawQuery("SELECT id,at_ms,kind,body FROM event ORDER BY id", null).use { c ->
    while (c.moveToNext()) db.update("event", protectedValues(c.getLong(1), c.getString(2), JSONObject(c.getString(3))), "id=?", arrayOf(c.getLong(0).toString()))
   }
  }
  if (oldVersion < 3) {
   db.execSQL("CREATE TABLE outbox (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)")
   db.rawQuery("SELECT id,body FROM event ORDER BY id", null).use { c ->
    while (c.moveToNext()) {
     val event = decodeEvent(c.getString(1))
     if (!event.has("event_id")) {
      event.put("event_id", UUID.randomUUID().toString())
      db.update("event", ContentValues().apply { put("body", cipher.encrypt(event.toString().toByteArray(Charsets.UTF_8), "mercury-event-v1")) }, "id=?", arrayOf(c.getLong(0).toString()))
     }
    }
   }
  }
 }
 private fun decodeEvent(value: String) = JSONObject(String(cipher.decrypt(value, "mercury-event-v1"), Charsets.UTF_8))
 fun record(kind: String, body: JSONObject = JSONObject()) {
  writableDatabase.insertOrThrow("event", null, protectedValues(System.currentTimeMillis(), kind, body))
 }
 /** Ordered manual demo checkpoints; insertion and duplicate protection share one transaction. */
 fun patrolProgress(sessionId: String): Int {
  val events = org.json.JSONArray(exportJson())
  var next = 0
  for (i in 0 until events.length()) {
   val event = events.getJSONObject(i)
   val data = event.getJSONObject("data")
   if (event.getString("kind") == "patrol_checkpoint_demo" && data.optString("session") == sessionId && data.optInt("index", -1) == next) next++
  }
  return next
 }
 fun recordCheckpoint(sessionId: String, expectedIndex: Int): Boolean {
  val db = writableDatabase
  db.beginTransaction()
  try {
   val next = patrolProgress(sessionId)
   if (next != expectedIndex || next !in DemoRoute.checkpoints.indices) return false
   record("patrol_checkpoint_demo", JSONObject().put("session", sessionId).put("index", next)
    .put("checkpoint", DemoRoute.checkpoints[next]).put("source", "manual_demo").put("presence_verified", false))
   db.setTransactionSuccessful()
   return true
  } finally { db.endTransaction() }
 }
 /** Transport-neutral outbox only. No network caller or simulated delivery acknowledgement. */
 fun pendingCount(): Int = readableDatabase.rawQuery("SELECT count(*) FROM event WHERE synced=0", null).use { it.moveToFirst(); it.getInt(0) }
 fun prepareBatch(limit: Int = 50): JSONObject? {
  require(limit in 1..100)
  val db = writableDatabase
  db.beginTransaction()
  try {
   db.rawQuery("SELECT body FROM outbox WHERE id=1", null).use { c ->
    if (c.moveToFirst()) {
     val existing = JSONObject(String(cipher.decrypt(c.getString(0), "mercury-outbox-v1"), Charsets.UTF_8))
     db.setTransactionSuccessful()
     return existing
    }
   }
   val events = JSONArray()
   db.rawQuery("SELECT id,body FROM event WHERE synced=0 ORDER BY id LIMIT ?", arrayOf(limit.toString())).use { c ->
    while (c.moveToNext()) {
     val event = decodeEvent(c.getString(1)).put("sequence", c.getLong(0))
     // Bound serialized event data; an oversized first record fails without losing it.
     if (events.toString().toByteArray(Charsets.UTF_8).size + event.toString().toByteArray(Charsets.UTF_8).size > 262144) {
      check(events.length() > 0) { "Event exceeds batch size limit" }
      break
     }
     events.put(event)
    }
   }
   if (events.length() == 0) { db.setTransactionSuccessful(); return null }
   val batch = JSONObject().put("batch_id", UUID.randomUUID().toString()).put("schema_version", 1).put("events", events)
   saveBatch(db, batch)
   db.setTransactionSuccessful()
   return batch
  } finally { db.endTransaction() }
 }
 private fun saveBatch(db: SQLiteDatabase, batch: JSONObject) {
  db.insertWithOnConflict("outbox", null, ContentValues().apply {
   put("id", 1); put("body", cipher.encrypt(batch.toString().toByteArray(Charsets.UTF_8), "mercury-outbox-v1"))
  }, SQLiteDatabase.CONFLICT_REPLACE).also { check(it != -1L) }
 }
 /** Call only after a future authenticated transport validates a server receipt. */
 fun acknowledgeBatch(batchId: String, acceptedIds: Set<String>) {
  val db = writableDatabase
  db.beginTransaction()
  try {
   val batch = db.rawQuery("SELECT body FROM outbox WHERE id=1", null).use { c ->
    check(c.moveToFirst()) { "No pending batch" }
    JSONObject(String(cipher.decrypt(c.getString(0), "mercury-outbox-v1"), Charsets.UTF_8))
   }
   require(batch.getString("batch_id") == batchId) { "Receipt does not match pending batch" }
   val events = batch.getJSONArray("events")
   val allowed = (0 until events.length()).map { events.getJSONObject(it).getString("event_id") }.toSet()
   require(allowed.containsAll(acceptedIds)) { "Receipt includes an event outside the batch" }
   val remaining = JSONArray()
   for (i in 0 until events.length()) {
    val event = events.getJSONObject(i)
    if (event.getString("event_id") in acceptedIds) {
     val sequence = event.getLong("sequence")
     val stored = db.rawQuery("SELECT body FROM event WHERE id=?", arrayOf(sequence.toString())).use { c ->
      check(c.moveToFirst()); decodeEvent(c.getString(0))
     }
     check(stored.getString("event_id") == event.getString("event_id"))
     db.update("event", ContentValues().apply { put("synced", 1) }, "id=?", arrayOf(sequence.toString()))
    } else remaining.put(event)
   }
   if (remaining.length() == 0) db.delete("outbox", "id=1", null)
   else if (acceptedIds.isNotEmpty()) saveBatch(db, batch.put("batch_id", UUID.randomUUID().toString()).put("events", remaining))
   db.setTransactionSuccessful()
  } finally { db.endTransaction() }
 }
 fun count(): Int = readableDatabase.rawQuery("SELECT count(*) FROM event", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }
 fun exportJson(): String {
  val all = org.json.JSONArray()
  readableDatabase.rawQuery("SELECT body FROM event ORDER BY id", null).use { c ->
   while (c.moveToNext()) all.put(JSONObject(String(cipher.decrypt(c.getString(0), "mercury-event-v1"), Charsets.UTF_8)))
  }
  return all.toString(2)
 }
}
