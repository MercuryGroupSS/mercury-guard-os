package ca.mercury.guard

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyStore
import java.util.UUID

/** Logical delivery ports only. Does not play sound, schedule real alarms or claim hardware delivery. */
class AuthorizedAttentionRemindersTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private class Fixture(val context:Context):java.io.Closeable {
  val suffix=UUID.randomUUID().toString();val alias="test.attention.$suffix";val marker="attention-$suffix"
  val prefs="attention-$suffix";val attentionDb="attention-$suffix.db";val eventsDb="attention-events-$suffix.db"
  var elapsed=1000L;var boot=1;var access=true;var owns=false;var trustedConfiguration:Pair<String,String>?=null
  val notes=mutableListOf<Notification>();val alarms=mutableListOf<Long>()
  val identity=DeviceIdentity(context,alias,marker)
  val binding:GrantBinding;val owner:ConnectedDispatchOwner
  init {
   assertNull("Do not claim another reminder schedule",context.getSharedPreferences("authorized_reminders",0).getString("schedule",null))
   assertFalse("Do not clear another reminder notification",(context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).activeNotifications.any{it.id==AuthorizedReminders.NOTE})
   binding=GrantBinding("attention-guard","attention-site","attention-assignment",identity.create().thumbprint,1)
   owner=ConnectedDispatchOwner("a".repeat(64),"attention-installation",UUID.randomUUID().toString(),DispatchScope(binding,"attention-company"));trustedConfiguration=owner.configuration to owner.deviceId
  }
  val epoch=1000000L
  val grant get()=VerifiedShiftGrant("synthetic-check",binding,setOf("check_in","photo"),100,10000,1)
  fun policy(progressive:Boolean=true,window:Long=900000)=JSONObject().put("revision",1).put("starts_at",epoch).put("ends_at",epoch+1800000)
   .put("interval_ms",900000).put("window_ms",window).put("max_evidence_age_ms",5000).put("max_accuracy_m",20).also{if(progressive)it.put("attention",JSONObject().put("version",1).put("profile",CheckInAttentionPolicy.PROFILE))}
  fun reminders()=AuthorizedReminders(context,prefs,identity,{elapsed},{boot},{access},attentionDb,eventsDb,{notes.add(it)},{alarms.add(it)},{trustedConfiguration})
  fun enable(r:AuthorizedReminders=reminders(),p:JSONObject=policy(),o:ConnectedDispatchOwner=owner){owns=true;r.enable(p,o,grant,ServerTimeAnchor(epoch,1000,1))}
  fun snapshot(r:AuthorizedReminders=reminders())=r.attentionSnapshot(owner,policy())!!
  override fun close(){if(owns)reminders().stop();context.deleteSharedPreferences(prefs);context.deleteDatabase(attentionDb);context.deleteDatabase(eventsDb)
   KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)};File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()}
 }
 private fun rejected(block:()->Unit){var denied=false;try{block()}catch(_:Exception){denied=true};assertTrue("Expected reminder authority rejection",denied)}

 @Test fun twentyLogicalAttemptsStopAtBudgetWithoutInventingMissOrEndingLongerWindow(){Fixture(context).use{f->
  val r=f.reminders();f.enable(r);val originalToken=f.snapshot(r).token!!;assertEquals(1,f.notes.size)
  assertTrue(f.snapshot(r).pulse);f.elapsed+=4000;assertFalse(f.snapshot(r).pulse)
  for(index in 1..19){f.elapsed=1000+index*30000L;r.refresh();assertEquals(index+1,f.notes.size)}
  f.elapsed=1000+600000;r.refresh();assertEquals(20,f.notes.size)
  val exhausted=f.snapshot(r);assertEquals(CheckInAttentionTiming.Stage.RED,exhausted.stage);assertTrue(exhausted.budgetExhausted);assertFalse(exhausted.pulse);assertEquals(originalToken,exhausted.token)
  assertFalse(r.fullScreenAllowed(originalToken));assertNotNull(r.genericSnapshot(originalToken));assertTrue(r.status().contains("enabled"))
  ScopedEventStore(context,f.eventsDb,{f.elapsed},{f.boot}).use{assertFalse(it.checkInRecorded(f.owner,1,0))}
  f.elapsed=1000+900000;r.refresh();assertEquals(21,f.notes.size);assertNull(r.genericSnapshot(originalToken));assertNotEquals(originalToken,f.snapshot(r).token)
  assertEquals(CheckInAttentionTiming.Stage.GREEN,f.snapshot(r).stage)
  assertEquals(20,f.notes.take(20).count{it.channelId==AuthorizedReminders.ATTENTION_CHANNEL})
  for(note in f.notes){assertNotNull(note.deleteIntent);assertEquals(note.deleteIntent,note.actions.single().actionIntent);assertNull(note.fullScreenIntent)
   val presentation=note.extras.getCharSequence(Notification.EXTRA_TITLE).toString()+note.extras.getCharSequence(Notification.EXTRA_TEXT).toString()
   for(privateValue in listOf(f.owner.subject,f.owner.deviceId,f.binding.guardId,f.binding.siteId,f.binding.assignmentId))assertFalse(presentation.contains(privateValue))}
 }}

 @Test fun restartAndReenableCannotBurstOrResetSilencedWindowAndStaleTokenCannotSilenceNext(){Fixture(context).use{f->
  var r=f.reminders();f.enable(r);val first=f.snapshot(r).token!!
  f.elapsed+=125000;r=f.reminders();r.refresh();assertEquals(2,f.notes.size);assertEquals(CheckInAttentionTiming.Stage.YELLOW,f.snapshot(r).stage)
  r.refresh();assertEquals(2,f.notes.size);assertTrue(r.silenceToken(first));f.elapsed+=30000;r.refresh();assertEquals(2,f.notes.size);assertTrue(f.snapshot(r).silenced)
  r.stop();assertNull(r.genericSnapshot(first))
  // A fresh authorization permits re-enable; its capture lease still does not authorize reminders forever.
  val renewed=VerifiedShiftGrant("fresh-enable",f.binding,setOf("check_in"),f.elapsed,f.elapsed+10000,1)
  r.enable(f.policy(),f.owner,renewed,ServerTimeAnchor(f.epoch+f.elapsed-1000,f.elapsed,1));assertEquals(2,f.notes.size)
  val second=f.snapshot(r).token!!;assertNotEquals(first,second);assertTrue(f.snapshot(r).silenced);assertNull(r.genericSnapshot(first))
  f.elapsed=901000;r.refresh();assertEquals(3,f.notes.size);val third=f.snapshot(r).token!!;assertFalse(r.silenceToken(second));assertFalse(f.snapshot(r).silenced);assertNotEquals(second,third)
  ScopedEventStore(context,f.eventsDb,{f.elapsed},{f.boot}).use{assertFalse(it.checkInRecorded(f.owner,1,0));assertFalse(it.checkInRecorded(f.owner,1,1))}
 }}

 @Test fun accountConfigurationAndAssignmentStopsUseFullOwnerWithoutLegacyAdoption(){Fixture(context).use{f->
  val r=f.reminders();f.enable(r);val token=f.snapshot(r).token!!;val raw=context.getSharedPreferences(f.prefs,0).getString("schedule",null)!!
  val others=listOf(f.owner.copy(configuration="b".repeat(64)),f.owner.copy(subject=UUID.randomUUID().toString()),f.owner.copy(deviceId="another-installation"),f.owner.copy(scope=f.owner.scope.copy(vendorId="another-company")),f.owner.copy(scope=f.owner.scope.copy(binding=f.binding.copy(assignmentId="another-assignment"))))
  for(other in others){assertEquals("Reminders off for this assignment",r.status(other,f.policy()));assertNull(r.attentionSnapshot(other,f.policy()));assertFalse(r.silenceCurrent(other,f.policy()));assertFalse(r.stopForAssignment(other));assertEquals(raw,context.getSharedPreferences(f.prefs,0).getString("schedule",null))}
  assertFalse(r.stopForAssignment(f.binding));r.retainForAssignments(setOf(f.owner));assertNotNull(r.genericSnapshot(token))
  r.retainForAssignments(setOf(others[1]));assertNull(r.genericSnapshot(token));assertEquals("Reminders off",r.status())
  f.enable(r,o=others[1]);assertEquals(2,f.notes.size);assertNotNull(r.attentionSnapshot(others[1],f.policy()));assertFalse(r.stopForAssignment(f.owner));assertTrue(r.stopForAssignment(others[1]))
 }}

 @Test fun exactCapturedOwnerCompletesAfterCrashButLegacyOrAnotherSubjectNeverDoes(){Fixture(context).use{f->
  val r=f.reminders();val p=AuthorizedCheckInPolicy.parse(f.policy())
  ScopedEventStore(context,f.eventsDb,{f.elapsed},{f.boot}).use{db->
   db.capture("check_in",JSONObject().put("policy_revision",1).put("slot",0),f.binding,f.grant,f.identity,f.epoch)
   assertFalse(db.checkInRecorded(f.owner,1,0))
  }
  f.enable(r);assertEquals(1,f.notes.size)
  val fix=JSONObject().put("at",f.epoch).put("latitude",0).put("longitude",0).put("accuracy_m",5).put("mock",false)
  val evidence=AuthorizedCheckInEvidence(p,0,f.epoch,fix);val photo=JSONObject().put("evidence_id",UUID.randomUUID().toString()).put("sha256","e".repeat(64)).put("bytes",100)
  ScopedEventStore(context,f.eventsDb,{f.elapsed},{f.boot}).use{db->db.captureCheckIn(f.owner,f.grant,f.identity,evidence,photo,f.epoch)}
  // No explicit reminder-complete callback is invoked: recreation must reconcile durable proof.
  val again=f.reminders();again.refresh();assertEquals(CheckInAttentionTiming.Stage.COMPLETE,f.snapshot(again).stage);assertNull(r.genericSnapshot(f.snapshot(r).token?:"not-a-token"));f.elapsed+=30000;again.refresh();assertEquals(1,f.notes.size)
  val other=f.owner.copy(subject=UUID.randomUUID().toString());val fresh=VerifiedShiftGrant("other-account",f.binding,setOf("check_in"),f.elapsed,f.elapsed+10000,1)
  again.enable(f.policy(),other,fresh,ServerTimeAnchor(f.epoch+f.elapsed-1000,f.elapsed,1));assertEquals(2,f.notes.size);assertEquals(CheckInAttentionTiming.Stage.GREEN,again.attentionSnapshot(other,f.policy())!!.stage)
 }}

 @Test fun permissionLossSignoutBootAndActualPolicyEndCancelWithoutNewCaptureExpiryDependency(){Fixture(context).use{f->
  val r=f.reminders();f.enable(r);val first=f.snapshot(r).token!!;f.elapsed=61000;r.refresh();assertEquals(2,f.notes.size);assertTrue(r.status().contains("enabled")) // Original capture grant expired at10000.
  f.access=false;r.refresh();assertEquals("Reminders off",r.status());assertNull(r.genericSnapshot(first));rejected{f.enable(r)}
  f.access=true;f.elapsed=1000;f.enable(r);val second=f.snapshot(r).token!!;f.boot=2;r.refresh();assertEquals("Reminders off",r.status());assertNull(r.genericSnapshot(second))
  f.boot=1;f.enable(r);val changed=f.snapshot(r).token!!;f.trustedConfiguration="b".repeat(64) to f.owner.deviceId;r.refresh();assertNull(r.genericSnapshot(changed));assertEquals("Reminders off",r.status());f.trustedConfiguration=f.owner.configuration to f.owner.deviceId
  f.enable(r);val third=f.snapshot(r).token!!;r.stop();r.refresh();assertNull(r.genericSnapshot(third));assertNull(context.getSharedPreferences(f.prefs,0).getString("schedule",null))
  f.enable(r);f.elapsed=1801000;r.refresh();assertEquals("Reminders off",r.status())
 }}

 @Test fun omittedAttentionKeepsOneCueAndRejectsProgressiveEnableWithoutConnectedOwner(){Fixture(context).use{f->
  val r=f.reminders();val legacy=f.policy(false);f.enable(r,legacy);assertEquals(1,f.notes.size);assertEquals(AuthorizedReminders.CHANNEL,f.notes.single().channelId)
  for(age in listOf(30000L,120000L,300000L,600000L)){f.elapsed=1000+age;r.refresh()};assertEquals(1,f.notes.size);assertNull(r.attentionSnapshot(f.owner,legacy))
  assertFalse(r.fullScreenConsented());assertNull(f.notes.single().fullScreenIntent)
  f.elapsed=1000;rejected{r.enable(f.policy(),f.binding,f.grant,ServerTimeAnchor(f.epoch,1000,1))}
 }}
 @Test fun preFullOwnerScheduleIsQuarantinedBeforeSignInWithoutChangingItsEncryptedBytes(){Fixture(context).use{f->
  val preferences=context.getSharedPreferences(f.prefs,0);val raw=JSONObject().put("id",UUID.randomUUID().toString()).put("policy",f.policy(false)).put("epoch",f.epoch).put("elapsed",1000).put("boot",1)
   .put("guard",f.binding.guardId).put("site",f.binding.siteId).put("assignment",f.binding.assignmentId).put("thumbprint",f.binding.deviceThumbprint).put("revocation",1).put("last_attempt",-1)
  val encrypted=DeviceCipher().encrypt(raw.toString().toByteArray(Charsets.UTF_8),"mercury-authorized-reminders-v1")
  check(preferences.edit().putString("schedule",encrypted).commit());f.owns=true
  val r=f.reminders();r.refresh();assertNull(preferences.getString("schedule",null));assertTrue(f.notes.isEmpty());assertTrue(f.alarms.isEmpty());assertTrue(r.status().contains("sign in and explicitly enable"))
  val quarantined=preferences.all.filterKeys{it.startsWith("legacy_quarantine_")};assertEquals(1,quarantined.size);assertEquals(encrypted,quarantined.values.single())
  r.refresh();assertEquals(quarantined,preferences.all.filterKeys{it.startsWith("legacy_quarantine_")})
  f.enable(r);assertEquals(1,f.notes.size);assertNotNull(r.attentionSnapshot(f.owner,f.policy()));assertEquals(encrypted,preferences.getString(quarantined.keys.single(),null))
  val owned=JSONObject(String(DeviceCipher().decrypt(preferences.getString("schedule",null)!!,"mercury-authorized-reminders-v1"),Charsets.UTF_8))
  assertEquals(f.owner.json().toString(),owned.getJSONObject("owner").toString());assertFalse(raw.has("owner"));assertEquals(encrypted,quarantined.values.single())
 }}

 @Test fun freshAssignmentPolicyRemovalOrRevisionStopsOriginalScheduleWithoutRebindingIt(){Fixture(context).use{f->
  val r=f.reminders();f.enable(r);val token=f.snapshot(r).token!!
  r.retainForAssignments(mapOf(f.owner to f.policy()));assertNotNull(r.genericSnapshot(token))
  r.retainForAssignments(mapOf(f.owner to f.policy().put("revision",2)));assertNull(r.genericSnapshot(token));assertEquals("Reminders off",r.status())
  f.enable(r);val next=f.snapshot(r).token!!;r.retainForAssignments(emptyMap<ConnectedDispatchOwner,JSONObject>());assertNull(r.genericSnapshot(next));assertEquals("Reminders off",r.status())
  CheckInAttentionStore(context,f.attentionDb).use{assertEquals(0,it.read(f.owner,AuthorizedCheckInPolicy.parse(f.policy()),0).lastAttempt)}
 }}

}
