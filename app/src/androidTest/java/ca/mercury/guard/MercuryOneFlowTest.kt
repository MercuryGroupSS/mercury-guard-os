package ca.mercury.guard

import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.*
import androidx.test.espresso.matcher.ViewMatchers.*
import android.os.SystemClock
import android.provider.Settings
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class MercuryOneFlowTest {
 private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
 @Before fun reset() {
  DemoSession(context).end()
  context.getSharedPreferences("mercury_demo_assignment",0).edit().clear().commit()
 }
 @org.junit.After fun cleanup() { reset() }
 @Test fun noAssignmentHasNoClockInButEscalationRemainsAvailable() {
  ActivityScenario.launch(MainActivity::class.java).use {
   onView(withText("Sign in with biometrics")).check(doesNotExist())
   onView(withText("Clock out")).check(doesNotExist())
   onView(org.hamcrest.Matchers.anyOf(withText("Escalate"), withContentDescription("Escalate"))).perform(scrollTo(), click())
   onView(withText("Incident report")).perform(scrollTo(), click())
   onView(withHint("Describe the incident")).perform(scrollTo(), replaceText("OFF-SHIFT TEST ISSUE"), closeSoftKeyboard())
   onView(withText("Save incident")).perform(scrollTo(), click())
   assertFalse(DemoSession(context).active())
  }
 }
 @Test fun unavailableBiometricsNeverStartAssignment() {
  org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("testBiometricFailure") == "true")
  val instrumentation = InstrumentationRegistry.getInstrumentation()
  fun shell(command: String) { instrumentation.uiAutomation.executeShellCommand(command).use {
   android.os.ParcelFileDescriptor.AutoCloseInputStream(it).bufferedReader().readText()
  } }
  // This test is only valid on a fresh emulator without enrolled biometrics.
  org.junit.Assume.assumeTrue(android.os.Build.MODEL.contains("sdk"))
  val keyguard = context.getSystemService(android.content.Context.KEYGUARD_SERVICE) as android.app.KeyguardManager
  org.junit.Assume.assumeFalse(keyguard.isDeviceSecure)
  shell("pm grant ${context.packageName} android.permission.ACCESS_COARSE_LOCATION")
  shell("pm grant ${context.packageName} android.permission.ACCESS_FINE_LOCATION")
  if (android.os.Build.VERSION.SDK_INT >= 33) shell("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
  try {
   DemoAssignment(context).create()
   ActivityScenario.launch(MainActivity::class.java).use { scenario ->
    instrumentation.waitForIdleSync()
    assertFalse(DemoSession(context).active())
    scenario.recreate()
    assertFalse(DemoSession(context).active())
   }
  } finally {
   context.getSharedPreferences("mercury_demo_assignment",0).edit().clear().commit()
  }
 }
 @Test fun scheduledEndDoesNotAutomaticallyStopShift() {
  // Keep readiness prompts independent of emulator uptime; only the scheduled end is past.
  DemoSession(context).start()
  context.getSharedPreferences("mercury_demo_assignment",0).edit().putLong("end_elapsed",0).commit()
  ActivityScenario.launch(MainActivity::class.java).use { scenario ->
   assertTrue(DemoSession(context).active())
   onView(withText("Clock out")).perform(scrollTo()).check(matches(isDisplayed()))
   scenario.recreate()
   assertTrue(DemoSession(context).active())
   onView(withText("Clock out")).perform(scrollTo(),click())
   onView(withText("Keep working")).perform(click())
   assertTrue(DemoSession(context).active())
   onView(withText("Clock out")).perform(scrollTo(),click())
   onView(withText("Clock out now")).perform(click())
   assertFalse(DemoSession(context).active())
  }
 }
 @Test fun earlyExitRequiresReasonAndConfirmationAndRecordsActualTime() {
  DemoAssignment(context).create(); DemoSession(context).start()
  val before = System.currentTimeMillis()
  ActivityScenario.launch(MainActivity::class.java).use {
   onView(withText("Clock out")).check(doesNotExist())
   onView(withText("End shift early")).check(doesNotExist())
   onView(org.hamcrest.Matchers.anyOf(withText("Escalate"), withContentDescription("Escalate"))).perform(scrollTo(),click())
   onView(withText("End shift early")).perform(scrollTo(),click())
   onView(withText("Review")).perform(click())
   assertTrue(DemoSession(context).active())
   onView(withHint("Reason for ending early")).perform(replaceText("Synthetic emergency"),closeSoftKeyboard())
   onView(withText("Review")).perform(click())
   assertTrue(DemoSession(context).active())
   onView(withText("End shift now")).perform(click())
   assertFalse(DemoSession(context).active())
   val store = GuardStore(context)
   try {
    val entry = store.auditPage(Long.MAX_VALUE).first { it.event.getString("kind") == "shift_ended_early_demo" }
    assertTrue(entry.event.toString().contains("Synthetic emergency"))
    assertTrue(entry.event.toString().contains("actual_clock_out"))
    assertTrue(entry.event.getLong("at") >= before)
   } finally { store.close() }
  }
 }
 @Test fun assignmentCannotBeConsumedTwiceAndExpiresBeforeClockIn() {
  val assignment = DemoAssignment(context)
  assignment.create(); assertTrue(assignment.available())
  assertTrue(assignment.consume()); assertFalse(assignment.available())
  assignment.create()
  context.getSharedPreferences("mercury_demo_assignment",0).edit().putLong("end_elapsed",SystemClock.elapsedRealtime()-1).commit()
  assertFalse(assignment.available())
 }
}
