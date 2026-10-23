package ca.mercury.guard

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class EscalationScope(val configuration:String,val deviceId:String,val thumbprint:String,val subject:String,val guardId:String,val vendorId:String){
 init{require(configuration.matches(Regex("[a-f0-9]{64}"))&&thumbprint.matches(Regex("[a-f0-9]{64}"))&&EscalationRules.uuid(subject)&&listOf(deviceId,guardId,vendorId).all{PatrolPlan.identifier(it)})}
 internal fun json()=JSONObject().put("configuration",configuration).put("device_id",deviceId).put("thumbprint",thumbprint).put("subject",subject).put("guard_id",guardId).put("vendor_id",vendorId)
 internal fun owner()=EscalationProtocol.hash(JSONArray(listOf(configuration,deviceId,thumbprint,subject,guardId,vendorId)).toString())
 override fun toString()="EscalationScope(redacted)"
}
class EscalationRecord internal constructor(val id:String,val scope:EscalationScope,val raw:String,val hash:String,val receipt:JSONObject?,val snapshot:JSONObject?,val review:JSONObject?){
 val intent get()=EscalationProtocol.parse(raw)
 val state get()=if(snapshot?.optString("status")=="operator_acknowledged")"Operator acknowledged" else if(receipt!=null)"Service received" else "Saved locally"
 override fun toString()="EscalationRecord(redacted)"
}
class EscalationLease internal constructor(val token:String,val record:EscalationRecord){override fun toString()="EscalationLease(redacted)"}

/** Separate immutable intent queue. Never imports demo/shift audit events or changes their attribution. */
class EscalationStore internal constructor(context:Context,name:String="mercury_escalations.db",
 private val elapsed:()->Long={android.os.SystemClock.elapsedRealtime()},
 private val boot:()->Int={android.provider.Settings.Global.getInt(context.contentResolver,android.provider.Settings.Global.BOOT_COUNT,-1)}):SQLiteOpenHelper(context,name,null,1),java.io.Closeable{
 private val cipher=DeviceCipher()
 override fun onConfigure(db:SQLiteDatabase){super.onConfigure(db);db.rawQuery("PRAGMA secure_delete=ON",null).use{check(it.moveToFirst()&&it.getInt(0)==1)}}
 override fun onCreate(db:SQLiteDatabase){
  db.execSQL("CREATE TABLE intents(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,owner TEXT NOT NULL,body TEXT NOT NULL,receipt TEXT,snapshot TEXT,review TEXT,lease TEXT,lease_until INTEGER,lease_boot INTEGER,last_poll INTEGER,last_boot INTEGER)")
  db.execSQL("CREATE INDEX intents_owner_sequence ON intents(owner,sequence)")
 }
 override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){error("Unsupported escalation queue upgrade")}
 override fun onOpen(db:SQLiteDatabase){super.onOpen(db);db.rawQuery("SELECT * FROM intents ORDER BY sequence LIMIT 1",null).use{if(it.moveToFirst())record(it)}}
 private fun decode(raw:String,purpose:String)=JSONObject(String(cipher.decrypt(raw,purpose),Charsets.UTF_8))
 private fun encode(value:JSONObject,purpose:String)=cipher.encrypt(value.toString().toByteArray(Charsets.UTF_8),purpose)
 private fun scope(j:JSONObject)=EscalationScope(j.getString("configuration"),j.getString("device_id"),j.getString("thumbprint"),j.getString("subject"),j.getString("guard_id"),j.getString("vendor_id"))
 private fun record(c:android.database.Cursor):EscalationRecord {
  fun text(k:String)=c.getString(c.getColumnIndexOrThrow(k))
  fun optional(k:String,purpose:String):JSONObject?=c.getColumnIndexOrThrow(k).let{if(c.isNull(it))null else decode(c.getString(it),purpose)}
  val id=text("id");require(EscalationRules.uuid(id));val value=decode(text("body"),"mercury-escalation:$id")
  require(value.keys().asSequence().toSet()==setOf("scope","intent_raw","intent_sha256"))
  val original=scope(value.getJSONObject("scope"));val raw=value.getString("intent_raw");val hash=value.getString("intent_sha256");val intent=EscalationProtocol.parse(raw)
  check(original.owner()==text("owner")&&intent.id==id&&intent.guardId==original.guardId&&intent.vendorId==original.vendorId&&hash==EscalationProtocol.hash(raw))
  val receipt=optional("receipt","mercury-escalation-receipt:$id")?.let{EscalationProtocol.receipt(it,id,hash)}
  val snapshot=optional("snapshot","mercury-escalation-status:$id")?.let{check(receipt!=null);EscalationProtocol.status(it,id,hash,receipt)}
  return EscalationRecord(id,original,raw,hash,receipt,snapshot,optional("review","mercury-escalation-review:$id"))
 }
 fun save(scope:EscalationScope,intent:EscalationIntent):EscalationRecord=saveRaw(scope,EscalationProtocol.raw(intent))
 internal fun saveRaw(scope:EscalationScope,raw:String):EscalationRecord {
  val intent=EscalationProtocol.parse(raw);require(intent.guardId==scope.guardId&&intent.vendorId==scope.vendorId)
  val hash=EscalationProtocol.hash(raw);val db=writableDatabase;db.beginTransaction()
  try{
   val prior=get(db,intent.id,scope)
   if(prior!=null){check(prior.raw==raw&&prior.hash==hash);db.setTransactionSuccessful();return prior}
   val body=JSONObject().put("scope",scope.json()).put("intent_raw",raw).put("intent_sha256",hash)
   db.insertOrThrow("intents",null,ContentValues().apply{put("id",intent.id);put("owner",scope.owner());put("body",encode(body,"mercury-escalation:${intent.id}"))})
   val saved=get(db,intent.id,scope)?:error("Escalation not retained");db.setTransactionSuccessful();return saved
  }finally{db.endTransaction()}
 }
 private fun get(db:SQLiteDatabase,id:String,scope:EscalationScope):EscalationRecord?=db.rawQuery("SELECT * FROM intents WHERE id=? AND owner=?",arrayOf(id,scope.owner())).use{if(it.moveToFirst())record(it).also{r->check(r.scope==scope)}else null}
 fun get(id:String,scope:EscalationScope)=get(readableDatabase,id,scope)
 fun list(scope:EscalationScope):List<EscalationRecord>{val rows=mutableListOf<EscalationRecord>();readableDatabase.rawQuery("SELECT * FROM intents WHERE owner=? ORDER BY sequence DESC LIMIT 50",arrayOf(scope.owner())).use{while(it.moveToNext())rows.add(record(it))};return rows}
 internal fun claim(scope:EscalationScope,generation:String,id:String?=null):EscalationLease? {
  val db=writableDatabase;db.beginTransaction()
  try{
   val now=elapsed();val boot=boot();var chosen:EscalationRecord?=null
   db.rawQuery("SELECT * FROM intents WHERE owner=?"+(if(id==null)"" else " AND id=?")+" ORDER BY sequence",if(id==null)arrayOf(scope.owner())else arrayOf(scope.owner(),id)).use{c->while(c.moveToNext()){
    val r=record(c);check(r.scope==scope)
    val lease=c.getColumnIndexOrThrow("lease_until");val leaseBoot=c.getColumnIndexOrThrow("lease_boot")
    if(!c.isNull(lease)&&!c.isNull(leaseBoot)&&c.getInt(leaseBoot)==boot&&c.getLong(lease)>now)continue
    if(r.snapshot?.optString("status")=="operator_acknowledged")continue
    if(id==null&&r.review?.optString("generation")==generation)continue
    val last=c.getColumnIndexOrThrow("last_poll");val lastBoot=c.getColumnIndexOrThrow("last_boot")
    if(id==null&&r.receipt!=null&&!c.isNull(last)&&!c.isNull(lastBoot)&&c.getInt(lastBoot)==boot&&now-c.getLong(last)<60000)continue
    chosen=r;break
   }}
   val r=chosen?:run{db.setTransactionSuccessful();return null};val token=UUID.randomUUID().toString()
   check(db.update("intents",ContentValues().apply{put("lease",token);put("lease_until",Math.addExact(now,120000));put("lease_boot",boot)},"id=? AND owner=?",arrayOf(r.id,scope.owner()))==1)
   db.setTransactionSuccessful();return EscalationLease(token,r)
  }finally{db.endTransaction()}
 }
 private fun leased(db:SQLiteDatabase,lease:EscalationLease):EscalationRecord {
  val r=get(db,lease.record.id,lease.record.scope)?:error("Original escalation unavailable")
  check(r.raw==lease.record.raw&&r.hash==lease.record.hash)
  db.rawQuery("SELECT lease FROM intents WHERE id=?",arrayOf(r.id)).use{check(it.moveToFirst()&&it.getString(0)==lease.token)}
  return r
 }
 internal fun accepted(lease:EscalationLease,response:JSONObject,status:Boolean){
  val db=writableDatabase;db.beginTransaction()
  try{
   val r=leased(db,lease)
   val snapshot=if(status)EscalationProtocol.status(response,r.id,r.hash,r.receipt) else null
   val receipt=if(status)JSONObject(response.toString()).apply{remove("acknowledgement");put("status","received_by_guard_service")}else EscalationProtocol.receipt(response,r.id,r.hash)
   if(r.receipt!=null)for(k in r.receipt.keys())require(r.receipt.get(k)==receipt.get(k))
   if(r.snapshot?.optString("status")=="operator_acknowledged")require(snapshot?.toString()==r.snapshot.toString())
   val values=ContentValues().apply{put("receipt",encode(receipt,"mercury-escalation-receipt:${r.id}"));if(snapshot!=null)put("snapshot",encode(snapshot,"mercury-escalation-status:${r.id}"));putNull("review");putNull("lease");putNull("lease_until");putNull("lease_boot");put("last_poll",elapsed());put("last_boot",boot())}
   check(db.update("intents",values,"id=?",arrayOf(r.id))==1);db.setTransactionSuccessful()
  }finally{db.endTransaction()}
 }
 internal fun release(lease:EscalationLease,reviewGeneration:String?=null,code:Int=0){
  val db=writableDatabase;db.beginTransaction()
  try{
   val r=leased(db,lease)
   val values=ContentValues().apply{putNull("lease");putNull("lease_until");putNull("lease_boot");if(reviewGeneration!=null)put("review",encode(JSONObject().put("generation",reviewGeneration).put("code",code).put("state","retained_service_outcome_unconfirmed"),"mercury-escalation-review:${r.id}"))}
   check(db.update("intents",values,"id=?",arrayOf(r.id))==1);db.setTransactionSuccessful()
  }finally{db.endTransaction()}
 }
 internal fun awaiting(scope:EscalationScope,generation:String):Boolean {
  readableDatabase.rawQuery("SELECT * FROM intents WHERE owner=?",arrayOf(scope.owner())).use{c->while(c.moveToNext()){val r=record(c);if(r.snapshot?.optString("status")!="operator_acknowledged"&&r.review?.optString("generation")!=generation)return true}}
  return false
 }
}
