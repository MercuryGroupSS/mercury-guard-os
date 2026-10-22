package ca.mercury.guard

import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DutyWorkflowTest {
 private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
 @Test fun timerRecoveryMissIsIdempotentAndReasonDoesNotEraseIt() {
  GuardStore(context).useStore { store ->
   val duty = DutyPrompts(store)
   val start = SystemClock.elapsedRealtime()
   val session = "test-${java.util.UUID.randomUUID()}:$start"
   val p = duty.requestCheckIn(session,start)
   assertEquals("green",duty.pending(session,start+119999).first().stage(start+119999))
   assertEquals("yellow",DutyPrompts(store).pending(session,start+120000).first().stage(start+120000))
   assertEquals("red",duty.pending(session,start+599999).first().stage(start+599999))
   assertTrue(duty.pending(session,start+600000).isEmpty())
   duty.pending(session,start+700000)
   assertEquals(1,store.eventsOf("duty_missed").count { it.optString("event_key")==p.id })
   store.recordOnce("duty_miss_reason",p.id,JSONObject().put("reason","Synthetic explanation"))
   assertFalse(duty.missed().any { it.optString("event_key")==p.id })
   assertEquals(1,store.eventsOf("duty_missed").count { it.optString("event_key")==p.id })
  }
 }
 @Test fun checkInCannotCompleteWithoutAllThreeEvidenceTypes() {
  GuardStore(context).useStore { store ->
   val duty=DutyPrompts(store); val p=duty.requestCheckIn("test:${SystemClock.elapsedRealtime()}")
   assertFalse(duty.complete(p))
   store.recordOnce("duty_biometric",p.id,JSONObject().put("synthetic_test",true))
   assertFalse(duty.complete(p))
   store.recordOnce("duty_gps",p.id,JSONObject().put("synthetic_test",true))
   assertFalse(duty.complete(p))
   store.recordOnce("duty_photo",p.id,JSONObject().put("synthetic_test",true))
   assertTrue(duty.complete(p)); assertFalse(duty.complete(p))
  }
 }
 @Test fun patrolAnyOrderAndDuplicateProtection() {
  GuardStore(context).useStore { store ->
   val session="test-${java.util.UUID.randomUUID()}"
   val gps=JSONObject().put("latitude",0).put("longitude",0).put("accuracy_m",12).put("fix_at",System.currentTimeMillis()).put("mock",true)
   assertTrue(store.completePoint(session,2,gps)); assertTrue(store.completePoint(session,0,gps))
   assertFalse(store.completePoint(session,2,gps)); assertEquals(setOf(0,2),store.completedPoints(session))
   assertTrue(store.recordCheckpoint(session,0)); assertTrue(store.recordCheckpoint(session,1))
   assertEquals(setOf(0,1,2),store.completedPoints(session))
   assertFalse(store.completePoint(session,1,gps))
  }
 }
 @Test fun mapSelectionClampsAndPublishesCoordinates() {
  InstrumentationRegistry.getInstrumentation().runOnMainSync {
   var selected=0 to 0
   val map=DemoPropertyView(context,50,50) { x,y -> selected=x to y }
   map.movePin(150,-10); assertEquals(100 to 0,selected)
  }
 }
}

internal inline fun <T> GuardStore.useStore(block: (GuardStore) -> T): T = try { block(this) } finally { close() }
