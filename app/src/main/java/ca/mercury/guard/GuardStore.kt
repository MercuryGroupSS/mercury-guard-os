package ca.mercury.guard

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.content.ContentValues
import org.json.JSONObject

/** Whole event payload is encrypted; row IDs/counts remain visible. Not a tamper-evident history. */
class GuardStore(context: Context, databaseName: String = "mercury_demo.db") : SQLiteOpenHelper(context, databaseName, null, 2) {
 private val cipher = DeviceCipher()
 override fun onConfigure(db: SQLiteDatabase) { super.onConfigure(db); db.execSQL("PRAGMA secure_delete=ON") }
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
 fun count(): Int = readableDatabase.rawQuery("SELECT count(*) FROM event", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }
 fun exportJson(): String {
  val all = org.json.JSONArray()
  readableDatabase.rawQuery("SELECT body FROM event ORDER BY id", null).use { c ->
   while (c.moveToNext()) all.put(JSONObject(String(cipher.decrypt(c.getString(0), "mercury-event-v1"), Charsets.UTF_8)))
  }
  return all.toString(2)
 }
}
