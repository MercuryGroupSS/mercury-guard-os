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
) : SQLiteOpenHelper(context,name,null,1) {
 private val cipher = DeviceCipher()
 override fun onCreate(db: SQLiteDatabase) {
  db.execSQL("CREATE TABLE captured (sequence INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, pilot_receipted INTEGER NOT NULL DEFAULT 0)")
  db.execSQL("CREATE TABLE pending (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)")
 }
 override fun onUpgrade(db: SQLiteDatabase,oldVersion: Int,newVersion: Int) { error("Unsupported scoped store version") }
 private fun decrypt(body: String,aad: String)=JSONObject(String(cipher.decrypt(body,aad),Charsets.UTF_8))
 private fun binding(b: GrantBinding)=JSONObject().put("guard_id",b.guardId).put("site_id",b.siteId).put("assignment_id",b.assignmentId).put("device_thumbprint",b.deviceThumbprint).put("revocation_version",b.revocationVersion)
 private fun binding(j: JSONObject)=GrantBinding(j.getString("guard_id"),j.getString("site_id"),j.getString("assignment_id"),j.getString("device_thumbprint"),j.getLong("revocation_version"))
 private fun requiredAction(kind: String)=when(kind) {
  "incident" -> "incident"; "patrol_checkpoint" -> "patrol"; "check_in" -> "check_in"; "photo_evidence" -> "photo"; "location" -> "location"
  else -> error("Unsupported authorized event kind")
 }
 fun capture(kind: String,data: JSONObject,original: GrantBinding,grant: VerifiedShiftGrant,identity: DeviceIdentity,observedAt: Long): String {
  require(observedAt in 0..9007199254740991L)
  check(grant.permits(requiredAction(kind),original,elapsedNow(),bootNow())) { "Capture not authorized" }
  check(identity.publicIdentity()?.thumbprint == original.deviceThumbprint) { "Capture device mismatch" }
  require(!data.has("capture_grant_id"))
  val eventId=UUID.randomUUID().toString()
  val event=JSONObject().put("event_id",eventId).put("at",observedAt).put("kind",kind)
   .put("data",JSONObject(data.toString()).put("capture_grant_id",grant.grantId))
  val record=JSONObject().put("scope",binding(original)).put("event",event)
  require(record.toString().toByteArray(Charsets.UTF_8).size <= 240000)
  val db=writableDatabase;db.beginTransaction()
  try {
   val seq=db.insertOrThrow("captured",null,ContentValues().apply {put("body","")})
   check(seq in 1..9007199254740991L)
   event.put("sequence",seq)
   check(db.update("captured",ContentValues().apply {put("body",cipher.encrypt(record.toString().toByteArray(Charsets.UTF_8),"mercury-scoped-event:$seq"))},"sequence=?",arrayOf(seq.toString()))==1)
   db.setTransactionSuccessful();return eventId
  } finally {db.endTransaction()}
 }
 /** FIFO across scopes prevents a later assignment from overtaking older device sequences. */
 fun prepareSigned(identity: DeviceIdentity,audience: String): JSONObject? {
  val db=writableDatabase;db.beginTransaction()
  try {
   var snapshot: JSONObject?=db.rawQuery("SELECT body FROM pending WHERE id=1",null).use {c->if(c.moveToFirst())decrypt(c.getString(0),"mercury-scoped-pending") else null}
   if(snapshot==null) {
    val events=JSONArray();var first: GrantBinding?=null;var size=0
    db.rawQuery("SELECT sequence,body FROM captured WHERE pilot_receipted=0 ORDER BY sequence LIMIT 100",null).use {c->
     while(c.moveToNext()) {
      val record=decrypt(c.getString(1),"mercury-scoped-event:${c.getLong(0)}");val scope=binding(record.getJSONObject("scope"))
      if(first!=null && first!=scope)break
      val event=record.getJSONObject("event");check(event.getLong("sequence")==c.getLong(0))
      val bytes=event.toString().toByteArray(Charsets.UTF_8).size
      if(size+bytes>250000)break
      first=scope;size+=bytes;events.put(event)
     }
    }
    if(events.length()==0){db.setTransactionSuccessful();return null}
    snapshot=JSONObject().put("scope",binding(first!!)).put("batch",JSONObject().put("batch_id",UUID.randomUUID().toString()).put("schema_version",1).put("events",events))
    db.insertOrThrow("pending",null,ContentValues().apply {put("id",1);put("body",cipher.encrypt(snapshot.toString().toByteArray(Charsets.UTF_8),"mercury-scoped-pending"))})
   }
   val proof=identity.signScopedEventBatch(audience,snapshot.getJSONObject("batch"),binding(snapshot.getJSONObject("scope")))
   db.setTransactionSuccessful();return proof
  } finally {db.endTransaction()}
 }
 /** Only records local-pilot acceptance. Does not mark operational audit records delivered. */
 fun recordPilotReceipt(receipt: JSONObject) {
  val db=writableDatabase;db.beginTransaction()
  try {
   val snapshot=db.rawQuery("SELECT body FROM pending WHERE id=1",null).use {c->check(c.moveToFirst());decrypt(c.getString(0),"mercury-scoped-pending")}
   val batch=snapshot.getJSONObject("batch");val events=batch.getJSONArray("events")
   val ids=(0 until events.length()).map {events.getJSONObject(it).getString("event_id")}.toSet()
   GuardTransport.validatePilotReceipt(receipt,batch.getString("batch_id"),ids)
   for(i in 0 until events.length()) {
    val e=events.getJSONObject(i);val seq=e.getLong("sequence")
    val stored=db.rawQuery("SELECT body FROM captured WHERE sequence=?",arrayOf(seq.toString())).use {c->check(c.moveToFirst());decrypt(c.getString(0),"mercury-scoped-event:$seq")}
    check(stored.getJSONObject("event").toString()==e.toString())
    check(db.update("captured",ContentValues().apply {put("pilot_receipted",1)},"sequence=?",arrayOf(seq.toString()))==1)
   }
   db.delete("pending","id=1",null);db.setTransactionSuccessful()
  } finally {db.endTransaction()}
 }
 fun pendingCount(): Int=readableDatabase.rawQuery("SELECT COUNT(*) FROM captured WHERE pilot_receipted=0",null).use {it.moveToFirst();it.getInt(0)}
}
