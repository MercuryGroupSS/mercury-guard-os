package ca.mercury.guard

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Per-install key. Loss/invalidation of the key fails closed; there is no plaintext fallback. */
class DeviceCipher {
 companion object { private const val ALIAS = "mercury.local.v1"; private val lock = Any() }
 private fun key(create: Boolean = true): SecretKey = synchronized(lock) {
  val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  if (ks.containsAlias(ALIAS)) ks.getKey(ALIAS, null) as SecretKey else {
   check(create) { "Local encryption key unavailable" }
   KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
    init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
     .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
     .setKeySize(256).setRandomizedEncryptionRequired(true).build())
   }.generateKey()
  }
 }
 // Keep individual Keystore calls bounded on older Android implementations. Return no
 // decrypted bytes to callers until doFinal has authenticated the complete message.
 private fun finish(cipher: Cipher, input: ByteArray): ByteArray {
  val output = ByteArrayOutputStream()
  var offset = 0
  while (input.size - offset > 16384) {
   cipher.update(input, offset, 16384)?.let { output.write(it) }
   offset += 16384
  }
  output.write(cipher.doFinal(input, offset, input.size - offset))
  return output.toByteArray()
 }
 fun encrypt(plaintext: ByteArray, purpose: String): String {
  val cipher = Cipher.getInstance("AES/GCM/NoPadding")
  cipher.init(Cipher.ENCRYPT_MODE, key())
  cipher.updateAAD(purpose.toByteArray(Charsets.UTF_8))
  return JSONObject().put("v", 1).put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
   .put("ciphertext", Base64.encodeToString(finish(cipher, plaintext), Base64.NO_WRAP)).toString()
 }
 fun decrypt(envelope: String, purpose: String): ByteArray {
  val value = JSONObject(envelope)
  require(value.getInt("v") == 1) { "Unsupported encrypted record version" }
  val cipher = Cipher.getInstance("AES/GCM/NoPadding")
  cipher.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(128, Base64.decode(value.getString("iv"), Base64.NO_WRAP)))
  cipher.updateAAD(purpose.toByteArray(Charsets.UTF_8))
  return finish(cipher, Base64.decode(value.getString("ciphertext"), Base64.NO_WRAP))
 }
}
