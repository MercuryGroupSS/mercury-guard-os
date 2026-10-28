package ca.mercury.guard

import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Only a synthetic presentation scope is injected; no service/capture action or live credentials. */
class ConnectedIncidentDraftLifecycleTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private fun field(activity:GuardAccountActivity,name:String,value:Any){GuardAccountActivity::class.java.getDeclaredField(name).apply{isAccessible=true;set(activity,value)}}
 private fun present(activity:GuardAccountActivity,config:GuardServiceConfig,scope:ConnectedIncidentDraftScope,item:JSONObject){
  val type=GuardAccountActivity::class.java.declaredClasses.single{it.simpleName=="AccountIdentity"}
  val identity=type.getDeclaredConstructor(String::class.java,String::class.java,String::class.java).apply{isAccessible=true}.newInstance(scope.subject,scope.guardId,scope.vendorId)
  field(activity,"config",config);field(activity,"accountIdentity",identity);field(activity,"session",GuardAccountClient.Session("synthetic-draft-no-network",android.os.SystemClock.elapsedRealtime()+60000))
  field(activity,"captureBinding",GrantBinding(scope.guardId,scope.siteId,scope.assignmentId,scope.thumbprint,1))
  GuardAccountActivity::class.java.getDeclaredMethod("captureScreen",JSONObject::class.java).apply{isAccessible=true;invoke(activity,item)}
 }
 private fun click(activity:GuardAccountActivity,title:String){
  fun find(view:android.view.View):android.widget.Button? {
   if(view is android.widget.Button&&view.text.toString()==title)return view
   if(view is android.view.ViewGroup)for(i in 0 until view.childCount)find(view.getChildAt(i))?.let{return it}
   return null
  }
  assertTrue("Real navigation control missing: $title",find(activity.window.decorView)?.performClick()==true)
 }
 /** Wait for actual layout, then request the exact rectangle from the real scrolling parent. */
 private fun enterDraft(scenario:ActivityScenario<GuardAccountActivity>,text:String){
  fun editor(view:android.view.View):android.widget.EditText? {
   if(view is android.widget.EditText&&view.hint?.toString()=="Describe the incident")return view
   if(view is android.view.ViewGroup)for(i in 0 until view.childCount)editor(view.getChildAt(i))?.let{return it}
   return null
  }
  val measured=CountDownLatch(1)
  var observed:android.view.View?=null;var layoutListener:android.view.View.OnLayoutChangeListener?=null
  scenario.onActivity{activity->
   val target=editor(activity.window.decorView)?:error("Incident editor missing");observed=target
   if(target.isLaidOut&&target.width>0&&target.height>0)measured.countDown()
   else {
    layoutListener=android.view.View.OnLayoutChangeListener{v,_,_,_,_,_,_,_,_->if(v.width>0&&v.height>0)measured.countDown()}
    target.addOnLayoutChangeListener(layoutListener)
   }
  }
  try{check(measured.await(5,TimeUnit.SECONDS)){"Incident editor did not complete layout"}}
  finally{scenario.onActivity{layoutListener?.let{listener->observed?.removeOnLayoutChangeListener(listener)}}}
  androidx.test.espresso.Espresso.closeSoftKeyboard()
  onView(withHint("Describe the incident")).perform(object:androidx.test.espresso.ViewAction{
   override fun getDescription()="scroll the measured incident editor rectangle into its actual viewport"
   override fun getConstraints():org.hamcrest.Matcher<android.view.View> = org.hamcrest.Matchers.allOf(isAssignableFrom(android.widget.EditText::class.java),isDescendantOfA(isAssignableFrom(android.widget.ScrollView::class.java)))
   override fun perform(ui:androidx.test.espresso.UiController,target:android.view.View){
    ui.loopMainThreadUntilIdle()
    check(target.isLaidOut&&target.width>0&&target.height>0){"Incident editor lost its measured layout"}
    var ancestor=target.parent
    while(ancestor is android.view.View&&ancestor !is android.widget.ScrollView)ancestor=ancestor.parent
    val scroll=ancestor as? android.widget.ScrollView?:error("Incident editor scroll parent missing")
    val content=scroll.getChildAt(0) as? android.view.ViewGroup?:error("Incident editor scroll content missing")
    val rectangle=android.graphics.Rect(0,0,target.width,target.height)
    content.offsetDescendantRectToMyCoords(target,rectangle)
    scroll.requestChildRectangleOnScreen(content,rectangle,true)
    ui.loopMainThreadUntilIdle()
    if(!isDisplayingAtLeast(90).matches(target)){
     val visible=android.graphics.Rect();val viewport=android.graphics.Rect();val position=IntArray(2)
     target.getGlobalVisibleRect(visible);scroll.getGlobalVisibleRect(viewport);target.getLocationOnScreen(position)
     // Pixel bounds and booleans only. Never dump editor text, account data or the view hierarchy.
     error("Incident editor visibility: target=${target.width}x${target.height}@${position[0]},${position[1]}; visible=$visible; viewport=$viewport; scrollY=${scroll.scrollY}; contentHeight=${content.height}; canUp=${scroll.canScrollVertically(-1)}; canDown=${scroll.canScrollVertically(1)}")
    }
   }
  }).check(matches(isDisplayingAtLeast(90))).perform(click(),replaceText(text),closeSoftKeyboard())
 }
 @Test fun rotationBackgroundPatrolAndEscalationRecoverOnlyTheOriginalVerifiedIndividualDraft(){
  ConnectedPatrolUiFixture(context).use{
  val suffix=UUID.randomUUID().toString();val key=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair().public
  val config=GuardServiceConfig.parse(JSONObject().put("endpoint","https://example.test").put("issuer","test").put("audience","mercury-local").put("device_id","draft-phone")
   .put("issuer_keys",JSONObject().put("test",Base64.getUrlEncoder().withoutPadding().encodeToString(key.encoded))).toString())
  val scope=ConnectedIncidentDraftScope(config.uploadBinding(),config.deviceId,DeviceIdentity(context).publicIdentity()?.thumbprint?:error("Synthetic presentation identity missing"),UUID.randomUUID().toString(),"draft-guard","draft-vendor","draft-site","draft-$suffix")
  val other=scope.copy(subject=UUID.randomUUID().toString())
  val item=JSONObject().put("guardId",scope.guardId).put("vendorId",scope.vendorId).put("siteId",scope.siteId).put("assignmentId",scope.assignmentId)
   .put("patrolRoute",JSONObject().put("routeId","draft-route").put("revision",1).put("checkpoints",JSONArray().put(JSONObject().put("id","entrance").put("label","Entrance"))))
  val text="Unfinished connected incident — café 🚨\nKeep exact text through navigation."
  try{ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   scenario.onActivity{present(it,config,scope,item)}
   enterDraft(scenario,text)
   assertEquals(text,ConnectedIncidentDraftStore(context).use{it.read(scope)})
   scenario.onActivity{click(it,"Open assigned patrol")};onView(withText("ASSIGNED PATROL")).check(matches(isDisplayed()))
   scenario.onActivity{click(it,"Back to assignment")}
   onView(withHint("Describe the incident")).check(matches(withText(text)))
   scenario.onActivity{click(it,"Escalate")};scenario.onActivity{present(it,config,scope,item)}
   onView(withHint("Describe the incident")).check(matches(withText(text)))
   scenario.recreate();scenario.onActivity{present(it,config,scope,item)}
   onView(withHint("Describe the incident")).check(matches(withText(text)))
   scenario.moveToState(Lifecycle.State.CREATED);scenario.moveToState(Lifecycle.State.RESUMED);scenario.onActivity{present(it,config,scope,item)}
   onView(withHint("Describe the incident")).check(matches(withText(text)))
   scenario.onActivity{present(it,config,other,item)}
   onView(withHint("Describe the incident")).check(matches(withText("")))
   assertEquals(text,ConnectedIncidentDraftStore(context).use{it.read(scope)});assertNull(ConnectedIncidentDraftStore(context).use{it.read(other)})
   scenario.onActivity{present(it,config,scope,item)}
   scenario.onActivity{click(it,"Discard unfinished incident")};onView(withId(android.R.id.button1)).inRoot(androidx.test.espresso.matcher.RootMatchers.isDialog()).perform(click())
   onView(withHint("Describe the incident")).check(matches(withText("")));assertNull(ConnectedIncidentDraftStore(context).use{it.read(scope)})
  }}finally{ConnectedIncidentDraftStore(context).use{store->for(s in listOf(scope,other))store.read(s)?.let{store.clear(s,it)}}}
  }
 }
}
