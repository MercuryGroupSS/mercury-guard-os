package ca.mercury.guard

import android.animation.ValueAnimator
import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test

/** Presentation and fail-closed entry only; no biometric success, alarm delivery or live account. */
class ConnectedAttentionViewTest {
 private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
 private val context get()=instrumentation.targetContext
 private fun texts(view:View):List<String> = (if(view is TextView)listOf(view.text.toString())else emptyList())+if(view is ViewGroup)(0 until view.childCount).flatMap{texts(view.getChildAt(it))}else emptyList()
 private fun animator(view:ConnectedCheckInAttentionView)=ConnectedCheckInAttentionView::class.java.getDeclaredField("pulse").apply{isAccessible=true}.get(view) as? ValueAnimator
 @Test fun reducedMotionAndSilenceNeverClaimCompletionOrDelivery(){instrumentation.runOnMainSync{
  val view=ConnectedCheckInAttentionView(context,{false})
  view.present(CheckInAttentionTiming.Stage.GREEN,"opaque-test",true,false,false,false)
  assertNull(animator(view));assertTrue(texts(view).contains("Check-in due"));assertFalse(texts(view).any{it.contains("saved on this phone")})
  view.present(CheckInAttentionTiming.Stage.RED,"opaque-test",true,true,false,false)
  assertNull(animator(view));assertTrue(texts(view).any{it.contains("still incomplete")});assertFalse(texts(view).any{it.contains("saved on this phone")})
  view.present(CheckInAttentionTiming.Stage.COMPLETE,null,false,true,false,false)
  assertTrue(texts(view).contains("Check-in saved on this phone"));assertTrue(texts(view).any{it.contains("service delivery remains separate")});assertFalse(texts(view).any{it.contains("still incomplete")})
  view.close()
 }}
 @Test fun cuePollingDoesNotRestartFinitePulseAndSteadyStopsItImmediately(){
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   lateinit var view:ConnectedCheckInAttentionView
   scenario.onActivity{activity->
    val root=GuardAccountActivity::class.java.getDeclaredField("root").apply{isAccessible=true}.get(activity) as LinearLayout
    view=ConnectedCheckInAttentionView(activity,{true});root.addView(view)
   }
   instrumentation.waitForIdleSync()
   scenario.onActivity{
    assertTrue(view.isAttachedToWindow)
    view.present(CheckInAttentionTiming.Stage.GREEN,"opaque-test",true,false,false,false)
    val original=animator(view)?:error("Finite cue animator missing")
    assertEquals(4000L,original.duration);assertEquals(0,original.repeatCount)
    view.present(CheckInAttentionTiming.Stage.GREEN,"opaque-test",true,false,false,false)
    assertSame("Polling the same cue must not restart it",original,animator(view))
    view.present(CheckInAttentionTiming.Stage.GREEN,"opaque-test",true,false,false,true)
    assertNull(animator(view));assertFalse(view.isPulsing)
    view.close();assertTrue(texts(view).all{it.isEmpty()})
    view.present(CheckInAttentionTiming.Stage.RED,"later-test",true,false,false,false)
    assertTrue("Closed views must not repopulate",texts(view).all{it.isEmpty()});assertNull(animator(view))
   }
  }
 }
 @Test fun invalidGenericEntryIsNonexportedAndFinishesWithoutActiveContent(){
  val component=android.content.ComponentName(context,ConnectedCheckInAlertActivity::class.java)
  @Suppress("DEPRECATION") val info=context.packageManager.getActivityInfo(component,0)
  assertFalse(info.exported)
  ActivityScenario.launch<ConnectedCheckInAlertActivity>(Intent(context,ConnectedCheckInAlertActivity::class.java).putExtra(AuthorizedReminders.EXTRA_TOKEN,"not-a-token")).use{scenario->
   assertEquals(Lifecycle.State.DESTROYED,scenario.state)
  }
 }
}
