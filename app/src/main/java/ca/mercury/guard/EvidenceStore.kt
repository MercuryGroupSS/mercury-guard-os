package ca.mercury.guard

import android.content.Context
import android.graphics.BitmapFactory
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import org.json.JSONObject

/** Camera output is temporarily private plaintext; retained media uses authenticated encryption. */
class EvidenceStore(private val context: Context) {
 private val cipher = DeviceCipher()
 private val directory get() = File(context.noBackupFilesDir, "evidence").apply { mkdirs() }
 fun savePhoto(source: File): JSONObject {
  require(source.length() in 1..MAX_PHOTO_BYTES) { "Photo missing or larger than 20 MB" }
  val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  BitmapFactory.decodeFile(source.absolutePath, bounds)
  require(bounds.outWidth > 0 && bounds.outHeight > 0 && bounds.outMimeType == "image/jpeg") { "Camera did not return a valid JPEG" }
  require(bounds.outWidth <= 50000 && bounds.outHeight <= 50000 && bounds.outWidth.toLong() * bounds.outHeight <= 100000000L) { "Photo dimensions exceed the service limit" }
  val bytes = source.readBytes()
  val id = UUID.randomUUID().toString()
  val destination = File(directory, "$id.enc")
  val temporary = File(directory, "$id.pending")
  try {
   temporary.outputStream().use { stream ->
    stream.write(cipher.encrypt(bytes, "mercury-photo:$id").toByteArray(Charsets.UTF_8))
    stream.fd.sync()
   }
   check(temporary.renameTo(destination)) { "Could not retain encrypted photo" }
  } finally { temporary.delete() }
  val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
  return JSONObject().put("evidence_id",id).put("sha256",hash).put("bytes",bytes.size)
   .put("width",bounds.outWidth).put("height",bounds.outHeight).put("capture","camera_intent")
 }
 fun readPhoto(id: String): ByteArray {
  require(UUID.fromString(id).toString() == id)
  return cipher.decrypt(File(directory,"$id.enc").readText(), "mercury-photo:$id")
 }
 fun remove(id: String) { require(UUID.fromString(id).toString() == id); File(directory,"$id.enc").delete() }
 companion object { const val MAX_PHOTO_BYTES = 20L * 1024 * 1024 }
}
