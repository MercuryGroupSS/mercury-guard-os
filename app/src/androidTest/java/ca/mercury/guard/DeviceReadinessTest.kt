package ca.mercury.guard

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class DeviceReadinessTest {
 private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
 @Before fun reset() {
  DemoSession(context).end(); TrackingStatus.stopped()
  val ui = InstrumentationRegistry.getInstrumentation().uiAutomation
  ui.executeShellCommand("pm revoke ${context.packageName} android.permission.ACCESS_FINE_LOCATION").close()
  ui.executeShellCommand("pm revoke ${context.packageName} android.permission.ACCESS_COARSE_LOCATION").close()
  if (Build.VERSION.SDK_INT >= 33) ui.executeShellCommand("pm revoke ${context.packageName} android.permission.POST_NOTIFICATIONS").close()
 }
 @Test fun permissionsAreIndependentAndStandbyOverridesStaleObservations() {
  val readiness = DeviceReadiness(context)
  assertFalse(readiness.preciseLocationGranted())
  assertEquals(Build.VERSION.SDK_INT < 33, readiness.notificationPermissionGranted())
  TrackingStatus.requesting = true; TrackingStatus.lastFixElapsed = 0
  assertEquals("GPS tracking: stopped · no active demo shift", readiness.trackingDescription())
  DemoSession(context).start()
  assertEquals("GPS tracking: unavailable · precise location not granted", readiness.trackingDescription())
  TrackingStatus.stopped(); DemoSession(context).end()
 }
 @Test fun standbyReadinessRestoresWithoutStartingShiftOrChangingQueue() {
  val db = GuardStore(context)
  val count: Int
  val pending: Int
  try { count = db.count(); pending = db.pendingCount() } finally { db.close() }
  ActivityScenario.launch(MainActivity::class.java).use { scenario ->
   onView(withText("Device readiness")).perform(scrollTo(), click())
   onView(withText("DEVICE READINESS")).check(matches(isDisplayed()))
   onView(withText("Precise location: not granted")).check(matches(isDisplayed()))
   onView(withText("GPS tracking: stopped · no active demo shift")).perform(scrollTo()).check(matches(isDisplayed()))
   scenario.recreate()
   onView(withText("DEVICE READINESS")).check(matches(isDisplayed()))
   onView(withText("Refresh readiness")).perform(scrollTo(), click())
   onView(withText("Return")).perform(scrollTo(), click())
   onView(withText("DEVICE STANDBY")).check(matches(isDisplayed()))
  }
  assertFalse(DemoSession(context).active()); assertFalse(TrackingStatus.requesting)
  val after = GuardStore(context)
  try { assertEquals(count, after.count()); assertEquals(pending, after.pendingCount()) } finally { after.close() }
 }
 @Test fun activeReadinessDoesNotStartTrackingOrGrantPermissionByViewing() {
  DemoSession(context).start()
  ActivityScenario.launch(MainActivity::class.java).use {
   onView(withText("Device readiness")).perform(scrollTo(), click())
   onView(withText("GPS tracking: unavailable · precise location not granted")).perform(scrollTo()).check(matches(isDisplayed()))
   onView(withText("Request GPS for active demo shift")).perform(scrollTo()).check(matches(isDisplayed()))
  }
  assertFalse(DeviceReadiness(context).preciseLocationGranted()); assertFalse(TrackingStatus.requesting)
  DemoSession(context).end()
 }
}
