package ca.mercury.guard

import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.util.Base64
import java.util.UUID

class PersonalAccountTest {
 private class Fixture {
  val issuer=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair()
  private fun encoded(bytes:ByteArray)=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
  val config=GuardServiceConfig.parse(JSONObject().put("endpoint","https://guard.test").put("issuer","test").put("audience","test").put("device_id","personal-test-phone").put("issuer_keys",JSONObject().put("test",encoded(issuer.public.encoded))).toString())
  val thumb="a".repeat(64)
  fun credential():JSONObject {
   val refresh="private-synthetic-fixture-only";val now=System.currentTimeMillis()
   val hash=MessageDigest.getInstance("SHA-256").digest(refresh.toByteArray()).joinToString(""){"%02x".format(it.toInt() and 255)}
   val claims=JSONObject().put("version",1).put("issuer","test").put("audience","test").put("origin","https://guard.test").put("subject",UUID.randomUUID().toString()).put("session_id",UUID.randomUUID().toString()).put("guard_id","guard").put("vendor_id","company").put("device_id",config.deviceId).put("thumbprint",thumb).put("revocation_version",0).put("issued_at_ms",now).put("expires_at_ms",now+30*86400000L).put("refresh_sha256",hash)
   val payload=encoded(claims.toString().toByteArray());val signature=Signature.getInstance("SHA256withRSA").run{initSign(issuer.private);update("mercury-personal-session-v1.test.$payload".toByteArray());sign()}
   return JSONObject().put("refresh_token",refresh).put("permit",JSONObject().put("payload",payload).put("signature",encoded(signature)))
  }
 }
 private fun rejected(action:()->Unit){try{action();fail("Untrusted personal credential accepted")}catch(_:IllegalArgumentException){}catch(_:IllegalStateException){}}
 @Test fun signedPersonalCredentialRejectsWrongInstallationServiceRefreshAndTampering(){
  val f=Fixture();val c=f.credential();PersonalAccountProtocol.validate(c,f.config,f.thumb)
  rejected{PersonalAccountProtocol.validate(c,f.config,"b".repeat(64))}
  val other=Fixture();rejected{PersonalAccountProtocol.validate(c,other.config,f.thumb)}
  c.put("refresh_token","other-private-fixture");rejected{PersonalAccountProtocol.validate(c,f.config,f.thumb)}
  val changed=f.credential();changed.getJSONObject("permit").put("signature",Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(256)))
  rejected{PersonalAccountProtocol.validate(changed,f.config,f.thumb)}
 }
 @Test fun personalVaultCannotDecryptWithoutBiometricAndForgetCannotResurrectIt(){
  val context=ApplicationProvider.getApplicationContext<Context>();val f=Fixture();val name="personal-test-"+UUID.randomUUID().toString();val store=PersonalAccountStore(context,name)
  try{
   val ready=if(Build.VERSION.SDK_INT>=30)context.getSystemService(BiometricManager::class.java).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)==BiometricManager.BIOMETRIC_SUCCESS else context.getSystemService(android.hardware.fingerprint.FingerprintManager::class.java).hasEnrolledFingerprints()
   if(androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("requireBiometricVault")=="true")assertTrue("Physical acceptance requires the enrolled strong-biometric vault branch",ready)
   if(!ready){var denied=false;try{store.establish(f.config,f.thumb,f.credential())}catch(_:Exception){denied=true};assertTrue("No fingerprint must not establish return access",denied);return}
   store.establish(f.config,f.thumb,f.credential());assertTrue(store.available(f.config,f.thumb))
   val pending=store.prepareUnlock(f.config,f.thumb)
   var denied=false;try{store.unlock(pending,pending.cipher,f.config,f.thumb)}catch(_:Exception){denied=true};assertTrue("A cipher without a successful real biometric must not decrypt",denied)
   val stale=PersonalAccountStore.Opened(pending.generation,f.credential());store.forget();assertFalse(store.available(f.config,f.thumb));assertFalse(store.rotate(stale,f.config,f.thumb,f.credential()));stale.clear()
  }finally{store.forget()}
 }
}
