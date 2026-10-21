package ca.mercury.guard

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.content.ContentValues
import org.json.JSONObject

/** Whole event payload is encrypted; row IDs/counts remain visible. Not a tamper-evident history. */
class GuardStore(context: Context, databaseName: String = "mercury_demo.db") : SQLiteOpenHelper(context, databaseName, null, 2) {
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
  db.execSQL("CREATE TABLE event (id INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0)")
 }
 private fun protectedValues(at: Long, kind: String, body: JSONObject): ContentValues {
  val event = JSONObject().put("at", at).put("kind", kind).put("data", body)
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
 }
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
 fun count(): Int = readableDatabase.rawQuery("SELECT count(*) FROM event", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }
 fun exportJson(): String {
  val all = org.json.JSONArray()
  readableDatabase.rawQuery("SELECT body FROM event ORDER BY id", null).use { c ->
   while (c.moveToNext()) all.put(JSONObject(String(cipher.decrypt(c.getString(0), "mercury-event-v1"), Charsets.UTF_8)))
  }
  return all.toString(2)
 }
}
