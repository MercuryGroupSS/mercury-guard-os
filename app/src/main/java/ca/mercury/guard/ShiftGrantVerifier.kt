package ca.mercury.guard

import org.json.JSONObject
import java.security.PublicKey
import java.security.Signature
import java.security.interfaces.RSAPublicKey
import java.util.Base64

/** Provisional staging protocol only. DemoSession never consumes these grants. */
data class GrantBinding(val guardId: String, val siteId: String, val assignmentId: String, val deviceThumbprint: String, val revocationVersion: Long)
/** Must originate from a fresh authenticated server response, never the editable device wall clock. */
data class ServerTimeAnchor(val epochMillis: Long, val elapsedMillis: Long, val bootCount: Int)

class VerifiedShiftGrant internal constructor(
 val grantId: String, private val binding: GrantBinding, private val actions: Set<String>,
 private val acceptedElapsed: Long, internal val expiresElapsed: Long, private val bootCount: Int,
 val location:AuthorizedLocationConsent?=null, internal val notBeforeEpoch:Long=0,internal val expiresEpoch:Long=0
) {
 fun permits(action: String, currentBinding: GrantBinding, elapsedMillis: Long, currentBoot: Int): Boolean =
  currentBinding == binding && action in actions && (action!="location"||location!=null) && currentBoot >= 0 && currentBoot == bootCount &&
   elapsedMillis >= acceptedElapsed && elapsedMillis < expiresElapsed
}

class ShiftGrantVerifier(private val issuer: String, private val audience: String, trustedKeys: Map<String, PublicKey>) {
 private val keys = trustedKeys.toMap()
 companion object {
  const val MAX_LIFETIME_MS = 15 * 60 * 1000L
  private val supportedActions = setOf("patrol", "incident", "photo", "check_in", "location", "dispatch_ack")
  private val fields = setOf("version", "grant_id", "issuer", "audience", "guard_id", "site_id", "assignment_id", "device_thumbprint", "revocation_version", "issued_at_ms", "not_before_ms", "expires_at_ms", "actions")
 }
 /** Fixed RSA-SHA256 envelope; no algorithm selection, embedded keys or remote key fetching. */
 fun verify(keyId: String, payload: String, signature: String, expected: GrantBinding, anchor: ServerTimeAnchor,
            elapsedMillis: Long, bootCount: Int): VerifiedShiftGrant? = try {
  verifyChecked(keyId, payload, signature, expected, anchor, elapsedMillis, bootCount)
 } catch (_: Exception) { null }
 private fun decode(text: String, max: Int): ByteArray {
  require(text.length in 1..max && text.matches(Regex("[A-Za-z0-9_-]+")))
  val bytes = Base64.getUrlDecoder().decode(text)
  require(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) == text)
  return bytes
 }
 private fun verifyChecked(keyId: String, payload: String, signature: String, expected: GrantBinding,
                           anchor: ServerTimeAnchor, elapsedMillis: Long, bootCount: Int): VerifiedShiftGrant {
  require(keyId.matches(Regex("[A-Za-z0-9_-]{1,64}")))
  val key = keys[keyId] as? RSAPublicKey ?: error("Untrusted key")
  require(key.modulus.bitLength() >= 2048)
  val bytes = decode(payload, 16384)
  val signatureBytes = decode(signature, 2048)
  require(Signature.getInstance("SHA256withRSA").run {
   initVerify(key); update("mercury-shift-grant-v1.$keyId.$payload".toByteArray(Charsets.US_ASCII)); verify(signatureBytes)
  })
  val raw = String(bytes, Charsets.UTF_8)
  require(raw.toByteArray(Charsets.UTF_8).contentEquals(bytes))
  val claims = JSONObject(raw)
  // Fixed compact encoding also rejects duplicate claims, ignored trailing text and coercions.
  require(claims.toString() == raw && claims.keys().asSequence().toSet() in setOf(fields,fields+"location"))
  fun text(name: String): String = (claims.get(name) as? String ?: error("String required")).also { require(it.isNotBlank() && it.length <= 256) }
  fun number(name: String): Long {
   val value = claims.get(name)
   require(value is Int || value is Long)
   return (value as Number).toLong()
  }
  require(number("version") == 1L && text("issuer") == issuer && text("audience") == audience)
  val binding = GrantBinding(text("guard_id"), text("site_id"), text("assignment_id"), text("device_thumbprint"), number("revocation_version"))
  require(binding == expected && binding.deviceThumbprint.matches(Regex("[a-f0-9]{64}")) && binding.revocationVersion >= 0)
  require(anchor.bootCount >= 0 && anchor.bootCount == bootCount && anchor.elapsedMillis >= 0 && elapsedMillis >= anchor.elapsedMillis && anchor.epochMillis > 0)
  val now = Math.addExact(anchor.epochMillis, Math.subtractExact(elapsedMillis, anchor.elapsedMillis))
  val issued = number("issued_at_ms"); val start = number("not_before_ms"); val expiry = number("expires_at_ms")
  require(issued > 0 && issued <= start && start <= now && now < expiry)
  require(Math.subtractExact(expiry, issued) in 1..MAX_LIFETIME_MS)
  val actions = claims.getJSONArray("actions")
  require(actions.length() in 1..supportedActions.size)
  val allowed = (0 until actions.length()).map { actions.get(it) as? String ?: error("Action required") }.toSet()
  require(allowed.size == actions.length() && supportedActions.containsAll(allowed))
  val location=if(claims.has("location"))AuthorizedLocationConsent.parse(claims.getJSONObject("location"))else null
  require((location!=null)==("location" in allowed)||location==null)
  if(location!=null)require(expiry-issued<=location.policy.maxLease)
  return VerifiedShiftGrant(text("grant_id"), binding, allowed, elapsedMillis, Math.addExact(elapsedMillis, Math.subtractExact(expiry, now)), bootCount,location,start,expiry)
 }
}
