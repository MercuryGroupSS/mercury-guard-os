package ca.mercury.guard

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Separate authorized-capture queue. Never imports or relabels the unscoped demo audit. */
class ScopedEventStore internal constructor(context: Context, name: String = "mercury_scoped_events.db",
 private val elapsedNow: () -> Long = { android.os.SystemClock.elapsedRealtime() },
 private val bootNow: () -> Int = { android.provider.Settings.Global.getInt(context.contentResolver,android.provider.Settings.Global.BOOT_COUNT,-1) }
) : SQLiteOpenHelper(context,name,null,5),java.io.Closeable {
 private val cipher = DeviceCipher()
 override fun onCreate(db: SQLiteDatabase) {
  db.execSQL("CREATE TABLE captured (sequence INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, pilot_receipted INTEGER NOT NULL DEFAULT 0)")
  db.execSQL("CREATE TABLE pending (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)")
  createGuardPending(db)
  createMediaReceipts(db)
  createCheckInIndex(db)
  createUploads(db)
 }
 override fun onConfigure(db: SQLiteDatabase) {
  super.onConfigure(db)
  db.rawQuery("PRAGMA secure_delete=ON",null).use {check(it.moveToFirst() && it.getInt(0)==1)}
 }
 override fun onOpen(db: SQLiteDatabase) {
  super.onOpen(db)
  // Never append with a newly generated encryption key if existing ciphertext is unreadable.
  db.rawQuery("SELECT sequence,body FROM captured ORDER BY sequence LIMIT 1",null).use {c->if(c.moveToFirst())decrypt(c.getString(1),"mercury-scoped-event:${c.getLong(0)}")}
  db.rawQuery("SELECT body FROM pending WHERE id=1",null).use {c->if(c.moveToFirst())decrypt(c.getString(0),"mercury-scoped-pending")}
  db.rawQuery("SELECT owner,body FROM pending_by_guard",null).use{c->while(c.moveToNext())decrypt(c.getString(1),"mercury-scoped-pending:${c.getString(0)}")}
 }
 private fun createGuardPending(db:SQLiteDatabase){db.execSQL("CREATE TABLE pending_by_guard (owner TEXT PRIMARY KEY, body TEXT NOT NULL)")}
 override fun onUpgrade(db: SQLiteDatabase,oldVersion: Int,newVersion: Int) {
  check(oldVersion in 1..4 && newVersion==5)
  if(oldVersion==1)createGuardPending(db)
  createMediaReceipts(db)
  createCheckInIndex(db)
  createUploads(db)
  db.rawQuery("SELECT sequence,body FROM captured",null).use{c->while(c.moveToNext()){
   val seq=c.getLong(0);val record=decrypt(c.getString(1),"mercury-scoped-event:$seq");val event=record.getJSONObject("event")
   if(event.getString("kind")=="check_in")indexCheckIn(db,binding(record.getJSONObject("scope")),event.getJSONObject("data"),seq)
  }}
 }
 private fun createCheckInIndex(db:SQLiteDatabase){db.execSQL("CREATE TABLE IF NOT EXISTS check_in_keys (lookup TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE)")}
 private fun checkInKey(binding:GrantBinding,revision:Long,slot:Long):String {
  require(revision>0&&slot>=0)
  val source=JSONArray(listOf(binding.guardId,binding.assignmentId,revision,slot)).toString()
  return java.security.MessageDigest.getInstance("SHA-256").digest(source.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
 }
 private fun indexCheckIn(db:SQLiteDatabase,binding:GrantBinding,data:JSONObject,sequence:Long){
  val key=checkInKey(binding,data.getLong("policy_revision"),data.getLong("slot"))
  db.insertWithOnConflict("check_in_keys",null,ContentValues().apply{put("lookup",key);put("sequence",sequence)},SQLiteDatabase.CONFLICT_IGNORE)
  db.rawQuery("SELECT sequence FROM check_in_keys WHERE lookup=?",arrayOf(key)).use{check(it.moveToFirst()&&it.getLong(0)==sequence){"Duplicate check-in slot"}}
 }
 private fun createMediaReceipts(db:SQLiteDatabase){db.execSQL("CREATE TABLE IF NOT EXISTS media_receipts (event_id TEXT PRIMARY KEY, body TEXT NOT NULL)")}
 private fun createUploads(db:SQLiteDatabase){
  db.execSQL("CREATE TABLE IF NOT EXISTS upload_snapshots(owner TEXT PRIMARY KEY, first_sequence INTEGER NOT NULL, body TEXT NOT NULL, review TEXT)")
  db.execSQL("CREATE TABLE IF NOT EXISTS upload_media_review(event_id TEXT PRIMARY KEY, body TEXT NOT NULL)")
  db.execSQL("CREATE TABLE IF NOT EXISTS upload_receipts(batch_id TEXT PRIMARY KEY, body TEXT NOT NULL)")
 }
 private fun owner(guardId:String):String {
  require(guardId.isNotBlank() && guardId.length<=200)
  return java.security.MessageDigest.getInstance("SHA-256").digest(guardId.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
 }
 private fun readSnapshot(db:SQLiteDatabase,guardId:String?):JSONObject? {
  if(guardId!=null){
   val id=owner(guardId)
   db.rawQuery("SELECT body FROM pending_by_guard WHERE owner=?",arrayOf(id)).use{c->if(c.moveToFirst())return decrypt(c.getString(0),"mercury-scoped-pending:$id")}
  }
  val legacy=db.rawQuery("SELECT body FROM pending WHERE id=1",null).use{c->if(c.moveToFirst())decrypt(c.getString(0),"mercury-scoped-pending") else null}?:return null
  if(guardId==null)return legacy
  if(binding(legacy.getJSONObject("scope")).guardId!=guardId)return null
  writeSnapshot(db,guardId,legacy);db.delete("pending","id=1",null);return legacy
 }
 private fun writeSnapshot(db:SQLiteDatabase,guardId:String?,snapshot:JSONObject){
  if(guardId==null)db.insertOrThrow("pending",null,ContentValues().apply{put("id",1);put("body",cipher.encrypt(snapshot.toString().toByteArray(Charsets.UTF_8),"mercury-scoped-pending"))})
  else {val id=owner(guardId);db.insertOrThrow("pending_by_guard",null,ContentValues().apply{put("owner",id);put("body",cipher.encrypt(snapshot.toString().toByteArray(Charsets.UTF_8),"mercury-scoped-pending:$id"))})}
 }
 private fun decrypt(body: String,aad: String)=JSONObject(String(cipher.decrypt(body,aad),Charsets.UTF_8))
 private fun binding(b: GrantBinding)=JSONObject().put("guard_id",b.guardId).put("site_id",b.siteId).put("assignment_id",b.assignmentId).put("device_thumbprint",b.deviceThumbprint).put("revocation_version",b.revocationVersion)
 private fun binding(j: JSONObject)=GrantBinding(j.getString("guard_id"),j.getString("site_id"),j.getString("assignment_id"),j.getString("device_thumbprint"),j.getLong("revocation_version"))
 private fun requiredAction(kind: String)=when(kind) {
  "dispatch_ack" -> "dispatch_ack"; "incident" -> "incident"; "patrol_checkpoint" -> "patrol"; "check_in", "check_in_miss_reason" -> "check_in"; "photo_evidence" -> "photo"; "location" -> "location"
  else -> error("Unsupported authorized event kind")
 }
 fun capture(kind: String,data: JSONObject,original: GrantBinding,grant: VerifiedShiftGrant,identity: DeviceIdentity,observedAt: Long): String {
  require(kind!="location"){"Typed policy-bound location capture required"}
  return captureInternal(kind,data,original,grant,identity,observedAt,null)
 }
 internal fun captureLocation(record:LocationConsentRecord,grant:VerifiedShiftGrant,identity:DeviceIdentity,sample:ConnectedLocationSample):String {
  val approved=grant.location?:error("Approved location grant required")
  check(record.accepted&&record.id==approved.id&&record.policy.sha256==approved.policy.sha256&&record.policy.payload==approved.policy.payload)
  return captureInternal("location",sample.data(approved),record.scope.binding,grant,identity,sample.at,record.scope)
 }
 private fun captureInternal(kind:String,data:JSONObject,original:GrantBinding,grant:VerifiedShiftGrant,identity:DeviceIdentity,observedAt:Long,locationOwner:LocationConsentScope?):String {
  require(observedAt in 0..9007199254740991L)
  check(grant.permits(requiredAction(kind),original,elapsedNow(),bootNow())) { "Capture not authorized" }
  check(identity.publicIdentity()?.thumbprint == original.deviceThumbprint) { "Capture device mismatch" }
  require(!data.has("capture_grant_id"))
  val eventId=UUID.randomUUID().toString()
  val event=JSONObject().put("event_id",eventId).put("at",observedAt).put("kind",kind)
   .put("data",JSONObject(data.toString()).put("capture_grant_id",grant.grantId))
  val record=JSONObject().put("scope",binding(original)).put("event",event)
  if(locationOwner!=null)record.put("location_owner",locationOwner.json())
  require(record.toString().toByteArray(Charsets.UTF_8).size <= 240000)
  val db=writableDatabase;db.beginTransaction()
  try {
   val seq=db.insertOrThrow("captured",null,ContentValues().apply {put("body","")})
   check(seq in 1..9007199254740991L)
   event.put("sequence",seq)
   check(db.update("captured",ContentValues().apply {put("body",cipher.encrypt(record.toString().toByteArray(Charsets.UTF_8),"mercury-scoped-event:$seq"))},"sequence=?",arrayOf(seq.toString()))==1)
   if(kind=="check_in")indexCheckIn(db,original,event.getJSONObject("data"),seq)
   db.setTransactionSuccessful();return eventId
  } finally {db.endTransaction()}
 }
 fun checkInRecorded(original:GrantBinding,revision:Long,slot:Long):Boolean {
  readableDatabase.rawQuery("SELECT k.sequence,c.body FROM check_in_keys k LEFT JOIN captured c ON c.sequence=k.sequence WHERE k.lookup=?",arrayOf(checkInKey(original,revision,slot))).use{c->
   if(!c.moveToFirst())return false
   val record=decrypt(c.getString(1),"mercury-scoped-event:${c.getLong(0)}");val scope=binding(record.getJSONObject("scope"));val event=record.getJSONObject("event");val data=event.getJSONObject("data")
   check(scope.guardId==original.guardId&&scope.assignmentId==original.assignmentId&&event.getString("kind")=="check_in"&&data.getLong("policy_revision")==revision&&data.getLong("slot")==slot){"Check-in index mismatch"}
   return true
  }
 }
 fun captureCheckIn(original:GrantBinding,grant:VerifiedShiftGrant,identity:DeviceIdentity,evidence:AuthorizedCheckInEvidence,photo:JSONObject,observedAt:Long):String {
  evidence.policy.validate(evidence.slot,evidence.biometricAt,evidence.location,observedAt,observedAt)
  val db=writableDatabase;db.beginTransaction()
  try{
   check(!checkInRecorded(original,evidence.policy.revision,evidence.slot)){"Check-in already recorded"}
   val metadata=JSONObject(photo.toString()).put("check_in_slot",evidence.slot).put("check_in_policy_revision",evidence.policy.revision)
   val photoId=capture("photo_evidence",metadata,original,grant,identity,observedAt)
   val data=JSONObject().put("policy_revision",evidence.policy.revision).put("slot",evidence.slot)
    .put("biometric",JSONObject().put("method","android_local_biometric").put("at",evidence.biometricAt))
    .put("location",JSONObject(evidence.location.toString())).put("photo_event_id",photoId).put("evidence_id",metadata.getString("evidence_id"))
   val result=capture("check_in",data,original,grant,identity,observedAt)
   db.setTransactionSuccessful();return result
  }finally{db.endTransaction()}
 }
 fun dispatchAcknowledged(original:GrantBinding,messageId:String,version:Long):Boolean {
  readableDatabase.rawQuery("SELECT sequence,body FROM captured ORDER BY sequence",null).use{c->while(c.moveToNext()){
   val record=decrypt(c.getString(1),"mercury-scoped-event:${c.getLong(0)}")
   if(binding(record.getJSONObject("scope"))!=original)continue
   val event=record.getJSONObject("event");val data=event.getJSONObject("data")
   if(event.getString("kind")=="dispatch_ack"&&data.optString("message_id")==messageId&&data.optLong("message_version")==version)return true
  }};return false
 }
 fun acknowledgeDispatch(original:GrantBinding,grant:VerifiedShiftGrant,identity:DeviceIdentity,messageId:String,version:Long,observedAt:Long):String {
  require(messageId.matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}"))&&version>0)
  val db=writableDatabase;db.beginTransaction()
  try{
   check(!dispatchAcknowledged(original,messageId,version)){"Acknowledgement already recorded"}
   val result=capture("dispatch_ack",JSONObject().put("message_id",messageId).put("message_version",version),original,grant,identity,observedAt)
   db.setTransactionSuccessful();return result
  }finally{db.endTransaction()}
 }
 fun checkpointRecorded(original:GrantBinding,routeId:String,revision:Long,checkpointId:String,roundId:String?=null):Boolean {
  require(roundId==null||PatrolPlan.identifier(roundId))
  return PatrolCheckpointKey(roundId,checkpointId) in checkpointProgress(original,routeId,revision)
 }
 /** One scan per rendered route, rather than one full encrypted-history scan for every button. */
 internal fun checkpointProgress(original:GrantBinding,routeId:String,revision:Long):Set<PatrolCheckpointKey>{
  val recorded=mutableSetOf<PatrolCheckpointKey>()
  readableDatabase.rawQuery("SELECT sequence,body FROM captured ORDER BY sequence",null).use{c->while(c.moveToNext()){
   val record=decrypt(c.getString(1),"mercury-scoped-event:${c.getLong(0)}")
   val scope=binding(record.getJSONObject("scope"))
   if(scope.guardId!=original.guardId||scope.assignmentId!=original.assignmentId)continue
   val event=record.getJSONObject("event");val data=event.getJSONObject("data")
   if(event.getString("kind")!="patrol_checkpoint"||data.opt("route_id")!=routeId)continue
   val version=data.opt("route_revision");if((version !is Int&&version !is Long)||(version as Number).toLong()!=revision)continue
   val point=data.opt("checkpoint_id") as? String?:continue
   val round=if(!data.has("round_id"))null else data.opt("round_id") as? String?:continue
   if(PatrolPlan.identifier(point)&&(round==null||PatrolPlan.identifier(round)))recorded.add(PatrolCheckpointKey(round,point))
  }}
  return recorded
 }
 fun captureCheckpoint(original:GrantBinding,grant:VerifiedShiftGrant,identity:DeviceIdentity,routeId:String,revision:Long,checkpointId:String,observedAt:Long,roundId:String?=null):String {
  require(routeId.isNotBlank()&&checkpointId.isNotBlank()&&revision>0&&(roundId==null||PatrolPlan.identifier(roundId)))
  val db=writableDatabase;db.beginTransaction()
  try{
   check(!checkpointRecorded(original,routeId,revision,checkpointId,roundId)){"Checkpoint already recorded in this patrol round"}
   val data=JSONObject().put("route_id",routeId).put("route_revision",revision).put("checkpoint_id",checkpointId)
   roundId?.let{data.put("round_id",it)}
   val result=capture("patrol_checkpoint",data,original,grant,identity,observedAt)
   db.setTransactionSuccessful();return result
  }finally{db.endTransaction()}
 }
 /** Preserve per-guard FIFO and immutable retry snapshots; other guards can upload independently. */
 fun prepareSigned(identity: DeviceIdentity,audience: String,guardId:String?=null): JSONObject? {
  val db=writableDatabase;db.beginTransaction()
  try {
   var snapshot: JSONObject?=readSnapshot(db,guardId)
   if(snapshot==null) {
    val events=JSONArray();var first: GrantBinding?=null;var firstPartition:JSONObject?=null;var size=0
    db.rawQuery("SELECT sequence,body FROM captured WHERE pilot_receipted=0 ORDER BY sequence",null).use {c->
     while(c.moveToNext()) {
      val record=decrypt(c.getString(1),"mercury-scoped-event:${c.getLong(0)}");val scope=binding(record.getJSONObject("scope"))
      if(guardId!=null && scope.guardId!=guardId)continue
      val partition=uploadPartition(record)
      if(events.length()>=100 || (first!=null && (first!=scope||firstPartition.toString()!=partition.toString())))break
      val event=record.getJSONObject("event");check(event.getLong("sequence")==c.getLong(0))
      val bytes=event.toString().toByteArray(Charsets.UTF_8).size
      if(size+bytes>250000)break
      first=scope;firstPartition=partition;size+=bytes;events.put(event)
     }
    }
    if(events.length()==0){db.setTransactionSuccessful();return null}
    snapshot=JSONObject().put("scope",binding(first!!)).put("partition",firstPartition).put("batch",JSONObject().put("batch_id",UUID.randomUUID().toString()).put("schema_version",1).put("events",events))
    writeSnapshot(db,guardId,snapshot)
   }
   val proof=identity.signScopedEventBatch(audience,snapshot.getJSONObject("batch"),binding(snapshot.getJSONObject("scope")))
   db.setTransactionSuccessful();return proof
  } finally {db.endTransaction()}
 }
 /** Only records local-pilot acceptance. Does not mark operational audit records delivered. */
 fun recordPilotReceipt(receipt: JSONObject,guardId:String?=null) {
  val db=writableDatabase;db.beginTransaction()
  try {
   val snapshot=readSnapshot(db,guardId)?:error("No pending batch")
   val batch=snapshot.getJSONObject("batch");val events=batch.getJSONArray("events")
   val ids=(0 until events.length()).map {events.getJSONObject(it).getString("event_id")}.toSet()
   GuardTransport.validatePilotReceipt(receipt,batch.getString("batch_id"),ids)
   for(i in 0 until events.length()) {
    val e=events.getJSONObject(i);val seq=e.getLong("sequence")
    val stored=db.rawQuery("SELECT body FROM captured WHERE sequence=?",arrayOf(seq.toString())).use {c->check(c.moveToFirst());decrypt(c.getString(0),"mercury-scoped-event:$seq")}
    check(stored.getJSONObject("event").toString()==e.toString())
    check(db.update("captured",ContentValues().apply {put("pilot_receipted",1)},"sequence=?",arrayOf(seq.toString()))==1)
   }
   if(guardId==null)db.delete("pending","id=1",null) else db.delete("pending_by_guard","owner=?",arrayOf(owner(guardId)))
   db.setTransactionSuccessful()
  } finally {db.endTransaction()}
 }
 fun pendingPhotos(guardId:String):List<JSONObject> {
  val result=mutableListOf<JSONObject>()
  readableDatabase.rawQuery("SELECT sequence,body FROM captured WHERE pilot_receipted=1 ORDER BY sequence",null).use{c->while(c.moveToNext()){
   val record=decrypt(c.getString(1),"mercury-scoped-event:${c.getLong(0)}")
   if(binding(record.getJSONObject("scope")).guardId!=guardId)continue
   val event=record.getJSONObject("event");if(event.getString("kind")!="photo_evidence")continue
   val id=event.getString("event_id")
   val acknowledged=readableDatabase.rawQuery("SELECT body FROM media_receipts WHERE event_id=?",arrayOf(id)).use{r->
    if(!r.moveToFirst())false else {GuardTransport.validateEvidenceReceipt(decrypt(r.getString(0),"mercury-media-receipt:$id"),id,event.getJSONObject("data"));true}
   }
   if(!acknowledged)result.add(record)
   if(result.size>=3)break
  }}
  return result
 }
 fun recordMediaReceipt(guardId:String,receipt:JSONObject){
  val db=writableDatabase;db.beginTransaction()
  try{
   val id=receipt.getString("event_id")
   val record=pendingPhotos(guardId).firstOrNull{it.getJSONObject("event").getString("event_id")==id}?:error("No matching pending photo")
   GuardTransport.validateEvidenceReceipt(receipt,id,record.getJSONObject("event").getJSONObject("data"))
   db.insertOrThrow("media_receipts",null,ContentValues().apply{put("event_id",id);put("body",cipher.encrypt(receipt.toString().toByteArray(Charsets.UTF_8),"mercury-media-receipt:$id"))})
   db.setTransactionSuccessful()
  }finally{db.endTransaction()}
 }
 fun pendingCount(guardId:String?=null):Int {
  if(guardId==null)return readableDatabase.rawQuery("SELECT COUNT(*) FROM captured WHERE pilot_receipted=0",null).use{it.moveToFirst();it.getInt(0)}
  var count=0
  readableDatabase.rawQuery("SELECT sequence,body FROM captured WHERE pilot_receipted=0",null).use{c->while(c.moveToNext()){
   if(binding(decrypt(c.getString(1),"mercury-scoped-event:${c.getLong(0)}").getJSONObject("scope")).guardId==guardId)count++
  }}
  return count
 }

 /** Original-scope snapshots allow one denied assignment to be retained without blocking another. */
 private fun uploadPartition(record:JSONObject):JSONObject {
  val event=record.getJSONObject("event")
  if(event.getString("kind")!="location")return JSONObject().put("kind","ordinary")
  val data=event.getJSONObject("data")
  return JSONObject().put("kind","location").put("owner",record.optJSONObject("location_owner")?:JSONObject.NULL).put("consent_id",data.opt("consent_id")?:JSONObject.NULL).put("policy_sha256",data.opt("policy_sha256")?:JSONObject.NULL)
 }
 private fun uploadOwner(scope:JSONObject,partition:JSONObject?=null)=EscalationProtocol.hash(if(partition==null)scope.toString()else JSONArray().put(scope).put(partition).toString())
 private fun saveUpload(db:SQLiteDatabase,snapshot:JSONObject){
  val id=uploadOwner(snapshot.getJSONObject("scope"),snapshot.optJSONObject("partition"));val events=snapshot.getJSONObject("batch").getJSONArray("events");require(events.length()>0)
  val old=db.rawQuery("SELECT body FROM upload_snapshots WHERE owner=?",arrayOf(id)).use{if(it.moveToFirst())decrypt(it.getString(0),"mercury-upload-snapshot:$id") else null}
  if(old!=null){check(old.toString()==snapshot.toString()){ "Conflicting original upload snapshot" };return}
  db.insertOrThrow("upload_snapshots",null,ContentValues().apply{put("owner",id);put("first_sequence",events.getJSONObject(0).getLong("sequence"));put("body",cipher.encrypt(snapshot.toString().toByteArray(Charsets.UTF_8),"mercury-upload-snapshot:$id"))})
 }
 private fun migrateUpload(db:SQLiteDatabase,guardId:String){
  val old=readSnapshot(db,guardId)?:return
  check(binding(old.getJSONObject("scope")).guardId==guardId);saveUpload(db,old)
  db.delete("pending_by_guard","owner=?",arrayOf(owner(guardId)))
 }
 internal fun prepareUpload(identity:DeviceIdentity,audience:String,guardId:String,generation:String):JSONObject? {
  val db=writableDatabase;db.beginTransaction()
  try{
   migrateUpload(db,guardId)
   var selected:JSONObject?=null;val occupied=mutableSetOf<String>();val reserved=mutableSetOf<String>()
   db.rawQuery("SELECT owner,body,review FROM upload_snapshots ORDER BY first_sequence",null).use{c->while(c.moveToNext()){
    val id=c.getString(0);val snapshot=decrypt(c.getString(1),"mercury-upload-snapshot:$id")
    if(binding(snapshot.getJSONObject("scope")).guardId!=guardId)continue
    occupied.add(id)
    val pending=snapshot.getJSONObject("batch").getJSONArray("events");for(i in 0 until pending.length())reserved.add(pending.getJSONObject(i).getString("event_id"))
    val held=!c.isNull(2)&&decrypt(c.getString(2),"mercury-upload-review:$id").getString("generation")==generation
    if(selected==null&&!held)selected=snapshot
   }}
   if(selected==null){
    val events=JSONArray();var first:GrantBinding?=null;var firstPartition:JSONObject?=null;var size=0
    db.rawQuery("SELECT sequence,body FROM captured WHERE pilot_receipted=0 ORDER BY sequence",null).use{c->while(c.moveToNext()){
     val record=decrypt(c.getString(1),"mercury-scoped-event:${c.getLong(0)}");val scope=binding(record.getJSONObject("scope"))
     val partition=uploadPartition(record);val event=record.getJSONObject("event")
     if(scope.guardId!=guardId||event.getString("event_id") in reserved||uploadOwner(record.getJSONObject("scope"),partition) in occupied)continue
     if(first!=null&&(first!=scope||firstPartition.toString()!=partition.toString()))continue
     check(event.getLong("sequence")==c.getLong(0));val bytes=event.toString().toByteArray(Charsets.UTF_8).size
     if(events.length()>=100||size+bytes>250000)break
     first=scope;firstPartition=partition;events.put(event);size+=bytes
    }}
    if(events.length()>0){selected=JSONObject().put("scope",binding(first!!)).put("partition",firstPartition).put("batch",JSONObject().put("batch_id",UUID.randomUUID().toString()).put("schema_version",1).put("events",events));saveUpload(db,selected!!)}
   }
   val snapshot=selected?:run{db.setTransactionSuccessful();return null}
   val proof=identity.signScopedEventBatch(audience,snapshot.getJSONObject("batch"),binding(snapshot.getJSONObject("scope")))
   db.setTransactionSuccessful();return proof
  }finally{db.endTransaction()}
 }
 private fun findUpload(db:SQLiteDatabase,guardId:String,batchId:String):Pair<String,JSONObject>? {
  db.rawQuery("SELECT owner,body FROM upload_snapshots",null).use{c->while(c.moveToNext()){
   val id=c.getString(0);val snapshot=decrypt(c.getString(1),"mercury-upload-snapshot:$id")
   if(binding(snapshot.getJSONObject("scope")).guardId==guardId&&snapshot.getJSONObject("batch").getString("batch_id")==batchId)return id to snapshot
  }};return null
 }
 internal fun retainUploadForReview(guardId:String,batchId:String,generation:String,status:Int){
  require(status in 300..499);val db=writableDatabase;db.beginTransaction()
  try{val (id,_)=findUpload(db,guardId,batchId)?:error("No original snapshot")
   val review=JSONObject().put("generation",generation).put("http_status",status).put("state","retained_for_review_not_permanent_rejection")
   check(db.update("upload_snapshots",ContentValues().apply{put("review",cipher.encrypt(review.toString().toByteArray(Charsets.UTF_8),"mercury-upload-review:$id"))},"owner=?",arrayOf(id))==1)
   db.setTransactionSuccessful()
  }finally{db.endTransaction()}
 }
 internal fun recordUploadReceipt(guardId:String,receipt:JSONObject){
  val db=writableDatabase;db.beginTransaction()
  try{
   val batchId=receipt.getString("batch_id")
   val prior=db.rawQuery("SELECT body FROM upload_receipts WHERE batch_id=?",arrayOf(batchId)).use{if(it.moveToFirst())decrypt(it.getString(0),"mercury-upload-receipt:$batchId") else null}
   if(prior!=null){check(prior.getString("guard")==guardId&&prior.getJSONObject("receipt").toString()==receipt.toString());db.setTransactionSuccessful();return}
   val (id,snapshot)=findUpload(db,guardId,batchId)?:error("No original snapshot")
   val events=snapshot.getJSONObject("batch").getJSONArray("events");val ids=(0 until events.length()).map{events.getJSONObject(it).getString("event_id")}.toSet()
   GuardTransport.validatePilotReceipt(receipt,batchId,ids)
   for(i in 0 until events.length()){
    val event=events.getJSONObject(i);val sequence=event.getLong("sequence")
    val original=db.rawQuery("SELECT body FROM captured WHERE sequence=?",arrayOf(sequence.toString())).use{check(it.moveToFirst());decrypt(it.getString(0),"mercury-scoped-event:$sequence")}
    check(original.getJSONObject("scope").toString()==snapshot.getJSONObject("scope").toString()&&original.getJSONObject("event").toString()==event.toString())
    check(db.update("captured",ContentValues().apply{put("pilot_receipted",1)},"sequence=?",arrayOf(sequence.toString()))==1)
   }
   val record=JSONObject().put("guard",guardId).put("receipt",receipt)
   db.insertOrThrow("upload_receipts",null,ContentValues().apply{put("batch_id",batchId);put("body",cipher.encrypt(record.toString().toByteArray(Charsets.UTF_8),"mercury-upload-receipt:$batchId"))})
   check(db.delete("upload_snapshots","owner=?",arrayOf(id))==1);db.setTransactionSuccessful()
  }finally{db.endTransaction()}
 }
 internal fun locationUploadScope(guardId:String,batchId:String):Triple<LocationConsentScope,String,String>? {
  val snapshot=findUpload(readableDatabase,guardId,batchId)?.second?:error("Original snapshot required")
  val events=snapshot.getJSONObject("batch").getJSONArray("events");val locations=(0 until events.length()).map{events.getJSONObject(it)}.filter{it.getString("kind")=="location"}
  if(locations.isEmpty())return null
  require(locations.size==events.length()){ "Mixed legacy location batch needs review" }
  val partition=snapshot.getJSONObject("partition");require(partition.getString("kind")=="location")
  val original=LocationConsentScope.parse(partition.getJSONObject("owner"));val id=partition.getString("consent_id");val hash=partition.getString("policy_sha256")
  for(e in locations){val d=e.getJSONObject("data");check(d.getString("consent_id")==id&&d.getString("policy_sha256")==hash)}
  return Triple(original,id,hash)
 }
 internal fun pendingUploadPhotos(guardId:String,generation:String,limit:Int=3):List<JSONObject>{
  require(limit in 1..100);val result=mutableListOf<JSONObject>()
  readableDatabase.rawQuery("SELECT sequence,body FROM captured WHERE pilot_receipted=1 ORDER BY sequence",null).use{c->while(c.moveToNext()){
   val record=decrypt(c.getString(1),"mercury-scoped-event:${c.getLong(0)}");if(binding(record.getJSONObject("scope")).guardId!=guardId)continue
   val event=record.getJSONObject("event");if(event.getString("kind")!="photo_evidence")continue
   val id=event.getString("event_id")
   val accepted=readableDatabase.rawQuery("SELECT body FROM media_receipts WHERE event_id=?",arrayOf(id)).use{r->if(!r.moveToFirst())false else{GuardTransport.validateEvidenceReceipt(decrypt(r.getString(0),"mercury-media-receipt:$id"),id,event.getJSONObject("data"));true}}
   if(accepted)continue
   val held=readableDatabase.rawQuery("SELECT body FROM upload_media_review WHERE event_id=?",arrayOf(id)).use{r->r.moveToFirst()&&decrypt(r.getString(0),"mercury-upload-media-review:$id").getString("generation")==generation}
   if(!held)result.add(record);if(result.size>=limit)break
  }};return result
 }
 internal fun retainPhotoForReview(guardId:String,eventId:String,generation:String,status:Int){
  require(status in 300..499||status==0);val db=writableDatabase;db.beginTransaction()
  try{
   var exists=false
   db.rawQuery("SELECT sequence,body FROM captured WHERE pilot_receipted=1",null).use{c->while(c.moveToNext()){
    val record=decrypt(c.getString(1),"mercury-scoped-event:${c.getLong(0)}");val event=record.getJSONObject("event")
    if(binding(record.getJSONObject("scope")).guardId==guardId&&event.getString("kind")=="photo_evidence"&&event.getString("event_id")==eventId){exists=true;break}
   }};check(exists)
   val value=JSONObject().put("guard",guardId).put("generation",generation).put("http_status",status).put("state","retained_for_review_not_permanent_rejection")
   db.insertWithOnConflict("upload_media_review",null,ContentValues().apply{put("event_id",eventId);put("body",cipher.encrypt(value.toString().toByteArray(Charsets.UTF_8),"mercury-upload-media-review:$eventId"))},SQLiteDatabase.CONFLICT_REPLACE)
   db.setTransactionSuccessful()
  }finally{db.endTransaction()}
 }
 internal fun recordUploadMediaReceipt(guardId:String,receipt:JSONObject){
  val db=writableDatabase;db.beginTransaction()
  try{
   val id=receipt.getString("event_id")
   val old=db.rawQuery("SELECT body FROM media_receipts WHERE event_id=?",arrayOf(id)).use{if(it.moveToFirst())decrypt(it.getString(0),"mercury-media-receipt:$id") else null}
   // Look up the exact original record, independently of other pending photos or their reviews.
   var found=false
   db.rawQuery("SELECT sequence,body FROM captured WHERE pilot_receipted=1",null).use{c->while(c.moveToNext()){
    val record=decrypt(c.getString(1),"mercury-scoped-event:${c.getLong(0)}");val event=record.getJSONObject("event")
    if(binding(record.getJSONObject("scope")).guardId==guardId&&event.getString("event_id")==id&&event.getString("kind")=="photo_evidence"){GuardTransport.validateEvidenceReceipt(receipt,id,event.getJSONObject("data"));found=true;break}
   }};check(found)
   if(old!=null){check(old.toString()==receipt.toString());db.setTransactionSuccessful();return}
   db.insertOrThrow("media_receipts",null,ContentValues().apply{put("event_id",id);put("body",cipher.encrypt(receipt.toString().toByteArray(Charsets.UTF_8),"mercury-media-receipt:$id"))})
   db.delete("upload_media_review","event_id=?",arrayOf(id));db.setTransactionSuccessful()
  }finally{db.endTransaction()}
 }
 internal fun uploadSummary(guardId:String):String {
  var reviews=0;var photos=0
  readableDatabase.rawQuery("SELECT sequence,body FROM captured WHERE pilot_receipted=1",null).use{c->while(c.moveToNext()){
   val record=decrypt(c.getString(1),"mercury-scoped-event:${c.getLong(0)}");val event=record.getJSONObject("event")
   if(binding(record.getJSONObject("scope")).guardId==guardId&&event.getString("kind")=="photo_evidence"){
    val id=event.getString("event_id");val accepted=readableDatabase.rawQuery("SELECT body FROM media_receipts WHERE event_id=?",arrayOf(id)).use{r->if(!r.moveToFirst())false else{GuardTransport.validateEvidenceReceipt(decrypt(r.getString(0),"mercury-media-receipt:$id"),id,event.getJSONObject("data"));true}}
    if(!accepted)photos++
   }
  }}
  readableDatabase.rawQuery("SELECT owner,body,review FROM upload_snapshots WHERE review IS NOT NULL",null).use{c->while(c.moveToNext())if(binding(decrypt(c.getString(1),"mercury-upload-snapshot:${c.getString(0)}").getJSONObject("scope")).guardId==guardId)reviews++}
  readableDatabase.rawQuery("SELECT event_id,body FROM upload_media_review",null).use{c->while(c.moveToNext())if(decrypt(c.getString(1),"mercury-upload-media-review:${c.getString(0)}").getString("guard")==guardId)reviews++}
  return "${pendingCount(guardId)} saved record(s) and $photos photo file(s) await service receipts. $reviews upload group(s) retained for review. Retained data is never discarded or reassigned; sign in again to retry after the connection or authorization is corrected."
 }
}
