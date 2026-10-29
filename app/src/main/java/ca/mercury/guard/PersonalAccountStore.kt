package ca.mercury.guard

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.*
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/** Personal return credential only. Separate from installation signing and upload keys.
 * A fresh strong-biometric CryptoObject unwraps a random data key. Public-key
 * wrapping lets a rotated credential be saved without a second fingerprint. */
internal class PersonalAccountStore(context:Context,name:String="personal-account-v1") {
 init{require(name.matches(Regex("[A-Za-z0-9-]{1,100}")))}
 private val file=AtomicFile(File(context.noBackupFilesDir,name))
 private val alias="mercury.personal.biometric.$name"
 companion object {private val lock=Any();private val oaep=OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA1,PSource.PSpecified.DEFAULT)}
 internal class Pending(val generation:String,internal val envelope:JSONObject,val cipher:Cipher)
 internal class Opened(val generation:String,val credential:JSONObject){override fun toString()="PersonalAccount(redacted)";fun clear(){credential.remove("refresh_token")}}
 private fun ks()=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
 private fun encode(bytes:ByteArray)=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
 private fun decode(value:String,max:Int):ByteArray {require(value.length<=max*2&&value.matches(Regex("[A-Za-z0-9_-]+")));return Base64.getUrlDecoder().decode(value).also{require(it.size<=max&&encode(it)==value)}}
 private fun raw():JSONObject?=try{file.openRead().use{require(it.available()<=65536);JSONObject(String(it.readBytes(),Charsets.UTF_8))}}catch(_:java.io.FileNotFoundException){null}
 private fun binding(config:GuardServiceConfig,thumb:String)="mercury-personal-account-v1:${config.uploadBinding()}:$thumb"
 private fun read(config:GuardServiceConfig,thumb:String):JSONObject? {
  val j=raw()?:return null
  require(j.keys().asSequence().toSet()==setOf("generation","binding","key","wrapped","iv","encrypted"))
  require(EscalationRules.uuid(j.getString("generation"))&&j.getString("binding")==binding(config,thumb))
  val public=ks().getCertificate(alias)?.publicKey?:error("Personal fingerprint key unavailable")
  require(j.getString("key")==encode(MessageDigest.getInstance("SHA-256").digest(public.encoded)))
  return j
 }
 fun available(config:GuardServiceConfig,thumb:String):Boolean=synchronized(lock){read(config,thumb)!=null}
 fun prepareUnlock(config:GuardServiceConfig,thumb:String):Pending=synchronized(lock){
  val j=read(config,thumb)?:error("Personal setup required")
  val cipher=Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding").apply{init(Cipher.DECRYPT_MODE,ks().getKey(alias,null),oaep)}
  Pending(j.getString("generation"),j,cipher)
 }
 fun unlock(pending:Pending,authenticated:Cipher,config:GuardServiceConfig,thumb:String):Opened=synchronized(lock){
  check(authenticated===pending.cipher&&read(config,thumb)?.getString("generation")==pending.generation)
  val j=pending.envelope;val key=authenticated.doFinal(decode(j.getString("wrapped"),512))
  try{require(key.size==32);val bytes=Cipher.getInstance("AES/GCM/NoPadding").run{init(Cipher.DECRYPT_MODE,SecretKeySpec(key,"AES"),GCMParameterSpec(128,decode(j.getString("iv"),12)));updateAAD(j.getString("binding").toByteArray(Charsets.UTF_8));doFinal(decode(j.getString("encrypted"),32768))}
   try{Opened(pending.generation,JSONObject(String(bytes,Charsets.UTF_8)).also{PersonalAccountProtocol.validate(it,config,thumb)})}finally{bytes.fill(0)}
  }finally{key.fill(0)}
 }
 /** Explicit initial setup, after password authentication of this approved personal phone. */
 fun establish(config:GuardServiceConfig,thumb:String,credential:JSONObject)=synchronized(lock){
  PersonalAccountProtocol.validate(credential,config,thumb)
  // Never replace an existing key silently. Forgetting this personal account is explicit.
  check(raw()==null&&!ks().containsAlias(alias)){"Forget the previous personal account before setup"}
  val spec=KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_DECRYPT).setKeySize(2048).setDigests(KeyProperties.DIGEST_SHA256).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP).setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true)
  if(Build.VERSION.SDK_INT>=30)spec.setUserAuthenticationParameters(0,KeyProperties.AUTH_BIOMETRIC_STRONG)else spec.setUserAuthenticationValidityDurationSeconds(-1)
  KeyPairGenerator.getInstance("RSA","AndroidKeyStore").apply{initialize(spec.build())}.generateKeyPair()
  try{write(config,thumb,credential,UUID.randomUUID().toString())}catch(e:Exception){ks().deleteEntry(alias);throw e}
 }
 /** CAS prevents an abandoned refresh from restoring a forgotten account. */
 fun rotate(opened:Opened,config:GuardServiceConfig,thumb:String,credential:JSONObject):Boolean=synchronized(lock){
  PersonalAccountProtocol.validate(credential,config,thumb)
  if(read(config,thumb)?.getString("generation")!=opened.generation)return@synchronized false
  write(config,thumb,credential,UUID.randomUUID().toString());true
 }
 private fun write(config:GuardServiceConfig,thumb:String,credential:JSONObject,generation:String){
  val public=KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(ks().getCertificate(alias).publicKey.encoded));val key=ByteArray(32).also{SecureRandom().nextBytes(it)};val aad=binding(config,thumb)
  val bytes=credential.toString().toByteArray(Charsets.UTF_8)
  try{
   val aes=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.ENCRYPT_MODE,SecretKeySpec(key,"AES"));updateAAD(aad.toByteArray(Charsets.UTF_8))}
   val encrypted=aes.doFinal(bytes);val wrapped=Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding").run{init(Cipher.ENCRYPT_MODE,public,oaep);doFinal(key)}
   val j=JSONObject().put("generation",generation).put("binding",aad).put("key",encode(MessageDigest.getInstance("SHA-256").digest(public.encoded))).put("wrapped",encode(wrapped)).put("iv",encode(aes.iv)).put("encrypted",encode(encrypted))
   val out=file.startWrite();try{out.write(j.toString().toByteArray(Charsets.UTF_8));file.finishWrite(out)}catch(e:Exception){file.failWrite(out);throw e}
  }finally{key.fill(0);bytes.fill(0)}
 }
 fun forget(generation:String?=null)=synchronized(lock){
  if(generation!=null&&raw()?.optString("generation")!=generation)return@synchronized
  file.delete();ks().deleteEntry(alias)
 }
}

internal object PersonalAccountProtocol {
 fun validate(credential:JSONObject,config:GuardServiceConfig,thumb:String){
  require(credential.keys().asSequence().toSet()==setOf("refresh_token","permit"))
  val token=credential.getString("refresh_token");require(token.length in 1..16384&&token.none{it.isWhitespace()})
  val permit=credential.getJSONObject("permit");require(permit.keys().asSequence().toSet()==setOf("payload","signature"))
  val payload=permit.getString("payload");require(payload.length in 1..4096&&payload.matches(Regex("[A-Za-z0-9_-]+")))
  val decoded=Base64.getUrlDecoder().decode(payload);require(Base64.getUrlEncoder().withoutPadding().encodeToString(decoded)==payload)
  val j=JSONObject(String(decoded,Charsets.UTF_8))
  require(j.keys().asSequence().toSet()==setOf("version","issuer","audience","origin","subject","session_id","guard_id","vendor_id","device_id","thumbprint","revocation_version","issued_at_ms","expires_at_ms","refresh_sha256"))
  require(j.getInt("version")==1&&j.getString("issuer")==config.issuer&&j.getString("audience")==config.audience&&j.getString("origin")==config.endpoint.trimEnd('/')&&j.getString("device_id")==config.deviceId&&j.getString("thumbprint")==thumb)
  require(EscalationRules.uuid(j.getString("subject"))&&EscalationRules.uuid(j.getString("session_id")))
  for(k in listOf("guard_id","vendor_id"))require(j.getString(k).matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}")))
  require(j.getLong("revocation_version")>=0&&j.getLong("issued_at_ms")>0&&Math.subtractExact(j.getLong("expires_at_ms"),j.getLong("issued_at_ms"))==30*86400000L)
  val hash=MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)};require(j.getString("refresh_sha256")==hash)
  val signature=Base64.getUrlDecoder().decode(permit.getString("signature"));require(signature.size in 256..512)
  require(config.keys.any{(id,key)->Signature.getInstance("SHA256withRSA").run{initVerify(key);update("mercury-personal-session-v1.$id.$payload".toByteArray(Charsets.UTF_8));verify(signature)}})
 }
}
