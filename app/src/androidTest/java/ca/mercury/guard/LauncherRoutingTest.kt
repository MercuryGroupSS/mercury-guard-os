package ca.mercury.guard
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.util.Base64
class LauncherRoutingTest{
 @Test fun packagedTrustRoutesAndInvalidTrustNeverFallsBackToDemo(){
  assertEquals(LauncherActivity.Destination.DEMO,LauncherActivity.destination{null})
  assertEquals(LauncherActivity.Destination.INVALID,LauncherActivity.destination{error("Invalid trust")})
  val key=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair().public
  val raw=JSONObject().put("endpoint","https://example.test").put("issuer","test").put("audience","mercury-local").put("device_id","test-phone").put("issuer_keys",JSONObject().put("test",Base64.getUrlEncoder().withoutPadding().encodeToString(key.encoded)))
  assertEquals(LauncherActivity.Destination.ACCOUNT,LauncherActivity.destination{GuardServiceConfig.parse(raw.toString())})
  raw.put("endpoint","http://example.test");assertEquals(LauncherActivity.Destination.INVALID,LauncherActivity.destination{GuardServiceConfig.parse(raw.toString())})
 }
 @Test fun onlyLauncherIsExternallyLaunchable(){
  val c=InstrumentationRegistry.getInstrumentation().targetContext;val pm=c.packageManager
  assertEquals(LauncherActivity::class.java.name,pm.getLaunchIntentForPackage(c.packageName)!!.component!!.className)
  for(type in listOf(MainActivity::class.java,GuardAccountActivity::class.java))assertFalse(pm.getActivityInfo(android.content.ComponentName(c,type),0).exported)
 }
}
