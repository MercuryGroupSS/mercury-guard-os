package ca.mercury.guard

import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import org.hamcrest.Matchers.containsString
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import java.util.UUID

class AuditViewerTest {
 private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
 @Test fun pagesStayOrderedAcrossNewEventsAndDoNotMutateQueue() {
  val name = "audit-${UUID.randomUUID()}.db"
  val db = GuardStore(context, name)
  try {
   repeat(45) { db.record("test", JSONObject().put("index", it)) }
   db.saveIncidentDraft("DRAFT EXCLUDED FROM AUDIT")
   val first = db.auditPage()
   assertEquals(20, first.size); assertEquals(45L, first.first().sequence); assertEquals(26L, first.last().sequence)
   db.record("newer")
   val second = db.auditPage(first.last().sequence)
   assertEquals((25L downTo 6L).toList(), second.map { it.sequence })
   val third = db.auditPage(second.last().sequence)
   assertEquals((5L downTo 1L).toList(), third.map { it.sequence })
   assertTrue(db.auditPage(1).isEmpty())
   val ids = (first + second + third).map { it.event.getString("event_id") }
   assertEquals(45, ids.toSet().size)
   assertEquals(first.first().event.toString(), db.auditEvent(45)!!.event.toString())
   assertNull(db.auditEvent(99999))
   assertEquals(46, db.count()); assertEquals(46, db.pendingCount())
   assertEquals("DRAFT EXCLUDED FROM AUDIT", db.incidentDraft())
   assertFalse(first.any { it.event.toString().contains("DRAFT EXCLUDED") })
  } finally { db.close(); context.deleteDatabase(name) }
 }
 @Test fun invalidPagesAndCorruptRecordsAreRejectedWithoutErasingData() {
  val name = "audit-corrupt-${UUID.randomUUID()}.db"
  val db = GuardStore(context, name)
  try {
   db.record("first"); db.record("second")
   for (block in listOf<() -> Unit>({ db.auditPage(0) }, { db.auditPage(limit=0) }, { db.auditPage(limit=51) }, { db.auditEvent(-1) })) {
    var rejected = false; try { block() } catch (_: IllegalArgumentException) { rejected = true }; assertTrue(rejected)
   }
   db.writableDatabase.execSQL("UPDATE event SET body='corrupt' WHERE id=2")
   var rejected = false; try { db.auditPage() } catch (_: Exception) { rejected = true }; assertTrue(rejected)
   assertEquals(2, db.count()); assertEquals(2, db.pendingCount())
   assertNotNull(db.auditEvent(1))
  } finally { db.close(); context.deleteDatabase(name) }
 }
 @Test fun standbyViewerRestoresDetailWithoutRecordingOrAcknowledging() {
  DemoSession(context).end()
  val db = GuardStore(context)
  val sequence: Long
  val count: Int
  val pending: Int
  try {
   db.record("viewer_test", JSONObject().put("description", "VIEWER SYNTHETIC NOTE"))
   sequence = db.auditPage(limit=1).first().sequence
   count = db.count(); pending = db.pendingCount()
  } finally { db.close() }
  ActivityScenario.launch(MainActivity::class.java).use { scenario ->
   onView(org.hamcrest.Matchers.anyOf(withText("Prototype tools"), withContentDescription("Prototype tools"))).perform(scrollTo(), click())
   onView(withText("Review local audit events")).perform(scrollTo(), click())
   onView(withText("Event #$sequence · viewer_test")).perform(scrollTo(), click())
   onView(withText("AUDIT EVENT")).check(matches(isDisplayed()))
   onView(withText(containsString("VIEWER SYNTHETIC NOTE"))).perform(scrollTo()).check(matches(isDisplayed()))
   scenario.recreate()
   onView(withText("AUDIT EVENT")).check(matches(isDisplayed()))
   onView(withText("Back to audit")).perform(scrollTo(), click())
   onView(withText("Return")).perform(scrollTo(), click())
   onView(withText("Mercury One")).check(matches(isDisplayed()))
  }
  val after = GuardStore(context)
  try { assertEquals(count, after.count()); assertEquals(pending, after.pendingCount()) } finally { after.close() }
 }
}
