package ca.mercury.guard

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyStore
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Synthetic encrypted-store attribution; no GPS, camera, Auth or service acceptance claim. */
class ConnectedPatrolOwnerTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private class Fixture(val context:Context):java.io.Closeable {
  val id=UUID.randomUUID().toString();val name="patrol-owner-$id.db";val alias="test.patrol.owner.$id";val marker="patrol-owner-$id"
  val identity=DeviceIdentity(context,alias,marker);val binding=GrantBinding("guard","site","assignment",identity.create().thumbprint,1)
  val owner=ConnectedDispatchOwner("a".repeat(64),"installation",UUID.randomUUID().toString(),DispatchScope(binding,"company"))
  val grant=VerifiedShiftGrant("patrol-original",binding,setOf("patrol"),100,1000,1)
  val plan=AuthorizedPatrolRoute.parse(JSONObject("""{"routeId":"route","revision":1,"checkpoints":[{"id":"entrance","label":"Entrance"},{"id":"perimeter","label":"Perimeter"}],"rounds":[{"id":"opening","label":"Opening"},{"id":"closing","label":"Closing"}]}"""))
  val store=ScopedEventStore(context,name,{200},{1})
  fun capture(owner:ConnectedDispatchOwner=this.owner,point:String="entrance",round:String="opening",db:ScopedEventStore=store)=db.capturePatrolCheckpoint(owner,plan,plan.choice(point,round),grant,identity,10000)
  fun bodies()=store.readableDatabase.rawQuery("SELECT body FROM captured ORDER BY sequence",null).use{c->buildList{while(c.moveToNext())add(c.getString(0))}}
  override fun close(){store.close();context.deleteDatabase(name);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)};File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()}
 }
 private fun rejected(block:()->Unit){var denied=false;try{block()}catch(_:Exception){denied=true};assertTrue("Expected original-owner or duplicate rejection",denied)}
 @Test fun allNineOwnerFieldsIsolateCompletionAndReplacementAccountCanRecordItsOwnCheckpoint(){Fixture(context).use{f->
  f.capture();val o=f.owner
  val alternatives=listOf(o.copy(configuration="b".repeat(64)),o.copy(deviceId="other-phone"),o.copy(subject=UUID.randomUUID().toString()),o.copy(scope=o.scope.copy(vendorId="other-company")),o.copy(scope=o.scope.copy(binding=f.binding.copy(guardId="other-guard"))),o.copy(scope=o.scope.copy(binding=f.binding.copy(siteId="other-site"))),o.copy(scope=o.scope.copy(binding=f.binding.copy(assignmentId="other-assignment"))),o.copy(scope=o.scope.copy(binding=f.binding.copy(deviceThumbprint="c".repeat(64)))),o.copy(scope=o.scope.copy(binding=f.binding.copy(revocationVersion=2))))
  for(other in alternatives)assertTrue(f.store.checkpointProgress(other,"route",1).isEmpty())
  for(other in alternatives.take(4)){f.capture(other);assertEquals(setOf(PatrolCheckpointKey("opening","entrance")),f.store.checkpointProgress(other,"route",1));rejected{f.capture(other)}}
  assertEquals(setOf(PatrolCheckpointKey("opening","entrance")),f.store.checkpointProgress(o,"route",1));rejected{f.capture()};assertEquals(5,f.store.pendingCount())
 }}
 @Test fun arbitraryPointAndRoundOrderRetainsExactWireAndEncryptedOwnerAcrossReopen(){Fixture(context).use{f->
  f.capture(point="perimeter",round="closing");f.capture(point="entrance",round="opening");f.capture(point="perimeter",round="opening")
  val original=f.bodies();val proof=f.store.prepareUpload(f.identity,"mercury-local",ConnectedEventOwnership.account(f.owner),"session")!!
  val raw=String(Base64.getUrlDecoder().decode(proof.getString("payload")),Charsets.UTF_8);val payload=JSONObject(raw)
  assertEquals(3,payload.getJSONArray("events").length());assertFalse(raw.contains("patrol_owner"));assertFalse(raw.contains(f.owner.subject));assertFalse(raw.contains(f.owner.configuration));assertFalse(original.any{it.contains(f.owner.subject)})
  f.store.close();ScopedEventStore(context,f.name,{200},{1}).use{db->
   assertEquals(3,db.checkpointProgress(f.owner,"route",1).size);assertEquals(proof.getString("payload"),db.prepareUpload(f.identity,"mercury-local",ConnectedEventOwnership.account(f.owner),"new-session")!!.getString("payload"))
   val reopened=db.readableDatabase.rawQuery("SELECT body FROM captured ORDER BY sequence",null).use{c->buildList{while(c.moveToNext())add(c.getString(0))}};assertEquals(original,reopened)
   rejected{f.capture(db=db,point="perimeter",round="closing")}
  }
 }}
 @Suppress("DEPRECATION") @Test fun legacyOwnerlessCompletionIsRetainedWithoutBeingAdopted(){Fixture(context).use{f->
  f.store.captureCheckpoint(f.binding,f.grant,f.identity,"route",1,"entrance",10000,"opening");val legacy=f.bodies().single()
  assertTrue(f.store.checkpointProgress(f.owner,"route",1).isEmpty());assertNull(f.store.prepareUpload(f.identity,"mercury-local",ConnectedEventOwnership.account(f.owner),"session"))
  f.capture();assertEquals(setOf(PatrolCheckpointKey("opening","entrance")),f.store.checkpointProgress(f.owner,"route",1));assertEquals(legacy,f.bodies().first())
 }}
 @Test fun malformedOrRelabelledOwnerCannotCountAndItsCiphertextIsPreserved(){Fixture(context).use{f->
  f.capture();val db=f.store.writableDatabase
  val row=db.rawQuery("SELECT sequence,body FROM captured",null).use{assertTrue(it.moveToFirst());it.getLong(0) to it.getString(1)}
  val cipher=DeviceCipher();val record=JSONObject(String(cipher.decrypt(row.second,"mercury-scoped-event:${row.first}"),Charsets.UTF_8));record.getJSONObject("patrol_owner").getJSONObject("scope").put("site_id","different-site")
  val changed=cipher.encrypt(record.toString().toByteArray(Charsets.UTF_8),"mercury-scoped-event:${row.first}")
  db.execSQL("UPDATE captured SET body=? WHERE sequence=?",arrayOf(changed,row.first));assertTrue(f.store.checkpointProgress(f.owner,"route",1).isEmpty());assertNull(f.store.prepareUpload(f.identity,"mercury-local",ConnectedEventOwnership.account(f.owner),"session"));assertEquals(changed,f.bodies().single())
 }}
 @Test fun concurrentHelpersHaveOneWinnerForTheExactOriginalOwner(){Fixture(context).use{f->
  val pool=Executors.newFixedThreadPool(2);val start=CountDownLatch(1)
  try{val tasks=(1..2).map{pool.submit<Boolean>{start.await();try{ScopedEventStore(context,f.name,{200},{1}).use{f.capture(db=it)};true}catch(_:Exception){false}}};start.countDown();assertEquals(1,tasks.count{it.get(10,TimeUnit.SECONDS)});assertEquals(1,f.store.pendingCount());assertEquals(1,f.store.checkpointProgress(f.owner,"route",1).size)}finally{pool.shutdownNow()}
 }}
}
