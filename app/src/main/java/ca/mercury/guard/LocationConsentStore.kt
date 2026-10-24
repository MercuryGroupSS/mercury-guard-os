package ca.mercury.guard

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.util.UUID

internal data class LocationConsentScope(val account:EscalationScope,val binding:GrantBinding){
 init{require(account.guardId==binding.guardId&&account.thumbprint==binding.deviceThumbprint&&PatrolPlan.identifier(binding.siteId)&&PatrolPlan.identifier(binding.assignmentId)&&binding.revocationVersion in 1..9007199254740991L)}
 fun json()=JSONObject().put("account",account.json()).put("site_id",binding.siteId).put("assignment_id",binding.assignmentId).put("revocation_version",binding.revocationVersion)
 fun owner()=EscalationProtocol.hash(json().toString())
 companion object {fun parse(j:JSONObject):LocationConsentScope {val a=j.getJSONObject("account");val account=EscalationScope(a.getString("configuration"),a.getString("device_id"),a.getString("thumbprint"),a.getString("subject"),a.getString("guard_id"),a.getString("vendor_id"));return LocationConsentScope(account,GrantBinding(account.guardId,j.getString("site_id"),j.getString("assignment_id"),account.thumbprint,j.getLong("revocation_version")))}}
}
internal class LocationConsentRecord(val sequence:Long,val id:String,val scope:LocationConsentScope,val policy:AuthorizedLocationPolicy,val raw:String,val receipt:JSONObject?,val withdrawal:String?,val withdrawalReceipt:JSONObject?,val reviewGeneration:String?){
 val withdrawn get()=withdrawal!=null
 val accepted get()=receipt!=null&&!withdrawn
 fun intent(action:String):String=if(action=="consent")raw else withdrawal?:error("Withdrawal not retained")
 override fun toString()="LocationConsentRecord(redacted)"
}
/** Exact immutable consent intents and a durable local withdrawal barrier. No token or restart authority. */
internal class LocationConsentStore(context:Context,name:String="mercury_location_consents.db"):SQLiteOpenHelper(context,name,null,1),java.io.Closeable {
 private val cipher=DeviceCipher()
 override fun onConfigure(db:SQLiteDatabase){super.onConfigure(db);db.rawQuery("PRAGMA secure_delete=ON",null).use{check(it.moveToFirst()&&it.getInt(0)==1)}}
 override fun onCreate(db:SQLiteDatabase){db.execSQL("CREATE TABLE consent(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,owner TEXT NOT NULL,body TEXT NOT NULL,receipt TEXT,withdrawal TEXT,withdrawal_receipt TEXT,review TEXT)")}
 override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){error("Unsupported consent schema")}
 private fun encode(j:JSONObject,purpose:String)=cipher.encrypt(j.toString().toByteArray(Charsets.UTF_8),purpose)
 private fun decode(raw:String,purpose:String)=JSONObject(String(cipher.decrypt(raw,purpose),Charsets.UTF_8))
 private fun record(c:android.database.Cursor):LocationConsentRecord {
  fun text(k:String)=c.getString(c.getColumnIndexOrThrow(k))
  fun optional(k:String,p:String):JSONObject?=c.getColumnIndexOrThrow(k).let{if(c.isNull(it))null else decode(c.getString(it),p)}
  val id=text("id");require(EscalationRules.uuid(id));val j=decode(text("body"),"location-consent:$id");val scope=LocationConsentScope.parse(j.getJSONObject("scope"));check(scope.owner()==text("owner"))
  val policy=AuthorizedLocationPolicy.parse(j.getString("policy_payload"),j.getString("policy_sha256"));val raw=j.getString("intent_raw");validateIntent(raw,scope,policy,id,"consent")
  val receipt=optional("receipt","location-consent-receipt:$id")?.also{validateReceipt(it,raw)}
  val withdrawal=optional("withdrawal","location-withdrawal:$id")?.getString("raw")?.also{validateIntent(it,scope,policy,id,"withdraw")}
  val withdrawalReceipt=optional("withdrawal_receipt","location-withdrawal-receipt:$id")?.also{validateReceipt(it,withdrawal?:error("Original withdrawal missing"))}
  return LocationConsentRecord(c.getLong(c.getColumnIndexOrThrow("sequence")),id,scope,policy,raw,receipt,withdrawal,withdrawalReceipt,optional("review","location-consent-review:$id")?.getString("generation"))
 }
 private fun get(db:SQLiteDatabase,id:String,scope:LocationConsentScope)=db.rawQuery("SELECT * FROM consent WHERE id=? AND owner=?",arrayOf(id,scope.owner())).use{if(it.moveToFirst())record(it).also{r->check(r.scope==scope)}else null}
 fun get(id:String,scope:LocationConsentScope)=get(readableDatabase,id,scope)
 fun list(account:EscalationScope):List<LocationConsentRecord>{val result=mutableListOf<LocationConsentRecord>();readableDatabase.rawQuery("SELECT * FROM consent ORDER BY sequence DESC",null).use{while(it.moveToNext()){val r=record(it);if(r.scope.account==account)result.add(r)}};return result}
 fun current(scope:LocationConsentScope,policyHash:String)=list(scope.account).firstOrNull{it.scope==scope&&it.policy.sha256==policyHash}?.takeUnless{it.withdrawn}
 fun prepare(scope:LocationConsentScope,policy:AuthorizedLocationPolicy):LocationConsentRecord {
  val db=writableDatabase;db.beginTransaction();try{
   current(scope,policy.sha256)?.let{db.setTransactionSuccessful();return it}
   val id=UUID.randomUUID().toString();val raw=intent(scope,policy,id,"consent")
   db.insertOrThrow("consent",null,ContentValues().apply{put("id",id);put("owner",scope.owner());put("body",encode(JSONObject().put("scope",scope.json()).put("policy_payload",policy.payload).put("policy_sha256",policy.sha256).put("intent_raw",raw),"location-consent:$id"))})
   val value=get(db,id,scope)!!;db.setTransactionSuccessful();return value
  }finally{db.endTransaction()}
 }
 fun withdraw(id:String,scope:LocationConsentScope):LocationConsentRecord {
  val db=writableDatabase;db.beginTransaction();try{
   val r=get(db,id,scope)?:error("Original consent unavailable")
   if(r.withdrawal==null){val raw=intent(r.scope,r.policy,r.id,"withdraw");check(db.update("consent",ContentValues().apply{put("withdrawal",encode(JSONObject().put("raw",raw),"location-withdrawal:$id"))},"id=?",arrayOf(id))==1)}
   val value=get(db,id,scope)!!;db.setTransactionSuccessful();return value
  }finally{db.endTransaction()}
 }
 fun accept(id:String,scope:LocationConsentScope,action:String,response:JSONObject){
  val db=writableDatabase;db.beginTransaction();try{
   val r=get(db,id,scope)?:error("Original consent unavailable");val raw=r.intent(action);validateReceipt(response,raw)
   val old=if(action=="consent")r.receipt else r.withdrawalReceipt;if(old!=null)for(k in old.keys())check(old.get(k)==response.get(k))
   val column=if(action=="consent")"receipt"else"withdrawal_receipt";val purpose=if(action=="consent")"location-consent-receipt:$id"else"location-withdrawal-receipt:$id"
   check(db.update("consent",ContentValues().apply{put(column,encode(response,purpose))},"id=?",arrayOf(id))==1);db.setTransactionSuccessful()
  }finally{db.endTransaction()}
 }
 fun review(id:String,scope:LocationConsentScope,generation:String){check(writableDatabase.update("consent",ContentValues().apply{put("review",encode(JSONObject().put("generation",generation),"location-consent-review:$id"))},"id=? AND owner=?",arrayOf(id,scope.owner()))==1)}
 fun canUpload(id:String,scope:LocationConsentScope,policyHash:String):Boolean {
  val records=list(scope.account).filter{it.scope==scope&&it.policy.sha256==policyHash}
  val record=records.firstOrNull{it.id==id}?:return false
  val barrier=records.filter{it.withdrawn}.maxOfOrNull{it.sequence}?:0L
  return record.accepted&&record.sequence>barrier
 }
 companion object {
  private fun intent(scope:LocationConsentScope,p:AuthorizedLocationPolicy,id:String,action:String)=JSONObject().put("version",1).put("request_id",UUID.randomUUID().toString()).put("consent_id",id).put("action",action)
   .put("guard_id",scope.account.guardId).put("vendor_id",scope.account.vendorId).put("site_id",scope.binding.siteId).put("assignment_id",scope.binding.assignmentId).put("device_id",scope.account.deviceId).put("device_thumbprint",scope.account.thumbprint)
   .put("revocation_version",scope.binding.revocationVersion).put("policy_revision",p.revision).put("policy_sha256",p.sha256).put("notice_revision",p.noticeRevision).put("notice_sha256",p.noticeSha256).toString()
  private fun validateIntent(raw:String,scope:LocationConsentScope,p:AuthorizedLocationPolicy,id:String,action:String){
   require(raw.toByteArray(Charsets.UTF_8).size<=4096);val j=JSONObject(raw)
   val expected=JSONObject(intent(scope,p,id,action)).apply{put("request_id",j.getString("request_id"))}
   require(EscalationRules.uuid(j.getString("request_id"))&&j.keys().asSequence().toSet()==expected.keys().asSequence().toSet())
   for(k in expected.keys())require(j.get(k)==expected.get(k))
  }
  private fun validateReceipt(j:JSONObject,raw:String){
   AuthorizedLocationPolicy.exact(j,"version","request_id","consent_id","action","status","recorded_at_ms","intent_sha256");val request=JSONObject(raw)
   require(AuthorizedLocationPolicy.integer(j,"version")==1L&&AuthorizedLocationPolicy.integer(j,"recorded_at_ms")>0)
   for(k in listOf("request_id","consent_id","action"))require(j.get(k)==request.get(k))
   require(j.get("status")==if(request.getString("action")=="consent")"consent_recorded"else"consent_withdrawn")
   require(j.get("intent_sha256")==EscalationProtocol.hash(raw))
  }
 }
}
