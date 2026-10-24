package ca.mercury.guard

import android.Manifest
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.UUID

class EscalationPermissionTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 @Test fun deniedFinePermissionOmitsOptionalGpsAndAllowsTheOriginalRequestToBeSaved(){
  assumeTrue(context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_DENIED)
  var optional:EscalationLocation?=null
  ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->scenario.onActivity{activity->
   val read=GuardAccountActivity::class.java.getDeclaredMethod("recentEscalationLocation",java.lang.Long.TYPE);read.isAccessible=true
   optional=read.invoke(activity,1730000000000L) as EscalationLocation?;assertNull(optional)
  }}
  val name="permission-escalation-${UUID.randomUUID()}.db"
  try{
   EscalationStore(context,name).use{store->
    val scope=EscalationScope("a".repeat(64),"synthetic-phone","b".repeat(64),UUID.randomUUID().toString(),"synthetic-guard","synthetic-vendor")
    val intent=EscalationIntent(UUID.randomUUID().toString(),scope.guardId,scope.vendorId,null,1730000000000L,"assistance","Synthetic permission-denied request. No real assistance requested.",optional)
    val saved=store.save(scope,intent);assertNull(saved.intent.location);assertEquals("Saved locally",saved.state)
   }
  }finally{context.deleteDatabase(name)}
 }
 @Test fun permissionRevokedBetweenCheckAndProviderReadOmitsGpsWithoutThrowing(){
  val allowedAtCheck=object:ContextWrapper(context){override fun checkSelfPermission(permission:String)=if(permission==Manifest.permission.ACCESS_FINE_LOCATION)PackageManager.PERMISSION_GRANTED else super.checkSelfPermission(permission)}
  var read=false
  val result=EscalationLocationCapture.latest(allowedAtCheck,1730000000000L,900000000000L){read=true;throw SecurityException("Synthetic permission revocation after the check")}
  assertTrue(read);assertNull(result)
  val denied=object:ContextWrapper(context){override fun checkSelfPermission(permission:String)=PackageManager.PERMISSION_DENIED}
  assertNull(EscalationLocationCapture.latest(denied,1730000000000L,900000000000L){fail("Provider read without precise permission");null})
 }
}
