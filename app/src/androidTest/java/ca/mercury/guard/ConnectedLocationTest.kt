package ca.mercury.guard

import android.content.ContentValues
import android.location.Location
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyStore
import java.util.UUID

class ConnectedLocationTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private fun policy():AuthorizedLocationPolicy {
  val notice="Synthetic location test notice only. No real guard is tracked."
  val raw=JSONObject().put("version",1).put("revision",1).put("notice_revision",2).put("notice_text",notice).put("notice_sha256",EscalationProtocol.hash(notice)).put("sample_interval_ms",1000).put("min_distance_m",0).put("max_fix_age_ms",2000).put("max_accuracy_m",20).put("max_capture_lease_ms",10000).put("geofence",JSONObject.NULL).toString()
  return AuthorizedLocationPolicy.parse(EscalationProtocol.encode(raw),EscalationProtocol.hash(raw))
 }
 private fun scope(thumb:String="b".repeat(64))=LocationConsentScope(EscalationScope("a".repeat(64),"synthetic-phone",thumb,UUID.randomUUID().toString(),"guard","vendor"),GrantBinding("guard","site","shift",thumb,1))
 private fun receipt(r:LocationConsentRecord,action:String="consent"):JSONObject {val raw=r.intent(action);val i=JSONObject(raw);return JSONObject().put("version",1).put("request_id",i.getString("request_id")).put("consent_id",r.id).put("action",action).put("status",if(action=="consent")"consent_recorded"else"consent_withdrawn").put("recorded_at_ms",1730000000000L).put("intent_sha256",EscalationProtocol.hash(raw))}
 private fun rejected(action:()->Unit){try{action();fail("Invalid location accepted")}catch(_:IllegalArgumentException){}catch(_:IllegalStateException){}}
 @Test fun approvedBytesAndExactNoticeHashAreRequiredWithoutDefaults(){
  val p=policy();assertEquals(1000,p.interval);assertNull(p.geofence)
  rejected{AuthorizedLocationPolicy.parse(p.payload,"0".repeat(64))}
  val j=JSONObject(String(java.util.Base64.getUrlDecoder().decode(p.payload),Charsets.UTF_8)).put("notice_text","Changed")
  val raw=j.toString();rejected{AuthorizedLocationPolicy.parse(EscalationProtocol.encode(raw),EscalationProtocol.hash(raw))}
  j.remove("sample_interval_ms");val absent=j.toString();rejected{AuthorizedLocationPolicy.parse(EscalationProtocol.encode(absent),EscalationProtocol.hash(absent))}
 }
 @Test fun encryptedConsentRetryAndWithdrawalRetainExactOriginalIndividualScope(){
  val name="location-consent-test-${UUID.randomUUID()}.db";val s=scope();val p=policy()
  try{LocationConsentStore(context,name).use{db->
   val r=db.prepare(s,p);assertEquals(r.raw,db.prepare(s,p).raw);assertFalse(db.canUpload(r.id,s,p.sha256))
   db.accept(r.id,s,"consent",receipt(r));val reordered=JSONObject();for(k in receipt(r).keys().asSequence().toList().reversed())reordered.put(k,receipt(r).get(k));db.accept(r.id,s,"consent",reordered);assertTrue(db.canUpload(r.id,s,p.sha256))
   val encrypted=db.readableDatabase.rawQuery("SELECT body FROM consent",null).use{it.moveToFirst();it.getString(0)};assertFalse(encrypted.contains(s.account.subject));assertFalse(encrypted.contains(p.notice))
   val withdrawn=db.withdraw(r.id,s);assertEquals(r.raw,withdrawn.raw);assertFalse(db.canUpload(r.id,s,p.sha256));assertNull(db.current(s,p.sha256));assertEquals(withdrawn.withdrawal,db.withdraw(r.id,s).withdrawal)
   rejected{db.accept(r.id,s,"withdraw",receipt(withdrawn,"withdraw").put("intent_sha256","0".repeat(64)))}
   db.accept(r.id,s,"withdraw",receipt(withdrawn,"withdraw"));assertNotNull(db.get(r.id,s)!!.withdrawalReceipt)
   assertNull(db.get(r.id,s.copy(account=s.account.copy(subject=UUID.randomUUID().toString()))))
  };LocationConsentStore(context,name).use{assertTrue(it.list(s.account).single().withdrawn)}}finally{context.deleteDatabase(name)}
 }
 @Test fun laterWithdrawalPermanentlyBlocksOlderConsentWithoutFallbackEvenAfterFreshConsent(){
  val name="location-barrier-${UUID.randomUUID()}.db";val second="location-independent-${UUID.randomUUID()}.db";val s=scope();val p=policy()
  try{LocationConsentStore(context,name).use{db->LocationConsentStore(context,second).use{independent->
   val a=db.prepare(s,p);db.accept(a.id,s,"consent",receipt(a))
   val b=independent.prepare(s,p);independent.accept(b.id,s,"consent",receipt(b))
   // Simulate another explicitly retained consent arriving from the same original installation.
   independent.readableDatabase.rawQuery("SELECT id,owner,body,receipt FROM consent",null).use{c->assertTrue(c.moveToFirst());db.writableDatabase.insertOrThrow("consent",null,ContentValues().apply{for(i in 0..3)put(c.getColumnName(i),c.getString(i))})}
   assertEquals(b.id,db.current(s,p.sha256)!!.id);assertTrue(db.canUpload(a.id,s,p.sha256))
   db.withdraw(b.id,s);assertNull(db.current(s,p.sha256));assertFalse(db.canUpload(a.id,s,p.sha256));assertFalse(db.canUpload(b.id,s,p.sha256))
   val c=db.prepare(s,p);assertNotEquals(a.id,c.id);assertNotEquals(b.id,c.id);db.accept(c.id,s,"consent",receipt(c));assertTrue(db.canUpload(c.id,s,p.sha256));assertFalse(db.canUpload(a.id,s,p.sha256));assertFalse(db.canUpload(b.id,s,p.sha256));assertEquals(a.raw,db.get(a.id,s)!!.raw)
  }}}finally{context.deleteDatabase(name);context.deleteDatabase(second)}
 }
 @Test fun typedSamplesShareSequenceButDeniedLocationPartitionCannotBlockIncident(){
  val suffix=UUID.randomUUID().toString();val alias="location-test-$suffix";val marker="location-test-$suffix";val consentName="location-consent-$suffix.db";val eventName="location-events-$suffix.db"
  try{
   val identity=DeviceIdentity(context,alias,marker);val s=scope(identity.create().thumbprint);val p=policy()
   LocationConsentStore(context,consentName).use{consents->ScopedEventStore(context,eventName,{100},{1}).use{events->
    var r=consents.prepare(s,p);consents.accept(r.id,s,"consent",receipt(r));r=consents.get(r.id,s)!!
    val auth=AuthorizedLocationConsent(r.id,p);val grant=VerifiedShiftGrant(UUID.randomUUID().toString(),s.binding,setOf("location","incident"),100,10000,1,auth,99000,109000)
    val fix=Location("gps").apply{latitude=45.0;longitude=-73.0;accuracy=5f;elapsedRealtimeNanos=1000000000L}
    val sample=ConnectedLocationSample.fromLocation(fix,grant,100000,1000000000L)!!
    events.captureLocation(r,grant,identity,sample);events.capture("incident",JSONObject().put("description","Synthetic incident remains deliverable"),s.binding,grant,identity,100001)
    val location=events.prepareUpload(identity,"mercury-local","guard","session-a")!!
    val first=JSONObject(String(java.util.Base64.getUrlDecoder().decode(location.getString("payload")),Charsets.UTF_8));assertEquals("location",first.getJSONArray("events").getJSONObject(0).getString("kind"));assertEquals(1,first.getJSONArray("events").length())
    events.retainUploadForReview("guard",first.getString("batch_id"),"session-a",403)
    val next=events.prepareUpload(identity,"mercury-local","guard","session-a")!!;val second=JSONObject(String(java.util.Base64.getUrlDecoder().decode(next.getString("payload")),Charsets.UTF_8))
    assertEquals("incident",second.getJSONArray("events").getJSONObject(0).getString("kind"));assertTrue(first.getJSONArray("events").getJSONObject(0).getLong("sequence")<second.getJSONArray("events").getJSONObject(0).getLong("sequence"))
    val original=events.prepareUpload(identity,"mercury-local","guard","session-b")!!;assertEquals(location.getString("payload"),original.getString("payload"));assertEquals(location.getString("device_thumbprint"),original.getString("device_thumbprint"))
    assertNull(ConnectedLocationSample.fromLocation(fix.apply{accuracy=100f},grant,100000,1000000000L))
    if(android.os.Build.VERSION.SDK_INT>=31)assertNull(ConnectedLocationSample.fromLocation(fix.apply{accuracy=5f;isMock=true},grant,100000,1000000000L))
   }}
  }finally{context.deleteDatabase(consentName);context.deleteDatabase(eventName);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)};File(context.noBackupFilesDir,marker).delete()}
 }
 @Test fun collectorIsSeparateNonExportedAndHasNoUnrestrictedBackgroundPermission(){
  val service=context.packageManager.getServiceInfo(android.content.ComponentName(context,ConnectedLocationService::class.java),0);assertFalse(service.exported)
  assertEquals(PackageManagerDenied,context.checkSelfPermission("android.permission.ACCESS_BACKGROUND_LOCATION"))
  assertNotEquals(PatrolService::class.java,ConnectedLocationService::class.java)
 }
 private val PackageManagerDenied get()=android.content.pm.PackageManager.PERMISSION_DENIED
}
