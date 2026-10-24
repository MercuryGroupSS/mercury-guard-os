package ca.mercury.guard

import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
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

/** Synthetic verified presentation and encrypted cache; no network, Auth or biometric acceptance. */
class ConnectedDispatchHostTest {
 private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
 private val context get()=instrumentation.targetContext
 private fun field(a:GuardAccountActivity,key:String,value:Any?){GuardAccountActivity::class.java.getDeclaredField(key).apply{isAccessible=true;set(a,value)}}
 private fun value(a:GuardAccountActivity,key:String)=GuardAccountActivity::class.java.getDeclaredField(key).apply{isAccessible=true}.get(a)
 private fun tree(v:View):List<View> = listOf(v)+if(v is ViewGroup)(0 until v.childCount).flatMap{tree(v.getChildAt(it))}else emptyList()
 private fun texts(v:View)=tree(v).filterIsInstance<TextView>().map{it.text.toString()}
 private class Fixture(val a:GuardServiceConfig,val b:GuardServiceConfig,val thumb:String){
  val subject=UUID.randomUUID().toString();val messageId="host-${UUID.randomUUID()}"
  val scope=DispatchScope(GrantBinding("dispatch-guard","dispatch-site","dispatch-${UUID.randomUUID()}",thumb,1),"dispatch-company")
  val ownerA=ConnectedDispatchOwner(a.uploadBinding(),a.deviceId,subject,scope)
  val ownerB=ConnectedDispatchOwner(b.uploadBinding(),b.deviceId,subject,scope)
  fun item()=JSONObject().put("guardId",scope.binding.guardId).put("vendorId",scope.vendorId).put("siteId",scope.binding.siteId).put("assignmentId",scope.binding.assignmentId).put("deviceThumbprint",thumb).put("revocationVersion",1)
  fun message(label:String)=JSONObject().put("message_id",messageId).put("version",1).put("state","active").put("title","$label $messageId").put("body","Original private $label body $messageId").put("issued_at",1000).put("due_at",JSONObject.NULL)
  fun page(label:String)=JSONObject().put("scope",scope.json()).put("changes",JSONArray().put(message(label))).put("next_cursor",UUID.randomUUID().toString()).put("has_more",false).put("server_time_ms",2000)
 }
 private fun configured(run:(Fixture)->Unit){
  val identity=DeviceIdentity(context);val prior=identity.publicIdentity();val key=prior?:identity.create();val pub=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair().public
  fun config(host:String)=GuardServiceConfig.parse(JSONObject().put("endpoint","https://$host.invalid").put("issuer","dispatch-host").put("audience","dispatch-host").put("device_id","dispatch-phone").put("issuer_keys",JSONObject().put("test",Base64.getUrlEncoder().withoutPadding().encodeToString(pub.encoded))).toString())
  val f=Fixture(config("dispatch-a"),config("dispatch-b"),key.thumbprint)
  try{run(f)}finally{
   DispatchInbox(context).use{db->for(owner in listOf(f.ownerA,f.ownerB)){db.writableDatabase.delete("messages","owner=?",arrayOf(owner.owner()));db.writableDatabase.delete("cursors","owner=?",arrayOf(owner.owner()))}}
   if(prior==null){check(identity.publicIdentity()==key);KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry("mercury.device.signing.v1")};File(context.noBackupFilesDir,"device-identity-v1").delete();File(context.noBackupFilesDir,"device-identity-v1.bak").delete()}
  }
 }
 private fun present(a:GuardAccountActivity,f:Fixture,c:GuardServiceConfig=f.a,subject:String=f.subject){
  val type=GuardAccountActivity::class.java.declaredClasses.single{it.simpleName=="AccountIdentity"}
  field(a,"config",c);field(a,"session",GuardAccountClient.Session("synthetic-dispatch-no-network",SystemClock.elapsedRealtime()+60000))
  field(a,"accountIdentity",type.getDeclaredConstructor(String::class.java,String::class.java,String::class.java).apply{isAccessible=true}.newInstance(subject,f.scope.binding.guardId,f.scope.vendorId))
  field(a,"captureBinding",f.scope.binding);field(a,"captureAnchor",ServerTimeAnchor(2000,SystemClock.elapsedRealtime(),1))
 }
 private fun openCached(a:GuardAccountActivity,f:Fixture){GuardAccountActivity::class.java.getDeclaredMethod("loadDispatch",JSONObject::class.java,Boolean::class.javaPrimitiveType,Int::class.javaPrimitiveType).apply{isAccessible=true;invoke(a,f.item(),false,0)}}
 private fun waitFor(scenario:ActivityScenario<GuardAccountActivity>,check:(GuardAccountActivity)->Boolean){val end=SystemClock.elapsedRealtime()+5000;while(SystemClock.elapsedRealtime()<end){var ready=false;scenario.onActivity{ready=check(it)};if(ready)return;SystemClock.sleep(25)};scenario.onActivity{assertTrue("Expected dispatch presentation did not arrive",check(it))}}
 @Test fun initialCachedOpenRunsAfterAttachAndOldAccountActionCannotAcknowledgeAfterSwitch(){configured{f->
  DispatchInbox(context).use{it.apply(f.ownerA,null,f.page("A"))}
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   scenario.onActivity{present(it,f);openCached(it,f)} // Production initial cached-open path, no forced post-layout render.
   waitFor(scenario){a->tree(a.window.decorView).filterIsInstance<Button>().any{it.text.toString()=="A ${f.messageId} · v1"}}
   scenario.onActivity{a->
    tree(a.window.decorView).filterIsInstance<Button>().single{it.text.toString()=="A ${f.messageId} · v1"}.performClick()
    assertTrue(texts(a.window.decorView).contains(f.message("A").getString("body")))
    val old=tree(a.window.decorView).filterIsInstance<Button>().single{it.text.toString()=="Acknowledge version 1"}
    present(a,f,subject=UUID.randomUUID().toString());old.performClick()
    assertNull(value(a,"session"));assertFalse(texts(a.window.decorView).contains(f.message("A").getString("body")))
    assertFalse(ScopedEventStore(context).use{it.dispatchAcknowledged(f.ownerA,f.messageId,1)})
   }
  }
 }}
 @Test fun changedConfigurationCannotOpenOldOwnerEvenWithIdenticalWireScopeAndMessageVersion(){configured{f->
  DispatchInbox(context).use{it.apply(f.ownerA,null,f.page("A"));it.apply(f.ownerB,null,f.page("B"))}
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   var read:Any?=null;lateinit var panel:ConnectedPrivatePanel
   scenario.onActivity{a->
    present(a,f,f.b)
    @Suppress("UNCHECKED_CAST") val pair=GuardAccountActivity::class.java.getDeclaredMethod("newAssignmentPanel",JSONObject::class.java,String::class.java,Boolean::class.javaPrimitiveType).apply{isAccessible=true}.invoke(a,f.item(),"ASSIGNMENT MESSAGES",true) as Pair<Any,ConnectedPrivatePanel>
    read=pair.first;panel=pair.second
   }
   waitFor(scenario){panel.isAttachedToWindow}
   scenario.onActivity{a->
    val method=GuardAccountActivity::class.java.declaredMethods.single{it.name=="viewDispatch"}.apply{isAccessible=true}
    method.invoke(a,read,panel,f.ownerA,f.item(),f.message("A"),0)
    assertFalse(texts(a.window.decorView).contains(f.message("A").getString("body")))
    assertTrue(DispatchInbox(context).use{it.list(f.ownerA).single().isNull("read_at")})
    method.invoke(a,read,panel,f.ownerB,f.item(),f.message("A"),0)
    assertTrue(texts(a.window.decorView).contains(f.message("B").getString("body")))
    assertFalse(texts(a.window.decorView).contains(f.message("A").getString("body")))
    assertFalse(DispatchInbox(context).use{it.list(f.ownerB).single().isNull("read_at")})
   }
  }
 }}
 @Test fun navigatingBeforeCachedCompletionClosesTheOldPanelAndPreservesReplacement(){configured{f->
  DispatchInbox(context).use{it.apply(f.ownerA,null,f.page("A"))}
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->
   lateinit var panel:ConnectedPrivatePanel;var ticket=0L
   scenario.onActivity{a->
    present(a,f);openCached(a,f);panel=value(a,"connectedPrivatePanel") as ConnectedPrivatePanel;ticket=panel.begin("Pending original cache")!!
    GuardAccountActivity::class.java.getDeclaredMethod("screen",String::class.java,String::class.java).apply{isAccessible=true;invoke(a,"REPLACEMENT SCREEN","Unrelated current view")}
   }
   instrumentation.waitForIdleSync()
   scenario.onActivity{a->
    assertEquals(0,panel.childCount);assertFalse(panel.render(ticket){text("Late original result")})
    assertTrue(texts(a.window.decorView).contains("REPLACEMENT SCREEN"));assertFalse(texts(a.window.decorView).contains("A ${f.messageId} · v1"));assertNull(value(a,"connectedPrivatePanel"))
   }
  }
 }}
}
