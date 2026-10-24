package ca.mercury.guard

import android.content.ContentValues
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Encrypted local timing state only: no notification, alarm, audio or service is delivered. */
class CheckInAttentionStoreTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private val owner=ConnectedDispatchOwner("a".repeat(64),"synthetic-phone",UUID.randomUUID().toString(),DispatchScope(GrantBinding("synthetic-guard","synthetic-site","synthetic-assignment","b".repeat(64),1),"synthetic-company"))
 private fun policy(revision:Long=1)=AuthorizedCheckInPolicy.parse(JSONObject().put("revision",revision).put("starts_at",1000000L).put("ends_at",4600000L)
  .put("interval_ms",900000).put("window_ms",900000).put("max_evidence_age_ms",5000).put("max_accuracy_m",20)
  .put("attention",JSONObject().put("version",1).put("profile","calm_progressive_v1")))
 private fun rejected(block:()->Unit){var denied=false;try{block()}catch(_:Exception){denied=true};assertTrue("Expected original attention state rejection",denied)}
 private inline fun fixture(block:(String,CheckInAttentionStore)->Unit){val name="attention-state-${UUID.randomUUID()}.db";val db=CheckInAttentionStore(context,name);try{block(name,db)}finally{db.close();context.deleteDatabase(name)}}

 @Test fun strictOptionalPresetDoesNotChangeLegacyPolicyAndRejectsMalformedPresentValues(){
  val legacy=policy().json().also{it.remove("attention")};val parsed=AuthorizedCheckInPolicy.parse(legacy)
  assertNull(parsed.attention);assertEquals(legacy.toString(),parsed.json().toString())
  assertEquals(CheckInAttentionPolicy.PROFILE,policy().attention!!.profile)
  val invalid=listOf<Any>(JSONObject.NULL,false,"calm_progressive_v1",JSONObject(),JSONObject().put("version",1).put("profile","unknown"),
   JSONObject().put("version",1.0).put("profile",CheckInAttentionPolicy.PROFILE),JSONObject().put("version",2).put("profile",CheckInAttentionPolicy.PROFILE),
   JSONObject().put("version",1).put("profile",CheckInAttentionPolicy.PROFILE).put("cadence",30000))
  for(value in invalid)rejected{AuthorizedCheckInPolicy.parse(JSONObject(legacy.toString()).put("attention",value))}
 }

 @Test fun exactOwnerPolicyAndAttemptSilenceSurviveEncryptedReopen(){fixture{name,db->
  val p=policy();assertEquals(CheckInAttentionStore.State(),db.read(owner,p,0))
  val first=db.claim(owner,p,0,p.startsAt,true)!!;assertEquals(0,first.lastAttempt);assertTrue(first.fullScreenAttempted);assertNull(db.claim(owner,p,0,p.startsAt,false))
  val later=db.claim(owner,p,0,p.startsAt+125000,false)!!;assertEquals(4,later.lastAttempt);assertTrue(later.fullScreenAttempted)
  assertTrue(db.silence(owner,p,0,p.startsAt+125001));assertNull(db.claim(owner,p,0,p.startsAt+150000,false))
  val raw=db.readableDatabase.rawQuery("SELECT body FROM attention",null).use{assertTrue(it.moveToFirst());it.getString(0)}
  for(privateValue in listOf(owner.subject,owner.configuration,owner.deviceId,owner.scope.binding.guardId,CheckInAttentionPolicy.PROFILE))assertFalse(raw.contains(privateValue))
  db.close();CheckInAttentionStore(context,name).use{again->val saved=again.read(owner,p,0);assertTrue(saved.silenced);assertTrue(saved.fullScreenAttempted);assertEquals(4,saved.lastAttempt);assertEquals(p.startsAt+125000,saved.attemptAt);assertNull(again.claim(owner,p,0,p.startsAt+180000,false))}
 }}

 @Test fun allOwnerDimensionsAndPolicyRevisionOrNextSlotAreSeparateWithoutResettingOriginal(){fixture{_,db->
  val p=policy();db.claim(owner,p,0,p.startsAt,false);db.silence(owner,p,0,p.startsAt+1)
  val b=owner.scope.binding
  val alternatives=listOf(owner.copy(configuration="c".repeat(64)),owner.copy(deviceId="another-phone"),owner.copy(subject=UUID.randomUUID().toString()),owner.copy(scope=owner.scope.copy(vendorId="another-company")),
   owner.copy(scope=owner.scope.copy(binding=b.copy(guardId="another-guard"))),owner.copy(scope=owner.scope.copy(binding=b.copy(siteId="another-site"))),owner.copy(scope=owner.scope.copy(binding=b.copy(assignmentId="another-assignment"))),
   owner.copy(scope=owner.scope.copy(binding=b.copy(deviceThumbprint="d".repeat(64)))),owner.copy(scope=owner.scope.copy(binding=b.copy(revocationVersion=2))))
  for(other in alternatives){assertEquals(CheckInAttentionStore.State(),db.read(other,p,0));assertEquals(0,db.claim(other,p,0,p.startsAt,false)!!.lastAttempt)}
  assertTrue(db.read(owner,p,0).silenced);assertEquals(CheckInAttentionStore.State(),db.read(owner,policy(2),0));assertEquals(CheckInAttentionStore.State(),db.read(owner,p,1))
  assertEquals(0,db.claim(owner,p,1,p.startsAt+p.interval,false)!!.lastAttempt)
  val before=db.readableDatabase.rawQuery("SELECT owner,body FROM attention ORDER BY owner",null).use{c->buildList{while(c.moveToNext())add(c.getString(0) to c.getString(1))}}
  val changed=AuthorizedCheckInPolicy.parse(p.json().put("window_ms",600000));rejected{db.read(owner,changed,0)};rejected{db.claim(owner,changed,0,p.startsAt+1,false)}
  val after=db.readableDatabase.rawQuery("SELECT owner,body FROM attention ORDER BY owner",null).use{c->buildList{while(c.moveToNext())add(c.getString(0) to c.getString(1))}};assertEquals(before,after)
 }}

 @Test fun twoHelpersClaimOnlyOneCurrentBucketAndNeverCatchUpEarlierBuckets(){fixture{name,db->
  val p=policy();db.writableDatabase
  CheckInAttentionStore(context,name).use{second->second.writableDatabase
   val ready=CountDownLatch(2);val start=CountDownLatch(1);val done=CountDownLatch(2);val accepted=AtomicInteger();val skipped=AtomicInteger();val failures=ConcurrentLinkedQueue<Throwable>()
   val threads=listOf(db,second).map{store->Thread{ready.countDown();try{check(start.await(5,TimeUnit.SECONDS));if(store.claim(owner,p,0,p.startsAt+125000,false)==null)skipped.incrementAndGet()else accepted.incrementAndGet()}catch(e:Throwable){failures.add(e)}finally{done.countDown()}}.apply{start()}}
   try{assertTrue(ready.await(5,TimeUnit.SECONDS));start.countDown();assertTrue(done.await(15,TimeUnit.SECONDS))}finally{start.countDown();threads.forEach{it.join(2000)}}
   assertTrue("Unexpected state-claim failure",failures.isEmpty());assertEquals(1,accepted.get());assertEquals(1,skipped.get());assertEquals(4,db.read(owner,p,0).lastAttempt)
   assertNull(db.claim(owner,p,0,p.startsAt+30000,false));assertNull(db.claim(owner,p,0,p.startsAt+125001,false));assertEquals(5,db.claim(owner,p,0,p.startsAt+150000,false)!!.lastAttempt)
  }
 }}

 @Test fun malformedEncryptedStateFailsClosedAndIsNotOverwritten(){fixture{_,db->
  val p=policy();db.claim(owner,p,0,p.startsAt,false)
  val original=db.readableDatabase.rawQuery("SELECT owner,body FROM attention",null).use{check(it.moveToFirst());it.getString(0) to it.getString(1)}
  val aad="mercury-connected-attention:${original.first}";val value=JSONObject(String(DeviceCipher().decrypt(original.second,aad),Charsets.UTF_8))
  try{for(change in listOf<(JSONObject)->Unit>({it.put("last_attempt","0")},{it.put("attempt_at",p.startsAt+30000)},{it.getJSONObject("owner").remove("subject")},{it.put("silenced","true")},{it.put("extra",true)})){
   val copy=JSONObject(value.toString());change(copy);val altered=DeviceCipher().encrypt(copy.toString().toByteArray(Charsets.UTF_8),aad)
   db.writableDatabase.update("attention",ContentValues().apply{put("body",altered)},"owner=?",arrayOf(original.first))
   rejected{db.read(owner,p,0)};rejected{db.claim(owner,p,0,p.startsAt+30000,false)}
   db.readableDatabase.rawQuery("SELECT body FROM attention WHERE owner=?",arrayOf(original.first)).use{check(it.moveToFirst());assertEquals(altered,it.getString(0))}
  }}finally{db.writableDatabase.update("attention",ContentValues().apply{put("body",original.second)},"owner=?",arrayOf(original.first))}
 }}
}
