package ca.mercury.guard

import android.content.Context
import android.content.ContentValues
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

/** Local owner attribution only. No Auth, network, enrollment or biometric-success injection. */
class ConnectedDispatchAckOwnerTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private class Fixture(val context:Context):java.io.Closeable {
  val suffix=UUID.randomUUID().toString()
  val name="dispatch-ack-owner-$suffix.db"
  val alias="test.dispatch.ack.$suffix"
  val marker="dispatch-ack-$suffix"
  val identity=DeviceIdentity(context,alias,marker)
  val binding=GrantBinding("ack-guard","ack-site","ack-assignment",identity.create().thumbprint,1)
  val owner=ConnectedDispatchOwner("a".repeat(64),"ack-installation",UUID.randomUUID().toString(),DispatchScope(binding,"ack-company"))
  val grant=VerifiedShiftGrant("original-ack-grant",binding,setOf("dispatch_ack"),100,1000,1)
  val store=ScopedEventStore(context,name,{200},{1})
  fun capture(owner:ConnectedDispatchOwner=this.owner,id:String="message",version:Long=1)=store.acknowledgeDispatch(owner,grant,identity,id,version,10000)
  fun raw():Pair<Long,String> =store.readableDatabase.rawQuery("SELECT sequence,body FROM captured ORDER BY sequence LIMIT 1",null).use{check(it.moveToFirst());it.getLong(0) to it.getString(1)}
  override fun close(){store.close();context.deleteDatabase(name);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)};File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()}
 }
 private fun rejected(block:()->Unit){var denied=false;try{block()}catch(_:Exception){denied=true};assertTrue("Expected original-owner or capture rejection",denied)}
 private fun payload(proof:JSONObject)=JSONObject(String(Base64.getUrlDecoder().decode(proof.getString("payload")),Charsets.UTF_8))
 private fun receipt(batch:JSONObject)=JSONObject().put("batch_id",batch.getString("batch_id")).put("status","accepted_local_only")
  .put("event_ids",JSONArray((0 until batch.getJSONArray("events").length()).map{batch.getJSONArray("events").getJSONObject(it).getString("event_id")}))

 @Test fun everyOwnerDimensionIsolatedAndSameBindingAccountsCanAcknowledgeIndependently(){Fixture(context).use{f->
  val o=f.owner;f.capture()
  val alternatives=listOf(o.copy(configuration="b".repeat(64)),o.copy(deviceId="another-installation"),o.copy(subject=UUID.randomUUID().toString()),o.copy(scope=o.scope.copy(vendorId="another-company")),
   o.copy(scope=o.scope.copy(binding=f.binding.copy(guardId="another-guard"))),o.copy(scope=o.scope.copy(binding=f.binding.copy(siteId="another-site"))),
   o.copy(scope=o.scope.copy(binding=f.binding.copy(assignmentId="another-assignment"))),o.copy(scope=o.scope.copy(binding=f.binding.copy(deviceThumbprint="c".repeat(64)))),o.copy(scope=o.scope.copy(binding=f.binding.copy(revocationVersion=2))))
  for(other in alternatives)assertFalse(f.store.dispatchAcknowledged(other,"message",1))
  for(other in alternatives.take(4)){f.capture(other);assertTrue(f.store.dispatchAcknowledged(other,"message",1));rejected{f.capture(other)}}
  assertTrue(f.store.dispatchAcknowledged(o,"message",1));assertFalse(f.store.dispatchAcknowledged(o,"message",2));assertFalse(f.store.dispatchAcknowledged(o,"another-message",1))
  assertEquals(5,f.store.pendingCount());rejected{f.capture()}
 }}

 @Test fun encryptedOwnerReopensWithoutChangingEventWireOrImmutableRetryIdentity(){Fixture(context).use{f->
  val eventId=f.capture();val original=f.raw();val decrypted=JSONObject(String(DeviceCipher().decrypt(original.second,"mercury-scoped-event:${original.first}"),Charsets.UTF_8))
  assertEquals(f.owner.json().toString(),decrypted.getJSONObject("dispatch_owner").toString())
  for(secret in listOf(f.owner.subject,f.owner.configuration,f.owner.deviceId,f.binding.guardId))assertFalse(original.second.contains(secret))
  val first=f.store.prepareSigned(f.identity,"mercury-local",f.binding.guardId)!!;val batch=payload(first);val event=batch.getJSONArray("events").getJSONObject(0)
  assertEquals(eventId,event.getString("event_id"));assertEquals(setOf("event_id","at","kind","data","sequence"),event.keys().asSequence().toSet())
  assertEquals(setOf("message_id","message_version","capture_grant_id"),event.getJSONObject("data").keys().asSequence().toSet())
  assertFalse(batch.toString().contains("dispatch_owner"));assertFalse(batch.toString().contains(f.owner.subject));assertFalse(batch.toString().contains(f.owner.configuration));assertFalse(batch.toString().contains(f.owner.deviceId))
  f.store.close()
  ScopedEventStore(context,f.name,{200},{1}).use{reopened->
   assertTrue(reopened.dispatchAcknowledged(f.owner,"message",1));val retry=reopened.prepareSigned(f.identity,"mercury-local",f.binding.guardId)!!
   assertEquals(first.getString("payload"),retry.getString("payload"));assertEquals(batch.getJSONObject("scope").toString(),payload(retry).getJSONObject("scope").toString())
   rejected{reopened.acknowledgeDispatch(f.owner,f.grant,f.identity,"message",1,10001)};assertEquals(1,reopened.pendingCount())
   reopened.readableDatabase.rawQuery("SELECT body FROM captured WHERE sequence=?",arrayOf(original.first.toString())).use{assertTrue(it.moveToFirst());assertEquals(original.second,it.getString(0))}
   reopened.recordPilotReceipt(receipt(batch),f.binding.guardId);assertEquals(0,reopened.pendingCount());assertTrue(reopened.dispatchAcknowledged(f.owner,"message",1))
  }
 }}

 @Test fun legacyAcknowledgementAndPendingSnapshotRemainUnchangedAndNeverCountForConnectedOwner(){Fixture(context).use{f->
  f.store.acknowledgeDispatch(f.binding,f.grant,f.identity,"message",1,9999);val legacy=f.raw();val pending=f.store.prepareSigned(f.identity,"mercury-local",f.binding.guardId)!!
  assertTrue(f.store.dispatchAcknowledged(f.binding,"message",1));assertFalse(f.store.dispatchAcknowledged(f.owner,"message",1))
  f.capture();assertTrue(f.store.dispatchAcknowledged(f.owner,"message",1));assertEquals(2,f.store.pendingCount())
  assertEquals(pending.getString("payload"),f.store.prepareSigned(f.identity,"mercury-local",f.binding.guardId)!!.getString("payload"))
  assertEquals(legacy,f.raw());val record=JSONObject(String(DeviceCipher().decrypt(legacy.second,"mercury-scoped-event:${legacy.first}"),Charsets.UTF_8));assertFalse(record.has("dispatch_owner"))
 }}

 @Test fun separateHelpersSerializeDuplicateCheckAndCaptureInOneTransaction(){Fixture(context).use{f->
  f.store.writableDatabase
  ScopedEventStore(context,f.name,{200},{1}).use{second->
   second.writableDatabase;val ready=CountDownLatch(2);val start=CountDownLatch(1);val done=CountDownLatch(2);val accepted=AtomicInteger();val rejected=AtomicInteger();val unexpected=ConcurrentLinkedQueue<Throwable>()
   val threads=listOf(f.store,second).map{store->Thread{
    ready.countDown()
    try{check(start.await(5,TimeUnit.SECONDS));store.acknowledgeDispatch(f.owner,f.grant,f.identity,"racing-message",1,10000);accepted.incrementAndGet()}
    catch(e:IllegalStateException){if(e.message=="Acknowledgement already recorded")rejected.incrementAndGet()else unexpected.add(e)}
    catch(e:Throwable){unexpected.add(e)}finally{done.countDown()}
   }.apply{start()}}
   try{assertTrue(ready.await(5,TimeUnit.SECONDS));start.countDown();assertTrue("Owned duplicate workers did not complete",done.await(15,TimeUnit.SECONDS))}
   finally{start.countDown();for(thread in threads)thread.join(2000)}
   assertTrue("Unexpected duplicate-worker failure",unexpected.isEmpty());assertEquals(1,accepted.get());assertEquals(1,rejected.get());assertEquals(1,f.store.pendingCount());assertTrue(f.store.dispatchAcknowledged(f.owner,"racing-message",1))
  }
 }}

 @Test fun malformedEncryptedOwnerFailsClosedWithoutAppendingOrRewriting(){Fixture(context).use{f->
  f.capture();val original=f.raw();val body=JSONObject(String(DeviceCipher().decrypt(original.second,"mercury-scoped-event:${original.first}"),Charsets.UTF_8))
  val invalid=listOf<(JSONObject)->Unit>({it.remove("subject")},{it.put("unexpected",true)},{it.put("version","1")},{it.put("subject",100)},{it.getJSONObject("scope").put("revocation_version",1.25)},{it.getJSONObject("scope").put("guard_id",100)})
  try{for(change in invalid){
   val altered=JSONObject(body.toString());change(altered.getJSONObject("dispatch_owner"));val encrypted=DeviceCipher().encrypt(altered.toString().toByteArray(Charsets.UTF_8),"mercury-scoped-event:${original.first}")
   f.store.writableDatabase.update("captured",ContentValues().apply{put("body",encrypted)},"sequence=?",arrayOf(original.first.toString()))
   rejected{f.store.dispatchAcknowledged(f.owner,"message",1)};rejected{f.capture()};assertEquals(1,f.store.pendingCount());assertEquals(encrypted,f.raw().second)
  }}finally{f.store.writableDatabase.update("captured",ContentValues().apply{put("body",original.second)},"sequence=?",arrayOf(original.first.toString()))}
  assertTrue(f.store.dispatchAcknowledged(f.owner,"message",1))
 }}

 @Test fun invalidOriginalGrantOrIdentityCannotAppendOwnerTaggedAcknowledgement(){Fixture(context).use{f->
  for(grant in listOf(VerifiedShiftGrant("wrong-assignment",f.binding.copy(assignmentId="wrong-assignment"),setOf("dispatch_ack"),100,1000,1),
   VerifiedShiftGrant("wrong-action",f.binding,setOf("incident"),100,1000,1),VerifiedShiftGrant("expired",f.binding,setOf("dispatch_ack"),100,200,1),VerifiedShiftGrant("wrong-boot",f.binding,setOf("dispatch_ack"),100,1000,2)))
   rejected{f.store.acknowledgeDispatch(f.owner,grant,f.identity,"message",1,10000)}
  val wrong=f.owner.copy(scope=f.owner.scope.copy(binding=f.binding.copy(deviceThumbprint="d".repeat(64))))
  rejected{f.store.acknowledgeDispatch(wrong,f.grant,f.identity,"message",1,10000)}
  assertEquals(0,f.store.pendingCount());assertNull(f.store.prepareSigned(f.identity,"mercury-local",f.binding.guardId))
 }}
}
