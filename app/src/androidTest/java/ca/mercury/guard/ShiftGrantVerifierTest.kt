package ca.mercury.guard

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64

class ShiftGrantVerifierTest {
 companion object {
  private val pair by lazy { KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair() }
 }
 private val binding = GrantBinding("guard-test", "site-test", "assignment-test", "a".repeat(64), 7)
 private val anchor = ServerTimeAnchor(1800000000000L, 1000, 3)
 private fun claims() = JSONObject().put("version",1).put("grant_id","grant-test")
  .put("issuer","https://staging.example.invalid").put("audience","mercury-guard-staging")
  .put("guard_id",binding.guardId).put("site_id",binding.siteId).put("assignment_id",binding.assignmentId)
  .put("device_thumbprint",binding.deviceThumbprint).put("revocation_version",7)
  .put("issued_at_ms",anchor.epochMillis).put("not_before_ms",anchor.epochMillis).put("expires_at_ms",anchor.epochMillis+60000)
  .put("actions",JSONArray().put("incident").put("check_in"))
 private fun verifier() = ShiftGrantVerifier("https://staging.example.invalid","mercury-guard-staging",mapOf("test-key" to pair.public))
 private fun encoded(raw: String) = Base64.getUrlEncoder().withoutPadding().encodeToString(raw.toByteArray(Charsets.UTF_8))
 private fun sign(payload: String, id: String = "test-key"): String = Base64.getUrlEncoder().withoutPadding().encodeToString(Signature.getInstance("SHA256withRSA").run {
  initSign(pair.private); update("mercury-shift-grant-v1.$id.$payload".toByteArray(Charsets.US_ASCII)); sign()
 })
 private fun verify(c: JSONObject, expected: GrantBinding = binding, elapsed: Long = 1000, boot: Int = 3): VerifiedShiftGrant? {
  val payload = encoded(c.toString()); return verifier().verify("test-key",payload,sign(payload),expected,anchor,elapsed,boot)
 }
 @Test fun validGrantBindsActionScopeBootAndMonotonicExpiry() {
  val grant = verify(claims())!!
  assertEquals("grant-test",grant.grantId)
  assertTrue(grant.permits("incident",binding,1000,3))
  assertTrue(grant.permits("check_in",binding,60999,3))
  assertFalse(grant.permits("incident",binding,61000,3))
  assertFalse(grant.permits("location",binding,1000,3))
  assertFalse(grant.permits("incident",binding,999,3))
  assertFalse(grant.permits("incident",binding,1000,4))
  assertFalse(grant.permits("incident",binding.copy(siteId="other"),1000,3))
  assertFalse(grant.permits("incident",binding.copy(revocationVersion=8),1000,3))
 }
 @Test fun tamperingUnknownKeysAndEmptyTrustAreRejected() {
  val payload = encoded(claims().toString()); val signature = sign(payload)
  assertNull(verifier().verify("test-key",encoded(claims().put("site_id","other").toString()),signature,binding,anchor,1000,3))
  val bytes = Base64.getUrlDecoder().decode(signature); bytes[0] = (bytes[0].toInt() xor 1).toByte()
  assertNull(verifier().verify("test-key",payload,Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),binding,anchor,1000,3))
  assertNull(verifier().verify("other-key",payload,sign(payload,"other-key"),binding,anchor,1000,3))
  assertNull(ShiftGrantVerifier("https://staging.example.invalid","mercury-guard-staging",emptyMap()).verify("test-key",payload,signature,binding,anchor,1000,3))
 }
 @Test fun signedButIncorrectBindingsAreRejected() {
  for (name in listOf("issuer","audience","guard_id","site_id","assignment_id","device_thumbprint")) assertNull(name,verify(claims().put(name,"other")))
  assertNull(verify(claims().put("revocation_version",8)))
  assertNull(verify(claims(),binding.copy(guardId="other")))
  assertNull(verify(claims().put("actions",JSONArray().put("admin"))))
  assertNull(verify(claims().put("actions",JSONArray().put("incident").put("incident"))))
 }
 @Test fun expiredFutureAndOverlongGrantsAndInvalidTimeAnchorsFail() {
  assertNull(verify(claims(),elapsed=61000))
  assertNull(verify(claims().put("issued_at_ms",anchor.epochMillis+1).put("not_before_ms",anchor.epochMillis+1)))
  assertNull(verify(claims().put("not_before_ms",anchor.epochMillis+1)))
  assertNull(verify(claims().put("expires_at_ms",anchor.epochMillis+ShiftGrantVerifier.MAX_LIFETIME_MS+1)))
  assertNull(verify(claims(),elapsed=999)); assertNull(verify(claims(),boot=4))
  val p = encoded(claims().toString())
  assertNull(verifier().verify("test-key",p,sign(p),binding,anchor.copy(bootCount=-1),1000,-1))
  assertNull(verifier().verify("test-key",p,sign(p),binding,anchor.copy(epochMillis=Long.MAX_VALUE),1001,3))
 }
 @Test fun malformedDuplicateUnknownAndCoercedClaimsFailClosed() {
  for (c in listOf(claims().put("version","1"), claims().put("revocation_version",7.5), claims().put("extra",true), claims().put("grant_id",""), claims().put("actions",JSONArray()))) assertNull(verify(c))
  val raw = claims().toString()
  for (text in listOf("{}",raw+" trailing", " "+raw,raw.dropLast(1)+",\"site_id\":\"site-test\"}")) {
   val p = encoded(text); assertNull(verifier().verify("test-key",p,sign(p),binding,anchor,1000,3))
  }
  assertNull(verifier().verify("test-key","x".repeat(16385),"bad",binding,anchor,1000,3))
  val p = encoded(raw); assertNull(verifier().verify("test-key",p+"=",sign(p+"="),binding,anchor,1000,3))
 }
 @Test fun remainingLifetimeUsesFreshTrustedServerTime() {
  val grant = verify(claims(),elapsed=31000)!!
  assertTrue(grant.permits("incident",binding,60999,3))
  assertFalse(grant.permits("incident",binding,61000,3))
  assertFalse(grant.permits("incident",binding,30000,3))
  val other = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
  val p = encoded(claims().toString())
  assertNull(ShiftGrantVerifier("https://staging.example.invalid","mercury-guard-staging",mapOf("test-key" to other.public)).verify("test-key",p,sign(p),binding,anchor,1000,3))
 }
}
