package ca.mercury.guard
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.json.JSONObject

class GuardFlowTest {
 @Before fun reset() {
  val c = InstrumentationRegistry.getInstrumentation().targetContext
  DemoSession(c).end()
  // Deny permissions to verify the complete offline flow still works without GPS.
  InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("pm revoke ${c.packageName} android.permission.ACCESS_FINE_LOCATION").close()
  InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("pm revoke ${c.packageName} android.permission.ACCESS_COARSE_LOCATION").close()
 }
 @Test fun standbySurvivesRecreation() {
  ActivityScenario.launch(MainActivity::class.java).use { s ->
   onView(withText("DEVICE STANDBY")).check(matches(isDisplayed()))
   s.recreate()
   onView(withText("DEVICE STANDBY")).check(matches(isDisplayed()))
  }
 }
 @Test fun incidentPersistsAndSessionEnds() {
  val c = InstrumentationRegistry.getInstrumentation().targetContext
  DemoSession(c).start() // Avoid the OS permission dialog; exercise offline UI.
  ActivityScenario.launch(MainActivity::class.java).use { s ->
   onView(withText("Incident report")).perform(scrollTo(), click())
   onView(withHint("Describe the incident")).perform(replaceText("AUTOMATED TEST incident"), closeSoftKeyboard())
   onView(withText("Save incident")).perform(scrollTo(), click())
   s.recreate()
   onView(withText("ACTIVE SHIFT")).check(matches(isDisplayed()))
   GuardStore(c).use { assertTrue(it.exportJson().contains("AUTOMATED TEST incident")) }
   onView(withText("End shift and stop GPS")).perform(scrollTo(), click())
   onView(withText("DEVICE STANDBY")).check(matches(isDisplayed()))
   assertFalse(DemoSession(c).active())
  }
 }
 @Test fun queueRoundTripsJson() {
  val c = InstrumentationRegistry.getInstrumentation().targetContext
  GuardStore(c).use { db ->
   db.record("test", JSONObject().put("description", "Quotes: \" & Unicode ◆"))
   assertTrue(db.exportJson().contains("Unicode ◆"))
  }
 }
}
