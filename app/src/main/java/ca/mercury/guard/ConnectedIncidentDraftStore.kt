package ca.mercury.guard

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Original account and installation scope. A renewed grant never changes draft ownership. */
data class ConnectedIncidentDraftScope(val configuration:String,val deviceId:String,val thumbprint:String,
 val subject:String,val guardId:String,val vendorId:String,val siteId:String,val assignmentId:String){
 init{
  require(configuration.matches(Regex("[a-f0-9]{64}"))&&thumbprint.matches(Regex("[a-f0-9]{64}")))
  require(EscalationRules.uuid(subject)&&listOf(deviceId,guardId,vendorId,siteId,assignmentId).all{PatrolPlan.identifier(it)})
 }
 internal fun json()=JSONObject().put("configuration",configuration).put("device_id",deviceId).put("thumbprint",thumbprint)
  .put("subject",subject).put("guard_id",guardId).put("vendor_id",vendorId).put("site_id",siteId).put("assignment_id",assignmentId)
 internal fun owner():String=MessageDigest.getInstance("SHA-256").digest(JSONArray(listOf(configuration,deviceId,thumbprint,subject,guardId,vendorId,siteId,assignmentId)).toString().toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
 override fun toString()="ConnectedIncidentDraftScope(redacted)"
}

/** Encrypted unfinished text only. No tokens, capture, auto-submit, expiry rebinding or demo import. */
class ConnectedIncidentDraftStore internal constructor(context:Context,name:String="mercury_connected_incident_drafts.db"):
 SQLiteOpenHelper(context,name,null,1),java.io.Closeable{
 companion object{const val MAX_LENGTH=8000}
 private val cipher=DeviceCipher()
 override fun onConfigure(db:SQLiteDatabase){super.onConfigure(db);db.rawQuery("PRAGMA secure_delete=ON",null).use{check(it.moveToFirst()&&it.getInt(0)==1)}}
 override fun onCreate(db:SQLiteDatabase){db.execSQL("CREATE TABLE drafts(owner TEXT PRIMARY KEY,body TEXT NOT NULL)")}
 override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){error("Unsupported connected incident draft upgrade")}
 override fun onOpen(db:SQLiteDatabase){super.onOpen(db);db.rawQuery("SELECT owner,body FROM drafts LIMIT 1",null).use{if(it.moveToFirst())decode(it.getString(0),it.getString(1))}}
 private fun text(value:String):String {
  require(value.length<=MAX_LENGTH&&String(value.toByteArray(Charsets.UTF_8),Charsets.UTF_8)==value){"Incident draft text is invalid or too long"}
  return value
 }
 private fun decode(owner:String,body:String):Pair<ConnectedIncidentDraftScope,String>{
  val bytes=cipher.decrypt(body,"mercury-connected-incident-draft:$owner");val raw=String(bytes,Charsets.UTF_8)
  check(raw.toByteArray(Charsets.UTF_8).contentEquals(bytes))
  val value=JSONObject(raw);check(value.keys().asSequence().toSet()==setOf("scope","text"))
  val scope=value.getJSONObject("scope");check(scope.keys().asSequence().toSet()==setOf("configuration","device_id","thumbprint","subject","guard_id","vendor_id","site_id","assignment_id"))
  fun string(key:String)=scope.get(key) as? String?:error("Original draft scope required")
  val original=ConnectedIncidentDraftScope(string("configuration"),string("device_id"),string("thumbprint"),string("subject"),string("guard_id"),string("vendor_id"),string("site_id"),string("assignment_id"))
  check(original.owner()==owner){"Original draft owner mismatch"}
  return original to text(value.get("text") as? String?:error("Original draft text required"))
 }
 private fun read(db:SQLiteDatabase,scope:ConnectedIncidentDraftScope):String?=db.rawQuery("SELECT body FROM drafts WHERE owner=?",arrayOf(scope.owner())).use{cursor->
  if(!cursor.moveToFirst())null else decode(scope.owner(),cursor.getString(0)).let{check(it.first==scope);it.second}
 }
 /** Caller must resolve the same individually authorized scope before displaying returned text. */
 fun read(scope:ConnectedIncidentDraftScope):String?=read(readableDatabase,scope)
 /** Preserve every bounded edit, including whitespace. Saving text never submits an incident. */
 fun write(scope:ConnectedIncidentDraftScope,value:String){
  text(value);val db=writableDatabase;db.beginTransaction()
  try{
   read(db,scope) // Authenticate an existing draft before replacement; preserve unreadable data.
   val body=JSONObject().put("scope",scope.json()).put("text",value)
   check(db.insertWithOnConflict("drafts",null,ContentValues().apply{put("owner",scope.owner());put("body",cipher.encrypt(body.toString().toByteArray(Charsets.UTF_8),"mercury-connected-incident-draft:${scope.owner()}"))},SQLiteDatabase.CONFLICT_REPLACE)!=-1L)
   db.setTransactionSuccessful()
  }finally{db.endTransaction()}
 }
 /** Explicit save/discard only; a stale screen cannot erase another instance's newer edit. */
 fun clear(scope:ConnectedIncidentDraftScope,expectedText:String):Boolean {
  text(expectedText);val db=writableDatabase;db.beginTransaction()
  try{
   if(read(db,scope)!=expectedText){db.setTransactionSuccessful();return false}
   check(db.delete("drafts","owner=?",arrayOf(scope.owner()))==1);db.setTransactionSuccessful();return true
  }finally{db.endTransaction()}
 }
}
