package ca.mercury.guard

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.UUID

/** Installation key only; neither enrollment nor guard authentication. No automatic key replacement. */
class DeviceIdentity(context: Context, private val alias: String = "mercury.device.signing.v1", markerName: String = "device-identity-v1") {
 init { require(markerName.matches(Regex("[A-Za-z0-9-]{1,100}"))) }
 private val marker = AtomicFile(File(context.noBackupFilesDir, markerName))
 companion object { private val lock = Any() }
 data class PublicIdentity(val thumbprint: String, val publicKeySpki: String)
 private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
 private fun encoded(bytes: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
 private fun describe(key: PublicKey): PublicIdentity = PublicIdentity(
  MessageDigest.getInstance("SHA-256").digest(key.encoded).joinToString("") { "%02x".format(it.toInt() and 255) }, encoded(key.encoded))
 private fun pinned(): String? = try { marker.openRead().bufferedReader(Charsets.US_ASCII).use { it.readText() } } catch (_: java.io.FileNotFoundException) { null }
 private fun checked(ks: KeyStore): PublicIdentity? {
  val pin = pinned()
  if (!ks.containsAlias(alias)) { check(pin == null) { "Installation signing key missing" }; return null }
  val identity = describe(ks.getCertificate(alias).publicKey)
  check(pin == identity.thumbprint) { "Installation identity mismatch" }
  return identity
 }
 fun publicIdentity(): PublicIdentity? = synchronized(lock) { checked(store()) }
 fun create(): PublicIdentity = synchronized(lock) {
  val ks = store()
  checked(ks)?.let { return@synchronized it }
  val pair = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
   initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build())
  }.generateKeyPair()
  val identity = describe(pair.public)
  val stream = marker.startWrite()
  try { stream.write(identity.thumbprint.toByteArray(Charsets.US_ASCII)); marker.finishWrite(stream) }
  catch (e: Exception) { marker.failWrite(stream); throw e }
  identity
 }
 /** Future transport must validate issuer/audience and consume a fresh, single-use server nonce. */
 fun signEnrollmentChallenge(audience: String, requestId: String, challenge: String): JSONObject = synchronized(lock) {
  require(audience.matches(Regex("[A-Za-z0-9._:/-]{1,128}")))
  require(UUID.fromString(requestId).toString() == requestId)
  require(challenge.length in 43..86 && challenge.matches(Regex("[A-Za-z0-9_-]+")))
  val nonce = Base64.getUrlDecoder().decode(challenge)
  require(nonce.size in 32..64 && encoded(nonce) == challenge)
  val ks = store(); val identity = checked(ks) ?: error("Installation signing key not initialized")
  val message = "mercury-enrollment-proof-v1\n$audience\n$requestId\n$challenge\n${identity.thumbprint}"
  val signature = Signature.getInstance("SHA256withECDSA").run {
   initSign(ks.getKey(alias,null) as PrivateKey); update(message.toByteArray(Charsets.US_ASCII)); sign()
  }
  JSONObject().put("version",1).put("algorithm","SHA256withECDSA").put("audience",audience).put("request_id",requestId)
   .put("challenge",challenge).put("device_thumbprint",identity.thumbprint).put("public_key_spki",identity.publicKeySpki)
   .put("signature_der",encoded(signature))
 }
}
