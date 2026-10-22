package ca.mercury.guard

import android.graphics.Bitmap
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.matcher.ViewMatchers.*
import org.json.JSONObject
import org.junit.Test
import org.junit.Assume.assumeTrue
import java.io.File

/** Synthetic state fixtures only, opt-in and emulator-only. No production authentication bypass. */
class DutyPreviewCaptureTest {
 @Test fun captureSlowPulse() {
  val ins=InstrumentationRegistry.getInstrumentation();val c=ins.targetContext
  assumeTrue(InstrumentationRegistry.getArguments().getString("captureDutyPulse")=="true")
  assumeTrue(android.os.Build.MODEL.contains("sdk"))
  fun shell(cmd:String)=ins.uiAutomation.executeShellCommand(cmd).use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).bufferedReader().readText() }
  val previous=shell("settings get global animator_duration_scale").trim()
  try {
   shell("wm size 968x2376");shell("wm density 420");shell("settings put global animator_duration_scale 1")
   DemoSession(c).end();DemoAssignment(c).create();DemoSession(c).start()
   val session=DemoSession(c).identity()
   GuardStore(c).useStore { it.recordOnce("duty_due","$session:pulse",JSONObject().put("session",session).put("kind","readiness").put("due_elapsed",SystemClock.elapsedRealtime()).put("synthetic_test",true)) }
   ActivityScenario.launch(MainActivity::class.java).use {
    SystemClock.sleep(4000)
    val recording=ins.uiAutomation.executeShellCommand("screenrecord --bit-rate 5000000 --time-limit 8 /sdcard/mercury-duty-pulse.mp4")
    SystemClock.sleep(9000);recording.close()
   }
  } finally {
   DemoSession(c).end();c.getSharedPreferences("mercury_demo_assignment",0).edit().clear().commit()
   shell("settings put global animator_duration_scale $previous");shell("wm size reset");shell("wm density reset")
  }
 }
 @Test fun captureDutyFlows() {
  val ins=InstrumentationRegistry.getInstrumentation(); val c=ins.targetContext
  assumeTrue(InstrumentationRegistry.getArguments().getString("captureDutyPreview")=="true")
  assumeTrue(android.os.Build.MODEL.contains("sdk"))
  fun shell(cmd:String)=ins.uiAutomation.executeShellCommand(cmd).use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).bufferedReader().readText() }
  val dir=File(c.getExternalFilesDir(null),"duty-preview").apply { mkdirs() }
  fun shot(name:String) { SystemClock.sleep(1700); val image=ins.uiAutomation.takeScreenshot(); File(dir,"$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG,100,it) }; image.recycle() }
  fun tap(text:String) { onView(withText(text)).perform(scrollTo(),click()); SystemClock.sleep(1200) }
  fun seed(kind:String,age:Long,verified:Boolean=false,gps:Boolean=false):String {
   DemoSession(c).end(); DemoAssignment(c).create(); DemoSession(c).start()
   val session=DemoSession(c).identity(); val id="$session:fixture:${java.util.UUID.randomUUID()}"
   GuardStore(c).useStore { store ->
    store.recordOnce("duty_due",id,JSONObject().put("session",session).put("kind",kind).put("due_elapsed",SystemClock.elapsedRealtime()-age).put("synthetic_test",true))
    if (verified) store.recordOnce("duty_biometric",id,JSONObject().put("synthetic_test",true))
    if (gps) store.recordOnce("duty_gps",id,JSONObject().put("mock",true).put("accuracy_m",12).put("fix_at",System.currentTimeMillis()).put("synthetic_test",true))
   }; return id
  }
  val previous=shell("settings get global animator_duration_scale").trim()
  try {
   shell("wm size 968x2376");shell("wm density 420");shell("settings put global animator_duration_scale 0")
   for ((name,age) in listOf("01-readiness-green" to 0L,"02-readiness-yellow" to 150000L,"03-readiness-red" to 360000L)) {
    seed("readiness",age)
    ActivityScenario.launch(MainActivity::class.java).use { SystemClock.sleep(3500); shot(name) }
   }
   seed("check_in",50000,true,true)
   ActivityScenario.launch(MainActivity::class.java).use {
    SystemClock.sleep(2000);shot("04-check-in-site-photo")
    tap("Take site photo");shot("05-site-photo-consent");onView(withText("Cancel")).perform(click())
   }
   seed("readiness",610000)
   ActivityScenario.launch(MainActivity::class.java).use {
    SystemClock.sleep(2000);tap("Escalate");tap("Dispatch · Acknowledge missed check")
    onView(withHint("Why was this check missed?")).perform(replaceText("DEMO: assisting a visitor at the checkpoint."),closeSoftKeyboard())
    shot("06-missed-check-reason");onView(withText("Cancel")).perform(click())
   }
   DemoSession(c).end(); DemoAssignment(c).create();DemoSession(c).start()
   GuardStore(c).useStore { it.completePoint(DemoSession(c).identity(),2,JSONObject().put("mock",true).put("accuracy_m",12).put("fix_at",System.currentTimeMillis()).put("synthetic_test",true)) }
   ActivityScenario.launch(MainActivity::class.java).use {
    val recording=ins.uiAutomation.executeShellCommand("screenrecord --bit-rate 5000000 --time-limit 45 /sdcard/mercury-duty-walkthrough.mp4")
    tap("Patrol · Open demo route");shot("07-any-order-patrol")
    tap("Return");tap("Shift check-in");SystemClock.sleep(3500);shot("08-check-in-verification")
    tap("Escalate");tap("Pinpoint issue · demo property")
    tap("Use patrol point: Perimeter");shot("09-route-issue-pin")
    tap("Record demo issue pin");tap("Back to escalation")
    SystemClock.sleep(2000)
    shell("kill -2 $(pidof screenrecord)");recording.close()
   }
   shell("wm size 1856x2160");shell("wm density 360")
   ActivityScenario.launch(MainActivity::class.java).use {
    SystemClock.sleep(2000);tap("Escalate");tap("Pinpoint issue · demo property")
    shot("10-unfolded-issue-map")
   }
  } finally {
   DemoSession(c).end();c.getSharedPreferences("mercury_demo_assignment",0).edit().clear().commit()
   shell("settings put global animator_duration_scale $previous");shell("wm size reset");shell("wm density reset")
  }
 }
}
