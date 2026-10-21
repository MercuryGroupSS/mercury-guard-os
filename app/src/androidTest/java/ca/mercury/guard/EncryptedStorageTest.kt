package ca.mercury.guard

import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import java.io.File
import java.util.UUID

class EncryptedStorageTest {
 private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
 @Test fun cipherUsesFreshNonceAndRejectsTamperingAndWrongPurpose() {
  val crypto = DeviceCipher()
  val clear = "Synthetic incident ◆".toByteArray(Charsets.UTF_8)
  val a = crypto.encrypt(clear, "test")
  val b = crypto.encrypt(clear, "test")
  assertNotEquals(a, b)
  assertArrayEquals(clear, crypto.decrypt(a, "test"))
  val damaged = JSONObject(a)
  val bytes = Base64.decode(damaged.getString("ciphertext"), Base64.NO_WRAP)
  bytes[0] = (bytes[0].toInt() xor 1).toByte()
  damaged.put("ciphertext", Base64.encodeToString(bytes, Base64.NO_WRAP))
  var rejected = false
  try { crypto.decrypt(damaged.toString(), "test") } catch (_: Exception) { rejected = true }
  assertTrue("Changed ciphertext must fail authentication", rejected)
  rejected = false
  try { crypto.decrypt(a, "other-purpose") } catch (_: Exception) { rejected = true }
  assertTrue("Purpose mismatch must fail authentication", rejected)
 }
 @Test fun migrationPreservesOldEventsAndEncryptsPayload() {
  val name = "test-migration-${UUID.randomUUID()}.db"
  val path = context.getDatabasePath(name).apply { parentFile!!.mkdirs() }
  val raw = SQLiteDatabase.openOrCreateDatabase(path, null)
  try {
   raw.execSQL("CREATE TABLE event (id INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0)")
   raw.execSQL("INSERT INTO event(at_ms,kind,body) VALUES(123,'incident','{\"description\":\"OLD TEST INCIDENT\"}')")
   raw.version = 1
  } finally { raw.close() }
  val db = GuardStore(context, name)
  try {
   assertEquals(1, db.count())
   val item = org.json.JSONArray(db.exportJson()).getJSONObject(0)
   assertEquals(123L, item.getLong("at"))
   assertEquals("OLD TEST INCIDENT", item.getJSONObject("data").getString("description"))
   db.readableDatabase.rawQuery("SELECT at_ms,kind,body FROM event", null).use { c ->
    assertTrue(c.moveToFirst()); assertEquals(0L, c.getLong(0)); assertEquals("encrypted_v1", c.getString(1))
    assertFalse(c.getString(2).contains("OLD TEST INCIDENT"))
   }
   db.record("test", JSONObject().put("note", "NEW TEST INCIDENT"))
   assertEquals(2, db.count())
  } finally { db.close(); context.deleteDatabase(name) }
 }
 @Test fun jpegEvidenceRoundTripsEncryptedAndRejectsInvalidFiles() {
  val file = File(context.cacheDir,"test-${UUID.randomUUID()}.jpg")
  val evidence = EvidenceStore(context)
  var id: String? = null
  try {
   val bitmap = Bitmap.createBitmap(4,4,Bitmap.Config.ARGB_8888)
   try { file.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG,90,it)) } } finally { bitmap.recycle() }
   val bytes = file.readBytes()
   val metadata = evidence.savePhoto(file)
   id = metadata.getString("evidence_id")
   assertArrayEquals(bytes, evidence.readPhoto(metadata.getString("evidence_id")))
   val stored = File(File(context.noBackupFilesDir,"evidence"),"$id.enc").readBytes()
   assertFalse(stored.contentEquals(bytes))
   file.writeText("not a photo")
   var rejected = false
   try { evidence.savePhoto(file) } catch (_: IllegalArgumentException) { rejected = true }
   assertTrue(rejected)
  } finally { file.delete(); id?.let { evidence.remove(it) } }
 }
}
