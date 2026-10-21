package ca.mercury.guard

import android.database.sqlite.SQLiteDatabase
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import java.util.UUID

class IncidentDraftTest {
 private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
 @Test fun encryptedDraftSurvivesReopenAndSubmitsExactlyOnce() {
  val name = "draft-${UUID.randomUUID()}.db"
  var db = GuardStore(context, name)
  try {
   db.saveIncidentDraft("SYNTHETIC DRAFT ◆")
   assertEquals(0, db.count()); assertEquals(0, db.pendingCount())
   assertFalse(db.exportJson().contains("SYNTHETIC DRAFT"))
   db.readableDatabase.rawQuery("SELECT body FROM draft", null).use { c -> c.moveToFirst(); assertFalse(c.getString(0).contains("SYNTHETIC DRAFT")) }
   db.close(); db = GuardStore(context, name)
   assertEquals("SYNTHETIC DRAFT ◆", db.incidentDraft())
   assertTrue(db.submitIncidentDraft()); assertEquals("", db.incidentDraft())
   assertFalse(db.submitIncidentDraft()); assertEquals(1, db.count()); assertEquals(1, db.pendingCount())
   assertEquals("SYNTHETIC DRAFT ◆", JSONArray(db.exportJson()).getJSONObject(0).getJSONObject("data").getString("description"))
  } finally { db.close(); context.deleteDatabase(name) }
 }
 @Test fun failedSubmissionRollsBackAndPreservesDraft() {
  val name = "draft-failure-${UUID.randomUUID()}.db"
  val db = GuardStore(context, name)
  try {
   db.saveIncidentDraft("KEEP THIS TEST DRAFT")
   db.writableDatabase.execSQL("CREATE TRIGGER reject_event BEFORE INSERT ON event BEGIN SELECT RAISE(ABORT, 'test failure'); END")
   var failed = false
   try { db.submitIncidentDraft() } catch (_: Exception) { failed = true }
   assertTrue(failed); assertEquals("KEEP THIS TEST DRAFT", db.incidentDraft()); assertEquals(0, db.count())
   db.writableDatabase.execSQL("DROP TRIGGER reject_event")
   assertTrue(db.submitIncidentDraft()); assertEquals(1, db.count())
  } finally { db.close(); context.deleteDatabase(name) }
 }
 @Test fun corruptDraftFailsClosedAndIsNotOverwritten() {
  val name = "draft-corrupt-${UUID.randomUUID()}.db"
  var db = GuardStore(context, name)
  try {
   db.saveIncidentDraft("TEST DRAFT")
   db.writableDatabase.execSQL("UPDATE draft SET body='invalid encrypted envelope'")
   var failed = false
   try { db.saveIncidentDraft("REPLACEMENT") } catch (_: Exception) { failed = true }
   assertTrue(failed)
   db.readableDatabase.rawQuery("SELECT body FROM draft", null).use { c -> c.moveToFirst(); assertEquals("invalid encrypted envelope", c.getString(0)) }
   db.close(); db = GuardStore(context, name)
   failed = false
   try { db.count() } catch (_: Exception) { failed = true }
   assertTrue(failed)
  } finally { db.close(); context.deleteDatabase(name) }
 }
 @Test fun versionThreeMigrationAndLengthLimitPreserveData() {
  val name = "draft-migrate-${UUID.randomUUID()}.db"
  val path = context.getDatabasePath(name).apply { parentFile!!.mkdirs() }
  val raw = SQLiteDatabase.openOrCreateDatabase(path, null)
  try {
   raw.execSQL("CREATE TABLE event (id INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0)")
   raw.execSQL("CREATE TABLE outbox (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)")
   raw.version = 3
  } finally { raw.close() }
  val db = GuardStore(context, name)
  try {
   assertEquals("", db.incidentDraft())
   val text = "x".repeat(GuardStore.MAX_DRAFT_LENGTH)
   db.saveIncidentDraft(text)
   var failed = false
   try { db.saveIncidentDraft(text + "x") } catch (_: IllegalArgumentException) { failed = true }
   assertTrue(failed); assertEquals(text, db.incidentDraft())
   db.discardIncidentDraft(); assertEquals("", db.incidentDraft()); assertEquals(0, db.count())
  } finally { db.close(); context.deleteDatabase(name) }
 }
}
