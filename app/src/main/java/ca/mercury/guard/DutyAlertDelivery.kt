package ca.mercury.guard

import android.app.*
import android.content.*
import android.media.AudioAttributes
import android.net.Uri
import android.os.*
import org.json.JSONObject

/** OS-channel-owned short cues. No DND bypass, alarm stream, wake lock or background launch. */
class DutyAlertDelivery(private val context: Context, private val store: GuardStore) {
 private val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
 private val duty = DutyPrompts(store)
 companion object { const val CHANNEL = "mercury_duty"; const val NOTE = 702 }
 fun ensureChannel() {
  if (nm.getNotificationChannel(CHANNEL) != null) return // Never replace owner choices or the v0.19 channel.
  nm.createNotificationChannel(NotificationChannel(CHANNEL,"Duty verification",NotificationManager.IMPORTANCE_HIGH).apply {
   description = "Short check-in cues, at most once every 30 seconds until the 10-minute deadline"
   setSound(Uri.parse("android.resource://${context.packageName}/raw/duty_chime"),AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
   enableVibration(true); vibrationPattern = longArrayOf(0,400,200,400)
   lockscreenVisibility = Notification.VISIBILITY_PRIVATE
  })
 }
 fun silenced(p: DutyPrompt) = duty.has("duty_alert_silenced",p.id) || duty.has("duty_biometric",p.id)
 fun silence(p: DutyPrompt, reason: String = "user_silenced") {
  store.recordOnce("duty_alert_silenced",p.id,JSONObject().put("reason",reason).put("at",System.currentTimeMillis()))
  nm.cancel(NOTE)
 }
 fun stop() { nm.cancel(NOTE); nm.cancel(703) }
 fun update(pending: List<DutyPrompt>, now: Long = SystemClock.elapsedRealtime()) {
  ensureChannel()
  val missed = duty.missed().isNotEmpty()
  if (missed && DeviceReadiness(context).notificationPermissionGranted() && nm.areNotificationsEnabled()) {
   nm.createNotificationChannel(NotificationChannel("mercury_missed", "Missed check records",NotificationManager.IMPORTANCE_LOW).apply { setSound(null,null);enableVibration(false) })
   val open=PendingIntent.getActivity(context,703,Intent(context,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE)
   nm.notify(703,Notification.Builder(context,"mercury_missed").setSmallIcon(android.R.drawable.ic_dialog_alert).setContentTitle("Mercury One · missed check")
    .setContentText("Reason required in Escalate · local record, not dispatched").setContentIntent(open).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE).build())
  } else nm.cancel(703)
  val p = pending.firstOrNull { !silenced(it) } ?: run { nm.cancel(NOTE); return }
  val slot = DutyAlertPolicy.slot(p.due,now) ?: run { nm.cancel(NOTE); return }
  if (!DeviceReadiness(context).notificationPermissionGranted() || !nm.areNotificationsEnabled() || nm.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) { stop(); return }
  // Persist slot before notifying: recovery may skip one cue, but never produces a burst.
  if (!store.recordOnce("duty_alert_attempt", "${p.id}:$slot",JSONObject().put("due_id",p.id).put("slot",slot).put("attempted_at",System.currentTimeMillis()))) return
  val open = PendingIntent.getActivity(context,702,Intent(context,DutyAlertActivity::class.java).putExtra("duty_id",p.id),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val mute = PendingIntent.getBroadcast(context,702,Intent(context,DutyAlertReceiver::class.java).putExtra("duty_id",p.id),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val publicNote = Notification.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_alert)
   .setContentTitle("Mercury One · verification due").setContentText("Open alert to respond or silence").build()
  val builder = Notification.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_alert)
   .setContentTitle("Mercury One · ${p.stage(now).uppercase()} · verification due")
   .setContentText("Open alert · silence does not complete this check")
   .setCategory(Notification.CATEGORY_REMINDER).setContentIntent(open).setDeleteIntent(mute)
   .addAction(Notification.Action.Builder(null,"Silence alert",mute).build())
   .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(publicNote)
   .setOnlyAlertOnce(false).setTimeoutAfter((p.due+DutyAlertPolicy.DEADLINE_MS-now).coerceAtLeast(1))
  val fullScreen = FullScreenAlerts(context)
  if (fullScreen.shouldAttach(DemoSession(context).active() && !silenced(p),duty.has("duty_full_screen_attempt",p.id)) &&
      store.recordOnce("duty_full_screen_attempt",p.id,JSONObject().put("attempted_at",System.currentTimeMillis()))) {
   val wake = PendingIntent.getActivity(context,704,Intent(context,DutyAlertActivity::class.java).putExtra("duty_id",p.id).putExtra("full_screen",true),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
   builder.setFullScreenIntent(wake,true)
  }
  val note=builder.build()
  try { nm.notify(NOTE,note) } catch (_: SecurityException) { stop() }
 }
 fun status(): String {
  ensureChannel(); val channel=nm.getNotificationChannel(CHANNEL)
  val power=context.getSystemService(Context.POWER_SERVICE) as PowerManager
  val audio=context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
  return "Notifications: ${if (DeviceReadiness(context).notificationPermissionGranted() && nm.areNotificationsEnabled()) "allowed" else "blocked"}\nDuty channel: importance ${channel?.importance}; sound ${if(channel?.sound != null) "configured" else "off"}; vibration ${if(channel?.shouldVibrate()==true) "on" else "off"}\nRinger: ${when(audio.ringerMode) { 2 -> "normal"; 1 -> "vibrate"; else -> "silent" }} · DND filter: ${nm.currentInterruptionFilter}\nPower idle: ${power.isDeviceIdleMode}. Delivery may be delayed.\n${FullScreenAlerts(context).status()}"
 }
}

class DutyAlertReceiver : BroadcastReceiver() {
 override fun onReceive(context: Context, intent: Intent) {
  val session=DemoSession(context)
  if (!session.active()) return
  val store=GuardStore(context)
  try {
   val p=DutyPrompts(store).pending(session.identity()).firstOrNull { it.id==intent.getStringExtra("duty_id") } ?: return
   DutyAlertDelivery(context,store).silence(p)
  } finally { store.close() }
 }
}
