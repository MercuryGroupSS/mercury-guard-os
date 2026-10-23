package ca.mercury.guard

import android.graphics.Bitmap
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

class CloseoutWorkflowTest {
 private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
 private fun isolated(block: (GuardStore) -> Unit) {
  val name = "closeout-${UUID.randomUUID()}.db"; val store = GuardStore(context,name)
  try { block(store) } finally { store.close(); context.deleteDatabase(name) }
 }
 private fun session() = "synthetic-${UUID.randomUUID()}:${SystemClock.elapsedRealtime()}"
 private fun photo(): JSONObject {
  val file = File(context.cacheDir,"synthetic-${UUID.randomUUID()}.jpg")
  val bitmap = Bitmap.createBitmap(4,4,Bitmap.Config.ARGB_8888)
  try {
   file.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG,90,it)) }
   return EvidenceStore(context).savePhoto(file)
  } finally { bitmap.recycle(); file.delete() }
 }
 @Test fun photoAuditEvidenceLinkAndCompletionCommitTogether() = isolated { store ->
  val id=session();val duty=DutyPrompts(store);val p=duty.requestCheckIn(id)
  store.recordOnce("duty_biometric",p.id,JSONObject().put("synthetic_test",true))
  store.recordOnce("duty_gps",p.id,JSONObject().put("synthetic_test",true))
  val metadata=photo()
  try {
   assertTrue(store.recordRetainedPhoto(metadata,id,p.id))
   assertTrue(duty.has("duty_photo",p.id));assertTrue(duty.has("duty_completed",p.id))
   val recorded=store.eventsOf("photo_evidence").single()
   assertEquals(id,recorded.getString("capture_session"))
   assertEquals(metadata.getString("evidence_id"),recorded.getString("evidence_id"))
   assertTrue(EvidenceStore(context).readPhoto(metadata.getString("evidence_id")).isNotEmpty())
  } finally { EvidenceStore(context).remove(metadata.getString("evidence_id")) }
 }
 @Test fun latePhotoLinkFailureRollsBackAuditAndCompletionAndAllowsRetry() = isolated { store ->
  val id=session();val duty=DutyPrompts(store);val p=duty.requestCheckIn(id)
  store.recordOnce("duty_biometric",p.id);store.recordOnce("duty_gps",p.id)
  val before=store.count();val metadata=photo()
  try {
   store.writableDatabase.execSQL("CREATE TRIGGER fail_photo_link BEFORE INSERT ON event WHEN (SELECT count(*) FROM event)>=$before+1 BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END")
   var failed=false
   try { store.recordRetainedPhoto(metadata,id,p.id) } catch (_: Exception) { failed=true }
   assertTrue(failed);assertEquals(before,store.count())
   assertTrue(store.eventsOf("photo_evidence").isEmpty())
   assertFalse(duty.has("duty_photo",p.id));assertFalse(duty.has("duty_completed",p.id))
   store.writableDatabase.execSQL("DROP TRIGGER fail_photo_link")
   assertTrue(store.recordRetainedPhoto(metadata,id,p.id))
   assertEquals(1,store.eventsOf("photo_evidence").size)
  } finally { EvidenceStore(context).remove(metadata.getString("evidence_id")) }
 }
 @Test fun unrelatedOrUnverifiedPhotoNeverCompletesCheckIn() = isolated { store ->
  val id=session();val duty=DutyPrompts(store);val p=duty.requestCheckIn(id)
  val metadata=photo()
  try {
   assertFalse(store.recordRetainedPhoto(metadata,id,"other-prompt"))
   assertFalse(duty.has("duty_photo",p.id));assertFalse(duty.has("duty_completed",p.id))
   assertEquals(1,store.eventsOf("photo_evidence").size)
  } finally { EvidenceStore(context).remove(metadata.getString("evidence_id")) }
 }
 @Test fun completionRejectsUnknownChangedFutureAndExpiredPromptEvenWithEvidence() = isolated { store ->
  val duty=DutyPrompts(store);val p=duty.requestCheckIn(session())
  store.recordOnce("duty_biometric",p.id)
  assertFalse(duty.complete(p.copy(kind="readiness")))
  assertFalse(duty.complete(p.copy(id="unknown")))
  assertFalse(duty.complete(p.copy(due=p.due-1)))
  store.recordOnce("duty_gps",p.id);store.recordOnce("duty_photo",p.id)
  assertFalse(duty.complete(p,p.due-1));assertFalse(duty.complete(p,p.due+600000))
  assertTrue(duty.complete(p,p.due));assertFalse(duty.complete(p,p.due))
 }
 @Test fun rollbackCannotLeakCachedEventWhenRowIdIsReused() = isolated { store ->
  val db=store.writableDatabase
  db.beginTransaction()
  try {
   store.record("synthetic_rolled_back",JSONObject().put("value","discard"))
   assertEquals(1,store.eventsOf("synthetic_rolled_back").size)
  } finally { db.endTransaction() }
  store.record("synthetic_committed",JSONObject().put("value","keep"))
  assertTrue(store.eventsOf("synthetic_rolled_back").isEmpty())
  assertEquals("keep",store.eventsOf("synthetic_committed").single().getString("value"))
 }

}
