package ca.mercury.guard

import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.*
import org.junit.Test

class VisualLayoutTest {
 private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
 private val context get() = instrumentation.targetContext

 @Test fun controlsKeepReadableTouchTargetsAndHeadingSemantics() {
  context.getSharedPreferences("mercury_demo_assignment",0).edit().clear().commit()
  DemoSession(context).end()
  ActivityScenario.launch(MainActivity::class.java).use { scenario ->
   scenario.onActivity { activity ->
    fun check(view: View) {
     if (view is Button) {
      assertTrue("Touch height: ${view.text}", view.minimumHeight >= 48 * context.resources.displayMetrics.density)
      assertTrue("Text remains scalable", view.textSize >= 14 * context.resources.displayMetrics.scaledDensity)
     }
     if (view is TextView && view.text.toString() == "Mercury One") assertTrue(view.isAccessibilityHeading)
     if (view is ViewGroup) for (i in 0 until view.childCount) check(view.getChildAt(i))
    }
    check(activity.window.decorView)
   }
   onView(org.hamcrest.Matchers.anyOf(withText("Escalate"), withContentDescription("Escalate"))).perform(scrollTo()).check(matches(isDisplayed()))
  }
 }

 /** Opt-in emulator review capture; never resizes or changes a physical device. */
 @Test fun captureReviewScreens() {
  org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("captureScreenshots") == "true")
  org.junit.Assume.assumeTrue(android.os.Build.FINGERPRINT.contains("generic") || android.os.Build.MODEL.contains("sdk"))
  context.getSharedPreferences("mercury_demo_assignment",0).edit().clear().commit()
  val output = File(context.getExternalFilesDir(null), "visual-review").apply { mkdirs() }
  fun command(value: String): String = instrumentation.uiAutomation.executeShellCommand(value).use {
   android.os.ParcelFileDescriptor.AutoCloseInputStream(it).bufferedReader().readText()
  }
  fun shot(name: String) {
   instrumentation.waitForIdleSync()
   // Allow the compositor to present the first frame after launch/configuration changes.
   android.os.SystemClock.sleep(500)
   val bitmap = instrumentation.uiAutomation.takeScreenshot()
   assertNotNull(bitmap)
   File(output, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
   bitmap.recycle()
  }
  val previousFont = command("settings get system font_scale").trim()
  try {
   for ((name, size, density) in listOf(Triple("folded", "968x2376", "420"), Triple("unfolded", "1856x2160", "360"), Triple("large-text", "968x2376", "420"))) {
    command("wm size $size"); command("wm density $density")
    command("settings put system font_scale ${if (name == "large-text") "2.0" else "1.0"}")
    DemoSession(context).end()
    ActivityScenario.launch(MainActivity::class.java).use {
     onView(withText("Mercury One")).check(matches(isDisplayed()))
     shot("$name-login")
    }
    DemoSession(context).start()
    ActivityScenario.launch(MainActivity::class.java).use { scenario ->
     onView(withText("ACTIVE SHIFT")).check(matches(isDisplayed()))
     shot("$name-dashboard")
     onView(org.hamcrest.Matchers.anyOf(withText("Escalate"), withContentDescription("Escalate"))).perform(scrollTo(), click())
     shot("$name-escalation")
     onView(withText("Pinpoint issue · demo property")).perform(scrollTo(), click())
     onView(withText(org.hamcrest.Matchers.startsWith("Issue pin: demo grid"))).perform(scrollTo())
     shot("$name-map")
     onView(withText("Back to escalation")).perform(scrollTo(), click())
     onView(withText("Return")).perform(scrollTo(), click())
     onView(withText("Patrol · Open demo route")).perform(scrollTo(), click())
     shot("$name-patrol")
     onView(withText("Return")).perform(scrollTo(), click())
     onView(org.hamcrest.Matchers.anyOf(withText("Escalate"), withContentDescription("Escalate"))).perform(scrollTo(), click())
   onView(withText("Incident report")).perform(scrollTo(), click())
     onView(withHint("Describe the incident")).perform(scrollTo(), replaceText("Review sample only. Manual checkpoint completed; no live dispatch connection."), closeSoftKeyboard())
     scenario.recreate()
     onView(withHint("Describe the incident")).check(matches(withText("Review sample only. Manual checkpoint completed; no live dispatch connection.")))
     onView(withHint("Describe the incident")).perform(scrollTo())
     shot("$name-incident")
    }
   }
  } finally {
   command("wm size reset"); command("wm density reset")
   if (previousFont == "null") command("settings delete system font_scale") else command("settings put system font_scale $previousFont")
   DemoSession(context).end()
   GuardStore(context).let { try { it.discardIncidentDraft() } finally { it.close() } }
  }
 }
}
