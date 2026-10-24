package ca.mercury.guard

import android.content.Context
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

/** Synthetic policy and point coordinates only. No SDK, service, network or hardware claim. */
class ScopedPatrolLocationTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private class Fixture(private val context:Context):Closeable {
  private val suffix=UUID.randomUUID().toString();private val alias="patrol-location-$suffix";private val marker="patrol-location-$suffix"
  private val eventName="patrol-location-events-$suffix.db";private val consentName="patrol-location-consent-$suffix.db"
  val identity=DeviceIdentity(context,alias,marker)
  val scope=LocationConsentScope(EscalationScope("a".repeat(64),"synthetic-phone",identity.create().thumbprint,UUID.randomUUID().toString(),"guard","vendor"),GrantBinding("guard","site","shift",identity.create().thumbprint,1))
  val events=ScopedEventStore(context,eventName,{200},{1});val consents=LocationConsentStore(context,consentName)
  val policy:AuthorizedLocationPolicy
  val record:LocationConsentRecord
  val grant:VerifiedShiftGrant
  val plan=PatrolPlan("route",1,listOf(PatrolCheckpoint("entrance","Entrance"),PatrolCheckpoint("another-point","Another point")),gpsRequired=true)
  init{
   val notice="Synthetic point-fix patrol test only. No real location."
   val raw=JSONObject().put("version",1).put("revision",1).put("notice_revision",2).put("notice_text",notice).put("notice_sha256",EscalationProtocol.hash(notice)).put("sample_interval_ms",1000).put("min_distance_m",0).put("max_fix_age_ms",2000).put("max_accuracy_m",20).put("max_capture_lease_ms",10000).put("geofence",JSONObject.NULL).toString()
   policy=AuthorizedLocationPolicy.parse(EscalationProtocol.encode(raw),EscalationProtocol.hash(raw))
   val pending=consents.prepare(scope,policy);val intent=JSONObject(pending.raw)
   consents.accept(pending.id,scope,"consent",JSONObject().put("version",1).put("request_id",intent.getString("request_id")).put("consent_id",pending.id).put("action","consent").put("status","consent_recorded").put("recorded_at_ms",99000).put("intent_sha256",EscalationProtocol.hash(pending.raw)))
   record=consents.get(pending.id,scope)!!
   grant=VerifiedShiftGrant("synthetic-point-grant",scope.binding,setOf("patrol","location","incident"),100,1000,1,AuthorizedLocationConsent(record.id,policy),100000,109000)
  }
  fun point()=JSONObject().put("requested_at_ms",100100).put("fix_at_ms",100400).put("consent_id",record.id).put("policy_revision",policy.revision).put("notice_revision",policy.noticeRevision).put("policy_sha256",policy.sha256).put("notice_sha256",policy.noticeSha256).put("latitude",0.0).put("longitude",0.0).put("accuracy_m",5).put("mock",false)
  fun capture(point:JSONObject=point(),grant:VerifiedShiftGrant=this.grant,record:LocationConsentRecord=this.record,checkpoint:String="entrance",at:Long=100500)=events.capturePatrolCheckpoint(plan,plan.choice(checkpoint),scope.binding,grant,identity,at,record,point)
  override fun close(){events.close();consents.close();context.deleteDatabase(eventName);context.deleteDatabase(consentName);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)};File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()}
 }
 private fun rejected(run:()->Unit){var failed=false;try{run()}catch(_:Exception){failed=true};assertTrue("GPS checkpoint must fail closed",failed)}
 private fun payload(proof:JSONObject)=JSONObject(String(Base64.getUrlDecoder().decode(proof.getString("payload")),Charsets.UTF_8))
 private fun receipt(batch:JSONObject)=JSONObject().put("batch_id",batch.getString("batch_id")).put("event_ids",JSONArray((0 until batch.getJSONArray("events").length()).map{batch.getJSONArray("events").getJSONObject(it).getString("event_id")})).put("status","accepted_local_only")

 @Test fun exactOriginalPolicyNoticeTimingAccuracyAndNonMockFieldsAreRequiredBeforeSave(){Fixture(context).use{f->
  val invalid=listOf(
   f.point().put("consent_id",UUID.randomUUID().toString()),f.point().put("policy_revision",2),f.point().put("notice_revision",3),f.point().put("policy_sha256","0".repeat(64)),f.point().put("notice_sha256","0".repeat(64)),
   f.point().put("requested_at_ms",99999),f.point().put("requested_at_ms",100401),f.point().put("fix_at_ms",100501),f.point().put("requested_at_ms",100100.5),
   f.point().put("mock",true),f.point().put("mock","false"),f.point().put("accuracy_m",0),f.point().put("accuracy_m",21),f.point().put("latitude",91),f.point().put("longitude",-181),f.point().put("extra","not approved"),f.point().apply{remove("notice_sha256")}
  )
  for(point in invalid)rejected{f.capture(point)}
  rejected{f.capture(at=109000)};rejected{f.capture(at=103000)}
  val noLocation=VerifiedShiftGrant("manual-only",f.scope.binding,setOf("patrol"),100,1000,1)
  rejected{f.capture(grant=noLocation)}
  val noLocationAction=VerifiedShiftGrant("wrong-action",f.scope.binding,setOf("patrol"),100,1000,1,AuthorizedLocationConsent(f.record.id,f.policy),100000,109000)
  rejected{f.capture(grant=noLocationAction)}
  assertEquals(0,f.events.pendingCount());assertFalse(f.events.checkpointRecorded(f.scope.binding,"route",1,"entrance"))
  f.capture();assertTrue(f.events.checkpointRecorded(f.scope.binding,"route",1,"entrance"));rejected{f.capture()}
 }}

 @Test fun originalGpsBytesAndConsentPartitionSurviveReviewWhileIncidentDeliveryContinuesAfterWithdrawal(){Fixture(context).use{f->
  val point=f.point();val gpsId=f.capture(point)
  val owner=ConnectedIncidentDraftScope(f.scope.account.configuration,f.scope.account.deviceId,f.scope.account.thumbprint,f.scope.account.subject,"guard","vendor","site","shift")
  f.events.captureIncident(owner,"Independent incident remains deliverable",f.scope.binding,f.grant,f.identity,100501)
  val proof=f.events.prepareUpload(f.identity,"mercury-local","guard","session-a")!!;val first=payload(proof)
  assertEquals(1,first.getJSONArray("events").length());val event=first.getJSONArray("events").getJSONObject(0)
  assertEquals(gpsId,event.getString("event_id"));assertEquals(point.toString(),event.getJSONObject("data").getJSONObject("location").toString())
  val original=f.events.locationUploadScope("guard",first.getString("batch_id"))!!;assertEquals(Triple(f.scope,f.record.id,f.policy.sha256),original)
  f.consents.withdraw(f.record.id,f.scope);assertFalse(f.consents.canUpload(original.second,original.first,original.third))
  f.events.retainUploadForReview("guard",first.getString("batch_id"),"session-a",403)
  val second=payload(f.events.prepareUpload(f.identity,"mercury-local","guard","session-a")!!)
  assertEquals("incident",second.getJSONArray("events").getJSONObject(0).getString("kind"));assertNull(f.events.locationUploadScope("guard",second.getString("batch_id")))
  f.events.recordUploadReceipt("guard",receipt(second));assertEquals(ConnectedIncidentReceiptState.SERVICE_ACCEPTED,f.events.incidentPage(owner).items.single().receiptState)
  val retry=f.events.prepareUpload(f.identity,"mercury-local","guard","session-b")!!;assertEquals(proof.getString("payload"),retry.getString("payload"));assertEquals(1,f.events.pendingCount())
  rejected{f.capture(record=f.consents.get(f.record.id,f.scope)!!,checkpoint="another-point")}
 }}

 @Test fun legacyManualCheckpointWireRemainsUnchangedWithoutLocationConsent(){Fixture(context).use{f->
  val grant=VerifiedShiftGrant("manual-only",f.scope.binding,setOf("patrol"),100,1000,1)
  val plan=PatrolPlan("route",1,listOf(PatrolCheckpoint("manual-point","Manual point")))
  f.events.capturePatrolCheckpoint(plan,plan.choice("manual-point"),f.scope.binding,grant,f.identity,100000)
  val batch=payload(f.events.prepareUpload(f.identity,"mercury-local","guard","manual-session")!!)
  val data=batch.getJSONArray("events").getJSONObject(0).getJSONObject("data")
  assertEquals(setOf("route_id","route_revision","checkpoint_id","capture_grant_id"),data.keys().asSequence().toSet());assertFalse(data.has("location"));assertNull(f.events.locationUploadScope("guard",batch.getString("batch_id")))
 }}

 @Test fun requiredPlanCannotCompleteWithoutAFixOrWithAnotherCheckpointRoundOrRevision(){Fixture(context).use{f->
  val choice=f.plan.choice("entrance")
  rejected{f.events.capturePatrolCheckpoint(f.plan,choice,f.scope.binding,f.grant,f.identity,100500)}
  rejected{f.events.capturePatrolCheckpoint(f.plan,choice,f.scope.binding,f.grant,f.identity,100500,f.record,null)}
  rejected{f.events.capturePatrolCheckpoint(f.plan,choice,f.scope.binding,f.grant,f.identity,100500,null,f.point())}
  for(wrong in listOf(choice.copy(routeId="another-route"),choice.copy(revision=2),choice.copy(checkpointId="not-assigned"),choice.copy(roundId="not-declared")))rejected{f.events.capturePatrolCheckpoint(f.plan,wrong,f.scope.binding,f.grant,f.identity,100500,f.record,f.point())}
  rejected{f.events.capturePatrolCheckpoint(f.plan,choice,f.scope.binding.copy(assignmentId="another-assignment"),f.grant,f.identity,100500,f.record,f.point())}
  val manual=PatrolPlan("route",1,f.plan.checkpoints)
  rejected{f.events.capturePatrolCheckpoint(manual,choice,f.scope.binding,f.grant,f.identity,100500,f.record,f.point())}
  val rounds=PatrolPlan("route",1,f.plan.checkpoints,listOf(PatrolRound("opening","Opening")),true)
  rejected{f.events.capturePatrolCheckpoint(rounds,choice,f.scope.binding,f.grant,f.identity,100500,f.record,f.point())}
  assertEquals(0,f.events.pendingCount());assertTrue(f.events.checkpointProgress(f.scope.binding,"route",1).isEmpty())
  f.events.capturePatrolCheckpoint(rounds,rounds.choice("entrance","opening"),f.scope.binding,f.grant,f.identity,100500,f.record,f.point())
  assertTrue(f.events.checkpointRecorded(f.scope.binding,"route",1,"entrance","opening"))
 }}
}
