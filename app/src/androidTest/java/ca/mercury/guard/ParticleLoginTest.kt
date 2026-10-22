package ca.mercury.guard

import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class ParticleLoginTest {
 private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
 private val context get()=instrumentation.targetContext
 private fun reset() {
  DemoSession(context).end()
  context.getSharedPreferences("mercury_demo_assignment",0).edit().clear().commit()
 }
 @Test fun loginHasOnlyWordmarkAndAccessibleSafetyControls() {
  reset()
  ActivityScenario.launch(MainActivity::class.java).use { scenario ->
   scenario.onActivity { activity ->
    val words=mutableListOf<String>()
    fun visit(v: View) {
     if(v is TextView && v.text.isNotEmpty()) words.add(v.text.toString())
     if(v is ViewGroup) for(i in 0 until v.childCount) visit(v.getChildAt(i))
    }
    visit(activity.window.decorView)
    assertEquals(listOf("Mercury One","!","⋯"),words)
   }
   onView(withContentDescription("Escalate")).perform(click())
   onView(withText("ESCALATE")).check(matches(isDisplayed()))
   assertFalse(DemoSession(context).active())
  }
 }
 @Test fun captureParticleTransitionOnly() {
  org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("captureParticles")=="true")
  org.junit.Assume.assumeTrue(android.os.Build.MODEL.contains("sdk"))
  reset()
  val dir=File(context.getExternalFilesDir(null),"particle-review").apply { mkdirs() }
  fun capture(name:String) {
   instrumentation.uiAutomation.takeScreenshot().let { bitmap ->
    File(dir,"$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }; bitmap.recycle()
   }
  }
  fun animationScale(value:String) {
   instrumentation.uiAutomation.executeShellCommand("settings put global animator_duration_scale $value").use { descriptor ->
    java.io.FileInputStream(descriptor.fileDescriptor).readBytes()
   }
   android.os.SystemClock.sleep(250)
  }
  animationScale("0")
  ActivityScenario.launch(MainActivity::class.java).use { scenario ->
   animationScale("1")
   scenario.onActivity { activity ->
    fun visit(v:View) {
     if(v is ParticleLoginView) {
      v.post { v.startMotion() }
      v.postDelayed({ v.setSigningIn(true) },2200)
      v.postDelayed({ v.stopMotion(); println(v.renderingStats()) },9500)
     }
     if(v is ViewGroup) for(i in 0 until v.childCount) visit(v.getChildAt(i))
    }
    visit(activity.window.decorView)
   }
   // Capture animated frames directly; Espresso focus settling is unsuitable for this live animation.
   android.os.SystemClock.sleep(500)
   val recording=instrumentation.uiAutomation.executeShellCommand("screenrecord --time-limit 9 /sdcard/mercury-one-particles.mp4")
   android.os.SystemClock.sleep(1500); capture("MercuryOne-particle-login")
   android.os.SystemClock.sleep(4200); capture("MercuryOne-generic-face-transition")
   assertFalse("Decorative transition never signs the user in",DemoSession(context).active())
   android.os.SystemClock.sleep(3400)
   recording.close()
  }
 }
}
