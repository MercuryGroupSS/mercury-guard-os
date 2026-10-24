package ca.mercury.guard

import android.app.AlertDialog
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
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID

/** Framework lifecycle dispatch with a synthetic account scope. No network or biometric success. */
class GuardAccountDepartureTest {
 private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
 private val context get()=instrumentation.targetContext
 private fun field(a:GuardAccountActivity,key:String,value:Any?){GuardAccountActivity::class.java.getDeclaredField(key).apply{isAccessible=true;set(a,value)}}
 private fun value(a:GuardAccountActivity,key:String)=GuardAccountActivity::class.java.getDeclaredField(key).apply{isAccessible=true}.get(a)
 private fun tree(v:View):List<View> = listOf(v)+if(v is ViewGroup)(0 until v.childCount).flatMap{tree(v.getChildAt(it))}else emptyList()
 private fun texts(v:View)=tree(v).filterIsInstance<TextView>().map{it.text.toString()}
 private class Fixture(val config:GuardServiceConfig,val owner:ConnectedIncidentDraftScope){
  val binding=GrantBinding(owner.guardId,owner.siteId,owner.assignmentId,owner.thumbprint,1)
  val scope=DispatchScope(binding,owner.vendorId)
  val epoch=1730000000000L
  fun item()=JSONObject().put("guardId",owner.guardId).put("vendorId",owner.vendorId).put("siteId",owner.siteId).put("assignmentId",owner.assignmentId)
   .put("deviceThumbprint",owner.thumbprint).put("revocationVersion",1).put("startsAt",epoch-60000).put("endsAt",epoch+3600000)
   .put("status_server_time_ms",epoch).put("status_elapsed_ms",SystemClock.elapsedRealtime())
 }
 private fun configured(run:(Fixture)->Unit){
  val identity=DeviceIdentity(context);val existing=identity.publicIdentity();val key=existing?:identity.create()
  val public=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair().public
  val config=GuardServiceConfig.parse(JSONObject().put("endpoint","https://departure-ui.invalid").put("issuer","departure-test").put("audience","departure-test").put("device_id","departure-phone")
   .put("issuer_keys",JSONObject().put("test",Base64.getUrlEncoder().withoutPadding().encodeToString(public.encoded))).toString())
  val fixture=Fixture(config,ConnectedIncidentDraftScope(config.uploadBinding(),config.deviceId,key.thumbprint,UUID.randomUUID().toString(),"departure-guard","departure-company","departure-site","departure-${UUID.randomUUID()}"))
  try{run(fixture)}finally{
   ConnectedIncidentDraftStore(context).use{store->store.read(fixture.owner)?.let{store.clear(fixture.owner,it)}}
   val owner=MessageDigest.getInstance("SHA-256").digest((fixture.scope.json().toString()+"\nend").toByteArray()).joinToString(""){"%02x".format(it.toInt()and 255)}
   ShiftTransitionStore(context).use{it.writableDatabase.delete("transitions","owner=?",arrayOf(owner))}
   if(existing==null){check(identity.publicIdentity()==key);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry("mercury.device.signing.v1")};File(context.noBackupFilesDir,"device-identity-v1").delete();File(context.noBackupFilesDir,"device-identity-v1.bak").delete()}
  }
 }
 private fun present(a:GuardAccountActivity,f:Fixture):GuardAccountClient.Session {
  val type=GuardAccountActivity::class.java.declaredClasses.single{it.simpleName=="AccountIdentity"}
  val identity=type.getDeclaredConstructor(String::class.java,String::class.java,String::class.java).apply{isAccessible=true}.newInstance(f.owner.subject,f.owner.guardId,f.owner.vendorId)
  val session=GuardAccountClient.Session("synthetic-departure-no-network",SystemClock.elapsedRealtime()+60000)
  field(a,"config",f.config);field(a,"session",session);field(a,"accountIdentity",identity);field(a,"captureBinding",f.binding)
  field(a,"captureGrant",VerifiedShiftGrant("synthetic-departure-grant",f.binding,setOf("incident"),0,SystemClock.elapsedRealtime()+60000,1))
  field(a,"captureAnchor",ServerTimeAnchor(f.epoch,SystemClock.elapsedRealtime(),1))
  GuardAccountActivity::class.java.getDeclaredMethod("captureScreen",JSONObject::class.java).apply{isAccessible=true;invoke(a,f.item())}
  return session
 }
 private fun assertLocked(a:GuardAccountActivity,old:GuardAccountClient.Session){
  for(key in listOf("session","accountIdentity","captureGrant","captureBinding","captureAnchor","signal","password"))assertNull(key,value(a,key))
  try{old.bearer();fail("Departure retained the original bearer")}catch(_:IllegalStateException){}
  assertFalse(texts(a.window.decorView).contains("AUTHORIZED ASSIGNMENT"))
  assertFalse(tree(a.window.decorView).filterIsInstance<EditText>().any{it.hint?.toString() in setOf("Guard ID","Password")})
 }
 @Test fun frameworkDepartureLocksBeforePauseOrStopAndRapidResumeRequiresPassiveReauthentication(){configured{f->
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->scenario.onActivity{a->
   val old=present(a,f);val originalRoot=value(a,"root") as View;val before=value(a,"generation") as Int
   val cancellation=CancellationSignal();field(a,"signal",cancellation);field(a,"busy",true)
   val password=EditText(a).apply{setText("synthetic-only-private-input")};field(a,"password",password)
   instrumentation.callActivityOnUserLeaving(a)
   assertLocked(a,old);assertTrue(cancellation.isCanceled);assertEquals("",password.text.toString());assertTrue((value(a,"generation") as Int)>before)
   assertEquals(true,value(a,"stopped"));assertEquals(false,value(a,"busy"));assertTrue(texts(originalRoot).all{it.isEmpty()});assertTrue(texts(a.window.decorView).contains("ACCOUNT LOCKED"))
   // Dispatch the pause/resume callbacks directly; deliberately never dispatch onStop in this race.
   instrumentation.callActivityOnPause(a);instrumentation.callActivityOnResume(a)
   assertLocked(a,old);assertTrue(texts(a.window.decorView).contains("GUARD SIGN-IN"));assertNull(value(a,"signal"))
   assertTrue(tree(a.window.decorView).filterIsInstance<Button>().any{it.text.toString()=="Verify with biometrics"})
  }}
 }}
 @Test fun systemPauseWithoutUserDepartureDoesNotCancelVerificationOrTurnIntoSignOut(){configured{f->
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->scenario.onActivity{a->
   val old=present(a,f);val before=value(a,"generation");val grant=value(a,"captureGrant");val cancellation=CancellationSignal();field(a,"signal",cancellation)
   instrumentation.callActivityOnPause(a)
   assertSame(old,value(a,"session"));assertSame(grant,value(a,"captureGrant"));assertEquals(before,value(a,"generation"));assertFalse(cancellation.isCanceled)
   instrumentation.callActivityOnResume(a)
   assertSame(old,value(a,"session"));assertSame(cancellation,value(a,"signal"));assertTrue(texts(a.window.decorView).contains("AUTHORIZED ASSIGNMENT"))
  }}
 }}
 @Test fun homeDismissesOwnedReasonWithoutActionAndPreservesEncryptedDraftAndOriginalTransition(){configured{f->
  val draft="Departure draft ${UUID.randomUUID()} — café 🚨"
  val pending=ShiftTransitionStore(context).use{it.prepare(f.scope,"end","Previously confirmed synthetic request")}.toString()
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->scenario.onActivity{a->
   val old=present(a,f);val editor=tree(a.window.decorView).filterIsInstance<EditText>().single{it.hint?.toString()=="Describe the incident"};editor.setText(draft)
   GuardAccountActivity::class.java.getDeclaredMethod("earlyExit",JSONObject::class.java,DispatchScope::class.java).apply{isAccessible=true;invoke(a,f.item(),f.scope)}
   val dialog=value(a,"ownedDialog") as AlertDialog
   val oldPositive=dialog.getButton(AlertDialog.BUTTON_POSITIVE)
   val reason=tree(dialog.window!!.decorView).filterIsInstance<EditText>().single();reason.setText("Unsubmitted transient reason")
   instrumentation.callActivityOnUserLeaving(a)
   assertLocked(a,old);assertFalse(dialog.isShowing);assertNull(value(a,"ownedDialog"));assertEquals("",editor.text.toString());assertEquals("",reason.text.toString())
   assertFalse("Departed dialog retained its action",oldPositive.performClick())
   assertEquals(draft,ConnectedIncidentDraftStore(context).use{it.read(f.owner)})
   ConnectedIncidentDraftStore(context).use{store->store.readableDatabase.rawQuery("SELECT body FROM drafts WHERE owner=?",arrayOf(f.owner.owner())).use{row->assertTrue(row.moveToFirst());assertFalse(row.getString(0).contains(draft))}}
   assertEquals(pending,ShiftTransitionStore(context).use{it.saved(f.scope,"end")!!.getJSONObject("request").toString()})
   instrumentation.callActivityOnPause(a);instrumentation.callActivityOnResume(a)
   assertEquals(draft,ConnectedIncidentDraftStore(context).use{it.read(f.owner)});assertTrue(texts(a.window.decorView).contains("GUARD SIGN-IN"))
   present(a,f);assertEquals(draft,tree(a.window.decorView).filterIsInstance<EditText>().single{it.hint?.toString()=="Describe the incident"}.text.toString())
  }}
 }}
 @Test fun departureDoesNotDiscardPreviouslyAuthorizedPendingCameraOutput(){configured{f->
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->scenario.onActivity{a->
   val old=present(a,f);val file=File(context.cacheDir,"departure-output-${UUID.randomUUID()}.jpg");val bytes=byteArrayOf(1,2,3,4);file.writeBytes(bytes)
   val type=GuardAccountActivity::class.java.declaredClasses.single{it.simpleName=="PendingPhoto"}
   val originalOwner=ConnectedDispatchOwner(f.config.uploadBinding(),f.config.deviceId,f.owner.subject,f.scope)
   val pending=type.getDeclaredConstructor(File::class.java,GrantBinding::class.java,VerifiedShiftGrant::class.java,ServerTimeAnchor::class.java,AuthorizedCheckInEvidence::class.java,ConnectedDispatchOwner::class.java).apply{isAccessible=true}.newInstance(file,f.binding,value(a,"captureGrant"),value(a,"captureAnchor"),null,originalOwner)
   try{
    field(a,"pendingPhoto",pending);instrumentation.callActivityOnUserLeaving(a)
    assertLocked(a,old);assertSame(pending,value(a,"pendingPhoto"));assertArrayEquals(bytes,file.readBytes())
   }finally{field(a,"pendingPhoto",null);assertTrue(file.delete())}
  }}
 }}
}
