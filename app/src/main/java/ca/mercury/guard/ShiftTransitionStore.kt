package ca.mercury.guard

import android.content.Context
import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/** Durable confirmation intent: a lost reply retries the same request, never a new clock time. */
class ShiftTransitionStore internal constructor(context:Context,name:String="mercury_shifts.db"):SQLiteOpenHelper(context,name,null,2),java.io.Closeable{
 private data class Address(val scope:DispatchScope,val key:String,val connected:ConnectedDispatchOwner?=null)
 private val cipher=DeviceCipher()
 companion object{
  internal fun validReason(reason:String)=reason.length<=2000&&JSONObject().put("reason",reason).toString().toByteArray(Charsets.UTF_8).size<=2000
 }
 override fun onConfigure(db:SQLiteDatabase){super.onConfigure(db);db.rawQuery("PRAGMA secure_delete=ON",null).use{check(it.moveToFirst()&&it.getInt(0)==1)}}
 override fun onOpen(db:SQLiteDatabase){
  super.onOpen(db)
  for((table,purpose) in listOf("transitions" to "shift-transition","rejected_history" to "shift-rejected")){
   db.rawQuery("SELECT owner,body FROM $table LIMIT 1",null).use{if(it.moveToFirst())cipher.decrypt(it.getString(1),"$purpose:${it.getString(0)}")}
  }
 }

 override fun onCreate(db:SQLiteDatabase){db.execSQL("CREATE TABLE transitions(owner TEXT PRIMARY KEY,body TEXT NOT NULL)");history(db)}
 private fun history(db:SQLiteDatabase){db.execSQL("CREATE TABLE IF NOT EXISTS rejected_history(owner TEXT PRIMARY KEY,body TEXT NOT NULL)")}
 override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){check(oldVersion==1&&newVersion==2);history(db)}
 private fun key(scope:DispatchScope,action:String)=MessageDigest.getInstance("SHA-256").digest((scope.json().toString()+"\n"+action).toByteArray()).joinToString(""){"%02x".format(it.toInt() and 255)}
 private fun address(scope:DispatchScope,action:String)=Address(scope,key(scope,action))
 private fun address(owner:ConnectedDispatchOwner,action:String):Address {
  val key=MessageDigest.getInstance("SHA-256").digest(("mercury-connected-shift-transition-v1\n"+owner.json().toString()+"\n"+action).toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
  return Address(owner.scope,key,owner)
 }
 private fun verifyOwner(address:Address,value:JSONObject):JSONObject {
  if(address.connected==null)check(!value.has("connected_owner")){"Legacy confirmation cannot adopt a connected owner"}
  else check(value.getJSONObject("connected_owner").toString()==address.connected.json().toString()){ "Original connected shift owner mismatch" }
  return value
 }
 private fun load(db:SQLiteDatabase,address:Address):JSONObject?=db.rawQuery("SELECT body FROM transitions WHERE owner=?",arrayOf(address.key)).use{if(it.moveToFirst())verifyOwner(address,JSONObject(String(cipher.decrypt(it.getString(0),"shift-transition:${address.key}"),Charsets.UTF_8))) else null}
 private fun save(db:SQLiteDatabase,address:Address,value:JSONObject){
  address.connected?.let{value.put("connected_owner",it.json())}
  check(db.insertWithOnConflict("transitions",null,ContentValues().apply{put("owner",address.key);put("body",cipher.encrypt(value.toString().toByteArray(Charsets.UTF_8),"shift-transition:${address.key}"))},SQLiteDatabase.CONFLICT_REPLACE)!=-1L)
 }
 /** Legacy scope-only intents remain retained, without being adopted by a connected account. */
 fun prepare(scope:DispatchScope,action:String,reason:String)=prepare(address(scope,action),action,reason)
 fun prepare(owner:ConnectedDispatchOwner,action:String,reason:String)=prepare(address(owner,action),action,reason)
 private fun prepare(address:Address,action:String,reason:String):JSONObject{
  require(action in setOf("start","end")&&validReason(reason)&&(action!="start"||reason.isEmpty()))
  val k=address.key;val db=writableDatabase;db.beginTransaction()
  try{
   val old=load(db,address)
   if(old!=null&&!old.has("rejection")){val request=old.getJSONObject("request");check(request.getString("reason")==reason){"Resolve the existing transition before changing it"};db.setTransactionSuccessful();return request}
   if(old!=null){
    val archive=k+":"+old.getJSONObject("request").getString("request_id")
    check(db.insertOrThrow("rejected_history",null,ContentValues().apply{put("owner",archive);put("body",cipher.encrypt(old.toString().toByteArray(Charsets.UTF_8),"shift-rejected:$archive"))})!=-1L)
   }
   val request=JSONObject().put("request_id",UUID.randomUUID().toString()).put("action",action).put("confirmed",true).put("reason",reason)
   save(db,address,JSONObject().put("request",request));db.setTransactionSuccessful();return request
  }finally{db.endTransaction()}
 }
 fun saved(scope:DispatchScope,action:String):JSONObject?=load(readableDatabase,address(scope,action))
 fun saved(owner:ConnectedDispatchOwner,action:String):JSONObject?=load(readableDatabase,address(owner,action))
 fun accept(scope:DispatchScope,action:String,receipt:JSONObject)=accept(address(scope,action),action,receipt)
 fun accept(owner:ConnectedDispatchOwner,action:String,receipt:JSONObject)=accept(address(owner,action),action,receipt)
 private fun accept(address:Address,action:String,receipt:JSONObject):Boolean{
  val scope=address.scope;val db=writableDatabase;db.beginTransaction()
  try{
   val value=load(db,address)?:error("No confirmed transition");val request=value.getJSONObject("request")
   if(receipt.optString("status")=="shift_rejected_local_only"){
    require(receipt.keys().asSequence().toSet()==setOf("request_id","scope","action","code","server_time_ms","status"))
    require(!value.has("receipt")&&receipt.get("request_id")==request.getString("request_id")&&receipt.get("action")==action)
    require(receipt.get("code") in setOf("shift_cannot_start","active_shift_conflict","shift_cannot_end","early_exit_reason_required"))
    val timestamp=receipt.get("server_time_ms");require((timestamp is Int||timestamp is Long)&&(timestamp as Number).toLong()>0)
    val expected=scope.json().apply{remove("revocation_version")};val actual=receipt.getJSONObject("scope")
    require(actual.keys().asSequence().toSet()==expected.keys().asSequence().toSet());for(field in expected.keys())require(actual.get(field)==expected.get(field))
    if(value.has("rejection"))require(value.getJSONObject("rejection").toString()==receipt.toString())
    save(db,address,value.put("rejection",receipt));db.setTransactionSuccessful();return false
   }
   require(!value.has("rejection"))
   require(receipt.keys().asSequence().toSet()==setOf("request_id","scope","action","recorded_at_ms","clocked_in_at_ms","clocked_out_at_ms","early_exit","reason","status"))
   require(receipt.get("request_id")==request.getString("request_id")&&receipt.get("action")==action&&receipt.get("status")=="shift_recorded_local_only")
   val expected=scope.json().apply{remove("revocation_version")};val actual=receipt.getJSONObject("scope")
   require(actual.keys().asSequence().toSet()==expected.keys().asSequence().toSet());for(field in expected.keys())require(actual.get(field)==expected.get(field))
   fun integer(field:String):Long{val n=receipt.get(field);require(n is Int||n is Long);return (n as Number).toLong().also{require(it>0)}}
   val at=integer("recorded_at_ms");val start=integer("clocked_in_at_ms");require(receipt.get("early_exit") is Boolean)
   if(action=="start")require(at==start&&receipt.isNull("clocked_out_at_ms")&&receipt.isNull("reason")&&!receipt.getBoolean("early_exit"))
   else require(integer("clocked_out_at_ms")==at&&at>=start&&receipt.get("reason")==request.get("reason"))
   if(value.has("receipt"))require(value.getJSONObject("receipt").toString()==receipt.toString())
   save(db,address,value.put("receipt",receipt));db.setTransactionSuccessful();return true
  }finally{db.endTransaction()}
 }
}
