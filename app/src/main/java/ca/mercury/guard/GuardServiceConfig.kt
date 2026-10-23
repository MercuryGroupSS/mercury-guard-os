package ca.mercury.guard

import android.content.Context
import org.json.JSONObject
import java.security.KeyFactory
import java.security.PublicKey
import java.security.interfaces.RSAPublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/** Public trust configuration packaged by the administrator, never read from an Intent or login form. */
class GuardServiceConfig private constructor(val endpoint: String, val issuer: String, val audience: String, val deviceId: String, val keys: Map<String,PublicKey>) {
 internal fun uploadBinding():String {
  val values=org.json.JSONArray().put(endpoint).put(issuer).put(audience).put(deviceId)
  for(id in keys.keys.sorted())values.put(org.json.JSONArray().put(id).put(Base64.getUrlEncoder().withoutPadding().encodeToString(keys.getValue(id).encoded)))
  return java.security.MessageDigest.getInstance("SHA-256").digest(values.toString().toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
 }
 companion object {
  fun load(context: Context): GuardServiceConfig? {
   if (!context.assets.list("").orEmpty().contains("guard-service.json")) return null
   val raw = context.assets.open("guard-service.json").use { stream ->
    val bytes = stream.readBytes(); require(bytes.size <= 16384); String(bytes,Charsets.UTF_8)
   }
   return parse(raw)
  }
  internal fun parse(raw: String): GuardServiceConfig {
   val data = JSONObject(raw)
   require(data.keys().asSequence().toSet() == setOf("endpoint","issuer","audience","device_id","issuer_keys"))
   fun text(key: String) = (data.get(key) as? String ?: error("String required")).also { require(it.isNotBlank() && it.length <= 256) }
   val endpoint=text("endpoint"); GuardAccountClient(endpoint)
   val audience=text("audience"); require(audience.matches(Regex("[A-Za-z0-9._:/-]{1,128}")))
   val device=text("device_id"); require(device.matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}")))
   val encoded=data.getJSONObject("issuer_keys"); require(encoded.length() in 1..4)
   val keys=encoded.keys().asSequence().associateWith { id ->
    require(id.matches(Regex("[A-Za-z0-9_-]{1,64}")))
    val value=encoded.get(id) as? String ?: error("Public key required")
    require(value.length in 1..4096 && value.matches(Regex("[A-Za-z0-9_-]+")))
    val bytes=Base64.getUrlDecoder().decode(value)
    require(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)==value)
    val key=KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(bytes)) as RSAPublicKey
    require(key.modulus.bitLength() >= 2048); key as PublicKey
   }
   return GuardServiceConfig(endpoint,text("issuer"),audience,device,keys)
  }
 }
}
