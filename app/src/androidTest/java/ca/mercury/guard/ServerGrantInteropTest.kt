package ca.mercury.guard

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.KeyFactory
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

class ServerGrantInteropTest {
 @Test fun acceptsNodeIssuedGrantAndRejectsWrongGuardAndExpiry() {
  val fixture = JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("server-grant-fixture.json").bufferedReader().use { it.readText() })
  val key = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(Base64.getUrlDecoder().decode(fixture.getString("public_key_spki"))))
  val verifier = ShiftGrantVerifier("mercury-local", "mercury-local", mapOf("fixture-v1" to key))
  val binding = GrantBinding("synthetic-guard", "synthetic-site", "synthetic-shift", "a".repeat(64), 1)
  val anchor = ServerTimeAnchor(fixture.getLong("server_time_ms"), 1000, 2)
  fun verify(expected: GrantBinding, elapsed: Long) = verifier.verify(fixture.getString("key_id"), fixture.getString("payload"), fixture.getString("signature"), expected, anchor, elapsed, 2)
  val grant = verify(binding, 1000)
  assertNotNull(grant)
  assertTrue(grant!!.permits("incident", binding, 1000, 2))
  assertFalse(grant.permits("photo", binding, 1000, 2))
  assertNull(verify(binding.copy(guardId = "another-guard"), 1000))
  assertNull(verify(binding, 61000))
 }
}
