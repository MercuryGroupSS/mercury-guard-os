package ca.mercury.guard

import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyFactory
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.UUID

class DeviceIdentityTest {
 private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
 private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
 private fun encoded(bytes: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
 private fun isolated(block: (DeviceIdentity,String,String) -> Unit) {
  val id = UUID.randomUUID().toString(); val alias = "mercury.test.identity.$id"; val marker = "test-identity-$id"
  try { block(DeviceIdentity(context,alias,marker),alias,marker) }
  finally { keyStore().deleteEntry(alias); File(context.noBackupFilesDir,marker).delete(); File(context.noBackupFilesDir,"$marker.bak").delete() }
 }
 private fun reject(block: () -> Unit) { var failed = false; try { block() } catch (_: Exception) { failed = true }; assertTrue(failed) }
 @Test fun identityIsExplicitStableAndPrivateKeyIsNotExported() = isolated { identity,alias,marker ->
  assertNull(identity.publicIdentity()); assertFalse(keyStore().containsAlias(alias))
  val first = identity.create()
  assertEquals(first, identity.create()); assertEquals(first, DeviceIdentity(context,alias,marker).publicIdentity())
  val key = keyStore().getKey(alias,null)
  assertNull(key.encoded)
  val publicBytes = Base64.getUrlDecoder().decode(first.publicKeySpki)
  assertEquals(first.thumbprint,MessageDigest.getInstance("SHA-256").digest(publicBytes).joinToString("") { "%02x".format(it.toInt() and 255) })
 }
 @Test fun challengeSignatureVerifiesAndBindsNonceAudienceAndRequest() = isolated { identity,_,_ ->
  val public = identity.create()
  val nonce = encoded(ByteArray(32).apply { SecureRandom().nextBytes(this) })
  val request = UUID.randomUUID().toString(); val audience = "mercury-staging"
  val proof = identity.signEnrollmentChallenge(audience,request,nonce)
  val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.getUrlDecoder().decode(public.publicKeySpki)))
  fun verifies(a: String, r: String, n: String): Boolean = Signature.getInstance("SHA256withECDSA").run {
   initVerify(key); update("mercury-enrollment-proof-v1\n$a\n$r\n$n\n${public.thumbprint}".toByteArray(Charsets.US_ASCII))
   verify(Base64.getUrlDecoder().decode(proof.getString("signature_der")))
  }
  assertTrue(verifies(audience,request,nonce))
  assertFalse(verifies("other",request,nonce)); assertFalse(verifies(audience,UUID.randomUUID().toString(),nonce))
  assertFalse(verifies(audience,request,encoded(ByteArray(32))))
  assertEquals(public.thumbprint,proof.getString("device_thumbprint")); assertEquals(public.publicKeySpki,proof.getString("public_key_spki"))
 }
 @Test fun missingOrMismatchedKeyNeverSilentlyRegenerates() = isolated { identity,alias,marker ->
  val first = identity.create()
  File(context.noBackupFilesDir,marker).writeText("wrong-pin")
  reject { identity.publicIdentity() }; reject { identity.create() }
  assertEquals(first.publicKeySpki,encoded(keyStore().getCertificate(alias).publicKey.encoded))
  File(context.noBackupFilesDir,marker).writeText(first.thumbprint)
  keyStore().deleteEntry(alias)
  reject { identity.publicIdentity() }; reject { identity.create() }
  reject { identity.signEnrollmentChallenge("mercury-staging",UUID.randomUUID().toString(),encoded(ByteArray(32))) }
  assertFalse(keyStore().containsAlias(alias))
 }
 @Test fun malformedChallengeDoesNotInitializeOrReplaceIdentity() = isolated { identity,alias,_ ->
  val request = UUID.randomUUID().toString(); val nonce = encoded(ByteArray(32))
  reject { identity.signEnrollmentChallenge("mercury-staging",request,nonce) }
  assertFalse(keyStore().containsAlias(alias))
  val first = identity.create()
  reject { identity.signEnrollmentChallenge("bad\naudience",request,nonce) }
  reject { identity.signEnrollmentChallenge("mercury-staging","not-a-uuid",nonce) }
  reject { identity.signEnrollmentChallenge("mercury-staging",request,"short") }
  reject { identity.signEnrollmentChallenge("mercury-staging",request,nonce+"=") }
  reject { identity.signEnrollmentChallenge("mercury-staging",request,encoded(ByteArray(65))) }
  assertEquals(first,identity.publicIdentity())
 }
 @Test fun uiRequiresConfirmationAndShowsFingerprintAfterRecreation() {
  DemoSession(context).end()
  ActivityScenario.launch(MainActivity::class.java).use { scenario ->
   onView(withText("Device information")).perform(scrollTo(),click())
   onView(withText("Create installation identity")).perform(scrollTo(),click())
   onView(withText("Cancel")).perform(click())
   assertNull(DeviceIdentity(context).publicIdentity())
   onView(withText("Create installation identity")).perform(scrollTo(),click())
   onView(withText("Create key")).perform(click())
   val deadline = android.os.SystemClock.elapsedRealtime() + 10000
   var generated = DeviceIdentity(context).publicIdentity()
   while (generated == null && android.os.SystemClock.elapsedRealtime() < deadline) {
    android.os.SystemClock.sleep(50); generated = DeviceIdentity(context).publicIdentity()
   }
   val identity = generated!!
   InstrumentationRegistry.getInstrumentation().waitForIdleSync()
   scenario.recreate()
   onView(withText("Installation public-key fingerprint: ${identity.thumbprint}")).perform(scrollTo()).check(matches(isDisplayed()))
   assertEquals(identity,DeviceIdentity(context).publicIdentity())
   assertFalse(DemoSession(context).active())
  }
 }
}
