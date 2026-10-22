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
  val draftStore = GuardStore(c)
  try { draftStore.discardIncidentDraft() } finally { draftStore.close() }
  // Deny permissions to verify the complete offline flow still works without GPS.
  InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("pm revoke ${c.packageName} android.permission.ACCESS_FINE_LOCATION").close()
  InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("pm revoke ${c.packageName} android.permission.ACCESS_COARSE_LOCATION").close()
 }
 @Test fun standbySurvivesRecreation() {
  ActivityScenario.launch(MainActivity::class.java).use { s ->
   onView(withText("Mercury One")).check(matches(isDisplayed()))
   s.recreate()
   onView(withText("Mercury One")).check(matches(isDisplayed()))
  }
 }
 @Test fun incidentPersistsAndSessionEnds() {
  val c = InstrumentationRegistry.getInstrumentation().targetContext
  DemoSession(c).start() // Avoid the OS permission dialog; exercise offline UI.
  ActivityScenario.launch(MainActivity::class.java).use { s ->
   onView(org.hamcrest.Matchers.anyOf(withText("Escalate"), withContentDescription("Escalate"))).perform(scrollTo(), click())
   onView(withText("Incident report")).perform(scrollTo(), click())
   onView(withHint("Describe the incident")).perform(scrollTo(), replaceText("AUTOMATED TEST incident"), closeSoftKeyboard())
   onView(withText("Save incident")).perform(scrollTo(), click())
   s.recreate()
   onView(withText("ACTIVE SHIFT")).check(matches(isDisplayed()))
   val db = GuardStore(c)
   try { assertTrue(db.exportJson().contains("AUTOMATED TEST incident")) } finally { db.close() }
   onView(org.hamcrest.Matchers.anyOf(withText("Escalate"), withContentDescription("Escalate"))).perform(scrollTo(), click())
   onView(withText("End shift early")).perform(scrollTo(), click())
   onView(withHint("Reason for ending early")).perform(replaceText("Test emergency"), closeSoftKeyboard())
   onView(withText("Review")).perform(click())
   onView(withText("End shift now")).perform(click())
   onView(withText("Mercury One")).check(matches(isDisplayed()))
   assertFalse(DemoSession(c).active())
  }
 }
 @Test fun unfinishedIncidentSurvivesRecreation() {
  val c = InstrumentationRegistry.getInstrumentation().targetContext
  DemoSession(c).start()
  ActivityScenario.launch(MainActivity::class.java).use { scenario ->
   onView(org.hamcrest.Matchers.anyOf(withText("Escalate"), withContentDescription("Escalate"))).perform(scrollTo(), click())
   onView(withText("Incident report")).perform(scrollTo(), click())
   onView(withHint("Describe the incident")).perform(scrollTo(), replaceText("UNSAVED TEST DRAFT"), closeSoftKeyboard())
   scenario.recreate()
   onView(withHint("Describe the incident")).check(matches(withText("UNSAVED TEST DRAFT")))
   onView(withText("Cancel")).perform(scrollTo(), click())
  }
 }
 @Test fun photoConsentCanBeCancelledWithoutOpeningCamera() {
  val c = InstrumentationRegistry.getInstrumentation().targetContext
  DemoSession(c).start()
  ActivityScenario.launch(MainActivity::class.java).use {
   onView(org.hamcrest.Matchers.anyOf(withText("Escalate"), withContentDescription("Escalate"))).perform(scrollTo(), click())
   onView(withText("Capture photo evidence")).perform(scrollTo(), click())
   onView(withText("Capture test photo")).check(matches(isDisplayed()))
   onView(withText("Cancel")).perform(click())
   onView(withText("ESCALATE")).perform(scrollTo()).check(matches(isDisplayed()))
  }
 }
 @Test fun patrolSurvivesRecreationAndDeniedGpsCannotCheckPoint() {
  val c = InstrumentationRegistry.getInstrumentation().targetContext
  DemoSession(c).start()
  val id = DemoSession(c).identity()
  GuardStore(c).useStore { db ->
   assertTrue(db.completePoint(id,2,JSONObject().put("mock",true).put("accuracy_m",10).put("fix_at",System.currentTimeMillis())))
   assertFalse(db.completePoint(id,2,JSONObject().put("mock",true)))
  }
  ActivityScenario.launch(MainActivity::class.java).use { scenario ->
   onView(withText("Patrol · Open demo route")).perform(scrollTo(),click())
   onView(withText("1 / 3 recorded")).check(matches(isDisplayed()))
   scenario.recreate()
   onView(withText("1 / 3 recorded")).check(matches(isDisplayed()))
   onView(withText("Control point")).check(matches(isChecked()))
   onView(withText("Main entrance")).perform(scrollTo(),click())
   onView(withText("Main entrance")).check(matches(isNotChecked()))
   GuardStore(c).useStore { assertEquals(setOf(2),it.completedPoints(id)) }
  }
 }
 @Test fun incidentDraftSurvivesFullActivityCloseAndCanBeDiscarded() {
  val c = InstrumentationRegistry.getInstrumentation().targetContext
  DemoSession(c).start()
  ActivityScenario.launch(MainActivity::class.java).use {
   onView(org.hamcrest.Matchers.anyOf(withText("Escalate"), withContentDescription("Escalate"))).perform(scrollTo(), click())
   onView(withText("Incident report")).perform(scrollTo(), click())
   onView(withHint("Describe the incident")).perform(scrollTo(), replaceText("DURABLE TEST DRAFT"), closeSoftKeyboard())
  }
  ActivityScenario.launch(MainActivity::class.java).use {
   onView(org.hamcrest.Matchers.anyOf(withText("Escalate"), withContentDescription("Escalate"))).perform(scrollTo(), click())
   onView(withText("Incident report")).perform(scrollTo(), click())
   onView(withHint("Describe the incident")).check(matches(withText("DURABLE TEST DRAFT")))
   onView(withText("Discard draft")).perform(scrollTo(), click())
   onView(withText("Keep draft")).perform(click())
   onView(withHint("Describe the incident")).check(matches(withText("DURABLE TEST DRAFT")))
   onView(withText("Discard draft")).perform(scrollTo(), click())
   onView(withText("Discard")).perform(click())
   onView(org.hamcrest.Matchers.anyOf(withText("Escalate"), withContentDescription("Escalate"))).perform(scrollTo(), click())
   onView(withText("Incident report")).perform(scrollTo(), click())
   onView(withHint("Describe the incident")).check(matches(withText("")))
  }
 }
 @Test fun queueRoundTripsJson() {
  val c = InstrumentationRegistry.getInstrumentation().targetContext
  val db = GuardStore(c)
  try {
   db.record("test", JSONObject().put("description", "Quotes: \" & Unicode ◆"))
   assertTrue(db.exportJson().contains("Unicode ◆"))
  } finally { db.close() }
 }
}
