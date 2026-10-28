package ca.mercury.guard

import android.location.Location
import android.location.LocationListener
import android.os.Build
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.core.app.ActivityScenario
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.UUID

/** Typed synthetic points/fake port prove filtering and listener ownership, not physical GNSS or presence. */
class PatrolPointLocationTest {
 private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
 private val context get()=instrumentation.targetContext
 private val epoch=1730000000000L
 private val binding=GrantBinding("synthetic-point-guard","synthetic-point-site","synthetic-point-shift","a".repeat(64),1)
 private val anchor=ServerTimeAnchor(epoch,1000,1)
 private fun policy():AuthorizedLocationPolicy {
  val notice="Synthetic approved checkpoint point-fix notice only."
  val raw=JSONObject().put("version",1).put("revision",3).put("notice_revision",4).put("notice_text",notice).put("notice_sha256",EscalationProtocol.hash(notice))
   .put("sample_interval_ms",1000).put("min_distance_m",0).put("max_fix_age_ms",1000).put("max_accuracy_m",10).put("max_capture_lease_ms",10000).put("geofence",JSONObject.NULL).toString()
  return AuthorizedLocationPolicy.parse(EscalationProtocol.encode(raw),EscalationProtocol.hash(raw))
 }
 private fun grant(end:Long=5000)=VerifiedShiftGrant("point-${UUID.randomUUID()}",binding,setOf("patrol","location"),1000,end,1,AuthorizedLocationConsent(UUID.randomUUID().toString(),policy()),epoch,epoch+4000)
 private fun fix(nanos:Long=2100000000,accuracy:Float=5f)=Location("gps").apply{latitude=0.0;longitude=0.0;this.accuracy=accuracy;elapsedRealtimeNanos=nanos;time=1}
 private class Port:PatrolPointLocation.Port {
  var ready=true;var subscribed=0;var removed=0;var listener:LocationListener?=null;val removedListeners=mutableListOf<LocationListener>()
  override fun ready()=ready
  override fun subscribe(listener:LocationListener){subscribed++;this.listener=listener}
  override fun remove(listener:LocationListener){removed++;removedListeners.add(listener);if(this.listener===listener)this.listener=null}
 }
 private fun rejected(run:()->Unit){var rejected=false;try{run()}catch(_:Exception){rejected=true};assertTrue(rejected)}
 @Test fun requiredGpsFlagIsExactAndTypedPointUsesOriginalNoticeAndMonotonicTimes(){
  val route=JSONObject().put("routeId","point-route").put("revision",1).put("checkpoints",JSONArray().put(JSONObject().put("id","entrance").put("label","Entrance")))
  assertFalse(AuthorizedPatrolRoute.parse(route).gpsRequired)
  assertTrue(AuthorizedPatrolRoute.parse(JSONObject(route.toString()).put("gps_required",true)).gpsRequired)
  for(value in listOf<Any>(false,"true",1,JSONObject.NULL))rejected{AuthorizedPatrolRoute.parse(JSONObject(route.toString()).put("gps_required",value))}
  val grant=grant();val point=AuthorizedPatrolLocation.fromLocation(fix(),grant,anchor,2000000000,2200000000)!!
  assertEquals(epoch+1000,point.requestedAt);assertEquals(epoch+1100,point.fixAt);assertEquals(epoch+1200,point.at)
  val data=point.data();assertEquals(grant.location!!.id,data.getString("consent_id"));assertEquals(4,data.getInt("notice_revision"));assertEquals(grant.location!!.policy.noticeSha256,data.getString("notice_sha256"));assertEquals(false,data.get("mock"))
  assertEquals(setOf("requested_at_ms","fix_at_ms","consent_id","policy_revision","notice_revision","policy_sha256","notice_sha256","latitude","longitude","accuracy_m","mock"),data.keys().asSequence().toSet())
  assertNull(AuthorizedPatrolLocation.fromLocation(fix(1999999999),grant,anchor,2000000000,2200000000))
  assertNull(AuthorizedPatrolLocation.fromLocation(fix(2100000000,11f),grant,anchor,2000000000,2200000000))
  if(Build.VERSION.SDK_INT>=31)assertNull(AuthorizedPatrolLocation.fromLocation(fix().apply{setMock(true)},grant,anchor,2000000000,2200000000))
  assertNull(AuthorizedPatrolLocation.fromLocation(fix().apply{removeAccuracy()},grant,anchor,2000000000,2200000000))
 }
 @Test fun ownedListenerWaitsForFreshAccurateFixCompletesOnceAndIgnoresLateCallbacks(){
  val port=Port();var now=2000000000L;var callbacks=0;var captured:AuthorizedPatrolLocation?=null
  instrumentation.runOnMainSync{
   val collector=PatrolPointLocation(context,port,nanos={now},boot={1});collector.request(grant(),binding,anchor,{true}){callbacks++;captured=it}
   val owned=port.listener!!;owned.onLocationChanged(fix(1999999999));owned.onLocationChanged(fix(2100000000,50f));assertEquals(0,callbacks)
   now=2200000000;owned.onLocationChanged(fix());assertNotNull(captured);assertEquals(1,callbacks);assertEquals(1,port.removed);assertSame(owned,port.removedListeners.single())
   owned.onLocationChanged(fix());collector.cancel();assertEquals(1,callbacks);assertEquals(1,port.removed)
  }
 }
 @Test fun cancellationOrChangedConsentNeverCompletesARequestAsASavedPoint(){
  val port=Port();var allowed=true;var callbacks=0;var captured:AuthorizedPatrolLocation?=null;var now=2000000000L
  instrumentation.runOnMainSync{
   val collector=PatrolPointLocation(context,port,nanos={now},boot={1});collector.request(grant(),binding,anchor,{allowed}){callbacks++;captured=it};val first=port.listener!!
   collector.cancel();now=2200000000;first.onLocationChanged(fix());assertEquals(0,callbacks);assertEquals(1,port.removed)
   collector.request(grant(),binding,anchor,{allowed}){callbacks++;captured=it};val second=port.listener!!;allowed=false;now=2400000000;second.onLocationChanged(fix(2300000000));assertEquals(1,callbacks);assertNull(captured);assertEquals(2,port.removed)
   collector.request(grant(),binding,anchor,{allowed}){callbacks++;captured=it};assertEquals(2,callbacks);assertEquals(2,port.subscribed);assertNull(captured)
  }
 }
 @Test fun permissionWrongBootAndOriginalBindingFailBeforeSubscriptionAndLeaseDeadlineTimesOut(){
  val refused=Port().apply{ready=false};var callbacks=0
  instrumentation.runOnMainSync{
   PatrolPointLocation(context,refused,nanos={2000000000},boot={1}).request(grant(),binding,anchor,{true}){assertNull(it);callbacks++}
   refused.ready=true
   PatrolPointLocation(context,refused,nanos={2000000000},boot={2}).request(grant(),binding,anchor,{true}){assertNull(it);callbacks++}
   PatrolPointLocation(context,refused,nanos={2000000000},boot={1}).request(grant(),binding.copy(assignmentId="other"),anchor,{true}){assertNull(it);callbacks++}
  }
  assertEquals(3,callbacks);assertEquals(0,refused.subscribed)
  val port=Port();val finished=CountDownLatch(1)
  instrumentation.runOnMainSync{PatrolPointLocation(context,port,nanos={2000000000},boot={1}).request(grant(2005),binding,anchor,{true}){assertNull(it);finished.countDown()}}
  assertTrue(finished.await(5,TimeUnit.SECONDS));assertEquals(1,port.subscribed);assertEquals(1,port.removed)
 }
 @Test fun requiredRouteNeverOffersAManualCompletionWhenFreshAuthorityIsUnavailable(){
  fun views(view:View):List<View> = listOf(view)+if(view is ViewGroup)(0 until view.childCount).flatMap{views(view.getChildAt(it))}else emptyList()
  val before=ScopedEventStore(context).use{it.pendingCount()}
  ConnectedPatrolUiFixture(context).use{fixture->ActivityScenario.launch(GuardAccountActivity::class.java).use{scenario->scenario.onActivity{activity->
   val binding=fixture.prepare(activity,this.binding)
   val route=JSONObject().put("routeId","required-ui-route").put("revision",1).put("gps_required",true).put("checkpoints",JSONArray().put(JSONObject().put("id","entrance").put("label","Entrance")))
   val item=JSONObject().put("guardId",binding.guardId).put("siteId",binding.siteId).put("assignmentId",binding.assignmentId).put("patrolRoute",route)
   GuardAccountActivity::class.java.getDeclaredMethod("patrolScreen",JSONObject::class.java,String::class.java).apply{isAccessible=true;invoke(activity,item,null)}
   val controls=views(activity.window.decorView)
   assertTrue(controls.filterIsInstance<Button>().any{it.text.toString()=="Review patrol GPS notice and consent"})
   assertTrue(controls.filterIsInstance<TextView>().any{it.text.toString().contains("There is no manual fallback")})
   assertTrue(controls.filterIsInstance<Button>().single{it.text.toString()=="Record checkpoint: Entrance"}.performClick())
   assertTrue(views(activity.window.decorView).filterIsInstance<TextView>().any{it.text.toString().startsWith("Checkpoint not recorded.")})
  }}}
  assertEquals(before,ScopedEventStore(context).use{it.pendingCount()})
 }

}
