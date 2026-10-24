package ca.mercury.guard

import android.content.Intent
import android.os.CancellationSignal
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.util.Base64
import java.util.UUID

/** Actual framework callbacks on owned Activity instances; no Auth or biometric-success injection. */
class ConnectedAttentionEntryTest {
 private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
 private val context get()=instrumentation.targetContext
 private fun field(a:GuardAccountActivity,key:String,value:Any?){GuardAccountActivity::class.java.getDeclaredField(key).apply{isAccessible=true;set(a,value)}}
 private fun value(a:GuardAccountActivity,key:String)=GuardAccountActivity::class.java.getDeclaredField(key).apply{isAccessible=true}.get(a)
 private fun tree(v:View):List<View> =listOf(v)+if(v is ViewGroup)(0 until v.childCount).flatMap{tree(v.getChildAt(it))}else emptyList()
 private fun texts(v:View)=tree(v).filterIsInstance<TextView>().map{it.text.toString()}
 private class Fixture(val config:GuardServiceConfig,val draftOwner:ConnectedIncidentDraftScope){
  val binding=GrantBinding(draftOwner.guardId,draftOwner.siteId,draftOwner.assignmentId,draftOwner.thumbprint,1)
  val owner=ConnectedDispatchOwner(draftOwner.configuration,draftOwner.deviceId,draftOwner.subject,DispatchScope(binding,draftOwner.vendorId))
  val epoch=1730000000000L
  fun item()=JSONObject().put("guardId",draftOwner.guardId).put("vendorId",draftOwner.vendorId).put("siteId",draftOwner.siteId).put("assignmentId",draftOwner.assignmentId)
   .put("deviceThumbprint",draftOwner.thumbprint).put("revocationVersion",1).put("startsAt",epoch-60000).put("endsAt",epoch+3600000)
   .put("status_server_time_ms",epoch).put("status_elapsed_ms",SystemClock.elapsedRealtime())
 }
 private fun configured(run:(Fixture)->Unit){
  assertNull("Do not claim another connected reminder",context.getSharedPreferences("authorized_reminders",0).getString("schedule",null))
  assertFalse("Do not claim another connected upload session",File(context.noBackupFilesDir,"upload-authority-v1").exists())
  val identity=DeviceIdentity(context);val existing=identity.publicIdentity();val key=existing?:identity.create()
  val public=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair().public
  val config=GuardServiceConfig.parse(JSONObject().put("endpoint","https://attention-entry.invalid").put("issuer","attention-entry").put("audience","attention-entry").put("device_id","attention-entry-phone")
   .put("issuer_keys",JSONObject().put("test",Base64.getUrlEncoder().withoutPadding().encodeToString(public.encoded))).toString())
  val fixture=Fixture(config,ConnectedIncidentDraftScope(config.uploadBinding(),config.deviceId,key.thumbprint,UUID.randomUUID().toString(),"entry-guard","entry-company","entry-site","entry-${UUID.randomUUID()}"))
  try{run(fixture)}finally{
   ConnectedIncidentDraftStore(context).use{db->db.read(fixture.draftOwner)?.let{db.clear(fixture.draftOwner,it)}}
   if(existing==null){check(identity.publicIdentity()==key);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry("mercury.device.signing.v1")};File(context.noBackupFilesDir,"device-identity-v1").delete();File(context.noBackupFilesDir,"device-identity-v1.bak").delete()}
  }
 }
 private fun present(a:GuardAccountActivity,f:Fixture):GuardAccountClient.Session {
  val type=GuardAccountActivity::class.java.declaredClasses.single{it.simpleName=="AccountIdentity"}
  val account=type.getDeclaredConstructor(String::class.java,String::class.java,String::class.java).apply{isAccessible=true}.newInstance(f.draftOwner.subject,f.draftOwner.guardId,f.draftOwner.vendorId)
  val session=GuardAccountClient.Session("synthetic-entry-never-sent",SystemClock.elapsedRealtime()+60000)
  field(a,"config",f.config);field(a,"session",session);field(a,"accountIdentity",account);field(a,"captureBinding",f.binding)
  field(a,"captureGrant",VerifiedShiftGrant("synthetic-entry-grant",f.binding,setOf("incident","photo","check_in"),0,SystemClock.elapsedRealtime()+60000,1))
  field(a,"captureAnchor",ServerTimeAnchor(f.epoch,SystemClock.elapsedRealtime(),1))
  GuardAccountActivity::class.java.getDeclaredMethod("captureScreen",JSONObject::class.java).apply{isAccessible=true;invoke(a,f.item())}
  return session
 }
 private fun assertLocked(a:GuardAccountActivity,session:GuardAccountClient.Session,oldRoot:View,cancellation:CancellationSignal,oldGeneration:Int){
  for(key in listOf("session","accountIdentity","accountAnchor","captureGrant","captureBinding","captureAnchor","signal","password"))assertNull(key,value(a,key))
  try{session.bearer();fail("Entry kept a foreground bearer")}catch(_:IllegalStateException){}
  assertTrue(cancellation.isCanceled);assertTrue((value(a,"generation") as Int)>oldGeneration);assertEquals(false,value(a,"busy"))
  assertNotSame(oldRoot,value(a,"root"));assertTrue(texts(oldRoot).all{it.isEmpty()});assertTrue(texts(a.window.decorView).contains("GUARD SIGN-IN"))
  assertFalse(tree(a.window.decorView).filterIsInstance<EditText>().any{it.hint?.toString() in setOf("Guard ID","Password")})
  assertTrue(tree(a.window.decorView).filterIsInstance<Button>().any{it.text.toString()=="Verify with biometrics"});assertNull(value(a,"signal"))
 }

 @Test fun rapidRealNewIntentClearsForegroundStateAndOldListenersWithoutWaitingForStop(){configured{f->
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->scenario.onActivity{a->
   val old=present(a,f);val oldRoot=value(a,"root") as ViewGroup;val generation=value(a,"generation") as Int
   val cancellation=CancellationSignal();field(a,"signal",cancellation);field(a,"busy",true)
   val password=EditText(a).apply{setText("synthetic-private-input")};field(a,"password",password);oldRoot.addView(password)
   var obsoleteClicks=0;val obsolete=Button(a).apply{text="Synthetic obsolete action";setOnClickListener{obsoleteClicks++}};oldRoot.addView(obsolete)
   instrumentation.callActivityOnNewIntent(a,Intent(a,GuardAccountActivity::class.java).putExtra("open_attention",true))
   assertLocked(a,old,oldRoot,cancellation,generation);assertEquals(false,value(a,"stopped"));assertEquals("",password.text.toString());assertFalse(obsolete.performClick());assertEquals(0,obsoleteClicks)
   // No pause/stop or biometric callback was needed to establish this fence.
   instrumentation.callActivityOnResume(a);assertTrue(texts(a.window.decorView).contains("GUARD SIGN-IN"));assertNull(value(a,"signal"))
  }}
 }}

 @Test fun registryFencesTwoActualTaskInstancesAndPreservesTheFirstOriginalCameraFile(){configured{f->
  val firstIntent=Intent(context,GuardAccountActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
  ActivityScenario.launch<GuardAccountActivity>(firstIntent).use{first->
   lateinit var a:GuardAccountActivity;lateinit var originalPending:Any
   val file=File(context.cacheDir,"capture/account/attention-live-first-${UUID.randomUUID()}.jpg");val orphan=File(context.cacheDir,"capture/account/attention-abandoned-${UUID.randomUUID()}.jpg");val bytes=byteArrayOf(7,8,9,10)
   first.onActivity{
    a=it;present(a,f);file.parentFile!!.mkdirs();file.writeBytes(bytes);orphan.writeBytes(byteArrayOf(0,1,2))
    val type=GuardAccountActivity::class.java.declaredClasses.single{it.simpleName=="PendingPhoto"}
    originalPending=type.getDeclaredConstructor(File::class.java,GrantBinding::class.java,VerifiedShiftGrant::class.java,ServerTimeAnchor::class.java,AuthorizedCheckInEvidence::class.java,ConnectedDispatchOwner::class.java)
     .apply{isAccessible=true}.newInstance(file,f.binding,value(a,"captureGrant"),value(a,"captureAnchor"),null,f.owner)
    field(a,"pendingPhoto",originalPending)
   }
   try{
    val secondIntent=Intent(context,GuardAccountActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
    ActivityScenario.launch<GuardAccountActivity>(secondIntent).use{second->second.onActivity{b->
     assertNotSame(a,b);assertNotEquals(a.taskId,b.taskId);assertFalse(a.isDestroyed);assertFalse(b.isDestroyed)
     // The second onCreate must not classify a live first window's camera output as abandoned.
     assertArrayEquals(bytes,file.readBytes());assertSame(originalPending,value(a,"pendingPhoto"));assertFalse("Unowned abandoned output was retained",orphan.exists())
     assertEquals(f.owner,originalPending.javaClass.getDeclaredField("owner").apply{isAccessible=true}.get(originalPending))
     // Framework resume callbacks model the API29+ multi-resumed race; no device window mode is claimed.
     instrumentation.callActivityOnResume(a)
     val oldA=present(a,f);val oldB=present(b,f);val rootA=value(a,"root") as View;val rootB=value(b,"root") as View
     val generationA=value(a,"generation") as Int;val generationB=value(b,"generation") as Int
     val cancelA=CancellationSignal();val cancelB=CancellationSignal();field(a,"signal",cancelA);field(b,"signal",cancelB)
     ConnectedAttentionAccountLock.lockAll()
     assertLocked(a,oldA,rootA,cancelA,generationA);assertLocked(b,oldB,rootB,cancelB,generationB)
     assertEquals(false,value(a,"stopped"));assertEquals(false,value(b,"stopped"));assertNull(value(a,"signal"));assertNull(value(b,"signal"))
     assertArrayEquals(bytes,file.readBytes());assertSame(originalPending,value(a,"pendingPhoto"))
     assertEquals(f.owner,originalPending.javaClass.getDeclaredField("owner").apply{isAccessible=true}.get(originalPending))
    }}
   }finally{instrumentation.runOnMainSync{field(a,"pendingPhoto",null)};if(file.exists())assertTrue(file.delete());if(orphan.exists())assertTrue(orphan.delete())}
  }
 }}

 @Test fun attentionEntryPreservesEncryptedDraftAndOriginalPendingPhotoFileAndFullOwner(){configured{f->
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->scenario.onActivity{a->
   val old=present(a,f);val oldRoot=value(a,"root") as View;val generation=value(a,"generation") as Int
   val draft="Attention draft ${UUID.randomUUID()} — café 🚨";val editor=tree(oldRoot).filterIsInstance<EditText>().single{it.hint?.toString()=="Describe the incident"};editor.setText(draft)
   val file=File(context.cacheDir,"capture/account/attention-entry-${UUID.randomUUID()}.jpg");file.parentFile!!.mkdirs();val bytes=byteArrayOf(1,2,3,4);file.writeBytes(bytes)
   val type=GuardAccountActivity::class.java.declaredClasses.single{it.simpleName=="PendingPhoto"}
   val pending=type.getDeclaredConstructor(File::class.java,GrantBinding::class.java,VerifiedShiftGrant::class.java,ServerTimeAnchor::class.java,AuthorizedCheckInEvidence::class.java,ConnectedDispatchOwner::class.java)
    .apply{isAccessible=true}.newInstance(file,f.binding,value(a,"captureGrant"),value(a,"captureAnchor"),null,f.owner)
   val cancellation=CancellationSignal();field(a,"signal",cancellation)
   try{
    field(a,"pendingPhoto",pending);instrumentation.callActivityOnNewIntent(a,Intent(a,GuardAccountActivity::class.java))
    assertLocked(a,old,oldRoot,cancellation,generation);assertSame(pending,value(a,"pendingPhoto"));assertArrayEquals(bytes,file.readBytes())
    assertEquals(f.owner,type.getDeclaredField("owner").apply{isAccessible=true}.get(pending));assertEquals("",editor.text.toString())
    ConnectedIncidentDraftStore(context).use{db->assertEquals(draft,db.read(f.draftOwner));db.readableDatabase.rawQuery("SELECT body FROM drafts WHERE owner=?",arrayOf(f.draftOwner.owner())).use{row->assertTrue(row.moveToFirst());assertFalse(row.getString(0).contains(draft))}}
    present(a,f);assertEquals(draft,tree(a.window.decorView).filterIsInstance<EditText>().single{it.hint?.toString()=="Describe the incident"}.text.toString());assertSame(pending,value(a,"pendingPhoto"))
   }finally{field(a,"pendingPhoto",null);assertTrue(file.delete())}
  }}
 }}
}
