package ca.mercury.guard

import android.app.Activity
import android.content.Intent
import android.hardware.biometrics.BiometricManager
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.EditText
import android.widget.TextView
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.URL
import java.security.KeyStore
import javax.net.ssl.HttpsURLConnection

/** Actual launcher, platform strong biometric and visible credentials; no Auth/session injection. */
class HttpsSignInIntegrationTest {
 private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
 private val context get()=instrumentation.targetContext
 private var stage="initial"
 private fun waitFor(label:String,timeout:Long=20000,check:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){if(check())return;SystemClock.sleep(100)};assertTrue(label,check())}
 private fun activity():Activity?{var result:Activity?=null;instrumentation.runOnMainSync{result=ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).singleOrNull{it.packageName==context.packageName}};return result}
 private fun tree(view:View):List<View> = listOf(view)+(if(view is ViewGroup)(0 until view.childCount).flatMap{tree(view.getChildAt(it))}else emptyList())
 private fun hasText(value:String,prefix:Boolean=false):Boolean{var found=false;instrumentation.runOnMainSync{val a=ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).singleOrNull{it.packageName==context.packageName};found=a?.let{tree(it.window.decorView).filterIsInstance<TextView>().any{v->if(prefix)v.text.toString().startsWith(value)else v.text.toString()==value}}?:false};return found}
 private fun hasCredentials():Boolean{var found=false;instrumentation.runOnMainSync{val a=ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).singleOrNull{it.packageName==context.packageName};found=a?.let{tree(it.window.decorView).filterIsInstance<EditText>().any{v->v.hint?.toString() in setOf("Guard ID","Password")}}?:false};return found}
 private data class Geometry(val visible:Boolean,val y:Int,val windowTop:Int)
 private fun geometry(label:String):Geometry?{var found:Geometry?=null;instrumentation.runOnMainSync{val a=ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).singleOrNull{it.packageName==context.packageName};val v=a?.let{tree(it.window.decorView).filterIsInstance<TextView>().singleOrNull{v->v.text.toString()==label}};if(a!=null&&v!=null&&v.isLaidOut&&v.width>0&&v.height>0){val clipped=android.graphics.Rect();val bounds=android.graphics.Rect();a.window.decorView.getWindowVisibleDisplayFrame(bounds);val at=IntArray(2);v.getLocationOnScreen(at);val visible=v.getGlobalVisibleRect(clipped)&&clipped.width()>=v.width*.9&&clipped.height()>=v.height*.9;found=Geometry(visible,at[1],bounds.top)}};return found}
 private fun click(label:String){
  waitFor("Account action never completed actual layout"){geometry(label)!=null}
  for(i in 0..8){val g=geometry(label)?:error("Action layout disappeared");if(g.visible){onView(withText(label)).perform(click());return};check(i<8){"Action remained outside the visible viewport"};onView(isAssignableFrom(android.widget.ScrollView::class.java)).perform(if(g.y<g.windowTop)swipeDown()else swipeUp());instrumentation.waitForIdleSync()}
 }
 private fun systemPrompt():Boolean=instrumentation.uiAutomation.rootInActiveWindow?.findAccessibilityNodeInfosByText("Unlock guard sign-in")?.any{it.packageName?.toString()=="com.android.systemui"}==true
 private fun finger(step:String){
  val request=File(context.filesDir,"signin-test-step");val ack=File(context.filesDir,"signin-test-ack-$step");ack.delete();request.writeText(step)
  waitFor("Host sensor input was not acknowledged",15000){ack.exists()};request.delete();ack.delete()
 }
 private fun unlock(step:String){click("Verify with biometrics");waitFor("Real system biometric prompt did not appear"){systemPrompt()};assertFalse("Credentials exposed before biometric",hasCredentials());finger(step);waitFor("Actual biometric success did not reveal credential form"){hasText("YOUR GUARD ACCOUNT")};assertTrue(hasCredentials())}
 private fun fixture(metadata:JSONObject,path:String,body:JSONObject?=null):JSONObject{
  val c=URL("https://localhost:55450$path").openConnection() as HttpsURLConnection
  try{c.connectTimeout=10000;c.readTimeout=15000;c.instanceFollowRedirects=false;c.setRequestProperty("X-Mercury-Test-Nonce",metadata.getString("test_nonce"));if(body!=null){c.requestMethod="POST";c.doOutput=true;c.setRequestProperty("Content-Type","application/json");c.outputStream.use{it.write(body.toString().toByteArray(Charsets.UTF_8))}};check(c.responseCode==200){"Synthetic fixture operation rejected"};return JSONObject(c.inputStream.bufferedReader().use{it.readText()})}finally{c.disconnect()}
 }
 private fun login(id:String,password:String){onView(withHint("Guard ID")).perform(replaceText(id));onView(withHint("Password")).perform(replaceText(password),closeSoftKeyboard());click("Sign in")}
 private fun launch(){val intent=context.packageManager.getLaunchIntentForPackage(context.packageName)?:error("Real launcher absent");assertEquals(LauncherActivity::class.java.name,intent.component?.className);context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));waitFor("Configured launcher did not reach account flow"){activity() is GuardAccountActivity}}
 @Test fun actualStrongBiometricThenIndividualGuardAccountsShareCompanyWithoutSharingIdentity(){
  assumeTrue(InstrumentationRegistry.getArguments().getString("signinIntegration")=="true")
  // Reject a wrong target before entering any authority/UI cleanup boundary.
  check(context.packageName=="ca.mercury.guard.httpstest");check(android.os.Build.VERSION.SDK_INT==35)
  val qemu=instrumentation.uiAutomation.executeShellCommand("getprop ro.kernel.qemu").use{fd->java.io.FileInputStream(fd.fileDescriptor).use{String(it.readBytes()).trim()}};check(qemu=="1")
  val metadata=JSONObject(instrumentation.context.assets.open("signin-test-fixture.json").bufferedReader().use{it.readText()});check(metadata.getString("fixture_type")=="real_pg_auth_signin")
  val config=GuardServiceConfig.load(context)?:error("Trusted debug configuration absent");check(config.endpoint=="https://localhost:55450")
  val manager=context.getSystemService(BiometricManager::class.java);check(manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)==BiometricManager.BIOMETRIC_SUCCESS)
  val identity=DeviceIdentity(context);check(identity.publicIdentity()==null){"First-use fixture requires a fresh owned test installation"}
  val guards=metadata.getJSONArray("guards");val a=guards.getJSONObject(0);val b=guards.getJSONObject(1);check(a.getString("guard_id")!=b.getString("guard_id"))
  var createdIdentity=false
  try{
   stage="first_use_launcher";launch();waitFor("First-use enrollment screen absent"){hasText("PHONE ENROLLMENT")};assertFalse(hasCredentials())
   createdIdentity=true;click("Prepare phone identity");waitFor("Visible public identity preparation failed"){hasText("ENROLLMENT DETAILS")};val public=identity.publicIdentity()?:error("Public identity absent after button")
   fixture(metadata,"/test/enroll",JSONObject().put("public_key_spki",public.publicKeySpki));click("Continue to sign-in");waitFor("Guard sign-in screen absent"){hasText("GUARD SIGN-IN")};assertFalse(hasCredentials())
   stage="biometric_button";click("Verify with biometrics");stage="biometric_prompt_initial";waitFor("Platform biometric prompt absent"){systemPrompt()}
   stage="biometric_cancel_control"
   val cancel=instrumentation.uiAutomation.rootInActiveWindow?.findAccessibilityNodeInfosByText("Cancel")?.firstOrNull{it.packageName?.toString()=="com.android.systemui"&&it.isClickable}?:error("System cancel control absent")
   check(cancel.performAction(AccessibilityNodeInfo.ACTION_CLICK));stage="biometric_cancel_result";waitFor("Cancel did not dismiss platform gate"){!systemPrompt()};assertFalse("Cancel revealed credentials",hasCredentials());assertTrue(hasText("GUARD SIGN-IN"))
   stage="unknown_fingerprint";click("Verify with biometrics");waitFor("Platform biometric retry absent"){systemPrompt()};finger("unknown_finger");SystemClock.sleep(400);assertTrue("Unknown finger dismissed the gate",systemPrompt());assertFalse("Unknown finger revealed credentials",hasCredentials())
   stage="strong_fingerprint_a";finger("valid_finger_a");waitFor("Enrolled fingerprint did not unlock form"){hasText("YOUR GUARD ACCOUNT")};assertTrue(hasCredentials())
   stage="company_vendor_denied";login(metadata.getString("vendor_id"),metadata.getString("password"));waitFor("Actual company vendor login did not fail"){hasText("Sign-in failed or is temporarily unavailable.",true)};assertNull(UploadAuthorityStore(context).load(config,public.thumbprint));assertEquals(1,fixture(metadata,"/test/stats").getInt("vendor_login_denied"))
   stage="guard_a_login";login(a.getString("guard_id"),metadata.getString("password"));waitFor("Guard A assignments were not verified"){hasText("Guard: "+a.getString("guard_id"),true)}
   assertTrue(hasText(metadata.getString("site_id")+" · "+a.getString("assignment_id")));assertFalse(hasText(metadata.getString("site_id")+" · "+b.getString("assignment_id")))
   val authorityA=UploadAuthorityStore(context).load(config,public.thumbprint)?:error("Guard A verified authority absent");assertEquals(a.getString("guard_id"),authorityA.guardId);assertEquals(metadata.getString("vendor_id"),authorityA.vendorId)
   stage="background_exit";instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_HOME").use{fd->java.io.FileInputStream(fd.fileDescriptor).use{it.readBytes()}};waitFor("Account did not leave foreground"){activity()==null}
   stage="background_return_launcher";launch();waitFor("Background return did not relock account"){hasText("GUARD SIGN-IN")}
   stage="background_field_lock";assertFalse("Background exposed credentials",hasCredentials());assertFalse(hasText("YOUR ASSIGNMENTS"))
   stage="guard_switch_biometric";unlock("valid_finger_b");waitFor("Switch retained prior upload authority"){UploadAuthorityStore(context).load(config,public.thumbprint)==null}
   stage="guard_b_login";login(b.getString("guard_id"),metadata.getString("password"));waitFor("Guard B assignments were not verified"){hasText("Guard: "+b.getString("guard_id"),true)}
   assertTrue(hasText(metadata.getString("site_id")+" · "+b.getString("assignment_id")));assertFalse(hasText(metadata.getString("site_id")+" · "+a.getString("assignment_id")))
   val authorityB=UploadAuthorityStore(context).load(config,public.thumbprint)?:error("Guard B verified authority absent");assertEquals(b.getString("guard_id"),authorityB.guardId);assertEquals(authorityA.vendorId,authorityB.vendorId);assertNotEquals(authorityA.subject,authorityB.subject);assertNotEquals(authorityA.generation,authorityB.generation)
   stage="explicit_signout";click("Sign out");waitFor("Explicit sign-out did not relock UI"){hasText("GUARD SIGN-IN")};assertFalse(hasCredentials());assertNull(UploadAuthorityStore(context).load(config,public.thumbprint))
   stage="logout_server_confirmation"
   waitFor("Original real Auth sessions were not revoked",30000){val stats=fixture(metadata,"/test/stats");stats.getJSONObject("logged_out_session_denied").getInt("a")>=1&&stats.getJSONObject("logged_out_session_denied").getInt("b")>=1}
   stage="service_read_counts";val stats=fixture(metadata,"/test/stats");assertTrue(stats.getBoolean("company_vendor"));assertTrue(stats.getBoolean("distinct_subjects"));assertEquals(1,stats.getInt("enrollments"));for(label in listOf("a","b")){assertEquals(1,stats.getJSONObject("logins").getInt(label));assertTrue(stats.getJSONObject("assignments").getInt(label)>=1);assertTrue(stats.getJSONObject("profiles").getInt(label)>=1)} // Durable upload re-verification may legitimately read again.
   instrumentation.addResults(android.os.Bundle().apply{putString("mercury_signin_acceptance","SIGNIN_ACCEPTANCE actual_launcher=true actual_platform_strong_biometric=true cancel_denied=true unknown_finger_denied=true individual_guard_accounts=2 company_vendor_not_login=true background_relocked=true switched_identity_isolated=true exact_sessions_revoked=true")})
  }catch(error:Throwable){throw AssertionError("Actual sign-in acceptance failed at bounded stage: $stage; failure_type=${error.javaClass.simpleName}; credential UI diagnostics intentionally withheld")}
  finally{
   File(context.filesDir,"signin-test-step").delete();context.filesDir.listFiles()?.filter{it.name.startsWith("signin-test-ack-")}?.forEach{it.delete()};UploadCoordinator(context).stop()
   instrumentation.runOnMainSync{for(s in Stage.values())for(a in ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(s).toList().filter{it.packageName==context.packageName}){tree(a.window.decorView).filterIsInstance<EditText>().forEach{it.text.clear()};if(!a.isFinishing)a.finish()}}
   if(createdIdentity){KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry("mercury.device.signing.v1")};File(context.noBackupFilesDir,"device-identity-v1").delete();File(context.noBackupFilesDir,"device-identity-v1.bak").delete()}
  }
 }
}
