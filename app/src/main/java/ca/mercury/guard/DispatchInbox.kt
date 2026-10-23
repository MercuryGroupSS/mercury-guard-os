package ca.mercury.guard

import android.content.Context
import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import org.json.JSONArray
import java.security.MessageDigest

/** Assignment-scoped encrypted messages and cursor. Fetching does not acknowledge a message. */
data class DispatchScope(val binding:GrantBinding,val vendorId:String){
 fun json()=JSONObject().put("guard_id",binding.guardId).put("vendor_id",vendorId).put("site_id",binding.siteId).put("assignment_id",binding.assignmentId).put("device_thumbprint",binding.deviceThumbprint).put("revocation_version",binding.revocationVersion)
}
class DispatchInbox internal constructor(context:Context,name:String="mercury_dispatch.db"):SQLiteOpenHelper(context,name,null,1),java.io.Closeable{
 private val cipher=DeviceCipher()
 override fun onCreate(db:SQLiteDatabase){db.execSQL("CREATE TABLE messages(owner TEXT NOT NULL, lookup TEXT NOT NULL, version INTEGER NOT NULL, active INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(owner,lookup))");db.execSQL("CREATE TABLE cursors(owner TEXT PRIMARY KEY, body TEXT NOT NULL)")}
 override fun onOpen(db:SQLiteDatabase){
  super.onOpen(db)
  db.rawQuery("SELECT owner,lookup,body FROM messages LIMIT 1",null).use{if(it.moveToFirst())decode(it.getString(2),"dispatch-message:${it.getString(0)}:${it.getString(1)}")}
  db.rawQuery("SELECT owner,body FROM cursors LIMIT 1",null).use{if(it.moveToFirst())decode(it.getString(1),"dispatch-cursor:${it.getString(0)}")}
 }
 override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){error("Unsupported inbox upgrade")}
 override fun onConfigure(db:SQLiteDatabase){super.onConfigure(db);db.rawQuery("PRAGMA secure_delete=ON",null).use{check(it.moveToFirst()&&it.getInt(0)==1)}}
 private fun hash(s:String)=MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
 private fun owner(scope:DispatchScope)=hash(scope.json().toString())
 private fun decode(body:String,aad:String)=JSONObject(String(cipher.decrypt(body,aad),Charsets.UTF_8))
 private fun encode(value:JSONObject,aad:String)=cipher.encrypt(value.toString().toByteArray(Charsets.UTF_8),aad)
 private fun number(j:JSONObject,key:String):Long {val n=j.get(key);require(n is Int||n is Long);return (n as Number).toLong()}
 private fun metadata(db:SQLiteDatabase,owner:String):JSONObject?=db.rawQuery("SELECT body FROM cursors WHERE owner=?",arrayOf(owner)).use{if(it.moveToFirst())decode(it.getString(0),"dispatch-cursor:$owner") else null}
 fun cursor(scope:DispatchScope):String?=metadata(readableDatabase,owner(scope))?.let{if(it.isNull("cursor"))null else it.getString("cursor")}
 private fun saveMetadata(db:SQLiteDatabase,owner:String,value:JSONObject){db.insertWithOnConflict("cursors",null,ContentValues().apply{put("owner",owner);put("body",encode(value,"dispatch-cursor:$owner"))},SQLiteDatabase.CONFLICT_REPLACE).also{check(it!=-1L)}}
 private fun message(value:JSONObject):JSONObject {
  require(value.keys().asSequence().toSet()==setOf("message_id","version","state","title","body","issued_at","due_at"))
  val id=value.get("message_id") as? String?:error("Message ID required");require(id.matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}")))
  val version=number(value,"version");val issued=number(value,"issued_at");require(version>0&&issued>0)
  val state=value.get("state") as? String;val title=value.get("title") as? String?:error("Title required");val body=value.get("body") as? String?:error("Body required")
  require(state in setOf("active","retracted")&&title.length<=200&&body.length<=8000)
  if(state=="active")require(title.isNotBlank()&&body.isNotBlank()) else require(title.isEmpty()&&body.isEmpty())
  val due=if(value.isNull("due_at"))null else number(value,"due_at").also{require(it>=issued)}
  return JSONObject().put("message_id",id).put("version",version).put("state",state).put("title",title).put("body",body).put("issued_at",issued).put("due_at",due?:JSONObject.NULL)
 }
 fun apply(scope:DispatchScope,expectedCursor:String?,page:JSONObject):Boolean {
  require(page.toString().toByteArray(Charsets.UTF_8).size<=262144)
  require(page.keys().asSequence().toSet()==setOf("scope","changes","next_cursor","has_more","server_time_ms"))
  val expected=scope.json();val received=page.getJSONObject("scope")
  require(received.keys().asSequence().toSet()==expected.keys().asSequence().toSet())
  for(key in expected.keys())if(key!="revocation_version")require(received.get(key) is String && received.getString(key)==expected.getString(key))
  require(number(received,"revocation_version")==scope.binding.revocationVersion)
  val next=page.get("next_cursor") as? String?:error("Cursor required");require(next.length in 1..100)
  val more=page.get("has_more") as? Boolean?:error("Page state required");if(more)require(next!=expectedCursor)
  val time=number(page,"server_time_ms");require(time>0)
  val changes=page.getJSONArray("changes");require(changes.length()<=25)
  val owner=owner(scope);val db=writableDatabase;db.beginTransaction()
  try{
   val old=metadata(db,owner);val current=old?.let{if(it.isNull("cursor"))null else it.getString("cursor")};check(current==expectedCursor){"Inbox advanced during refresh"}
   require(time>=(old?.optLong("server_time_ms")?:0));val seen=mutableSetOf<String>()
   for(i in 0 until changes.length()){
    val incoming=message(changes.getJSONObject(i));val id=incoming.getString("message_id");require(seen.add(id));val lookup=hash(id);val version=incoming.getLong("version");val aad="dispatch-message:$owner:$lookup"
    val prior=db.rawQuery("SELECT version,body FROM messages WHERE owner=? AND lookup=?",arrayOf(owner,lookup)).use{if(it.moveToFirst()){val wrapped=decode(it.getString(1),aad);check(wrapped.getJSONObject("message").getLong("version")==it.getLong(0));wrapped}else null}
    if(prior!=null){val previous=prior.getJSONObject("message");require(version>=previous.getLong("version"));if(version==previous.getLong("version"))require(previous.toString()==incoming.toString())}
    val wrapped=if(prior!=null&&prior.getJSONObject("message").getLong("version")==version)prior else JSONObject().put("message",incoming).put("read_at",JSONObject.NULL)
    check(db.insertWithOnConflict("messages",null,ContentValues().apply{put("owner",owner);put("lookup",lookup);put("version",version);put("active",if(incoming.getString("state")=="active")1 else 0);put("body",encode(wrapped,aad))},SQLiteDatabase.CONFLICT_REPLACE)!=-1L)
   }
   saveMetadata(db,owner,JSONObject().put("cursor",next).put("server_time_ms",time).put("has_more",more))
   db.setTransactionSuccessful();return more
  }finally{db.endTransaction()}
 }
 /** Explicit reset hides old content until the authenticated full feed returns it again. */
 fun resetCursor(scope:DispatchScope,expectedCursor:String?){
  val owner=owner(scope);val db=writableDatabase;db.beginTransaction();try{
   check(cursor(scope)==expectedCursor)
   db.update("messages",ContentValues().apply{put("active",0)},"owner=?",arrayOf(owner))
   val old=metadata(db,owner)?:JSONObject();saveMetadata(db,owner,old.put("cursor",JSONObject.NULL).put("has_more",true))
   db.setTransactionSuccessful()
  }finally{db.endTransaction()}
 }
 fun list(scope:DispatchScope,offset:Int=0):List<JSONObject>{
  require(offset>=0);val owner=owner(scope);val result=mutableListOf<JSONObject>()
  readableDatabase.rawQuery("SELECT lookup,body FROM messages WHERE owner=? AND active=1 ORDER BY rowid DESC LIMIT 30 OFFSET ?",arrayOf(owner,offset.toString())).use{c->while(c.moveToNext()){
   val wrapped=decode(c.getString(1),"dispatch-message:$owner:${c.getString(0)}");val m=wrapped.getJSONObject("message");check(m.getString("state")=="active"&&hash(m.getString("message_id"))==c.getString(0));result.add(wrapped)
  }};return result
 }
 fun markRead(scope:DispatchScope,id:String,version:Long,at:Long):JSONObject {
  require(at>0);val owner=owner(scope);val lookup=hash(id);val aad="dispatch-message:$owner:$lookup";val db=writableDatabase;db.beginTransaction()
  try{
   val wrapped=db.rawQuery("SELECT body FROM messages WHERE owner=? AND lookup=? AND active=1",arrayOf(owner,lookup)).use{check(it.moveToFirst());decode(it.getString(0),aad)}
   val m=wrapped.getJSONObject("message");check(m.getString("message_id")==id&&m.getLong("version")==version&&m.getString("state")=="active")
   if(wrapped.isNull("read_at"))wrapped.put("read_at",at)
   check(db.update("messages",ContentValues().apply{put("body",encode(wrapped,aad))},"owner=? AND lookup=?",arrayOf(owner,lookup))==1)
   db.setTransactionSuccessful();return wrapped
  }finally{db.endTransaction()}
 }
}
