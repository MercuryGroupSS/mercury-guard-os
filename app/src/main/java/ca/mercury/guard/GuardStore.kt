package ca.mercury.guard

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

/** Local encrypted device storage is needed before production. This is a demo-only SQLite queue. */
class GuardStore(context: Context) : SQLiteOpenHelper(context, "mercury_demo.db", null, 1) {
 override fun onCreate(db: SQLiteDatabase) {
  db.execSQL("CREATE TABLE event (id INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0)")
 }
 override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}
 fun record(kind: String, body: JSONObject = JSONObject()) {
  val cv = android.content.ContentValues().apply { put("at_ms", System.currentTimeMillis()); put("kind", kind); put("body", body.toString()) }
  writableDatabase.insertOrThrow("event", null, cv)
 }
 fun count(): Int = readableDatabase.rawQuery("SELECT count(*) FROM event", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }
 fun exportJson(): String {
  val all = org.json.JSONArray()
  readableDatabase.rawQuery("SELECT at_ms,kind,body FROM event ORDER BY id", null).use { c ->
   while (c.moveToNext()) all.put(JSONObject().put("at", c.getLong(0)).put("kind", c.getString(1)).put("data", JSONObject(c.getString(2))))
  }
  return all.toString(2)
 }
}
