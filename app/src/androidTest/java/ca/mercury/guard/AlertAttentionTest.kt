package ca.mercury.guard

import android.app.NotificationManager
import android.content.Context
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AlertAttentionTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 @Test fun existingChannelIsNeverReplacedOrRetuned() {
  GuardStore(context).useStore { store ->
   val delivery=DutyAlertDelivery(context,store);delivery.ensureChannel()
   val manager=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
   val before=manager.getNotificationChannel(DutyAlertDelivery.CHANNEL)
   delivery.ensureChannel()
   val after=manager.getNotificationChannel(DutyAlertDelivery.CHANNEL)
   assertEquals(before.sound,after.sound);assertEquals(before.shouldVibrate(),after.shouldVibrate());assertEquals(before.importance,after.importance)
   assertFalse(after.canBypassDnd())
  }
 }
 @Test fun notificationCadenceRecoverySilenceAndDeadline() {
  GuardStore(context).useStore { store ->
   val delivery=DutyAlertDelivery(context,store)
   val now=SystemClock.elapsedRealtime()
   val p=DutyPrompt("attention-${java.util.UUID.randomUUID()}","readiness",now)
   delivery.update(listOf(p),now);delivery.update(listOf(p),now+1000)
   val enabled=DeviceReadiness(context).notificationPermissionGranted()
   assertEquals(if(enabled) 1 else 0,store.eventsOf("duty_alert_attempt").count { it.optString("due_id")==p.id })
   DutyAlertDelivery(context,store).update(listOf(p),now+1000)
   assertEquals(if(enabled) 1 else 0,store.eventsOf("duty_alert_attempt").count { it.optString("due_id")==p.id })
   delivery.update(listOf(p),now+30000)
   val count=store.eventsOf("duty_alert_attempt").count { it.optString("due_id")==p.id }
   assertEquals(if(enabled) 2 else 0,count)
   delivery.silence(p);delivery.update(listOf(p),now+60000)
   assertEquals(count,store.eventsOf("duty_alert_attempt").count { it.optString("due_id")==p.id })
   assertFalse(DutyPrompts(store).has("duty_completed",p.id))
   val manager=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
   assertFalse(manager.activeNotifications.any{it.id==DutyAlertDelivery.NOTE})
   val expired=DutyPrompt("expired-${java.util.UUID.randomUUID()}","readiness",now)
   delivery.update(listOf(expired),now+600000)
   assertFalse(manager.activeNotifications.any{it.id==DutyAlertDelivery.NOTE})
  }
 }
 @Test fun biometricVerificationSilencesAttentionButDoesNotCompletePhotoCheckIn() {
  GuardStore(context).useStore { store ->
   val p=DutyPrompt("synthetic-${java.util.UUID.randomUUID()}","check_in",SystemClock.elapsedRealtime())
   store.recordOnce("duty_biometric",p.id,JSONObject().put("synthetic_test",true))
   assertTrue(DutyAlertDelivery(context,store).silenced(p))
   assertFalse(DutyPrompts(store).complete(p))
  }
 }
}
