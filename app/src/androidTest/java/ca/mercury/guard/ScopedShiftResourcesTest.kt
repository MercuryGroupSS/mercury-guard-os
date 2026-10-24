package ca.mercury.guard

import android.app.NotificationManager
import android.content.Context
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.util.Base64
import java.util.UUID

/** Synthetic scopes only; no service, capture, account or network is started. */
class ScopedShiftResourcesTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private class Fixture(val context:Context):java.io.Closeable {
  val suffix=UUID.randomUUID().toString();private val alias="scoped-shift-$suffix";private val marker="scoped-shift-$suffix"
  val identity=DeviceIdentity(context,alias,marker);val thumb=identity.create().thumbprint
  val config=GuardServiceConfig.parse(JSONObject().put("endpoint","https://synthetic.invalid").put("issuer","synthetic").put("audience","synthetic").put("device_id","synthetic-phone")
   .put("issuer_keys",JSONObject().put("synthetic",Base64.getUrlEncoder().withoutPadding().encodeToString(KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair().public.encoded))).toString())
  val binding=GrantBinding("guard-b","site-b","assignment-b-$suffix",thumb,1)
  val scope=DispatchScope(binding,"vendor-b")
  val old=DispatchScope(binding.copy(guardId="guard-a",assignmentId="assignment-a-$suffix"),"vendor-a")
  private val now=SystemClock.elapsedRealtime()
  val grant=VerifiedShiftGrant(UUID.randomUUID().toString(),binding,setOf("location","check_in"),now,now+120000,1)
  val anchor=ServerTimeAnchor(1000000,now,1)
  val authority=UploadAuthority(UUID.randomUUID().toString(),binding.guardId,scope.vendorId,UUID.randomUUID().toString(),config.uploadBinding(),thumb,"synthetic-never-sent",now,now+120000,1,0)
  private val notice="Synthetic resource-scope test; no collection."
  private val rawPolicy=JSONObject().put("version",1).put("revision",1).put("notice_revision",1).put("notice_text",notice).put("notice_sha256",EscalationProtocol.hash(notice))
   .put("sample_interval_ms",1000).put("min_distance_m",0).put("max_fix_age_ms",1000).put("max_accuracy_m",20).put("max_capture_lease_ms",10000).put("geofence",JSONObject.NULL).toString()
  private val policy=AuthorizedLocationPolicy.parse(EscalationProtocol.encode(rawPolicy),EscalationProtocol.hash(rawPolicy))
  val record=LocationConsentRecord(1,UUID.randomUUID().toString(),LocationConsentScope(EscalationScope(config.uploadBinding(),config.deviceId,thumb,authority.subject,binding.guardId,scope.vendorId),binding),policy,"{}",JSONObject(),null,null,null)
  var ownsRuntime=false
  fun prepare():String=ConnectedLocationRuntime.prepare(context,config,record,authority,grant,anchor).also{ownsRuntime=true}
  fun reminderPolicy()=JSONObject().put("revision",1).put("starts_at",10000000).put("ends_at",11000000).put("interval_ms",60000).put("window_ms",10000).put("max_evidence_age_ms",5000).put("max_accuracy_m",100)
  override fun close(){
   if(ownsRuntime)ConnectedLocationRuntime.stop(context,"Synthetic scope cleanup")
   KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}
   File(context.noBackupFilesDir,marker).delete();File(context.noBackupFilesDir,"$marker.bak").delete()
  }
 }
 @Test fun lateOldAssignmentCannotStopNewPendingOrActiveCollector(){
  Fixture(context).use{f->
   val token=f.prepare()
   assertFalse(ConnectedLocationRuntime.stopForAssignment(context,f.old,"Late old closeout"))
   val run=ConnectedLocationRuntime.claim(token)?:error("Other assignment cleared pending start")
   assertTrue(ConnectedLocationRuntime.current(run))
   for(other in listOf(f.old,f.scope.copy(binding=f.binding.copy(assignmentId="historical-same-guard-${f.suffix}")),f.scope.copy(vendorId="another-vendor"),f.scope.copy(binding=f.binding.copy(siteId="another-site")),f.scope.copy(binding=f.binding.copy(revocationVersion=2)),f.scope.copy(binding=f.binding.copy(deviceThumbprint="a".repeat(64))))){
    assertFalse(ConnectedLocationRuntime.stopForAssignment(context,other,"Unrelated closeout"));assertTrue(ConnectedLocationRuntime.current(run));assertFalse(run.cancellation.cancelled())
   }
   assertTrue(ConnectedLocationRuntime.stopForAssignment(context,f.scope,"Matching closeout"))
   assertFalse(ConnectedLocationRuntime.current(run));assertTrue(run.cancellation.cancelled())
  }
 }
 @Test fun matchingCloseoutCancelsOnlyItsPendingStart(){
  Fixture(context).use{f->val token=f.prepare();assertTrue(ConnectedLocationRuntime.stopForAssignment(context,f.scope,"Matching pending closeout"));assertNull(ConnectedLocationRuntime.claim(token))}
 }
 @Test fun oldAssignmentCannotEraseAnotherEncryptedReminder(){
  Fixture(context).use{f->
   val prefs="scoped-reminders-${f.suffix}";val reminders=AuthorizedReminders(context,prefs,f.identity,{1000},{1},{true})
   val grant=VerifiedShiftGrant("synthetic-check",f.binding,setOf("check_in"),100,10000,1)
   try{
    reminders.enable(f.reminderPolicy(),f.binding,grant,ServerTimeAnchor(1000000,1000,1))
    val before=context.getSharedPreferences(prefs,0).getString("schedule",null)!!
    assertFalse(before.contains(f.binding.assignmentId))
    for(other in listOf(f.old.binding,f.binding.copy(assignmentId="historical-same-guard-${f.suffix}"),f.binding.copy(siteId="another-site"),f.binding.copy(deviceThumbprint="a".repeat(64)),f.binding.copy(revocationVersion=2))){assertFalse(reminders.stopForAssignment(other));assertEquals(before,context.getSharedPreferences(prefs,0).getString("schedule",null))}
    assertTrue(reminders.stopForAssignment(f.binding));assertNull(context.getSharedPreferences(prefs,0).getString("schedule",null))
   }finally{reminders.stop();context.deleteSharedPreferences(prefs)}
  }
 }
 @Test fun explicitGlobalSignOutStopsCurrentCollectorAndDefaultConnectedReminders(){
  val prefs=context.getSharedPreferences("authorized_reminders",0)
  assertNull("Do not claim another schedule",prefs.getString("schedule",null))
  assertFalse("Do not claim another upload session",File(context.noBackupFilesDir,"upload-authority-v1").exists())
  val notes=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  assertFalse("Do not clear another reminder",notes.activeNotifications.any{it.id==AuthorizedReminders.NOTE})
  Fixture(context).use{f->
   val reminders=AuthorizedReminders(context,"authorized_reminders",f.identity,{1000},{1},{true});var claimed=false
   try{
    reminders.enable(f.reminderPolicy(),f.binding,VerifiedShiftGrant("synthetic-check",f.binding,setOf("check_in"),100,10000,1),ServerTimeAnchor(1000000,1000,1));claimed=true
    val run=ConnectedLocationRuntime.claim(f.prepare())!!
    assertFalse(ConnectedLocationRuntime.stopForAssignment(context,f.old,"Old closeout"));assertNotNull(prefs.getString("schedule",null));assertTrue(ConnectedLocationRuntime.current(run))
    UploadCoordinator(context).stop()
    assertFalse(ConnectedLocationRuntime.current(run));assertTrue(run.cancellation.cancelled());assertNull(prefs.getString("schedule",null))
    reminders.refresh();assertNull(prefs.getString("schedule",null));assertFalse(notes.activeNotifications.any{it.id==AuthorizedReminders.NOTE})
   }finally{if(claimed)reminders.stop()}
  }
 }
}
