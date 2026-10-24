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
 @Test fun OldPendingEndDoesNotHideNewApprovedClockInAndFutureApprovalIsNotInvented(){
  val epoch=1730000000000L;val old=assignment("old-${UUID.randomUUID()}",epoch,epoch-1000);val oldScope=scope(old)
  val pending=ShiftTransitionStore(context).use{it.prepare(oldScope,"end","")}.toString()
  val next=assignment("new-${UUID.randomUUID()}",epoch,epoch+60000,"not_started",true)
  try{ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   scenario.onActivity{show(it,old)}
   onView(withText("Resolve pending end")).check(matches(isDisplayed()))
   scenario.onActivity{show(it,next)}
   onView(withText("Clock in")).check(matches(isDisplayed()))
   onView(withText("Resolve pending end")).check(doesNotExist())
   scenario.onActivity{press(it,"Clock in")}
   onView(withId(android.R.id.button1)).inRoot(isDialog()).check(matches(withText("Confirm clock-in")))
   onView(withId(android.R.id.button2)).inRoot(isDialog()).perform(click())
   assertNull(ShiftTransitionStore(context).use{it.saved(scope(next),"start")})
   assertEquals(pending,ShiftTransitionStore(context).use{it.saved(oldScope,"end")!!.getJSONObject("request").toString()})
   val future=assignment("future-${UUID.randomUUID()}",epoch,epoch+120000,"not_started",false).put("startsAt",epoch+60000)
   scenario.onActivity{show(it,future)}
   onView(withText("Clock in")).check(doesNotExist())
   onView(withText("Continue shift")).check(doesNotExist())
   assertTrue(old.getJSONObject("shift_state").isNull("clocked_out_at_ms"))
  }}finally{
   val owner=java.security.MessageDigest.getInstance("SHA-256").digest((oldScope.json().toString()+"\nend").toByteArray()).joinToString(""){"%02x".format(it.toInt() and 255)}
   ShiftTransitionStore(context).use{it.writableDatabase.delete("transitions","owner=?",arrayOf(owner))}
  }
 }
}
