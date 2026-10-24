package ca.mercury.guard

import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.*
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.platform.app.InstrumentationRegistry
import org.hamcrest.Matchers.startsWith
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.util.Base64
import java.util.UUID

/** Synthetic presentation only: opening a screen must not create an attendance transition. */
class ExpiredShiftScreenTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private fun assignment(id:String,epoch:Long,endsAt:Long,state:String="active",canStart:Boolean=false)=JSONObject()
  .put("guardId","history-guard").put("vendorId","shared-company").put("siteId","history-site").put("assignmentId",id)
  .put("deviceThumbprint","b".repeat(64)).put("revocationVersion",1).put("assignmentActive",true)
  .put("startsAt",epoch-60000).put("endsAt",endsAt).put("canStart",canStart)
  .put("status_server_time_ms",epoch).put("status_elapsed_ms",SystemClock.elapsedRealtime())
  .put("shift_state",JSONObject().put("state",state).put("clocked_in_at_ms",if(state=="active")epoch-60000 else JSONObject.NULL).put("clocked_out_at_ms",JSONObject.NULL))
 private fun scope(item:JSONObject)=DispatchScope(GrantBinding(item.getString("guardId"),item.getString("siteId"),item.getString("assignmentId"),item.getString("deviceThumbprint"),1),item.getString("vendorId"))
 private fun account(activity:GuardAccountActivity,config:GuardServiceConfig,subject:String){
  fun field(name:String,value:Any){GuardAccountActivity::class.java.getDeclaredField(name).apply{isAccessible=true;set(activity,value)}}
  val type=GuardAccountActivity::class.java.declaredClasses.single{it.simpleName=="AccountIdentity"}
  field("config",config);field("accountIdentity",type.getDeclaredConstructor(String::class.java,String::class.java,String::class.java).apply{isAccessible=true}.newInstance(subject,"history-guard","shared-company"))
  field("session",GuardAccountClient.Session("synthetic-history-no-network",SystemClock.elapsedRealtime()+60000))
 }
 private fun configured(run:(GuardServiceConfig,String,String)->Unit){
  val identity=DeviceIdentity(context);val existing=identity.publicIdentity();val key=existing?:identity.create()
  val public=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair().public
  val config=GuardServiceConfig.parse(JSONObject().put("endpoint","https://history-ui.invalid").put("issuer","history-test").put("audience","history-test").put("device_id","history-phone")
   .put("issuer_keys",JSONObject().put("test",Base64.getUrlEncoder().withoutPadding().encodeToString(public.encoded))).toString())
  try{run(config,UUID.randomUUID().toString(),key.thumbprint)}finally{if(existing==null){
   check(identity.publicIdentity()==key);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry("mercury.device.signing.v1")}
   File(context.noBackupFilesDir,"device-identity-v1").delete();File(context.noBackupFilesDir,"device-identity-v1.bak").delete()
  }}
 }
 private fun clearPending(owner:ConnectedDispatchOwner,action:String){
  val key=java.security.MessageDigest.getInstance("SHA-256").digest(("mercury-connected-shift-transition-v1\n"+owner.json().toString()+"\n"+action).toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
  ShiftTransitionStore(context).use{it.writableDatabase.delete("transitions","owner=?",arrayOf(key))}
 }
 private fun show(activity:GuardAccountActivity,item:JSONObject){GuardAccountActivity::class.java.getDeclaredMethod("assignmentOverview",JSONObject::class.java).apply{isAccessible=true;invoke(activity,item)}}
 private fun press(activity:GuardAccountActivity,title:String){
  fun find(v:android.view.View):android.widget.Button?{if(v is android.widget.Button&&v.text.toString()==title)return v;if(v is android.view.ViewGroup)for(i in 0 until v.childCount)find(v.getChildAt(i))?.let{return it};return null}
  assertTrue("Missing real control: $title",find(activity.window.decorView)?.performClick()==true)
 }
 @Test fun exactScheduledEndShowsUnconfirmedClockOutWithoutAutoEndOrCapture(){
  val epoch=1730000000000L;val item=assignment("elapsed-${UUID.randomUUID()}",epoch,epoch);val original=item.getJSONObject("shift_state").toString();val s=scope(item)
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   scenario.onActivity{show(it,item)}
   onView(withText(startsWith("Scheduled window elapsed · clock-out unconfirmed."))).check(matches(isDisplayed()))
   onView(withText("Continue shift")).check(doesNotExist())
   onView(withText("Clock in")).check(doesNotExist())
   assertNull(ShiftTransitionStore(context).use{it.saved(s,"end")})
   scenario.onActivity{press(it,"Clock out")}
   onView(withId(android.R.id.button1)).inRoot(isDialog()).check(matches(withText("Confirm clock-out")))
   onView(withId(android.R.id.button2)).inRoot(isDialog()).perform(click())
   assertNull("Viewing/cancelling must not record a clock-out",ShiftTransitionStore(context).use{it.saved(s,"end")})
   assertEquals(original,item.getJSONObject("shift_state").toString())
  }
 }
 @Test fun OldPendingEndDoesNotHideNewApprovedClockInAndFutureApprovalIsNotInvented(){configured{config,subject,thumb->
  val epoch=1730000000000L;val old=assignment("old-${UUID.randomUUID()}",epoch,epoch-1000).put("deviceThumbprint",thumb);val oldScope=scope(old)
  val oldOwner=ConnectedDispatchOwner(config.uploadBinding(),config.deviceId,subject,oldScope)
  val pending=ShiftTransitionStore(context).use{it.prepare(oldOwner,"end","")}.toString()
  val next=assignment("new-${UUID.randomUUID()}",epoch,epoch+60000,"not_started",true).put("deviceThumbprint",thumb)
  val nextOwner=ConnectedDispatchOwner(config.uploadBinding(),config.deviceId,subject,scope(next))
  try{ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   scenario.onActivity{account(it,config,subject);show(it,old)}
   onView(withText("Resolve pending end")).check(matches(isDisplayed()))
   scenario.onActivity{show(it,next)}
   onView(withText("Clock in")).check(matches(isDisplayed()))
   onView(withText("Resolve pending end")).check(doesNotExist())
   scenario.onActivity{press(it,"Clock in")}
   onView(withId(android.R.id.button1)).inRoot(isDialog()).check(matches(withText("Confirm clock-in")))
   onView(withId(android.R.id.button2)).inRoot(isDialog()).perform(click())
   assertNull(ShiftTransitionStore(context).use{it.saved(nextOwner,"start")})
   assertEquals(pending,ShiftTransitionStore(context).use{it.saved(oldOwner,"end")!!.getJSONObject("request").toString()})
   val future=assignment("future-${UUID.randomUUID()}",epoch,epoch+120000,"not_started",false).put("startsAt",epoch+60000).put("deviceThumbprint",thumb)
   scenario.onActivity{show(it,future)}
   onView(withText("Clock in")).check(doesNotExist())
   onView(withText("Continue shift")).check(doesNotExist())
   assertTrue(old.getJSONObject("shift_state").isNull("clocked_out_at_ms"))
  }}finally{
   clearPending(oldOwner,"end")
  }
 }}
 @Test fun originalPendingReasonAndResolveControlNeverMoveToAnotherIndividualWithTheSameGuardId(){configured{config,subject,thumb->
  val epoch=1730000000000L;val item=assignment("pending-owner-${UUID.randomUUID()}",epoch,epoch-1000).put("deviceThumbprint",thumb)
  val original=ConnectedDispatchOwner(config.uploadBinding(),config.deviceId,subject,scope(item));val other=original.copy(subject=UUID.randomUUID().toString())
  val reason="Original individual's unconfirmed reason — café 🚨"
  val request=ShiftTransitionStore(context).use{it.prepare(original,"end",reason)}.toString()
  try{ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   scenario.onActivity{account(it,config,subject);show(it,item)}
   onView(withText("Resolve pending end")).check(matches(isDisplayed()))
   scenario.onActivity{account(it,config,other.subject);show(it,item)}
   onView(withText("Resolve pending end")).check(doesNotExist())
   ShiftTransitionStore(context).use{assertNull(it.saved(other,"end"));assertEquals(request,it.saved(original,"end")!!.getJSONObject("request").toString())}
   scenario.onActivity{account(it,config,subject);show(it,item)}
   onView(withText("Resolve pending end")).check(matches(isDisplayed()))
   val retained=ShiftTransitionStore(context).use{it.saved(original,"end")!!.getJSONObject("request")}
   assertEquals(request,retained.toString());assertEquals(reason,retained.getString("reason"));assertTrue(item.getJSONObject("shift_state").isNull("clocked_out_at_ms"))
  }}finally{clearPending(original,"end")}
 }}
}
