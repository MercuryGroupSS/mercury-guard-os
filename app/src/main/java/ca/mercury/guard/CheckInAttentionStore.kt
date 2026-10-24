package ca.mercury.guard

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.security.MessageDigest

/** Original private reminder owner. No credentials or capture grant are persisted here. */
internal object ConnectedAttentionOwner {
 fun parse(value:JSONObject):ConnectedDispatchOwner {
  require(value.keys().asSequence().toSet()==setOf("version","configuration","device_id","subject","scope"))
  fun integer(j:JSONObject,k:String):Long{val v=j.get(k);require(v is Int||v is Long);return (v as Number).toLong()}
  fun text(j:JSONObject,k:String)=j.get(k) as? String?:error("Original reminder owner required")
  require(integer(value,"version")==1L)
  val s=value.getJSONObject("scope");require(s.keys().asSequence().toSet()==setOf("guard_id","vendor_id","site_id","assignment_id","device_thumbprint","revocation_version"))
  return ConnectedDispatchOwner(text(value,"configuration"),text(value,"device_id"),text(value,"subject"),DispatchScope(
   GrantBinding(text(s,"guard_id"),text(s,"site_id"),text(s,"assignment_id"),text(s,"device_thumbprint"),integer(s,"revocation_version")),text(s,"vendor_id")))
 }
}

/** Immutable policy/owner/slot with durable high-watermark attempts. Silence is never completion. */
internal class CheckInAttentionStore(context:Context,name:String="mercury_connected_attention.db"):
 SQLiteOpenHelper(context,name,null,1),java.io.Closeable {
 data class State(val lastAttempt:Int=-1,val attemptAt:Long?=null,val silenced:Boolean=false,val fullScreenAttempted:Boolean=false)
 private val cipher=DeviceCipher()
 override fun onConfigure(db:SQLiteDatabase){super.onConfigure(db);db.rawQuery("PRAGMA secure_delete=ON",null).use{check(it.moveToFirst()&&it.getInt(0)==1)}}
 override fun onCreate(db:SQLiteDatabase){db.execSQL("CREATE TABLE attention(owner TEXT PRIMARY KEY,body TEXT NOT NULL)")}
 override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){error("Unsupported attention state upgrade")}
 override fun onOpen(db:SQLiteDatabase){super.onOpen(db);db.rawQuery("SELECT owner,body FROM attention LIMIT 1",null).use{c->if(c.moveToFirst())cipher.decrypt(c.getString(1),"mercury-connected-attention:${c.getString(0)}")}}
 private fun key(owner:ConnectedDispatchOwner,p:AuthorizedCheckInPolicy,slot:Long):String {
  require(p.attention!=null&&slot in 0..10000)
  val source="mercury-connected-attention-state-v1\n"+owner.json().toString()+"\n"+p.revision+"\n"+slot
  return MessageDigest.getInstance("SHA-256").digest(source.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
 }
 private fun read(db:SQLiteDatabase,owner:ConnectedDispatchOwner,p:AuthorizedCheckInPolicy,slot:Long):State {
  val id=key(owner,p,slot)
  return db.rawQuery("SELECT body FROM attention WHERE owner=?",arrayOf(id)).use{c->
   if(!c.moveToFirst())return@use State()
   val bytes=cipher.decrypt(c.getString(0),"mercury-connected-attention:$id");val raw=String(bytes,Charsets.UTF_8);check(raw.toByteArray(Charsets.UTF_8).contentEquals(bytes))
   val j=JSONObject(raw);check(j.keys().asSequence().toSet()==setOf("version","owner","policy","slot","last_attempt","attempt_at","silenced","full_screen_attempted"))
   fun integer(k:String):Long{val v=j.get(k);check(v is Int||v is Long);return (v as Number).toLong()}
   check(integer("version")==1L&&ConnectedAttentionOwner.parse(j.getJSONObject("owner"))==owner&&integer("slot")==slot)
   check(j.getJSONObject("policy").toString()==p.json().toString()) {"Original attention policy changed without a new revision"}
   val last=integer("last_attempt");check(last in -1 until CheckInAttentionTiming.MAX_ATTEMPTS.toLong())
   val at=if(j.isNull("attempt_at"))null else integer("attempt_at")
   check((last==-1L)==(at==null))
   if(at!=null){val due=Math.addExact(p.startsAt,Math.multiplyExact(slot,p.interval));val cutoff=minOf(Math.addExact(due,p.window),p.endsAt,Math.addExact(due,CheckInAttentionTiming.BUDGET_MS))
    check(at in due until cutoff&&(at-due)/CheckInAttentionTiming.CUE_INTERVAL_MS==last){"Original attention attempt time mismatch"}}
   check(j.get("silenced") is Boolean&&j.get("full_screen_attempted") is Boolean)
   val state=State(last.toInt(),at,j.getBoolean("silenced"),j.getBoolean("full_screen_attempted"))
   check(!state.fullScreenAttempted||state.lastAttempt>=0)
   state
  }
 }
 private fun write(db:SQLiteDatabase,owner:ConnectedDispatchOwner,p:AuthorizedCheckInPolicy,slot:Long,state:State){
  val id=key(owner,p,slot);val j=JSONObject().put("version",1).put("owner",owner.json()).put("policy",p.json()).put("slot",slot)
   .put("last_attempt",state.lastAttempt).put("attempt_at",state.attemptAt?:JSONObject.NULL).put("silenced",state.silenced).put("full_screen_attempted",state.fullScreenAttempted)
  check(db.insertWithOnConflict("attention",null,ContentValues().apply{put("owner",id);put("body",cipher.encrypt(j.toString().toByteArray(Charsets.UTF_8),"mercury-connected-attention:$id"))},SQLiteDatabase.CONFLICT_REPLACE)!=-1L)
 }
 fun read(owner:ConnectedDispatchOwner,p:AuthorizedCheckInPolicy,slot:Long):State=read(readableDatabase,owner,p,slot)
 /** Atomically claim only the current logical attempt, before notification delivery. */
 fun claim(owner:ConnectedDispatchOwner,p:AuthorizedCheckInPolicy,slot:Long,now:Long,fullScreen:Boolean):State? {
  val db=writableDatabase;db.beginTransaction()
  try{
   val old=read(db,owner,p,slot);val d=CheckInAttentionTiming.evaluate(p.startsAt,p.endsAt,p.interval,p.window,now,old.lastAttempt,old.silenced)
   if(d.slot!=slot||!d.notify){db.setTransactionSuccessful();return null}
   val state=old.copy(lastAttempt=d.cueIndex!!,attemptAt=now,fullScreenAttempted=old.fullScreenAttempted||fullScreen)
   write(db,owner,p,slot,state);db.setTransactionSuccessful();return state
  }finally{db.endTransaction()}
 }
 fun silence(owner:ConnectedDispatchOwner,p:AuthorizedCheckInPolicy,slot:Long,now:Long):Boolean {
  val db=writableDatabase;db.beginTransaction()
  try{
   val old=read(db,owner,p,slot);val d=CheckInAttentionTiming.evaluate(p.startsAt,p.endsAt,p.interval,p.window,now,old.lastAttempt,old.silenced)
   if(d.slot!=slot||d.stage !in setOf(CheckInAttentionTiming.Stage.GREEN,CheckInAttentionTiming.Stage.YELLOW,CheckInAttentionTiming.Stage.RED)){db.setTransactionSuccessful();return false}
   write(db,owner,p,slot,old.copy(silenced=true));db.setTransactionSuccessful();return true
  }finally{db.endTransaction()}
 }
}
