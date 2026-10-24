package ca.mercury.guard

import android.content.ContentValues
import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyStore
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Encrypted local attribution with typed synthetic evidence; no SDK GPS, camera, Auth or network claim. */
class ConnectedCheckInOwnerTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private class Fixture(val context:Context):java.io.Closeable {
  val suffix=UUID.randomUUID().toString()
  val name="checkin-owner-$suffix.db"
  val attentionName="checkin-attention-cold-$suffix.db"
  val alias="test.checkin.owner.$suffix"
  val marker="checkin-owner-$suffix"
  val identity=DeviceIdentity(context,alias,marker)
  val binding=GrantBinding("check-guard","check-site","check-assignment",identity.create().thumbprint,1)
  val owner=ConnectedDispatchOwner("a".repeat(64),"check-installation",UUID.randomUUID().toString(),DispatchScope(binding,"check-company"))
  val grant=VerifiedShiftGrant("original-check-grant",binding,setOf("photo","check_in"),100,1000,1)
  val policy=AuthorizedCheckInPolicy.parse(JSONObject().put("revision",1).put("starts_at",1000).put("ends_at",131000)
   .put("interval_ms",60000).put("window_ms",10000).put("max_evidence_age_ms",5000).put("max_accuracy_m",100)
   .put("attention",JSONObject().put("version",1).put("profile","calm_progressive_v1")))
  val store=ScopedEventStore(context,name,{200},{1})
  fun evidence(mock:Boolean=false)=AuthorizedCheckInEvidence(policy,0,2000,JSONObject().put("at",3000).put("latitude",0).put("longitude",0).put("accuracy_m",5).put("mock",mock))
  fun photo()=JSONObject().put("evidence_id",UUID.randomUUID().toString()).put("sha256","a".repeat(64)).put("bytes",4).put("width",1).put("height",1).put("capture","camera_intent")
  fun capture(owner:ConnectedDispatchOwner=this.owner,db:ScopedEventStore=store)=db.captureCheckIn(owner,grant,identity,evidence(),photo(),4000)
  fun raw(kind:String="check_in"):Pair<Long,String> =store.readableDatabase.rawQuery("SELECT sequence,body FROM captured ORDER BY sequence",null).use{c->
   while(c.moveToNext()){
    val seq=c.getLong(0);val body=c.getString(1)
    if(decode(seq,body).getJSONObject("event").getString("kind")==kind)return@use seq to body
   }
   error("Expected original $kind fixture record")
  }
  fun decode(sequence:Long,body:String)=JSONObject(String(DeviceCipher().decrypt(body,"mercury-scoped-event:$sequence"),Charsets.UTF_8))
  override fun close(){store.close();context.deleteDatabase(name);context.deleteDatabase(attentionName);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)};File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()}
 }
 private fun rejected(block:()->Unit){var denied=false;try{block()}catch(_:Exception){denied=true};assertTrue("Expected original-owner, evidence or capture rejection",denied)}
 private fun payload(proof:JSONObject)=JSONObject(String(Base64.getUrlDecoder().decode(proof.getString("payload")),Charsets.UTF_8))
 private fun receipt(batch:JSONObject)=JSONObject().put("batch_id",batch.getString("batch_id")).put("status","accepted_local_only")
  .put("event_ids",JSONArray((0 until batch.getJSONArray("events").length()).map{batch.getJSONArray("events").getJSONObject(it).getString("event_id")}))

 @Test fun allNineOwnerDimensionsAreIsolatedAndSameBindingAccountsDoNotAdoptCompletion(){Fixture(context).use{f->
  f.capture();val o=f.owner
  val alternatives=listOf(o.copy(configuration="b".repeat(64)),o.copy(deviceId="another-installation"),o.copy(subject=UUID.randomUUID().toString()),o.copy(scope=o.scope.copy(vendorId="another-company")),
   o.copy(scope=o.scope.copy(binding=f.binding.copy(guardId="another-guard"))),o.copy(scope=o.scope.copy(binding=f.binding.copy(siteId="another-site"))),
   o.copy(scope=o.scope.copy(binding=f.binding.copy(assignmentId="another-assignment"))),o.copy(scope=o.scope.copy(binding=f.binding.copy(deviceThumbprint="c".repeat(64)))),o.copy(scope=o.scope.copy(binding=f.binding.copy(revocationVersion=2))))
  for(other in alternatives)assertFalse(f.store.checkInRecorded(other,1,0))
  for(other in alternatives.take(4)){f.capture(other);assertTrue(f.store.checkInRecorded(other,1,0));rejected{f.capture(other)}}
  assertTrue(f.store.checkInRecorded(o,1,0));assertFalse(f.store.checkInRecorded(o,2,0));assertFalse(f.store.checkInRecorded(o,1,1))
  assertEquals(10,f.store.pendingCount());rejected{f.capture()}
 }}

 @Test fun atomicPhotoAndCheckInReopenWithEncryptedOwnerAndUnchangedSignedRetry(){Fixture(context).use{f->
  val eventId=f.capture();val original=f.raw();val record=f.decode(original.first,original.second);val originalPhoto=f.raw("photo_evidence");val photo=f.decode(originalPhoto.first,originalPhoto.second)
  assertEquals(f.owner.json().toString(),record.getJSONObject("check_in_owner").toString())
  assertEquals(f.owner.json().toString(),photo.getJSONObject("photo_owner").toString())
  assertEquals(photo.getJSONObject("event").getString("event_id"),record.getJSONObject("event").getJSONObject("data").getString("photo_event_id"))
  for(secret in listOf(f.owner.subject,f.owner.configuration,f.owner.deviceId,f.binding.guardId)){assertFalse(original.second.contains(secret));assertFalse(originalPhoto.second.contains(secret))}
  val signed=f.store.prepareSigned(f.identity,"mercury-local",f.binding.guardId)!!;val batch=payload(signed);val events=batch.getJSONArray("events")
  assertEquals(2,events.length());assertEquals("photo_evidence",events.getJSONObject(0).getString("kind"));val check=events.getJSONObject(1)
  assertEquals(eventId,check.getString("event_id"));assertEquals(setOf("event_id","at","kind","data","sequence"),check.keys().asSequence().toSet())
  assertEquals(setOf("policy_revision","slot","biometric","location","photo_event_id","evidence_id","capture_grant_id"),check.getJSONObject("data").keys().asSequence().toSet())
  for(secret in listOf("check_in_owner","photo_owner",f.owner.subject,f.owner.configuration,f.owner.deviceId))assertFalse(batch.toString().contains(secret))
  f.store.close()
  ScopedEventStore(context,f.name,{200},{1}).use{reopened->
   assertTrue(reopened.checkInRecorded(f.owner,1,0));assertEquals(signed.getString("payload"),reopened.prepareSigned(f.identity,"mercury-local",f.binding.guardId)!!.getString("payload"))
   rejected{f.capture(db=reopened)};assertEquals(2,reopened.pendingCount())
   reopened.readableDatabase.rawQuery("SELECT body FROM captured WHERE sequence=?",arrayOf(original.first.toString())).use{assertTrue(it.moveToFirst());assertEquals(original.second,it.getString(0))}
   reopened.recordPilotReceipt(receipt(batch),f.binding.guardId);assertEquals(0,reopened.pendingCount());assertTrue(reopened.checkInRecorded(f.owner,1,0))
  }
 }}

 @Test fun legacyCompletionAndOriginalPendingSnapshotRemainQuarantined(){Fixture(context).use{f->
  f.store.captureCheckIn(f.binding,f.grant,f.identity,f.evidence(),f.photo(),4000);val legacy=f.raw();val pending=f.store.prepareSigned(f.identity,"mercury-local",f.binding.guardId)!!
  assertTrue(f.store.checkInRecorded(f.binding,1,0));assertFalse(f.store.checkInRecorded(f.owner,1,0))
  f.capture();assertTrue(f.store.checkInRecorded(f.owner,1,0));assertEquals(4,f.store.pendingCount())
  assertEquals(pending.getString("payload"),f.store.prepareSigned(f.identity,"mercury-local",f.binding.guardId)!!.getString("payload"));assertEquals(legacy,f.raw())
  assertFalse(f.decode(legacy.first,legacy.second).has("check_in_owner"))
 }}

 @Test fun captureCommittedBeforeAnyReminderAttemptIsRecoveredAsCompleteAfterRestart(){Fixture(context).use{f->
  f.capture();f.store.close()
  ScopedEventStore(context,f.name,{200},{1}).use{reopened->
   CheckInAttentionStore(context,f.attentionName).use{attention->
    val cold=attention.read(f.owner,f.policy,0);assertEquals(-1,cold.lastAttempt);assertNull(cold.attemptAt)
    val decision=CheckInAttentionTiming.evaluate(f.policy.startsAt,f.policy.endsAt,f.policy.interval,f.policy.window,5000,cold.lastAttempt,cold.silenced,reopened.checkInRecorded(f.owner,1,0))
    assertEquals(CheckInAttentionTiming.Stage.COMPLETE,decision.stage);assertFalse(decision.notify);assertFalse(decision.pulse)
    assertEquals(2,reopened.pendingCount());assertEquals(-1,attention.read(f.owner,f.policy,0).lastAttempt)
   }
  }
 }}

 @Test fun separateHelpersCommitExactlyOnePhotoCheckInPairForTheSameOwnerSlot(){Fixture(context).use{f->
  f.store.writableDatabase
  ScopedEventStore(context,f.name,{200},{1}).use{second->
   second.writableDatabase;val ready=CountDownLatch(2);val start=CountDownLatch(1);val done=CountDownLatch(2);val accepted=AtomicInteger();val duplicate=AtomicInteger();val unexpected=ConcurrentLinkedQueue<Throwable>()
   val threads=listOf(f.store,second).map{db->Thread{
    ready.countDown()
    try{check(start.await(5,TimeUnit.SECONDS));f.capture(db=db);accepted.incrementAndGet()}
    catch(e:IllegalStateException){if(e.message=="Check-in already recorded")duplicate.incrementAndGet()else unexpected.add(e)}
    catch(e:Throwable){unexpected.add(e)}finally{done.countDown()}
   }.apply{start()}}
   try{assertTrue(ready.await(5,TimeUnit.SECONDS));start.countDown();assertTrue("Owned check-in workers did not complete",done.await(15,TimeUnit.SECONDS))}
   finally{start.countDown();for(thread in threads)thread.join(2000)}
   assertTrue("Unexpected duplicate-worker failure",unexpected.isEmpty());assertEquals(1,accepted.get());assertEquals(1,duplicate.get())
   assertEquals(2,f.store.pendingCount());assertTrue(f.store.checkInRecorded(f.owner,1,0))
   f.store.readableDatabase.rawQuery("SELECT count(*) FROM check_in_keys",null).use{assertTrue(it.moveToFirst());assertEquals(1,it.getInt(0))}
  }
 }}

 @Test fun malformedEncryptedOwnerCannotCountAsCompletionOrAppendAnotherPair(){Fixture(context).use{f->
  f.capture();val original=f.raw();val body=f.decode(original.first,original.second)
  val mutations=listOf<(JSONObject)->Unit>({it.remove("subject")},{it.put("unexpected",true)},{it.put("version","1")},{it.put("subject",100)},{it.getJSONObject("scope").put("revocation_version",1.25)},{it.getJSONObject("scope").put("guard_id",100)})
  try{for(mutate in mutations){
   val altered=JSONObject(body.toString());mutate(altered.getJSONObject("check_in_owner"));val encrypted=DeviceCipher().encrypt(altered.toString().toByteArray(Charsets.UTF_8),"mercury-scoped-event:${original.first}")
   f.store.writableDatabase.update("captured",ContentValues().apply{put("body",encrypted)},"sequence=?",arrayOf(original.first.toString()))
   rejected{f.store.checkInRecorded(f.owner,1,0)};rejected{f.capture()};assertEquals(2,f.store.pendingCount());assertEquals(encrypted,f.raw().second)
  }}finally{f.store.writableDatabase.update("captured",ContentValues().apply{put("body",original.second)},"sequence=?",arrayOf(original.first.toString()))}
  assertTrue(f.store.checkInRecorded(f.owner,1,0))
 }}

 @Test fun partialCaptureFailureInvalidAuthorityAndSyntheticEvidenceLeaveNoPhotoOrCheckIn(){Fixture(context).use{f->
  for(grant in listOf(VerifiedShiftGrant("photo-only",f.binding,setOf("photo"),100,1000,1),VerifiedShiftGrant("check-only",f.binding,setOf("check_in"),100,1000,1),
   VerifiedShiftGrant("expired",f.binding,setOf("photo","check_in"),100,200,1),VerifiedShiftGrant("wrong-boot",f.binding,setOf("photo","check_in"),100,1000,2),
   VerifiedShiftGrant("wrong-assignment",f.binding.copy(assignmentId="another"),setOf("photo","check_in"),100,1000,1)))
   rejected{f.store.captureCheckIn(f.owner,grant,f.identity,f.evidence(),f.photo(),4000)}
  rejected{f.store.captureCheckIn(f.owner,f.grant,f.identity,f.evidence(true),f.photo(),4000)}
  rejected{f.store.captureCheckIn(f.owner,f.grant,f.identity,f.evidence(),JSONObject(),4000)}
  rejected{f.store.captureCheckIn(f.owner,f.grant,f.identity,f.evidence(),f.photo(),11000)}
  rejected{f.capture(f.owner.copy(scope=f.owner.scope.copy(binding=f.binding.copy(deviceThumbprint="d".repeat(64)))))}
  assertEquals(0,f.store.pendingCount());assertFalse(f.store.checkInRecorded(f.owner,1,0));assertNull(f.store.prepareSigned(f.identity,"mercury-local",f.binding.guardId))
  f.store.readableDatabase.rawQuery("SELECT count(*) FROM check_in_keys",null).use{assertTrue(it.moveToFirst());assertEquals(0,it.getInt(0))}
 }}
}
