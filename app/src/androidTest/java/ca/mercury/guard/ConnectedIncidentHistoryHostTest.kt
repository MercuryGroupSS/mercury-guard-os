package ca.mercury.guard

import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.util.Base64
import java.util.UUID

/** Synthetic presentation after the fresh-service boundary; no remote Auth/read-authorization claim. */
class ConnectedIncidentHistoryHostTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private fun field(activity:GuardAccountActivity,name:String,value:Any?){GuardAccountActivity::class.java.getDeclaredField(name).apply{isAccessible=true;set(activity,value)}}
 private fun value(activity:GuardAccountActivity,name:String)=GuardAccountActivity::class.java.getDeclaredField(name).apply{isAccessible=true}.get(activity)
 private fun identity(activity:GuardAccountActivity,subject:String){
  val type=GuardAccountActivity::class.java.declaredClasses.single{it.simpleName=="AccountIdentity"}
  field(activity,"accountIdentity",type.getDeclaredConstructor(String::class.java,String::class.java,String::class.java).apply{isAccessible=true}.newInstance(subject,"history-guard","history-company"))
 }
 private fun texts(view:View):List<String> = (if(view is TextView)listOf(view.text.toString())else emptyList())+if(view is ViewGroup)(0 until view.childCount).flatMap{texts(view.getChildAt(it))}else emptyList()
 private fun configured(run:(GuardServiceConfig,String)->Unit){
  val device=DeviceIdentity(context);val prior=device.publicIdentity();val key=prior?:device.create()
  val publicKey=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair().public
  val config=GuardServiceConfig.parse(JSONObject().put("endpoint","https://history-ui.invalid").put("issuer","history-test").put("audience","history-test").put("device_id","history-phone")
   .put("issuer_keys",JSONObject().put("history",Base64.getUrlEncoder().withoutPadding().encodeToString(publicKey.encoded))).toString())
  try{run(config,key.thumbprint)}finally{if(prior==null){check(device.publicIdentity()==key);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry("mercury.device.signing.v1")};File(context.noBackupFilesDir,"device-identity-v1").delete();File(context.noBackupFilesDir,"device-identity-v1.bak").delete()}}
 }
 private fun show(activity:GuardAccountActivity,config:GuardServiceConfig,thumb:String):ConnectedIncidentHistoryView {
  val subject=UUID.randomUUID().toString();field(activity,"config",config);field(activity,"session",GuardAccountClient.Session("synthetic-history-no-network",SystemClock.elapsedRealtime()+60000));identity(activity,subject)
  val owner=ConnectedIncidentDraftScope(config.uploadBinding(),config.deviceId,thumb,subject,"history-guard","history-company","history-site","history-${UUID.randomUUID()}")
  val item=JSONObject().put("guardId",owner.guardId).put("vendorId",owner.vendorId).put("siteId",owner.siteId).put("assignmentId",owner.assignmentId).put("deviceThumbprint",thumb)
  GuardAccountActivity::class.java.getDeclaredMethod("showIncidentHistory",JSONObject::class.java,ConnectedIncidentDraftScope::class.java).apply{isAccessible=true;invoke(activity,item,owner)}
  return value(activity,"incidentHistoryView") as ConnectedIncidentHistoryView
 }
 @Test fun historyHostScrubsAndLocksImmediatelyOnPauseAndDoesNotResumeOldRecords(){configured{config,thumb->
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   lateinit var shown:ConnectedIncidentHistoryView
   scenario.onActivity{shown=show(it,config,thumb);assertTrue(texts(it.window.decorView).contains("MY RECORDED INCIDENTS"))}
   scenario.moveToState(Lifecycle.State.STARTED)
   scenario.onActivity{assertNull(value(it,"incidentHistoryView"));assertNull(value(it,"session"));assertEquals(0,shown.childCount)}
   scenario.moveToState(Lifecycle.State.RESUMED)
   scenario.onActivity{assertTrue(texts(it.window.decorView).contains("GUARD SIGN-IN"));assertFalse(texts(it.window.decorView).contains("MY RECORDED INCIDENTS"));assertNull(value(it,"accountIdentity"))}
  }
 }}
 @Test fun changedIndividualSubjectInvalidatesVisibleHistoryWithoutRelabellingIt(){configured{config,thumb->
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   lateinit var shown:ConnectedIncidentHistoryView
   scenario.onActivity{shown=show(it,config,thumb);identity(it,UUID.randomUUID().toString())}
   val limit=SystemClock.elapsedRealtime()+5000;var scrubbed=false
   while(SystemClock.elapsedRealtime()<limit){scenario.onActivity{scrubbed=value(it,"incidentHistoryView")==null&&value(it,"session")==null&&shown.childCount==0};if(scrubbed)break;SystemClock.sleep(50)}
   assertTrue("Changed individual identity left history visible",scrubbed)
   scenario.onActivity{assertTrue(texts(it.window.decorView).contains("GUARD SIGN-IN"))}
  }
 }}
}
