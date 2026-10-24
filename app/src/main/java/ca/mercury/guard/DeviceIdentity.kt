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
 /** Distinct domain binds the fresh possession challenge to one exact retained intent or status query. */
 fun signEscalationChallenge(audience:String,operation:String,requestId:String,challenge:String,payloadHash:String):JSONObject=synchronized(lock){
  require(audience.matches(Regex("[A-Za-z0-9._:/-]{1,128}"))&&operation in setOf("create","status")&&EscalationRules.uuid(requestId))
  require(challenge.matches(Regex("[A-Za-z0-9_-]{43}"))&&payloadHash.matches(Regex("[a-f0-9]{64}")))
  val nonce=Base64.getUrlDecoder().decode(challenge);require(nonce.size==32&&encoded(nonce)==challenge)
  val ks=store();val identity=checked(ks)?:error("Installation signing key not initialized")
  val message="mercury-escalation-proof-v1\n$audience\n$operation\n$requestId\n$challenge\n${identity.thumbprint}\n$payloadHash"
  val signature=Signature.getInstance("SHA256withECDSA").run{initSign(ks.getKey(alias,null) as PrivateKey);update(message.toByteArray(Charsets.UTF_8));sign()}
  JSONObject().put("version",1).put("algorithm","SHA256withECDSA").put("audience",audience).put("request_id",requestId).put("challenge",challenge)
   .put("device_thumbprint",identity.thumbprint).put("public_key_spki",identity.publicKeySpki).put("signature_der",encoded(signature))
 }
 /** Consent domain binds one exact approved-policy intent or original-consent status query. */
 fun signLocationConsentChallenge(audience:String,operation:String,requestId:String,challenge:String,payloadHash:String):JSONObject=synchronized(lock){
  require(audience.matches(Regex("[A-Za-z0-9._:/-]{1,128}"))&&operation in setOf("consent","withdraw","status")&&EscalationRules.uuid(requestId))
  require(challenge.matches(Regex("[A-Za-z0-9_-]{43}"))&&payloadHash.matches(Regex("[a-f0-9]{64}")))
  val nonce=Base64.getUrlDecoder().decode(challenge);require(nonce.size==32&&encoded(nonce)==challenge)
  val ks=store();val identity=checked(ks)?:error("Installation signing key not initialized")
  val message="mercury-location-consent-proof-v1\n$audience\n$operation\n$requestId\n$challenge\n${identity.thumbprint}\n$payloadHash"
  val signature=Signature.getInstance("SHA256withECDSA").run{initSign(ks.getKey(alias,null) as PrivateKey);update(message.toByteArray(Charsets.UTF_8));sign()}
  JSONObject().put("version",1).put("algorithm","SHA256withECDSA").put("audience",audience).put("request_id",requestId).put("challenge",challenge)
   .put("device_thumbprint",identity.thumbprint).put("public_key_spki",identity.publicKeySpki).put("signature_der",encoded(signature))
 }
 /** Signs an immutable snapshot of a validated local outbox batch; does not send or acknowledge it. */
 fun signEventBatch(audience: String, batch: JSONObject): JSONObject = signBatch(audience, batch, null)
 /** Caller must supply the original capture binding, never the current assignment of an unscoped queue.
  * This low-level signer does not establish authorization or historical attribution. */
 fun signScopedEventBatch(audience: String, batch: JSONObject, captureBinding: GrantBinding): JSONObject =
  signBatch(audience, batch, captureBinding)
 private fun signBatch(audience: String, batch: JSONObject, captureBinding: GrantBinding?): JSONObject = synchronized(lock) {
  require(audience.matches(Regex("[A-Za-z0-9._:/-]{1,128}")))
  val raw = batch.toString()
  require(raw.toByteArray(Charsets.UTF_8).size <= 263168)
  val snapshot = JSONObject(raw)
  require(snapshot.keys().asSequence().toSet() == setOf("batch_id", "schema_version", "events"))
  fun uuid(value: Any): String = (value as? String ?: error("UUID required")).also { require(UUID.fromString(it).toString() == it) }
  fun integer(value: Any): Long { require(value is Int || value is Long); return (value as Number).toLong() }
  uuid(snapshot.get("batch_id")); require(integer(snapshot.get("schema_version")) == 1L)
  val events = snapshot.getJSONArray("events"); require(events.length() in 1..100)
  val ids = mutableSetOf<String>(); var previous = 0L
  for (i in 0 until events.length()) {
   val event = events.getJSONObject(i)
   require(event.keys().asSequence().toSet() == setOf("event_id", "at", "kind", "data", "sequence"))
   require(ids.add(uuid(event.get("event_id"))))
   val sequence = integer(event.get("sequence")); require(sequence > previous); previous = sequence
   require(integer(event.get("at")) >= 0)
   val kind = event.get("kind") as? String ?: error("Event kind required")
   require(kind.isNotBlank() && kind.length <= 128); event.getJSONObject("data")
  }
  val ks = store(); val identity = checked(ks) ?: error("Installation signing key not initialized")
  val version = if (captureBinding == null) 1 else 2
  if (captureBinding != null) {
   require(captureBinding.deviceThumbprint == identity.thumbprint)
   require(captureBinding.revocationVersion in 0..9007199254740991L)
   for (id in listOf(captureBinding.guardId,captureBinding.siteId,captureBinding.assignmentId)) require(id.isNotBlank() && id.length <= 256)
   for (i in 0 until events.length()) {
    val event = events.getJSONObject(i)
    require(integer(event.get("sequence")) <= 9007199254740991L && integer(event.get("at")) <= 9007199254740991L)
   }
   snapshot.put("schema_version",2).put("scope",JSONObject().put("guard_id",captureBinding.guardId)
    .put("site_id",captureBinding.siteId).put("assignment_id",captureBinding.assignmentId)
    .put("device_thumbprint",captureBinding.deviceThumbprint).put("revocation_version",captureBinding.revocationVersion))
  }
  val signedRaw = if (captureBinding == null) raw else snapshot.toString()
  require(signedRaw.toByteArray(Charsets.UTF_8).size <= 263168)
  val payload = encoded(signedRaw.toByteArray(Charsets.UTF_8))
  val message = "mercury-event-batch-v$version\n$audience\n${identity.thumbprint}\n$payload".toByteArray(Charsets.US_ASCII)
  val signature = Signature.getInstance("SHA256withECDSA").run {
   initSign(ks.getKey(alias,null) as PrivateKey)
   var offset = 0
   while (offset < message.size) {
    val count = minOf(16384,message.size-offset); update(message,offset,count); offset += count
   }
   sign()
  }
  JSONObject().put("version",version).put("algorithm","SHA256withECDSA").put("audience",audience)
   .put("device_thumbprint",identity.thumbprint).put("public_key_spki",identity.publicKeySpki)
   .put("payload",payload).put("signature_der",encoded(signature))
 }

}
