package ca.mercury.guard

import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.util.Base64
import java.util.UUID

/** Synthetic verified-presentation boundary only. Real Auth/device proof remains a separate gate. */
class ConnectedPrivatePanelHostTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private fun field(a:GuardAccountActivity,key:String,value:Any?){GuardAccountActivity::class.java.getDeclaredField(key).apply{isAccessible=true;set(a,value)}}
 private fun value(a:GuardAccountActivity,key:String)=GuardAccountActivity::class.java.getDeclaredField(key).apply{isAccessible=true}.get(a)
 private fun identity(a:GuardAccountActivity,subject:String){val type=GuardAccountActivity::class.java.declaredClasses.single{it.simpleName=="AccountIdentity"};field(a,"accountIdentity",type.getDeclaredConstructor(String::class.java,String::class.java,String::class.java).apply{isAccessible=true}.newInstance(subject,"read-guard","read-company"))}
 private fun texts(v:View):List<String> =(if(v is TextView)listOf(v.text.toString())else emptyList())+if(v is ViewGroup)(0 until v.childCount).flatMap{texts(v.getChildAt(it))}else emptyList()
 private fun configured(run:(GuardServiceConfig,String)->Unit){
  val device=DeviceIdentity(context);val prior=device.publicIdentity();val key=prior?:device.create()
  val pub=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair().public
  val config=GuardServiceConfig.parse(JSONObject().put("endpoint","https://readonly-ui.invalid").put("issuer","readonly-test").put("audience","readonly-test").put("device_id","read-phone").put("issuer_keys",JSONObject().put("read",Base64.getUrlEncoder().withoutPadding().encodeToString(pub.encoded))).toString())
  try{run(config,key.thumbprint)}finally{if(prior==null){check(device.publicIdentity()==key);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry("mercury.device.signing.v1")};File(context.noBackupFilesDir,"device-identity-v1").delete();File(context.noBackupFilesDir,"device-identity-v1.bak").delete()}}
 }
 private fun show(a:GuardAccountActivity,c:GuardServiceConfig,thumb:String):Pair<Any,ConnectedPrivatePanel>{
  field(a,"config",c);field(a,"session",GuardAccountClient.Session("synthetic-read-no-network",SystemClock.elapsedRealtime()+60000));identity(a,UUID.randomUUID().toString())
  val item=JSONObject().put("guardId","read-guard").put("vendorId","read-company").put("siteId","read-site").put("assignmentId","future-read-assignment").put("deviceThumbprint",thumb).put("revocationVersion",0)
  val method=GuardAccountActivity::class.java.getDeclaredMethod("newAssignmentPanel",JSONObject::class.java,String::class.java).apply{isAccessible=true}
  @Suppress("UNCHECKED_CAST") val result=method.invoke(a,item,"PRIVATE READ TEST") as Pair<Any,ConnectedPrivatePanel>
  result.second.text("private instruction body");return result
 }
 @Test fun pauseImmediatelyScrubsAndRelocksAndLateResultCannotRepopulate(){configured{c,thumb->
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   lateinit var panel:ConnectedPrivatePanel;var ticket=0L
   scenario.onActivity{panel=show(it,c,thumb).second;ticket=panel.begin("private pending read")!!}
   scenario.moveToState(Lifecycle.State.STARTED)
   scenario.onActivity{assertNull(value(it,"connectedPrivatePanel"));assertNull(value(it,"session"));assertEquals(0,panel.childCount);assertFalse(panel.render(ticket){text("LATE PRIVATE")})}
   scenario.moveToState(Lifecycle.State.RESUMED)
   scenario.onActivity{assertTrue(texts(it.window.decorView).contains("GUARD SIGN-IN"));assertFalse(texts(it.window.decorView).contains("LATE PRIVATE"))}
  }
 }}
 @Test fun changedSubjectWithSameGuardAndVendorScrubsInsteadOfAdoptingPrivatePage(){configured{c,thumb->
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   lateinit var panel:ConnectedPrivatePanel
   scenario.onActivity{panel=show(it,c,thumb).second;identity(it,UUID.randomUUID().toString())}
   val until=SystemClock.elapsedRealtime()+5000;var cleared=false
   while(SystemClock.elapsedRealtime()<until){scenario.onActivity{cleared=value(it,"connectedPrivatePanel")==null&&value(it,"session")==null&&panel.childCount==0};if(cleared)break;SystemClock.sleep(50)}
   assertTrue("Old subject retained private content",cleared)
  }
 }}
 @Test fun preStartInstructionsRenderWithoutGrantAndNeverOfferAcknowledgement(){configured{c,thumb->
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->scenario.onActivity{a->
   val (read,panel)=show(a,c,thumb);assertNull(value(a,"captureGrant"))
   val scope=DispatchScope(GrantBinding("read-guard","read-site","future-read-assignment",thumb,0),"read-company")
   val json=JSONObject().put("scope",scope.json()).put("changes",JSONArray().put(JSONObject().put("message_id","prestart").put("version",1).put("state","active").put("title","Before shift").put("body","Read these site instructions").put("issued_at",1000).put("due_at",JSONObject.NULL))).put("next_cursor",UUID.randomUUID().toString()).put("has_more",false).put("server_time_ms",2000)
   val page=ConnectedAssignmentInstructions.parse(scope,null,json)
   val method=GuardAccountActivity::class.java.declaredMethods.single{it.name=="showReadOnlyInstructions"}.apply{isAccessible=true}
   val ticket=panel.begin("Opening")!!;assertTrue(panel.render(ticket){method.invoke(a,read,panel,JSONObject(),page)})
   val all=texts(panel);assertTrue(all.any{it.contains("Before shift")});assertTrue(all.any{it.contains("Instructions are not saved on this phone")});assertFalse(all.any{it.startsWith("Acknowledge")});assertNull(value(a,"captureGrant"))
  }}
 }}
 @Test fun clearedSessionScrubsVisiblePanelAndDiscardsPendingRead(){configured{c,thumb->
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   lateinit var panel:ConnectedPrivatePanel;var ticket=0L
   scenario.onActivity{panel=show(it,c,thumb).second;ticket=panel.begin("private response pending")!!;(value(it,"session") as GuardAccountClient.Session).clear()}
   val until=SystemClock.elapsedRealtime()+5000;var cleared=false
   while(SystemClock.elapsedRealtime()<until){scenario.onActivity{cleared=value(it,"connectedPrivatePanel")==null&&value(it,"session")==null&&panel.childCount==0};if(cleared)break;SystemClock.sleep(50)}
   assertTrue("Signed-out session retained private content",cleared)
   scenario.onActivity{assertFalse(panel.render(ticket){text("late signed-out instruction")})}
  }
 }}
 @Test fun navigationClosesOriginalViewSoLateNetworkResultCannotChangeReplacement(){configured{c,thumb->
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->scenario.onActivity{a->
   val panel=show(a,c,thumb).second;val ticket=panel.begin("private response pending")!!
   GuardAccountActivity::class.java.getDeclaredMethod("screen",String::class.java,String::class.java).apply{isAccessible=true;invoke(a,"REPLACEMENT SCREEN","Public replacement text")}
   assertNull(value(a,"connectedPrivatePanel"));assertEquals(0,panel.childCount)
   assertFalse(panel.render(ticket){text("late navigation instruction")})
   assertTrue(texts(a.window.decorView).contains("REPLACEMENT SCREEN"));assertFalse(texts(a.window.decorView).contains("late navigation instruction"))
  }}
 }}
}
