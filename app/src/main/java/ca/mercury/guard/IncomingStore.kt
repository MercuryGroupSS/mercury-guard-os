package ca.mercury.guard

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/** Transport-neutral encrypted receive cache. Caller must authenticate server, grant and scope first. */
class IncomingStore(context: Context, databaseName: String = "mercury_incoming.db") : SQLiteOpenHelper(context,databaseName,null,1) {
 private val cipher = DeviceCipher()
 companion object {
  private val scopeFields = setOf("guard_id","site_id","assignment_id","device_thumbprint","revocation_version")
  private val changeFields = setOf("id","version","type","deleted","data")
  private fun canonical(value: Any?): String = when (value) {
   null, JSONObject.NULL -> "null"
   is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",","{","}") { JSONObject.quote(it)+":"+canonical(value.get(it)) }
   is JSONArray -> (0 until value.length()).joinToString(",","[","]") { canonical(value.get(it)) }
   is String -> JSONObject.quote(value)
   is Number -> JSONObject.numberToString(value)
   is Boolean -> value.toString()
   else -> error("Unsupported JSON value")
  }
  private fun hash(text: String) = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
  private fun integer(value: Any): Long { require(value is Int || value is Long); return (value as Number).toLong() }
  private fun uuid(value: Any): String = (value as? String ?: error("UUID required")).also { require(UUID.fromString(it).toString() == it) }
  private fun token(value: Any): String = (value as? String ?: error("Cursor required")).also { require(it.length <= 512 && it.all { c -> c.code in 33..126 }) }
  private fun scope(binding: GrantBinding): JSONObject {
   require(listOf(binding.guardId,binding.siteId,binding.assignmentId).all { it.isNotBlank() && it.length <= 256 })
   require(binding.deviceThumbprint.matches(Regex("[a-f0-9]{64}")) && binding.revocationVersion >= 0)
   return JSONObject().put("guard_id",binding.guardId).put("site_id",binding.siteId).put("assignment_id",binding.assignmentId)
    .put("device_thumbprint",binding.deviceThumbprint).put("revocation_version",binding.revocationVersion)
  }
 }
 override fun onCreate(db: SQLiteDatabase) {
  db.execSQL("CREATE TABLE incoming_record (scope TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(scope,id))")
  db.execSQL("CREATE TABLE incoming_cursor (scope TEXT PRIMARY KEY, body TEXT NOT NULL)")
 }
 override fun onConfigure(db: SQLiteDatabase) {
  super.onConfigure(db)
  db.rawQuery("PRAGMA secure_delete=ON",null).use { c -> check(c.moveToFirst() && c.getInt(0)==1) }
 }
 override fun onOpen(db: SQLiteDatabase) {
  super.onOpen(db)
  db.rawQuery("SELECT scope,id,body FROM incoming_record LIMIT 1",null).use { c -> if(c.moveToFirst()) cipher.decrypt(c.getString(2),"mercury-incoming-record-v1:${c.getString(0)}:${c.getString(1)}") }
  db.rawQuery("SELECT scope,body FROM incoming_cursor LIMIT 1",null).use { c -> if(c.moveToFirst()) cipher.decrypt(c.getString(1),"mercury-incoming-cursor-v1:${c.getString(0)}") }
 }
 override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { error("Unsupported incoming schema upgrade") }
 private fun cursorState(db: SQLiteDatabase, key: String): JSONObject? = db.rawQuery("SELECT body FROM incoming_cursor WHERE scope=?",arrayOf(key)).use { c ->
  if(c.moveToFirst()) JSONObject(String(cipher.decrypt(c.getString(0),"mercury-incoming-cursor-v1:$key"),Charsets.UTF_8)) else null
 }
 private fun read(db: SQLiteDatabase, key: String, id: String): JSONObject? = db.rawQuery("SELECT body FROM incoming_record WHERE scope=? AND id=?",arrayOf(key,id)).use { c ->
  if(c.moveToFirst()) JSONObject(String(cipher.decrypt(c.getString(0),"mercury-incoming-record-v1:$key:$id"),Charsets.UTF_8)) else null
 }
 fun cursor(binding: GrantBinding): String = cursorState(readableDatabase,hash(canonical(scope(binding))))?.getString("cursor") ?: ""
 fun record(binding: GrantBinding, id: String): JSONObject? = read(readableDatabase,hash(canonical(scope(binding))),uuid(id))
 fun records(binding: GrantBinding, includeDeleted: Boolean = false, limit: Int = 50): List<JSONObject> {
  require(limit in 1..100)
  val key = hash(canonical(scope(binding))); val result = mutableListOf<JSONObject>()
  // Inspect bounded rows; a page may contain fewer visible records when tombstones are present.
  readableDatabase.rawQuery("SELECT id,body FROM incoming_record WHERE scope=? ORDER BY id LIMIT ?",arrayOf(key,limit.toString())).use { c ->
   while(c.moveToNext()) {
    val item = JSONObject(String(cipher.decrypt(c.getString(1),"mercury-incoming-record-v1:$key:${c.getString(0)}"),Charsets.UTF_8))
    if(includeDeleted || !item.getBoolean("deleted")) result.add(item)
   }
  }
  return result
 }
 /** Exact replay of the most recently applied page is a no-op. All other stale cursors fail. */
 fun applyPage(binding: GrantBinding, page: JSONObject): Boolean {
  val raw = page.toString(); require(raw.toByteArray(Charsets.UTF_8).size <= 262144)
  val snapshot = JSONObject(raw)
  require(snapshot.keys().asSequence().toSet() == setOf("schema_version","scope","previous_cursor","next_cursor","changes"))
  require(integer(snapshot.get("schema_version")) == 1L)
  val incomingScope = snapshot.getJSONObject("scope"); val expected = scope(binding)
  require(incomingScope.keys().asSequence().toSet() == scopeFields && canonical(incomingScope) == canonical(expected))
  val previous = token(snapshot.get("previous_cursor")); val next = token(snapshot.get("next_cursor")); require(next.isNotEmpty() && previous != next)
  val changes = snapshot.getJSONArray("changes"); require(changes.length() <= 100)
  val key = hash(canonical(expected)); val pageHash = hash(canonical(snapshot)); val db = writableDatabase
  db.beginTransaction()
  try {
   val current = cursorState(db,key)
   if(current?.getString("cursor") == next && current.getString("page_hash") == pageHash) { db.setTransactionSuccessful(); return false }
   require((current?.getString("cursor") ?: "") == previous) { "Incoming cursor mismatch" }
   val seen = mutableSetOf<String>()
   for(i in 0 until changes.length()) {
    val change = changes.getJSONObject(i)
    require(change.keys().asSequence().toSet() == changeFields)
    val id = uuid(change.get("id")); require(seen.add(id))
    val version = integer(change.get("version")); require(version > 0)
    require(change.get("type") is String && change.getString("type") in setOf("assignment","dispatch"))
    require(change.get("deleted") is Boolean)
    val data = change.getJSONObject("data"); if(change.getBoolean("deleted")) require(data.length() == 0)
    val existing = read(db,key,id)
    if(existing != null) {
     require(existing.getString("type") == change.getString("type"))
     require(version >= integer(existing.get("version"))) { "Stale incoming version" }
     if(version == integer(existing.get("version"))) require(canonical(existing) == canonical(change)) { "Conflicting incoming version" }
    }
    if(existing == null || version > integer(existing.get("version"))) {
     check(db.insertWithOnConflict("incoming_record",null,ContentValues().apply {
      put("scope",key); put("id",id); put("body",cipher.encrypt(canonical(change).toByteArray(Charsets.UTF_8),"mercury-incoming-record-v1:$key:$id"))
     },SQLiteDatabase.CONFLICT_REPLACE) != -1L)
    }
   }
   val state = JSONObject().put("cursor",next).put("page_hash",pageHash)
   check(db.insertWithOnConflict("incoming_cursor",null,ContentValues().apply {
    put("scope",key); put("body",cipher.encrypt(state.toString().toByteArray(Charsets.UTF_8),"mercury-incoming-cursor-v1:$key"))
   },SQLiteDatabase.CONFLICT_REPLACE) != -1L)
   db.setTransactionSuccessful(); return true
  } finally { db.endTransaction() }
 }
}
