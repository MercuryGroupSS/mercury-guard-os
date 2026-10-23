package ca.mercury.guard

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.Closeable
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** Synthetic private-queue tests. No HTTP, dialer, real account or device action. */
class EscalationStoreTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private class Fixture(private val context:Context):Closeable {
  private val name="escalation-test-${UUID.randomUUID()}.db"
  val elapsed=AtomicLong(1000L)
  val boot=AtomicInteger(1)
  val store=open()
  fun open()=EscalationStore(context,name,{elapsed.get()},{boot.get()})
  override fun close(){store.close();context.deleteDatabase(name)}
 }
 private fun scope()=EscalationScope("a".repeat(64),"synthetic-phone","b".repeat(64),"11111111-1111-4111-8111-111111111111","guard-one","shared-company")
 private fun intent(scope:EscalationScope,id:String=UUID.randomUUID().toString(),description:String="Synthetic request only. No real alert.")=EscalationIntent(id,scope.guardId,scope.vendorId,null,1730000000000L,"assistance",description,null)
 private fun receipt(record:EscalationRecord,received:Long=1730000100000L)=JSONObject().put("version",1).put("escalation_id",record.id).put("intent_sha256",record.hash).put("status","received_by_guard_service").put("received_at_ms",received)
 private fun status(record:EscalationRecord,acknowledged:Boolean=false,received:Long=1730000100000L):JSONObject=receipt(record,received).put("status",if(acknowledged)"operator_acknowledged" else "received_by_guard_service").put("acknowledgement",if(!acknowledged)JSONObject.NULL else JSONObject().put("operator_subject","22222222-2222-4222-8222-222222222222").put("acknowledged_at_ms",received+1000).put("note","Synthetic operator acknowledgement. No response is claimed."))
 private fun rejected(action:()->Unit){try{action();fail("Invalid scope, receipt or stale lease was accepted")}catch(_:IllegalArgumentException){}catch(_:IllegalStateException){}catch(_:android.database.sqlite.SQLiteConstraintException){}}

 @Test fun exactUnicodeRawBytesSurviveEncryptionRestartAndIdempotentSave(){Fixture(context).use{f->
  val scope=scope();val value=intent(scope,description="Synthetic only: café 🚀 / quote \" and newline\nsecond line");val raw=JSONObject(EscalationProtocol.raw(value)).toString(2);val record=f.store.saveRaw(scope,raw)
  val expected=MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
  assertEquals(raw,record.raw);assertEquals(expected,record.hash);assertArrayEquals(raw.toByteArray(Charsets.UTF_8),Base64.getUrlDecoder().decode(EscalationProtocol.encode(record.raw)))
  assertEquals(raw,f.store.saveRaw(scope,raw).raw)
  rejected{f.store.saveRaw(scope,JSONObject(raw).toString())}
  f.store.readableDatabase.rawQuery("SELECT body FROM intents",null).use{assertTrue(it.moveToFirst());val encrypted=it.getString(0);assertFalse(encrypted.contains("Synthetic only"));assertFalse(encrypted.contains(scope.subject));assertFalse(encrypted.contains(scope.guardId))}
  f.store.close();f.open().use{reopened->val saved=reopened.get(value.id,scope)!!;assertEquals(raw,saved.raw);assertEquals(expected,saved.hash);assertEquals("Saved locally",saved.state);assertEquals(1,reopened.list(scope).size)}
 }}

 @Test fun originalSubjectGuardVendorConfigAndInstallationNeverRebindRetainedIntents(){Fixture(context).use{f->
  val original=scope();val saved=f.store.save(original,intent(original))
  val foreign=listOf(original.copy(configuration="c".repeat(64)),original.copy(deviceId="another-phone"),original.copy(thumbprint="d".repeat(64)),original.copy(subject="33333333-3333-4333-8333-333333333333"),original.copy(guardId="guard-two"),original.copy(vendorId="another-company"))
  for(other in foreign){assertNull(f.store.get(saved.id,other));assertTrue(f.store.list(other).isEmpty());assertNull(f.store.claim(other,"new-session"));rejected{f.store.saveRaw(other,saved.raw)}}
  val subjectRebound=foreign[3];val newPersonIntent=intent(subjectRebound)
  f.store.save(subjectRebound,newPersonIntent);assertEquals(listOf(newPersonIntent.id),f.store.list(subjectRebound).map{it.id});assertEquals(listOf(saved.id),f.store.list(original).map{it.id})
  rejected{f.store.saveRaw(original,JSONObject(saved.raw).put("assignment_id","different-assignment").toString())};assertEquals(saved.raw,f.store.get(saved.id,original)!!.raw)
 }}

 @Test fun exactServiceReceiptsAndFirstOperatorStatusCannotChangeOrRegress(){Fixture(context).use{f->
  val scope=scope();val record=f.store.save(scope,intent(scope));val lease=f.store.claim(scope,"session-a")!!
  rejected{f.store.accepted(lease,receipt(record).put("intent_sha256","e".repeat(64)),false)}
  rejected{f.store.accepted(lease,receipt(record).put("escalation_id",UUID.randomUUID().toString()),false)}
  f.store.accepted(lease,receipt(record),false);assertEquals("Service received",f.store.get(record.id,scope)!!.state)
  assertNull(f.store.claim(scope,"session-a")) // Automatic status reads respect their cooldown.
  val retry=f.store.claim(scope,"session-a",record.id)!!
  rejected{f.store.accepted(retry,status(record,received=1730000100001L),true)}
  f.store.accepted(retry,status(record),true);assertEquals("Service received",f.store.get(record.id,scope)!!.state)
  val acknowledged=f.store.claim(scope,"session-a",record.id)!!
  f.store.accepted(acknowledged,status(record,true),true);val accepted=f.store.get(record.id,scope)!!;assertEquals("Operator acknowledged",accepted.state);assertFalse(f.store.awaiting(scope,"session-a"));assertNull(f.store.claim(scope,"session-a",record.id))
  rejected{f.store.accepted(acknowledged,status(record),true)}
  assertEquals(accepted.snapshot.toString(),f.store.get(record.id,scope)!!.snapshot.toString())
  f.store.close();f.open().use{reopened->assertEquals("Operator acknowledged",reopened.get(record.id,scope)!!.state);assertNull(reopened.claim(scope,"another-session",record.id))}
 }}

 @Test fun concurrentHelpersClaimOneLeaseAndStaleWorkersCannotEraseReplacement(){Fixture(context).use{f->
  val scope=scope();val record=f.store.save(scope,intent(scope));val workers=Executors.newFixedThreadPool(2);val start=CountDownLatch(1)
  try{
   val tasks=(1..2).map{workers.submit<EscalationLease?>{start.await();f.open().use{it.claim(scope,"session-a")}}};start.countDown();val leases=tasks.map{it.get(20,TimeUnit.SECONDS)};assertEquals(1,leases.count{it!=null});val old=leases.filterNotNull().single()
   f.elapsed.addAndGet(120001L);val replacement=f.open().use{it.claim(scope,"session-a")}!!;assertNotEquals(old.token,replacement.token)
   rejected{f.store.accepted(old,receipt(record),false)};rejected{f.store.release(old)};assertNull(f.store.claim(scope,"session-a",record.id))
   f.store.accepted(replacement,receipt(record),false);assertEquals("Service received",f.store.get(record.id,scope)!!.state);assertEquals(record.raw,f.store.get(record.id,scope)!!.raw)
  }finally{workers.shutdownNow()}
 }}

 @Test fun restartBootChangeAndCancelledWorkPreserveOriginalUnsentSnapshot(){Fixture(context).use{f->
  val scope=scope();val record=f.store.save(scope,intent(scope));val original=f.store.claim(scope,"session-a")!!;f.store.close()
  f.open().use{reopened->assertNull(reopened.claim(scope,"session-a",record.id));assertEquals(record.hash,reopened.get(record.id,scope)!!.hash)}
  f.boot.incrementAndGet();f.elapsed.set(10L)
  f.open().use{reopened->
   val afterBoot=reopened.claim(scope,"session-b",record.id)!!;assertNotEquals(original.token,afterBoot.token);rejected{reopened.accepted(original,receipt(record),false)}
   reopened.release(afterBoot);val unsent=reopened.get(record.id,scope)!!;assertNull(unsent.receipt);assertEquals(record.raw,unsent.raw);assertEquals("Saved locally",unsent.state)
   val retry=reopened.claim(scope,"session-b",record.id)!!;assertEquals(record.raw,retry.record.raw);reopened.release(retry)
  }
 }}

 @Test fun heldOriginalRequestDoesNotBlockLaterOnesAndAnotherSessionRetriesSameBytes(){Fixture(context).use{f->
  val scope=scope();val first=f.store.save(scope,intent(scope));val second=f.store.save(scope,intent(scope));val lease=f.store.claim(scope,"session-a")!!;assertEquals(first.id,lease.record.id)
  f.store.release(lease,"session-a",403);val later=f.store.claim(scope,"session-a")!!;assertEquals(second.id,later.record.id);f.store.release(later,"session-a",400);assertFalse(f.store.awaiting(scope,"session-a"));assertNull(f.store.claim(scope,"session-a"))
  val freshSession=f.store.claim(scope,"session-b")!!;assertEquals(first.id,freshSession.record.id);assertEquals(first.raw,freshSession.record.raw);assertEquals(first.hash,freshSession.record.hash);assertNull(freshSession.record.receipt);f.store.release(freshSession)
 }}
}
