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

/** Isolated encrypted synthetic queues only. No Auth, service, SDK GPS, camera or phone actions. */
class ConnectedQueueOwnerTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private data class Row(val sequence:Long,val body:String,val receipted:Int)
 private class Fixture(private val context:Context):java.io.Closeable {
  private val suffix=UUID.randomUUID().toString()
  val name="connected-queue-owner-$suffix.db"
  private val alias="test.connected.queue.$suffix"
  private val marker="connected-queue-$suffix"
  val identity=DeviceIdentity(context,alias,marker)
  val binding=GrantBinding("queue-guard","queue-site","queue-assignment",identity.create().thumbprint,1)
  val owner=ConnectedDispatchOwner("a".repeat(64),"queue-installation",UUID.randomUUID().toString(),DispatchScope(binding,"queue-company"))
  val store=open()
  val policy=AuthorizedCheckInPolicy.parse(JSONObject().put("revision",1).put("starts_at",1000).put("ends_at",131000)
   .put("interval_ms",60000).put("window_ms",10000).put("max_evidence_age_ms",5000).put("max_accuracy_m",100))
  fun open()=ScopedEventStore(context,name,{200},{1})
  fun account(o:ConnectedDispatchOwner=owner)=EscalationScope(o.configuration,o.deviceId,o.scope.binding.deviceThumbprint,o.subject,o.scope.binding.guardId,o.scope.vendorId)
  fun grant(o:ConnectedDispatchOwner=owner)=VerifiedShiftGrant("synthetic-queue-grant",o.scope.binding,setOf("incident","dispatch_ack","photo","check_in"),100,1000,1)
  fun draft(o:ConnectedDispatchOwner=owner)=o.scope.binding.let{ConnectedIncidentDraftScope(o.configuration,o.deviceId,it.deviceThumbprint,o.subject,it.guardId,o.scope.vendorId,it.siteId,it.assignmentId)}
  fun incident(o:ConnectedDispatchOwner=owner,text:String="Synthetic original incident")=store.captureIncident(draft(o),text,o.scope.binding,grant(o),identity,10000)
  fun metadata()=JSONObject().put("evidence_id",UUID.randomUUID().toString()).put("sha256","e".repeat(64)).put("bytes",4).put("width",1).put("height",1).put("capture","camera_intent")
  fun photo(o:ConnectedDispatchOwner=owner)=store.capturePhoto(o,grant(o),identity,metadata(),10000)
  fun allKinds(){
   incident()
   store.acknowledgeDispatch(owner,grant(),identity,"synthetic-dispatch",1,10001)
   store.captureCheckInMissReason(owner,grant(),identity,1,1,"Synthetic local reason",10002)
   val evidence=AuthorizedCheckInEvidence(policy,0,2000,JSONObject().put("at",3000).put("latitude",0).put("longitude",0).put("accuracy_m",5).put("mock",false))
   store.captureCheckIn(owner,grant(),identity,evidence,metadata(),4000)
  }
  fun alternatives():List<ConnectedDispatchOwner> = listOf(
   owner.copy(configuration="b".repeat(64)),owner.copy(deviceId="other-installation"),owner.copy(subject=UUID.randomUUID().toString()),
   owner.copy(scope=owner.scope.copy(vendorId="other-company")),owner.copy(scope=owner.scope.copy(binding=binding.copy(guardId="other-guard"))),
   owner.copy(scope=owner.scope.copy(binding=binding.copy(deviceThumbprint="c".repeat(64)))))
  override fun close(){
   store.close();context.deleteDatabase(name)
   KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}
   File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()
  }
 }
 private fun rejected(action:()->Unit){var denied=false;try{action()}catch(_:Exception){denied=true};assertTrue("Original owner must be required before sending",denied)}
 private fun noProof(action:()->JSONObject?){
  // An inconsistent account/key may reject locally; it must never produce a signed upload.
  val proof=try{action()}catch(_:IllegalArgumentException){null}catch(_:IllegalStateException){null}
  assertNull("Another original owner must not produce a signed batch",proof)
 }
 private fun payload(proof:JSONObject)=JSONObject(String(Base64.getUrlDecoder().decode(proof.getString("payload")),Charsets.UTF_8))
 private fun eventIds(batch:JSONObject)=(0 until batch.getJSONArray("events").length()).map{batch.getJSONArray("events").getJSONObject(it).getString("event_id")}
 private fun receipt(batch:JSONObject)=JSONObject().put("batch_id",batch.getString("batch_id")).put("status","accepted_local_only").put("event_ids",JSONArray(eventIds(batch)))
 private fun rows(db:ScopedEventStore)=db.readableDatabase.rawQuery("SELECT sequence,body,pilot_receipted FROM captured ORDER BY sequence",null).use{c->buildList{while(c.moveToNext())add(Row(c.getLong(0),c.getString(1),c.getInt(2)))}}
 private fun decode(row:Row)=JSONObject(String(DeviceCipher().decrypt(row.body,"mercury-scoped-event:${row.sequence}"),Charsets.UTF_8))
 private fun row(db:ScopedEventStore,id:String)=rows(db).single{decode(it).getJSONObject("event").getString("event_id")==id}
 private fun replace(db:ScopedEventStore,original:Row,record:JSONObject):Row {
  val body=DeviceCipher().encrypt(record.toString().toByteArray(Charsets.UTF_8),"mercury-scoped-event:${original.sequence}")
  assertEquals(1,db.writableDatabase.update("captured",ContentValues().apply{put("body",body)},"sequence=?",arrayOf(original.sequence.toString())))
  return original.copy(body=body)
 }
 private fun snapshots(db:ScopedEventStore):List<List<String?>> {
  val result=mutableListOf<List<String?>>()
  for(sql in listOf("SELECT body FROM pending ORDER BY id","SELECT owner,body FROM pending_by_guard ORDER BY owner","SELECT owner,first_sequence,body,review FROM upload_snapshots ORDER BY owner")){
   db.readableDatabase.rawQuery(sql,null).use{c->while(c.moveToNext())result.add(listOf(sql)+(0 until c.columnCount).map{if(c.isNull(it))null else c.getString(it)})}
  }
  return result
 }
 private fun pre46MixedSnapshot(f:Fixture):JSONObject {
  // Reproduce the historical guard-only snapshot format, before owner partitions existed.
  val original=rows(f.store);assertEquals(2,original.size)
  val scope=decode(original.first()).getJSONObject("scope");val partition=JSONObject().put("kind","ordinary")
  val batch=JSONObject().put("batch_id",UUID.randomUUID().toString()).put("schema_version",1)
   .put("events",JSONArray(original.map{decode(it).getJSONObject("event")}))
  val snapshot=JSONObject().put("scope",scope).put("partition",partition).put("batch",batch)
  val lookup=EscalationProtocol.hash(JSONArray().put(scope).put(partition).toString())
  f.store.writableDatabase.insertOrThrow("upload_snapshots",null,ContentValues().apply{
   put("owner",lookup);put("first_sequence",original.first().sequence)
   put("body",DeviceCipher().encrypt(snapshot.toString().toByteArray(Charsets.UTF_8),"mercury-upload-snapshot:$lookup"))
  })
  return f.identity.signScopedEventBatch("mercury-local",batch,f.binding)
 }

 @Test fun allSixAccountDimensionsFenceEveryConnectedEventKindAndFinalBatchCheck(){Fixture(context).use{f->
  f.allKinds();val captured=rows(f.store);val originalSnapshots=snapshots(f.store)
  for(other in f.alternatives()){
   noProof{f.store.prepareUpload(f.identity,"mercury-local",f.account(other),"other-generation")}
   assertEquals(captured,rows(f.store));assertEquals(originalSnapshots,snapshots(f.store))
  }
  val proof=f.store.prepareUpload(f.identity,"mercury-local",f.account(),"current-generation")!!;val batch=payload(proof)
  assertEquals(setOf("incident","dispatch_ack","check_in_miss_reason","photo_evidence","check_in"),(0 until batch.getJSONArray("events").length()).map{batch.getJSONArray("events").getJSONObject(it).getString("kind")}.toSet())
  assertEquals(5,eventIds(batch).size);assertEquals(captured.map{decode(it).getJSONObject("event").getString("event_id")},eventIds(batch))
  assertEquals(f.binding,f.store.requireUploadOwner(f.account(),batch.getString("batch_id")))
  for(other in f.alternatives())rejected{f.store.requireUploadOwner(f.account(other),batch.getString("batch_id"))}
  for(privateField in listOf("incident_owner","dispatch_owner","check_in_owner","photo_owner",f.owner.subject,f.owner.configuration,f.owner.deviceId,f.owner.scope.vendorId))assertFalse(batch.toString().contains(privateField))
  assertEquals(captured,rows(f.store))
 }}

 @Test fun exactCurrentAccountRetriesOriginalSiteAssignmentAndRevisionWithoutRebinding(){Fixture(context).use{f->
  val originals=listOf(f.owner.copy(scope=f.owner.scope.copy(binding=f.binding.copy(siteId="original-other-site"))),
   f.owner.copy(scope=f.owner.scope.copy(binding=f.binding.copy(assignmentId="original-other-assignment"))),
   f.owner.copy(scope=f.owner.scope.copy(binding=f.binding.copy(revocationVersion=2))))
  val ids=originals.map{f.photo(it)};val encrypted=rows(f.store)
  for((index,owner) in originals.withIndex()){
   val batch=payload(f.store.prepareUpload(f.identity,"mercury-local",f.account(),"generation")!!)
   assertEquals(listOf(ids[index]),eventIds(batch));assertEquals(owner.scope.binding,f.store.requireUploadOwner(f.account(),batch.getString("batch_id")))
   val scope=batch.getJSONObject("scope");assertEquals(owner.scope.binding.siteId,scope.getString("site_id"));assertEquals(owner.scope.binding.assignmentId,scope.getString("assignment_id"));assertEquals(owner.scope.binding.revocationVersion,scope.getLong("revocation_version"))
   f.store.recordUploadReceipt(f.binding.guardId,receipt(batch))
  }
  assertEquals(0,f.store.pendingCount());assertEquals(encrypted.map{it.body},rows(f.store).map{it.body})
  val photos=f.store.pendingUploadPhotos(f.account(),"generation",10)
  assertEquals(ids,photos.map{it.getJSONObject("event").getString("event_id")})
  for((index,photo) in photos.withIndex())assertEquals(originals[index].scope.binding,f.store.requirePhotoOwner(f.account(),photo))
 }}

 @Test fun legacyPendingCiphertextAndRetryStayUnchangedWhileCurrentOwnerProceeds(){Fixture(context).use{f->
  f.store.capture("incident",JSONObject().put("description","Legacy owner unknown"),f.binding,f.grant(),f.identity,9999)
  val legacy=f.store.prepareSigned(f.identity,"mercury-local",f.binding.guardId)!!;val legacyBatch=payload(legacy)
  val originalSnapshots=snapshots(f.store);val legacyRow=rows(f.store).single()
  val current=f.incident();val currentBatch=payload(f.store.prepareUpload(f.identity,"mercury-local",f.account(),"generation")!!)
  assertEquals(listOf(current),eventIds(currentBatch));rejected{f.store.requireUploadOwner(f.account(),legacyBatch.getString("batch_id"))}
  assertTrue(snapshots(f.store).containsAll(originalSnapshots));assertEquals(legacyRow,rows(f.store).first())
  assertEquals(legacy.getString("payload"),f.store.prepareSigned(f.identity,"mercury-local",f.binding.guardId)!!.getString("payload"))
  f.store.requireUploadOwner(f.account(),currentBatch.getString("batch_id"));f.store.recordUploadReceipt(f.binding.guardId,receipt(currentBatch))
  assertEquals(1,f.store.pendingCount());assertNull(f.store.prepareUpload(f.identity,"mercury-local",f.account(),"generation"))
  assertEquals(originalSnapshots,snapshots(f.store));assertEquals(legacyRow,rows(f.store).first())
 }}

 @Test fun mixedGuardOnlySnapshotCannotBeAdoptedOrBlockNewOriginalOwner(){Fixture(context).use{f->
  f.incident(f.owner.copy(subject=UUID.randomUUID().toString()),"Original other subject")
  f.incident(f.owner.copy(configuration="b".repeat(64)),"Original other configuration")
  val legacy=pre46MixedSnapshot(f);val mixed=payload(legacy)
  assertEquals(2,eventIds(mixed).size);val originalSnapshots=snapshots(f.store);val originalRows=rows(f.store)
  val current=f.incident();val batch=payload(f.store.prepareUpload(f.identity,"mercury-local",f.account(),"current-generation")!!)
  assertEquals(listOf(current),eventIds(batch));rejected{f.store.requireUploadOwner(f.account(),mixed.getString("batch_id"))}
  assertTrue(snapshots(f.store).containsAll(originalSnapshots));assertEquals(originalRows,rows(f.store).take(2))
  f.store.requireUploadOwner(f.account(),batch.getString("batch_id"));f.store.recordUploadReceipt(f.binding.guardId,receipt(batch))
  assertEquals(2,f.store.pendingCount());assertNull(f.store.prepareUpload(f.identity,"mercury-local",f.account(),"current-generation"))
  assertEquals(originalSnapshots,snapshots(f.store));assertEquals(legacy.getString("payload"),f.store.prepareUpload(f.identity,"mercury-local",f.binding.guardId,"legacy-generation")!!.getString("payload"))
 }}

 @Test fun retainedOtherAccountSnapshotDoesNotBlockCurrentAndReauthRetriesExactOriginal(){Fixture(context).use{f->
  val other=f.owner.copy(subject=UUID.randomUUID().toString());f.incident(other)
  val original=f.store.prepareUpload(f.identity,"mercury-local",f.account(other),"original-generation")!!;val oldBatch=payload(original)
  f.store.retainUploadForReview(f.binding.guardId,oldBatch.getString("batch_id"),"original-generation",403)
  val retainedSnapshots=snapshots(f.store);val retainedRow=rows(f.store).single();val current=f.incident()
  val batch=payload(f.store.prepareUpload(f.identity,"mercury-local",f.account(),"current-generation")!!)
  assertEquals(listOf(current),eventIds(batch));rejected{f.store.requireUploadOwner(f.account(),oldBatch.getString("batch_id"))}
  f.store.requireUploadOwner(f.account(),batch.getString("batch_id"));f.store.recordUploadReceipt(f.binding.guardId,receipt(batch))
  assertEquals(retainedSnapshots,snapshots(f.store));assertEquals(retainedRow,rows(f.store).first());assertEquals(1,f.store.pendingCount())
  val retry=f.store.prepareUpload(f.identity,"mercury-local",f.account(other),"reauthenticated-generation")!!
  assertEquals(original.getString("payload"),retry.getString("payload"));assertEquals(eventIds(oldBatch),eventIds(payload(retry)))
  assertEquals(f.binding,f.store.requireUploadOwner(f.account(other),oldBatch.getString("batch_id")))
 }}

 @Test fun currentOwnerPayloadIdsCiphertextAndAcceptedReceiptSurviveReopen(){Fixture(context).use{f->
  f.allKinds();val originalRows=rows(f.store);val original=f.store.prepareUpload(f.identity,"mercury-local",f.account(),"generation")!!;val batch=payload(original)
  val originalSnapshots=snapshots(f.store);f.store.close()
  f.open().use{reopened->
   val retry=reopened.prepareUpload(f.identity,"mercury-local",f.account(),"renewed-generation")!!
   assertEquals(original.getString("payload"),retry.getString("payload"));assertEquals(eventIds(batch),eventIds(payload(retry)))
   assertEquals(originalRows,rows(reopened));assertEquals(originalSnapshots,snapshots(reopened));assertEquals(f.binding,reopened.requireUploadOwner(f.account(),batch.getString("batch_id")))
   reopened.recordUploadReceipt(f.binding.guardId,receipt(batch));reopened.recordUploadReceipt(f.binding.guardId,receipt(batch))
   assertEquals(0,reopened.pendingCount());assertNull(reopened.prepareUpload(f.identity,"mercury-local",f.account(),"renewed-generation"))
   assertEquals(originalRows.map{it.body},rows(reopened).map{it.body});assertTrue(rows(reopened).all{it.receipted==1})
   assertEquals(ConnectedIncidentReceiptState.SERVICE_ACCEPTED,reopened.incidentPage(f.draft()).items.single().receiptState)
  }
  f.open().use{reopened->
   assertEquals(0,reopened.pendingCount());assertNull(reopened.prepareUpload(f.identity,"mercury-local",f.account(),"generation"))
   val photo=reopened.pendingUploadPhotos(f.account(),"generation",3).single();assertEquals(f.binding,reopened.requirePhotoOwner(f.account(),photo))
   assertEquals(originalRows.map{it.body},rows(reopened).map{it.body})
  }
 }}

 @Test fun photosRequireExactStoredOwnerRecordBeforeSending(){Fixture(context).use{f->
  val old=f.photo(f.owner.copy(subject=UUID.randomUUID().toString()));val current=f.photo()
  val legacy=f.store.capture("photo_evidence",f.metadata(),f.binding,f.grant(),f.identity,10001)
  val accepted=mutableListOf<String>()
  while(true){val prepared=f.store.prepareUpload(f.identity,"mercury-local",f.binding.guardId,"legacy-metadata")?:break
   val batch=payload(prepared);accepted.addAll(eventIds(batch));f.store.recordUploadReceipt(f.binding.guardId,receipt(batch))}
  assertEquals(listOf(old,current,legacy),accepted);assertEquals(0,f.store.pendingCount())
  val original=rows(f.store);val photo=f.store.pendingUploadPhotos(f.account(),"generation",1).single()
  assertEquals(current,photo.getJSONObject("event").getString("event_id"));assertEquals(f.binding,f.store.requirePhotoOwner(f.account(),photo))
  for(other in f.alternatives()){
   assertTrue(f.store.pendingUploadPhotos(f.account(other),"generation",3).isEmpty())
   rejected{f.store.requirePhotoOwner(f.account(other),photo)}
  }
  rejected{f.store.requirePhotoOwner(f.account(),decode(row(f.store,old)))};rejected{f.store.requirePhotoOwner(f.account(),decode(row(f.store,legacy)))}
  val altered=listOf<(JSONObject)->Unit>({it.getJSONObject("event").put("event_id",UUID.randomUUID().toString())},
   {it.getJSONObject("event").getJSONObject("data").put("sha256","f".repeat(64))},
   {it.getJSONObject("photo_owner").put("subject",UUID.randomUUID().toString())},{it.getJSONObject("scope").put("assignment_id","other-assignment")})
  for(change in altered){val forged=JSONObject(photo.toString());change(forged);rejected{f.store.requirePhotoOwner(f.account(),forged)}}
  assertEquals(original,rows(f.store));assertEquals(current,f.store.pendingUploadPhotos(f.account(),"generation",1).single().getJSONObject("event").getString("event_id"))
 }}

 @Test fun malformedOrMissingMetadataRemainsEncryptedAndCannotBlockEligibleCurrentRecords(){Fixture(context).use{f->
  val invalid=mutableListOf<Row>();val invalidPhotos=mutableListOf<JSONObject>()
  val incidentChanges=listOf<(JSONObject)->Unit>({it.remove("incident_owner")},{it.getJSONObject("incident_owner").remove("subject")},
   {it.getJSONObject("incident_owner").put("subject",10)},{it.getJSONObject("incident_owner").put("unexpected",true)})
  for(change in incidentChanges){val id=f.incident();val original=row(f.store,id);val record=decode(original);change(record);invalid.add(replace(f.store,original,record))}
  val photoChanges=listOf<(JSONObject)->Unit>({it.remove("photo_owner")},{it.getJSONObject("photo_owner").put("version","1")},
   {it.getJSONObject("photo_owner").getJSONObject("scope").put("revocation_version",1.25)},{it.getJSONObject("photo_owner").put("subject",10)})
  for(change in photoChanges){val id=f.photo();val original=row(f.store,id);val record=decode(original);change(record);invalid.add(replace(f.store,original,record));invalidPhotos.add(record)}
  val currentIncident=f.incident();val currentPhoto=f.photo();val batch=payload(f.store.prepareUpload(f.identity,"mercury-local",f.account(),"generation")!!)
  assertEquals(listOf(currentIncident,currentPhoto),eventIds(batch));for(photo in invalidPhotos)rejected{f.store.requirePhotoOwner(f.account(),photo)}
  assertEquals(invalid,rows(f.store).take(invalid.size));f.store.requireUploadOwner(f.account(),batch.getString("batch_id"));f.store.recordUploadReceipt(f.binding.guardId,receipt(batch))
  assertNull(f.store.prepareUpload(f.identity,"mercury-local",f.account(),"generation"));assertEquals(invalid.size,f.store.pendingCount())
  assertEquals(invalid,rows(f.store).take(invalid.size));assertEquals(listOf(currentPhoto),f.store.pendingUploadPhotos(f.account(),"generation",10).map{it.getJSONObject("event").getString("event_id")})
 }}

 @Test fun encryptedFullOwnerMustMatchRecordGuardSiteAssignmentThumbprintAndRevision(){Fixture(context).use{f->
  val invalid=mutableListOf<Row>();val invalidPhotos=mutableListOf<JSONObject>()
  val changes=listOf<(JSONObject)->Unit>({it.put("guard_id","other-guard")},{it.put("site_id","other-site")},
   {it.put("assignment_id","other-assignment")},{it.put("device_thumbprint","d".repeat(64))},{it.put("revocation_version",2)})
  for(change in changes){val id=f.photo();val original=row(f.store,id);val record=decode(original);change(record.getJSONObject("scope"));invalid.add(replace(f.store,original,record));invalidPhotos.add(record)}
  val current=f.incident();val batch=payload(f.store.prepareUpload(f.identity,"mercury-local",f.account(),"generation")!!)
  assertEquals(listOf(current),eventIds(batch));for(photo in invalidPhotos)rejected{f.store.requirePhotoOwner(f.account(),photo)}
  assertEquals(invalid,rows(f.store).take(invalid.size));f.store.requireUploadOwner(f.account(),batch.getString("batch_id"));f.store.recordUploadReceipt(f.binding.guardId,receipt(batch))
  assertEquals(invalid.size,f.store.pendingCount());assertEquals(invalid,rows(f.store).take(invalid.size));assertNull(f.store.prepareUpload(f.identity,"mercury-local",f.account(),"generation"))
 }}

 @Test fun finalBatchCheckRereadsOriginalOwnerAndBindingInsteadOfTrustingPreparedSnapshot(){Fixture(context).use{f->
  val eventId=f.photo();val original=row(f.store,eventId)
  val proof=f.store.prepareUpload(f.identity,"mercury-local",f.account(),"generation")!!;val batch=payload(proof);val snapshot=snapshots(f.store)
  assertEquals(f.binding,f.store.requireUploadOwner(f.account(),batch.getString("batch_id")))
  val changes=listOf<(JSONObject)->Unit>({it.getJSONObject("photo_owner").put("subject",UUID.randomUUID().toString())},
   {it.getJSONObject("scope").put("assignment_id","changed-original-assignment")},
   {it.getJSONObject("event").getJSONObject("data").put("sha256","f".repeat(64))},
   {it.getJSONObject("photo_owner").getJSONObject("scope").put("revocation_version",2)})
  try{for(change in changes){
   val altered=decode(original);change(altered);val mutated=replace(f.store,original,altered)
   rejected{f.store.requireUploadOwner(f.account(),batch.getString("batch_id"))}
   assertEquals(mutated,row(f.store,eventId));assertEquals(snapshot,snapshots(f.store));assertEquals(1,f.store.pendingCount())
  }}finally{assertEquals(1,f.store.writableDatabase.update("captured",ContentValues().apply{put("body",original.body)},"sequence=?",arrayOf(original.sequence.toString())))}
  assertEquals(original,row(f.store,eventId));assertEquals(f.binding,f.store.requireUploadOwner(f.account(),batch.getString("batch_id")))
  assertEquals(proof.getString("payload"),f.store.prepareUpload(f.identity,"mercury-local",f.account(),"renewed-generation")!!.getString("payload"))
 }}
}
