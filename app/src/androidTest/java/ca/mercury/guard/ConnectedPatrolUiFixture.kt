package ca.mercury.guard

import android.content.Context
import android.os.SystemClock
import org.json.JSONObject
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.util.Base64
import java.util.UUID

/** Explicit synthetic presentation after the account boundary; no authentication/capture success injection. */
internal class ConnectedPatrolUiFixture(private val context:Context):java.io.Closeable {
 private val identity=DeviceIdentity(context)
 private val previous=identity.publicIdentity()
 private val key=previous?:identity.create()
 private val subject=UUID.randomUUID().toString()
 private val public=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair().public
 private val config=GuardServiceConfig.parse(JSONObject().put("endpoint","https://patrol-ui.invalid").put("issuer","patrol-ui").put("audience","patrol-ui").put("device_id","patrol-ui-phone")
  .put("issuer_keys",JSONObject().put("patrol-ui",Base64.getUrlEncoder().withoutPadding().encodeToString(public.encoded))).toString())
 fun prepare(activity:GuardAccountActivity,binding:GrantBinding):GrantBinding {
  fun field(name:String,value:Any?){GuardAccountActivity::class.java.getDeclaredField(name).apply{isAccessible=true;set(activity,value)}}
  val original=binding.copy(deviceThumbprint=key.thumbprint)
  field("config",config);field("session",GuardAccountClient.Session("synthetic-patrol-presentation-only",SystemClock.elapsedRealtime()+60000));field("captureBinding",original)
  val type=GuardAccountActivity::class.java.declaredClasses.single{it.simpleName=="AccountIdentity"}
  field("accountIdentity",type.getDeclaredConstructor(String::class.java,String::class.java,String::class.java).apply{isAccessible=true}.newInstance(subject,original.guardId,"synthetic-patrol-company"))
  return original
 }
 override fun close(){if(previous==null){check(identity.publicIdentity()==key);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry("mercury.device.signing.v1")};File(context.noBackupFilesDir,"device-identity-v1").delete();File(context.noBackupFilesDir,"device-identity-v1.bak").delete()}}
}
