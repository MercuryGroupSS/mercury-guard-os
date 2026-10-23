package ca.mercury.guard
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID
import java.util.Base64
import java.security.KeyStore
import java.io.File
class ScopedEventStoreTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private fun payload(proof: JSONObject)=JSONObject(String(Base64.getUrlDecoder().decode(proof.getString("payload")),Charsets.UTF_8))
 private fun rejected(block:()->Unit){var failed=false;try{block()}catch(_:Exception){failed=true};assertTrue("Expected rejection",failed)}
 private fun isolated(block:(ScopedEventStore,DeviceIdentity,String)->Unit){
  val suffix=UUID.randomUUID().toString();val name="scoped-$suffix.db";val alias="test.scoped.$suffix";val marker="scoped-$suffix";val store=ScopedEventStore(context,name,{200},{1})
  try{block(store,DeviceIdentity(context,alias,marker),name)}finally{store.close();context.deleteDatabase(name);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)};File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()}
 }
 private fun binding(identity: DeviceIdentity,assignment: String="shift-a")=GrantBinding("guard","site",assignment,identity.create().thumbprint,1)
 private fun grant(b: GrantBinding)=VerifiedShiftGrant("grant-${b.assignmentId}",b,setOf("incident"),100,1000,1)
 private fun receipt(batch: JSONObject)=JSONObject().put("batch_id",batch.getString("batch_id")).put("event_ids",JSONArray((0 until batch.getJSONArray("events").length()).map{batch.getJSONArray("events").getJSONObject(it).getString("event_id")})).put("status","accepted_local_only")
 @Test fun originalScopeSurvivesAssignmentSwitchRestartAndReceipt(){isolated{store,identity,name->
  val a=binding(identity);val b=binding(identity,"shift-b")
  store.capture("incident",JSONObject().put("note","synthetic-a"),a,grant(a),identity,10000)
  store.capture("incident",JSONObject().put("note","synthetic-b"),b,grant(b),identity,10001)
  val first=payload(store.prepareSigned(identity,"mercury-local")!!)
  assertEquals("shift-a",first.getJSONObject("scope").getString("assignment_id"));assertEquals(1,first.getJSONArray("events").length())
  assertEquals("grant-shift-a",first.getJSONArray("events").getJSONObject(0).getJSONObject("data").getString("capture_grant_id"))
  store.close()
  val reopened=ScopedEventStore(context,name,{200},{1})
  try {
   assertEquals(first.toString(),payload(reopened.prepareSigned(identity,"mercury-local")!!).toString())
   reopened.recordPilotReceipt(receipt(first));assertEquals(1,reopened.pendingCount())
   val second=payload(reopened.prepareSigned(identity,"mercury-local")!!)
   assertEquals("shift-b",second.getJSONObject("scope").getString("assignment_id"))
   assertTrue(second.getJSONArray("events").getJSONObject(0).getLong("sequence")>first.getJSONArray("events").getJSONObject(0).getLong("sequence"))
  } finally { reopened.close() }
 }}
 @Test fun failedAuthorityCannotCreatePendingEvents(){isolated{store,identity,_->
  val a=binding(identity);val b=binding(identity,"shift-b")
  rejected{store.capture("incident",JSONObject(),b,grant(a),identity,10000)}
  rejected{store.capture("incident",JSONObject(),a,VerifiedShiftGrant("expired",a,setOf("incident"),100,200,1),identity,10000)}
  rejected{store.capture("incident",JSONObject(),a,VerifiedShiftGrant("other-boot",a,setOf("incident"),100,1000,2),identity,10000)}
  rejected{store.capture("check_in",JSONObject(),a,grant(a),identity,10000)}
  rejected{store.capture("incident",JSONObject().put("capture_grant_id","forged"),a,grant(a),identity,10000)}
  assertEquals(0,store.pendingCount());assertNull(store.prepareSigned(identity,"mercury-local"))
 }}
 @Test fun alteredReceiptCannotClearQueueAndPayloadIsEncrypted(){isolated{store,identity,_->
  val a=binding(identity);store.capture("incident",JSONObject().put("note","PRIVATE-SYNTHETIC-NOTE"),a,grant(a),identity,10000)
  val batch=payload(store.prepareSigned(identity,"mercury-local")!!)
  rejected{store.recordPilotReceipt(receipt(batch).put("batch_id",UUID.randomUUID().toString()))}
  assertEquals(1,store.pendingCount())
  store.readableDatabase.rawQuery("SELECT body FROM captured",null).use{assertTrue(it.moveToFirst());assertFalse(it.getString(0).contains("PRIVATE-SYNTHETIC-NOTE"))}
  store.recordPilotReceipt(receipt(batch));assertEquals(0,store.pendingCount());assertNull(store.prepareSigned(identity,"mercury-local"))
 }}
 @Test fun corruptedExistingCiphertextBlocksReopening(){isolated{store,identity,name->
  val a=binding(identity);store.capture("incident",JSONObject(),a,grant(a),identity,10000)
  store.writableDatabase.execSQL("UPDATE captured SET body='corrupt'")
  store.close()
  val reopened=ScopedEventStore(context,name,{200},{1})
  try { rejected{reopened.pendingCount()} } finally { reopened.close() }
 }}

 @Test fun guardsUploadIndependentlyAndReceiptsCannotClearAnotherGuard(){isolated{store,identity,name->
  val a=binding(identity).copy(guardId="guard-a");val b=binding(identity).copy(guardId="guard-b")
  store.capture("incident",JSONObject().put("note","A"),a,grant(a),identity,10000)
  store.capture("incident",JSONObject().put("note","B"),b,grant(b),identity,10001)
  val firstA=payload(store.prepareSigned(identity,"mercury-local",a.guardId)!!)
  val firstB=payload(store.prepareSigned(identity,"mercury-local",b.guardId)!!)
  assertEquals("guard-b",firstB.getJSONObject("scope").getString("guard_id"))
  rejected{store.recordPilotReceipt(receipt(firstA),b.guardId)}
  store.close();val reopened=ScopedEventStore(context,name,{200},{1})
  try{
   assertEquals(firstB.toString(),payload(reopened.prepareSigned(identity,"mercury-local",b.guardId)!!).toString())
   reopened.recordPilotReceipt(receipt(firstB),b.guardId)
   assertEquals(1,reopened.pendingCount());assertNull(reopened.prepareSigned(identity,"mercury-local",b.guardId))
   assertEquals(firstA.toString(),payload(reopened.prepareSigned(identity,"mercury-local",a.guardId)!!).toString())
   reopened.recordPilotReceipt(receipt(firstA),a.guardId);assertEquals(0,reopened.pendingCount())
  }finally{reopened.close()}
 }}
 @Test fun versionOnePendingBatchMigratesWithoutChangingRetryIdentity(){isolated{store,identity,name->
  val a=binding(identity)
  store.capture("incident",JSONObject(),a,grant(a),identity,10000)
  val original=payload(store.prepareSigned(identity,"mercury-local")!!)
  store.writableDatabase.execSQL("DROP TABLE pending_by_guard")
  store.writableDatabase.version=1;store.close()
  val reopened=ScopedEventStore(context,name,{200},{1})
  try{
   assertEquals(original.toString(),payload(reopened.prepareSigned(identity,"mercury-local",a.guardId)!!).toString())
   reopened.recordPilotReceipt(receipt(original),a.guardId);assertEquals(0,reopened.pendingCount())
  }finally{reopened.close()}
 }}

 @Test fun checkpointChoicesAreIndependentAndCannotBeRecordedTwice(){isolated{store,identity,name->
  val a=binding(identity);val permission=VerifiedShiftGrant("patrol-grant",a,setOf("patrol"),100,1000,1)
  store.captureCheckpoint(a,permission,identity,"route",1,"perimeter",10000)
  store.captureCheckpoint(a,permission,identity,"route",1,"entrance",10001)
  rejected{store.captureCheckpoint(a,permission,identity,"route",1,"perimeter",10002)}
  store.close();val reopened=ScopedEventStore(context,name,{200},{1})
  try{assertTrue(reopened.checkpointRecorded(a,"route",1,"perimeter"));assertTrue(reopened.checkpointRecorded(a,"route",1,"entrance"));assertEquals(2,reopened.pendingCount(a.guardId))}finally{reopened.close()}
 }}

 @Test fun photoMetadataReceiptDoesNotClearPendingMediaAndMediaReceiptSurvivesRestart(){isolated{store,identity,name->
  val a=binding(identity);val permission=VerifiedShiftGrant("photo-grant",a,setOf("photo"),100,1000,1)
  val data=JSONObject().put("evidence_id",UUID.randomUUID().toString()).put("sha256","a".repeat(64)).put("bytes",100)
  val eventId=store.capture("photo_evidence",data,a,permission,identity,10000)
  assertTrue(store.pendingPhotos(a.guardId).isEmpty())
  val batch=payload(store.prepareSigned(identity,"mercury-local",a.guardId)!!);store.recordPilotReceipt(receipt(batch),a.guardId)
  assertEquals(0,store.pendingCount(a.guardId));assertEquals(1,store.pendingPhotos(a.guardId).size)
  val media=JSONObject(data.toString()).put("event_id",eventId).put("status","evidence_accepted_local_only")
  rejected{store.recordMediaReceipt("other-guard",media)}
  rejected{store.recordMediaReceipt(a.guardId,JSONObject(media.toString()).put("sha256","b".repeat(64)))}
  store.recordMediaReceipt(a.guardId,media);store.close()
  val reopened=ScopedEventStore(context,name,{200},{1})
  try{assertTrue(reopened.pendingPhotos(a.guardId).isEmpty())}finally{reopened.close()}
 }}

 @Test fun checkInAndPhotoCommitTogetherAndDuplicateSlotDoesNotAddPhoto(){isolated{store,identity,name->
  val a=binding(identity)
  val policy=AuthorizedCheckInPolicy.parse(JSONObject().put("revision",1).put("starts_at",1000).put("ends_at",100000).put("interval_ms",60000).put("window_ms",10000).put("max_evidence_age_ms",5000).put("max_accuracy_m",100))
  val evidence=AuthorizedCheckInEvidence(policy,0,2000,JSONObject().put("at",3000).put("latitude",45).put("longitude",-73).put("accuracy_m",5).put("mock",false))
  val photo=JSONObject().put("evidence_id",UUID.randomUUID().toString()).put("sha256","a".repeat(64)).put("bytes",4).put("width",1).put("height",1).put("capture","camera_intent")
  // Photo insert succeeds, but forbidden check-in must roll the entire transaction back.
  rejected{store.captureCheckIn(a,VerifiedShiftGrant("photo-only",a,setOf("photo"),100,1000,1),identity,evidence,photo,4000)}
  assertEquals(0,store.pendingCount());assertFalse(store.checkInRecorded(a,1,0))
  val both=VerifiedShiftGrant("both",a,setOf("photo","check_in"),100,1000,1)
  store.captureCheckIn(a,both,identity,evidence,photo,4000)
  assertEquals(2,store.pendingCount());assertTrue(store.checkInRecorded(a,1,0))
  rejected{store.captureCheckIn(a,both,identity,evidence,photo,4001)}
  assertEquals(2,store.pendingCount())
  val batch=payload(store.prepareSigned(identity,"mercury-local",a.guardId)!!);val events=batch.getJSONArray("events")
  assertEquals(events.getJSONObject(0).getString("event_id"),events.getJSONObject(1).getJSONObject("data").getString("photo_event_id"))
  store.writableDatabase.execSQL("DROP TABLE check_in_keys");store.writableDatabase.version=3;store.close()
  val reopened=ScopedEventStore(context,name,{200},{1})
  try{
   assertTrue(reopened.checkInRecorded(a,1,0))
   reopened.writableDatabase.execSQL("UPDATE check_in_keys SET sequence=(SELECT MIN(sequence) FROM captured)")
   rejected{reopened.checkInRecorded(a,1,0)}
  }finally{reopened.close()}
 }}
 @Test fun checkInRejectsStaleMockAndOutOfWindowEvidenceBeforeSaving(){isolated{store,identity,_->
  val a=binding(identity);val both=VerifiedShiftGrant("both",a,setOf("photo","check_in"),100,1000,1)
  val policy=AuthorizedCheckInPolicy.parse(JSONObject().put("revision",1).put("starts_at",1000).put("ends_at",100000).put("interval_ms",60000).put("window_ms",10000).put("max_evidence_age_ms",5000).put("max_accuracy_m",100))
  fun evidence(mock:Boolean)=AuthorizedCheckInEvidence(policy,0,2000,JSONObject().put("at",3000).put("latitude",45).put("longitude",-73).put("accuracy_m",5).put("mock",mock))
  rejected{store.captureCheckIn(a,both,identity,evidence(true),JSONObject(),4000)}
  rejected{store.captureCheckIn(a,both,identity,evidence(false),JSONObject(),10000)}
  rejected{store.captureCheckIn(a,both,identity,evidence(false),JSONObject(),11000)}
  assertEquals(0,store.pendingCount())
 }}

 @Test fun dispatchAcknowledgementIsVersionBoundAndDuplicateSafe(){isolated{store,identity,name->
  val a=binding(identity);val auth=VerifiedShiftGrant("ack-grant",a,setOf("dispatch_ack"),100,1000,1)
  rejected{store.acknowledgeDispatch(a,grant(a),identity,"message",1,10000)}
  assertFalse(store.dispatchAcknowledged(a,"message",1))
  store.acknowledgeDispatch(a,auth,identity,"message",1,10000)
  rejected{store.acknowledgeDispatch(a,auth,identity,"message",1,10001)}
  assertFalse(store.dispatchAcknowledged(a.copy(guardId="other"),"message",1))
  assertFalse(store.dispatchAcknowledged(a,"message",2))
  store.acknowledgeDispatch(a,auth,identity,"message",2,10002)
  assertEquals(2,store.pendingCount());store.close()
  ScopedEventStore(context,name,{200},{1}).use{reopened->
   assertTrue(reopened.dispatchAcknowledged(a,"message",1))
   rejected{reopened.acknowledgeDispatch(a,auth,identity,"message",1,10003)}
   val batch=payload(reopened.prepareSigned(identity,"mercury-local")!!)
   assertEquals("dispatch_ack",batch.getJSONArray("events").getJSONObject(0).getString("kind"))
   reopened.recordPilotReceipt(receipt(batch));assertTrue(reopened.dispatchAcknowledged(a,"message",1));assertEquals(0,reopened.pendingCount())
  }
 }}

 @Test fun originalScopeReviewDoesNotBlockNewAssignmentAndReauthenticationRetriesExactOriginal(){isolated{store,identity,name->
  val a=binding(identity);val b=binding(identity,"shift-b")
  store.capture("incident",JSONObject().put("note","RETAIN-ORIGINAL-A"),a,grant(a),identity,10000)
  val legacy=payload(store.prepareSigned(identity,"mercury-local",a.guardId)!!)
  store.capture("incident",JSONObject().put("note","CURRENT-B"),b,grant(b),identity,10001)
  store.writableDatabase.version=4;store.close()
  ScopedEventStore(context,name,{200},{1}).use{reopened->
   val first=payload(reopened.prepareUpload(identity,"mercury-local",a.guardId,"session-a")!!);assertEquals(legacy.toString(),first.toString())
   reopened.retainUploadForReview(a.guardId,first.getString("batch_id"),"session-a",403)
   val next=payload(reopened.prepareUpload(identity,"mercury-local",a.guardId,"session-a")!!);assertEquals("shift-b",next.getJSONObject("scope").getString("assignment_id"))
   rejected{reopened.recordUploadReceipt("other-guard",receipt(next))}
   reopened.recordUploadReceipt(a.guardId,receipt(next));reopened.recordUploadReceipt(a.guardId,receipt(next))
   assertEquals(1,reopened.pendingCount(a.guardId));assertNull(reopened.prepareUpload(identity,"mercury-local",a.guardId,"session-a"))
   assertTrue(reopened.uploadSummary(a.guardId).contains("1 upload group(s) retained"))
   val retried=payload(reopened.prepareUpload(identity,"mercury-local",a.guardId,"session-b")!!);assertEquals(first.toString(),retried.toString())
   reopened.readableDatabase.rawQuery("SELECT body FROM captured",null).use{c->while(c.moveToNext())assertFalse(c.getString(0).contains("RETAIN-ORIGINAL-A"))}
   reopened.recordUploadReceipt(a.guardId,receipt(retried));assertEquals(0,reopened.pendingCount(a.guardId))
  }
 }}
 @Test fun concurrentUploadPreparationAcrossHelpersKeepsOneExactSnapshot(){isolated{store,identity,name->
  val a=binding(identity);store.capture("incident",JSONObject().put("note","same"),a,grant(a),identity,10000)
  val pool=java.util.concurrent.Executors.newFixedThreadPool(2);val start=java.util.concurrent.CountDownLatch(1)
  try{
   val tasks=(1..2).map{pool.submit<String>{start.await();ScopedEventStore(context,name,{200},{1}).use{db->payload(db.prepareUpload(identity,"mercury-local",a.guardId,"session")!!).toString()}}}
   start.countDown();val one=tasks[0].get(20,java.util.concurrent.TimeUnit.SECONDS);val two=tasks[1].get(20,java.util.concurrent.TimeUnit.SECONDS);assertEquals(one,two)
   store.readableDatabase.rawQuery("SELECT COUNT(*) FROM upload_snapshots",null).use{assertTrue(it.moveToFirst());assertEquals(1,it.getInt(0))}
   store.recordUploadReceipt(a.guardId,receipt(JSONObject(one)));assertEquals(0,store.pendingCount(a.guardId))
  }finally{pool.shutdownNow()}
 }}
 @Test fun retainedPhotoDoesNotBlockOtherPhotosAndReceiptsAreGuardBound(){isolated{store,identity,name->
  val a=binding(identity);val permission=VerifiedShiftGrant("photos",a,setOf("photo"),100,1000,1)
  val data=JSONObject().put("evidence_id",UUID.randomUUID().toString()).put("sha256","a".repeat(64)).put("bytes",100)
  val first=store.capture("photo_evidence",data,a,permission,identity,10000)
  val second=store.capture("photo_evidence",JSONObject(data.toString()).put("evidence_id",UUID.randomUUID().toString()),a,permission,identity,10001)
  val batch=payload(store.prepareUpload(identity,"mercury-local",a.guardId,"session")!!);store.recordUploadReceipt(a.guardId,receipt(batch))
  store.retainPhotoForReview(a.guardId,first,"session",400)
  assertEquals(second,store.pendingUploadPhotos(a.guardId,"session",1).single().getJSONObject("event").getString("event_id"))
  val event=store.pendingUploadPhotos(a.guardId,"session",1).single().getJSONObject("event")
  val media=JSONObject(event.getJSONObject("data").toString()).apply{remove("capture_grant_id")}.put("event_id",second).put("status","evidence_accepted_local_only")
  rejected{store.recordUploadMediaReceipt("other-guard",media)};store.recordUploadMediaReceipt(a.guardId,media);store.recordUploadMediaReceipt(a.guardId,media)
  rejected{store.recordUploadMediaReceipt("other-guard",media)}
  assertTrue(store.pendingUploadPhotos(a.guardId,"session",10).isEmpty())
  store.close();ScopedEventStore(context,name,{200},{1}).use{reopened->assertEquals(first,reopened.pendingUploadPhotos(a.guardId,"new-session",1).single().getJSONObject("event").getString("event_id"))}
 }}

 @Test fun checkpointsRepeatOnlyAcrossExplicitRoundsAndSurviveRetryRestart(){isolated{store,identity,name->
  val a=binding(identity);val permission=VerifiedShiftGrant("rounds",a,setOf("patrol"),100,1000,1)
  store.captureCheckpoint(a,permission,identity,"route",2,"perimeter",10000,"closing")
  store.captureCheckpoint(a,permission,identity,"route",2,"entrance",10001,"opening")
  store.captureCheckpoint(a,permission,identity,"route",2,"perimeter",10002,"opening")
  rejected{store.captureCheckpoint(a,permission,identity,"route",2,"perimeter",10003,"closing")}
  rejected{store.captureCheckpoint(a,permission,identity,"route",2,"entrance",10003,"")}
  assertTrue(store.checkpointRecorded(a.copy(revocationVersion=2),"route",2,"perimeter","closing"))
  assertFalse(store.checkpointRecorded(a,"route",2,"entrance","closing"));assertFalse(store.checkpointRecorded(a,"route",2,"perimeter"))
  assertFalse(store.checkpointRecorded(a.copy(guardId="other"),"route",2,"perimeter","closing"))
  val original=payload(store.prepareUpload(identity,"mercury-local",a.guardId,"session")!!)
  assertEquals(listOf("closing","opening","opening"),(0 until original.getJSONArray("events").length()).map{original.getJSONArray("events").getJSONObject(it).getJSONObject("data").getString("round_id")})
  store.close();ScopedEventStore(context,name,{200},{1}).use{reopened->
   assertTrue(reopened.checkpointRecorded(a,"route",2,"perimeter","opening"));assertTrue(reopened.checkpointRecorded(a,"route",2,"perimeter","closing"))
   assertEquals(original.toString(),payload(reopened.prepareUpload(identity,"mercury-local",a.guardId,"session")!!).toString())
   reopened.recordUploadReceipt(a.guardId,receipt(original));assertEquals(0,reopened.pendingCount(a.guardId))
   assertTrue(reopened.checkpointRecorded(a,"route",2,"perimeter","closing"))
  }
 }}
 @Test fun legacyCheckpointEventsAndSnapshotsKeepTheirOriginalMissingRoundField(){isolated{store,identity,name->
  val a=binding(identity);val permission=VerifiedShiftGrant("legacy",a,setOf("patrol"),100,1000,1)
  store.captureCheckpoint(a,permission,identity,"route",1,"entrance",10000)
  val original=payload(store.prepareSigned(identity,"mercury-local",a.guardId)!!);assertFalse(original.getJSONArray("events").getJSONObject(0).getJSONObject("data").has("round_id"))
  store.close();ScopedEventStore(context,name,{200},{1}).use{reopened->
   assertTrue(reopened.checkpointRecorded(a,"route",1,"entrance"));assertFalse(reopened.checkpointRecorded(a,"route",1,"entrance","opening"))
   assertEquals(original.toString(),payload(reopened.prepareUpload(identity,"mercury-local",a.guardId,"session")!!).toString())
   rejected{reopened.captureCheckpoint(a,permission,identity,"route",1,"entrance",10001)}
  }
 }}
}
