package ca.mercury.guard

import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.util.Base64
import java.util.UUID

/** Presentation/clock only: synthetic verified scope, no network, attendance confirmation or hardware biometric claims. */
class ConnectedShiftControlsTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private fun field(activity:GuardAccountActivity,name:String,value:Any){GuardAccountActivity::class.java.getDeclaredField(name).apply{isAccessible=true;set(activity,value)}}
 private fun call(activity:GuardAccountActivity,name:String,item:JSONObject){GuardAccountActivity::class.java.getDeclaredMethod(name,JSONObject::class.java).apply{isAccessible=true;invoke(activity,item)}}
 private fun tree(view:View):List<View> = listOf(view)+if(view is ViewGroup)(0 until view.childCount).flatMap{tree(view.getChildAt(it))}else emptyList()
 private fun control(activity:GuardAccountActivity,title:String)=tree(activity.window.decorView).filterIsInstance<Button>().singleOrNull{it.text.toString()==title}
 private fun press(activity:GuardAccountActivity,title:String){assertTrue("Real control missing: $title",control(activity,title)?.performClick()==true)}
 private fun item(after:Long,thumb:String="b".repeat(64),active:Boolean=true):JSONObject {
  val epoch=1730000000000L
  return JSONObject().put("guardId","clock-guard").put("vendorId","clock-company").put("siteId","clock-site").put("assignmentId","clock-${UUID.randomUUID()}")
   .put("deviceThumbprint",thumb).put("revocationVersion",1).put("assignmentActive",active).put("startsAt",epoch-60000).put("endsAt",epoch+after)
   .put("status_server_time_ms",epoch).put("status_elapsed_ms",SystemClock.elapsedRealtime())
   .put("shift_state",JSONObject().put("state","active").put("clocked_in_at_ms",epoch-60000).put("clocked_out_at_ms",JSONObject.NULL))
 }
 private fun scope(item:JSONObject)=DispatchScope(GrantBinding(item.getString("guardId"),item.getString("siteId"),item.getString("assignmentId"),item.getString("deviceThumbprint"),1),item.getString("vendorId"))
 private fun waitClock(scenario:ActivityScenario<GuardAccountActivity>){
  val limit=SystemClock.elapsedRealtime()+10000
  while(SystemClock.elapsedRealtime()<limit){var found=false;scenario.onActivity{found=control(it,"Clock out")!=null};if(found)return;SystemClock.sleep(50)}
  fail("Visible deadline did not reveal Clock out")
 }
 private fun account(activity:GuardAccountActivity,config:GuardServiceConfig):String{
  val type=GuardAccountActivity::class.java.declaredClasses.single{it.simpleName=="AccountIdentity"}
  val subject=UUID.randomUUID().toString();val identity=type.getDeclaredConstructor(String::class.java,String::class.java,String::class.java).apply{isAccessible=true}.newInstance(subject,"clock-guard","clock-company")
  field(activity,"config",config);field(activity,"accountIdentity",identity);field(activity,"session",GuardAccountClient.Session("synthetic-clock-no-network",SystemClock.elapsedRealtime()+60000));return subject
 }
 private fun configured(action:(GuardServiceConfig,String)->Unit){
  val device=DeviceIdentity(context);val existing=device.publicIdentity();val identity=existing?:device.create()
  val key=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair().public
  val config=GuardServiceConfig.parse(JSONObject().put("endpoint","https://clock-ui.invalid").put("issuer","clock-test").put("audience","clock-test").put("device_id","clock-phone")
   .put("issuer_keys",JSONObject().put("clock",Base64.getUrlEncoder().withoutPadding().encodeToString(key.encoded))).toString())
  try{action(config,identity.thumbprint)}finally{if(existing==null){
   check(device.publicIdentity()==identity)
   KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry("mercury.device.signing.v1")}
   File(context.noBackupFilesDir,"device-identity-v1").delete();File(context.noBackupFilesDir,"device-identity-v1.bak").delete()
  }}
 }
 @Test fun earlyExitExistsOnlyInsideAssignedEscalateAndBlankOrCancelledReasonCannotEnd(){configured{config,thumb->
  for(active in listOf(true,false))ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   lateinit var assignment:JSONObject;lateinit var owner:ConnectedDispatchOwner
   scenario.onActivity{val subject=account(it,config);assignment=item(60000,thumb,active);owner=ConnectedDispatchOwner(config.uploadBinding(),config.deviceId,subject,scope(assignment));call(it,"assignmentOverview",assignment);assertNull(control(it,"End shift early"));assertNull(control(it,"Clock out"));press(it,"Escalate");assertNotNull(control(it,"End shift early"));press(it,"End shift early")}
   onView(withId(android.R.id.button1)).inRoot(isDialog()).perform(click())
   onView(withHint("Reason for leaving early")).check{view,_->assertEquals("A reason is required",(view as EditText).error.toString())}
   assertNull(ShiftTransitionStore(context).use{it.saved(owner,"end")})
   onView(withId(android.R.id.button2)).inRoot(isDialog()).perform(click())
   assertNull(ShiftTransitionStore(context).use{it.saved(owner,"end")});assertTrue(assignment.getJSONObject("shift_state").isNull("clocked_out_at_ms"))
  }
 }}
 @Test fun visibleOverviewRevealsClockOutAtDeadlineWithoutAnyAttendanceWrite(){
  lateinit var assignment:JSONObject
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   scenario.onActivity{assignment=item(1000);call(it,"assignmentOverview",assignment);assertNotNull(control(it,"Continue shift"));assertNull(control(it,"Clock out"))}
   waitClock(scenario)
   scenario.onActivity{assertNull(control(it,"Continue shift"));press(it,"Clock out")}
   onView(withId(android.R.id.button2)).inRoot(isDialog()).perform(click())
   assertNull(ShiftTransitionStore(context).use{it.saved(scope(assignment),"end")});assertTrue(assignment.getJSONObject("shift_state").isNull("clocked_out_at_ms"))
  }
 }
 @Test fun pausedClockStopsUpdatingAndResumeRechecksElapsedDeadline(){
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   fun value(activity:GuardAccountActivity,name:String)=GuardAccountActivity::class.java.getDeclaredField(name).apply{isAccessible=true}.get(activity)
   lateinit var shown:JSONObject;var displayedRoot:Any?=null;var stamp:Any?=null;var callback:Any?=null
   scenario.onActivity{activity->
    shown=item(1000);call(activity,"assignmentOverview",shown);displayedRoot=value(activity,"root");stamp=value(activity,"generation");callback=value(activity,"shiftDeadlineRefresh");assertNotNull(callback)
    // ActivityScenario STARTED launches EmptyFloatingActivity as a user departure.
    // This contract is a system pause without departure, as for a system prompt.
    InstrumentationRegistry.getInstrumentation().callActivityOnPause(activity)
    assertEquals(false,value(activity,"visibleForLocation"));assertEquals(false,value(activity,"stopped"));assertSame(callback,value(activity,"shiftDeadlineRefresh"))
   }
   SystemClock.sleep(1300) // Deliberately cross the approved deadline while the callback is paused.
   scenario.onActivity{activity->
    assertNull(control(activity,"Clock out"));assertSame(displayedRoot,value(activity,"root"));assertEquals(stamp,value(activity,"generation"))
    InstrumentationRegistry.getInstrumentation().callActivityOnResume(activity)
    assertSame(displayedRoot,value(activity,"root"));assertEquals(stamp,value(activity,"generation"))
   }
   waitClock(scenario)
   scenario.onActivity{assertNotNull(control(it,"Clock out"));assertNull(control(it,"Continue shift"))}
   assertNull(ShiftTransitionStore(context).use{it.saved(scope(shown),"end")});assertTrue(shown.getJSONObject("shift_state").isNull("clocked_out_at_ms"))
  }
 }
 @Test fun navigatingAwayOrPendingOriginalEndCannotAppendAClockOutControl(){
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   scenario.onActivity{call(it,"assignmentOverview",item(500));press(it,"Escalate")}
   SystemClock.sleep(800);scenario.onActivity{assertNull(control(it,"Clock out"))}
  }
  configured{config,thumb->
   lateinit var assignment:JSONObject;lateinit var original:String
   var cleanupOwner:ConnectedDispatchOwner?=null
   try{ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
    scenario.onActivity{val subject=account(it,config);assignment=item(500,thumb);cleanupOwner=ConnectedDispatchOwner(config.uploadBinding(),config.deviceId,subject,scope(assignment));original=ShiftTransitionStore(context).use{it.prepare(cleanupOwner!!,"end","Original unresolved reason")}.toString();call(it,"assignmentOverview",assignment)}
    SystemClock.sleep(800);scenario.onActivity{assertNotNull(control(it,"Resolve pending end"));assertNull(control(it,"Clock out"))}
    assertEquals(original,ShiftTransitionStore(context).use{it.saved(cleanupOwner!!,"end")!!.getJSONObject("request").toString()})
   }}finally{
    cleanupOwner?.let{savedOwner->
     val key=java.security.MessageDigest.getInstance("SHA-256").digest(("mercury-connected-shift-transition-v1\n"+savedOwner.json().toString()+"\nend").toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
     ShiftTransitionStore(context).use{it.writableDatabase.delete("transitions","owner=?",arrayOf(key))}
    }
   }
  }
 }
 @Test fun authorizedCaptureDeadlinePreservesTheIncidentEditor(){configured{config,thumb->
  var cleanupDraft:ConnectedIncidentDraftScope?=null
  lateinit var draft:ConnectedIncidentDraftScope
  val text="Keep this unfinished incident at scheduled end — café 🚨"
  try{ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   scenario.onActivity{
    account(it,config);val assignment=item(1000,thumb);field(it,"captureBinding",scope(assignment).binding);call(it,"captureScreen",assignment)
    val type=GuardAccountActivity::class.java.getDeclaredField("incidentDraftScope").apply{isAccessible=true};draft=type.get(it) as ConnectedIncidentDraftScope;cleanupDraft=draft
    tree(it.window.decorView).filterIsInstance<EditText>().single{edit->edit.hint.toString()=="Describe the incident"}.setText(text)
   }
   waitClock(scenario)
   scenario.onActivity{assertEquals(text,tree(it.window.decorView).filterIsInstance<EditText>().single{edit->edit.hint.toString()=="Describe the incident"}.text.toString())}
   assertEquals(text,ConnectedIncidentDraftStore(context).use{it.read(draft)})
  }}finally{cleanupDraft?.let{savedDraft->ConnectedIncidentDraftStore(context).use{it.read(savedDraft)?.let{text->it.clear(savedDraft,text)}}}}
 }}
}
