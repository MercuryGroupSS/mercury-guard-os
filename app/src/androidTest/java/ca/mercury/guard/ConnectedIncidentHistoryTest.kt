package ca.mercury.guard

import android.content.Context
import android.widget.Button
import android.view.View
import android.view.ViewGroup
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.Closeable
import java.io.File
import java.security.KeyStore
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Isolated encrypted local data/view tests. No provider, service, credential or hardware action. */
class ConnectedIncidentHistoryTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private class Fixture(private val context:Context):Closeable{
  val suffix=UUID.randomUUID().toString();val name="incident-history-$suffix.db"
  private val alias="test.incident-history.$suffix";private val marker="incident-history-$suffix"
  val identity=DeviceIdentity(context,alias,marker)
  val owner=ConnectedIncidentDraftScope("a".repeat(64),"synthetic-phone",identity.create().thumbprint,UUID.randomUUID().toString(),"synthetic-guard","synthetic-vendor","synthetic-site","synthetic-assignment")
  val binding=GrantBinding(owner.guardId,owner.siteId,owner.assignmentId,owner.thumbprint,1)
  val grant=VerifiedShiftGrant("synthetic-grant",binding,setOf("incident"),100,1000,1)
  val store=open()
  fun open()=ScopedEventStore(context,name,{200},{1})
  fun save(text:String="Saved synthetic incident")=store.captureIncident(owner,text,binding,grant,identity,10000)
  override fun close(){store.close();context.deleteDatabase(name);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)};File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()}
 }
 private fun rejected(action:()->Unit){var failed=false;try{action()}catch(_:Exception){failed=true};assertTrue("Operation must fail closed",failed)}
 private fun payload(proof:JSONObject)=JSONObject(String(Base64.getUrlDecoder().decode(proof.getString("payload")),Charsets.UTF_8))
 private fun receipt(batch:JSONObject)=JSONObject().put("batch_id",batch.getString("batch_id")).put("event_ids",JSONArray((0 until batch.getJSONArray("events").length()).map{batch.getJSONArray("events").getJSONObject(it).getString("event_id")})).put("status","accepted_local_only")
 private fun body(store:ScopedEventStore)=store.readableDatabase.rawQuery("SELECT sequence,body,pilot_receipted FROM captured ORDER BY sequence",null).use{c->buildList{while(c.moveToNext())add(listOf(c.getLong(0),c.getString(1),c.getInt(2)))}}

 @Test fun originalUnicodeOwnerAndWireBytesSurviveReopenWithoutPlaintextHistory(){Fixture(context).use{f->
  val text="  Recorded incident — café 🚀\nKeep exact description.  ";val id=f.save(text)
  val first=f.store.incidentPage(f.owner).items.single();assertEquals(id,first.eventId);assertEquals(text,first.description);assertEquals(ConnectedIncidentReceiptState.SAVED_LOCALLY,first.receiptState)
  val original=body(f.store);val batch=payload(f.store.prepareUpload(f.identity,"mercury-local",f.owner.guardId,"generation")!!)
  val event=batch.getJSONArray("events").getJSONObject(0)
  assertEquals(setOf("description","capture_grant_id"),event.getJSONObject("data").keys().asSequence().toSet());assertEquals(text,event.getJSONObject("data").getString("description"))
  assertFalse(batch.toString().contains("incident_owner"));assertFalse(batch.toString().contains(f.owner.subject));assertFalse(batch.toString().contains(f.owner.vendorId))
  f.store.readableDatabase.rawQuery("SELECT owner,accepted_batch,review FROM incident_history",null).use{assertTrue(it.moveToFirst());assertEquals(f.owner.owner(),it.getString(0));assertTrue(it.isNull(1));assertEquals(0,it.getInt(2))}
  assertFalse(original.single()[1].toString().contains("Recorded incident"));assertFalse(original.single()[1].toString().contains(f.owner.subject))
  f.store.close();f.open().use{reopened->assertEquals(text,reopened.incidentDetail(f.owner,first.sequence,id)!!.description);assertEquals(original,body(reopened));assertEquals(batch.toString(),payload(reopened.prepareUpload(f.identity,"mercury-local",f.owner.guardId,"generation")!!).toString())}
 }}

 @Test fun everyOriginalScopeFieldIsIsolatedAndCallerCannotCaptureWithAnotherBinding(){Fixture(context).use{f->
  f.save();val row=f.store.incidentPage(f.owner).items.single()
  val others=listOf(f.owner.copy(configuration="c".repeat(64)),f.owner.copy(deviceId="another-phone"),f.owner.copy(thumbprint="d".repeat(64)),f.owner.copy(subject=UUID.randomUUID().toString()),f.owner.copy(guardId="another-guard"),f.owner.copy(vendorId="another-vendor"),f.owner.copy(siteId="another-site"),f.owner.copy(assignmentId="another-assignment"))
  for(other in others){assertTrue(f.store.incidentPage(other).items.isEmpty());assertNull(f.store.incidentDetail(other,row.sequence,row.eventId))}
  for(other in others.filter{!ConnectedIncidentHistory.matches(it,f.binding)})rejected{f.store.captureIncident(other,"No relabelling",f.binding,f.grant,f.identity,10001)}
  val second=f.owner.copy(subject=UUID.randomUUID().toString());f.store.captureIncident(second,"Explicit other original subject",f.binding,f.grant,f.identity,10001)
  assertEquals(1,f.store.incidentPage(f.owner).items.size);assertEquals("Explicit other original subject",f.store.incidentPage(second).items.single().description)
  rejected{f.save("unpaired\ud800")};rejected{f.save(" ")};rejected{f.save("x".repeat(8001))};assertEquals(2,f.store.pendingCount())
 }}

 @Test fun versionFiveUpgradeNeverAdoptsLegacyRowsOrChangesPendingRetryBytes(){Fixture(context).use{f->
  f.store.capture("incident",JSONObject().put("description","Legacy owner unknown"),f.binding,f.grant,f.identity,9999)
  val original=payload(f.store.prepareUpload(f.identity,"mercury-local",f.owner.guardId,"generation")!!)
  val encrypted=body(f.store)
  f.store.writableDatabase.execSQL("DROP TABLE incident_history");f.store.writableDatabase.version=5;f.store.close()
  f.open().use{upgraded->
   assertTrue(upgraded.incidentPage(f.owner).items.isEmpty());assertEquals(encrypted,body(upgraded));assertEquals(original.toString(),payload(upgraded.prepareUpload(f.identity,"mercury-local",f.owner.guardId,"generation")!!).toString())
   upgraded.captureIncident(f.owner,"New explicitly owned incident",f.binding,f.grant,f.identity,10000)
   assertEquals("New explicitly owned incident",upgraded.incidentPage(f.owner).items.single().description);assertEquals(2,upgraded.pendingCount())
   upgraded.recordUploadReceipt(f.owner.guardId,receipt(original));assertEquals(1,upgraded.pendingCount());assertEquals(ConnectedIncidentReceiptState.SAVED_LOCALLY,upgraded.incidentPage(f.owner).items.single().receiptState)
  }
 }}

 @Test fun exactReceiptAndReviewStatesAreReadOnlyAtomicAndDoNotClaimDashboardDelivery(){Fixture(context).use{f->
  f.save();val batch=payload(f.store.prepareUpload(f.identity,"mercury-local",f.owner.guardId,"generation")!!)
  f.store.retainUploadForReview(f.owner.guardId,batch.getString("batch_id"),"generation",403)
  assertEquals(ConnectedIncidentReceiptState.RETAINED_FOR_REVIEW,f.store.incidentPage(f.owner).items.single().receiptState)
  rejected{f.store.recordUploadReceipt(f.owner.guardId,receipt(batch).put("status","delivered_to_dashboard"))}
  f.store.recordUploadReceipt(f.owner.guardId,receipt(batch));val encrypted=body(f.store)
  val accepted=f.store.incidentPage(f.owner).items.single();assertEquals(ConnectedIncidentReceiptState.SERVICE_ACCEPTED,accepted.receiptState);assertEquals(batch.getString("batch_id"),accepted.receiptBatchId)
  assertTrue(accepted.receiptState.label.contains("dashboard delivery not confirmed"));assertEquals(0,f.store.pendingCount());assertEquals(encrypted,body(f.store))
  f.store.recordUploadReceipt(f.owner.guardId,receipt(batch));rejected{f.store.retainUploadForReview(f.owner.guardId,batch.getString("batch_id"),"stale",403)}
  f.store.close();f.open().use{assertEquals(ConnectedIncidentReceiptState.SERVICE_ACCEPTED,it.incidentPage(f.owner).items.single().receiptState)}
 }}

 @Test fun indexFailureRollsBackCaptureAndDamagedIndexOrReceiptCannotExposeAnotherOwner(){Fixture(context).use{f->
  f.store.writableDatabase.execSQL("CREATE TRIGGER fail_history BEFORE INSERT ON incident_history BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END")
  rejected{f.save()};assertEquals(0,f.store.pendingCount());assertTrue(body(f.store).isEmpty())
  f.store.writableDatabase.execSQL("DROP TRIGGER fail_history");f.save();val original=body(f.store)
  val other=f.owner.copy(subject=UUID.randomUUID().toString())
  f.store.writableDatabase.execSQL("UPDATE incident_history SET owner=?",arrayOf(other.owner()))
  rejected{f.store.incidentPage(other)};assertEquals(original,body(f.store));f.store.writableDatabase.execSQL("UPDATE incident_history SET owner=?",arrayOf(f.owner.owner()))
  val batch=payload(f.store.prepareUpload(f.identity,"mercury-local",f.owner.guardId,"generation")!!);f.store.recordUploadReceipt(f.owner.guardId,receipt(batch))
  f.store.writableDatabase.execSQL("UPDATE upload_receipts SET body='damaged-ciphertext'")
  rejected{f.store.incidentPage(f.owner)};assertEquals(0,f.store.pendingCount())
 }}

 @Test fun boundedPagesAndConcurrentReceiptReadsPreserveOneExactEventSet(){Fixture(context).use{f->
  repeat(31){f.save("Synthetic incident $it")};val first=f.store.incidentPage(f.owner);assertEquals(25,first.items.size);assertNotNull(first.nextBeforeSequence)
  val next=f.store.incidentPage(f.owner,first.nextBeforeSequence);assertEquals(6,next.items.size);assertNull(next.nextBeforeSequence)
  assertEquals(31,(first.items+next.items).map{it.eventId}.toSet().size)
  rejected{f.store.incidentPage(f.owner,limit=0)};rejected{f.store.incidentPage(f.owner,limit=51)};rejected{f.store.incidentPage(f.owner,0)}
  rejected{f.store.incidentDetail(f.owner,first.items.first().sequence,UUID.randomUUID().toString())}
  val batch=payload(f.store.prepareUpload(f.identity,"mercury-local",f.owner.guardId,"generation")!!);val start=CountDownLatch(1);val workers=Executors.newFixedThreadPool(2)
  try{
   val read=workers.submit{start.await();repeat(10){f.open().use{db->val states=db.incidentPage(f.owner,limit=50).items.map{it.receiptState}.toSet();assertEquals(1,states.size);assertTrue(states.single() in setOf(ConnectedIncidentReceiptState.SAVED_LOCALLY,ConnectedIncidentReceiptState.SERVICE_ACCEPTED))}}}
   val accept=workers.submit{start.await();f.open().use{it.recordUploadReceipt(f.owner.guardId,receipt(batch))}}
   start.countDown();read.get(20,TimeUnit.SECONDS);accept.get(20,TimeUnit.SECONDS)
   assertTrue(f.store.incidentPage(f.owner,limit=50).items.all{it.receiptState==ConnectedIncidentReceiptState.SERVICE_ACCEPTED});assertEquals(0,f.store.pendingCount())
  }finally{workers.shutdownNow()}
 }}

 private fun strings(view:View):List<String> = buildList {
  if(view is android.widget.TextView)add(view.text.toString())
  if(view is ViewGroup)for(i in 0 until view.childCount)addAll(strings(view.getChildAt(i)))
 }
 private fun clickIncident(view:View):Boolean {
  if(view is Button&&view.text.contains("Open incident"))return view.performClick()
  if(view is ViewGroup)for(i in 0 until view.childCount)if(clickIncident(view.getChildAt(i)))return true
  return false
 }
 private fun waitUntil(test:()->Boolean){val end=System.nanoTime()+TimeUnit.SECONDS.toNanos(8);while(System.nanoTime()<end){if(test())return;Thread.sleep(25)};assertTrue("Bounded view condition unavailable",test())}

 @Test fun guardedInlineViewClearsAfterOwnerLossAndRecreationWithoutDeletingRecords(){Fixture(context).use{f->
  val text="PRIVATE SYNTHETIC RECORDED INCIDENT";f.save(text);val allowed=AtomicBoolean(true);val unavailable=AtomicBoolean(false)
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   var view:ConnectedIncidentHistoryView?=null
   scenario.onActivity{activity->view=ConnectedIncidentHistoryView(activity,f.owner,{allowed.get()},{},{unavailable.set(true)},{f.open()});activity.setContentView(view)}
   waitUntil{var found=false;scenario.onActivity{found=clickIncident(view!!)};found}
   waitUntil{var found=false;scenario.onActivity{found=text in strings(view!!)};found}
   allowed.set(false);waitUntil{unavailable.get()};scenario.onActivity{assertEquals(0,view!!.childCount);assertFalse(text in strings(it.window.decorView))}
   scenario.recreate();scenario.onActivity{assertFalse(text in strings(it.window.decorView))}
  }
  assertEquals(text,f.store.incidentPage(f.owner).items.single().description)
 }}

 @Test fun delayedDecryptionCannotRepopulateDetachedOrSignedOutView(){Fixture(context).use{f->
  val text="DELAYED PRIVATE SYNTHETIC INCIDENT";f.save(text);val entered=CountDownLatch(1);val release=CountDownLatch(1);val allowed=AtomicBoolean(true)
  try{ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   var view:ConnectedIncidentHistoryView?=null
   scenario.onActivity{activity->view=ConnectedIncidentHistoryView(activity,f.owner,{allowed.get()},{},{},{entered.countDown();release.await(5,TimeUnit.SECONDS);f.open()});activity.setContentView(view)}
   assertTrue(entered.await(5,TimeUnit.SECONDS));allowed.set(false)
   scenario.onActivity{view!!.close();it.setContentView(android.widget.TextView(it).apply{setText("Signed out")})};release.countDown()
   InstrumentationRegistry.getInstrumentation().waitForIdleSync();scenario.onActivity{assertEquals(0,view!!.childCount);assertFalse(text in strings(it.window.decorView))}
  }}finally{release.countDown()}
  assertEquals(text,f.store.incidentPage(f.owner).items.single().description)
 }}
}
