package ca.mercury.guard

import android.app.*
import android.content.*
import android.net.Uri
import android.os.*
import android.provider.Settings

class FullScreenAlerts(private val context: Context) {
 private val prefs = context.getSharedPreferences("mercury_local",0)
 fun consented() = prefs.getBoolean("full_screen_alert_consent",false)
 fun setConsent(value: Boolean) { prefs.edit().putBoolean("full_screen_alert_consent",value).commit() }
 fun osAllowed(): Boolean = try {
  if (Build.VERSION.SDK_INT >= 34) (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).canUseFullScreenIntent()
  else false // This opt-in pathway is intentionally limited to Android 14+ special access.
 } catch (_: RuntimeException) { false }
 fun settingsIntent(): Intent? = if(Build.VERSION.SDK_INT >= 34)
  Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,Uri.parse("package:${context.packageName}")) else null
 fun shouldAttach(active: Boolean, alreadyAttempted: Boolean): Boolean {
  val nm=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  val power=context.getSystemService(Context.POWER_SERVICE) as PowerManager
  val keyguard=context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
  return FullScreenAlertPolicy.allowed(consented(),osAllowed(),DeviceReadiness(context).notificationPermissionGranted() && nm.areNotificationsEnabled(),
   (nm.getNotificationChannel(DutyAlertDelivery.CHANNEL)?.importance ?: 0)>=NotificationManager.IMPORTANCE_HIGH,
   keyguard.isKeyguardLocked || !power.isInteractive,active,alreadyAttempted)
 }
 fun status() = "Full-screen alerts: app consent ${if(consented()) "on" else "off"}; Android access ${if(osAllowed()) "allowed" else "denied or unavailable"}. Android 14+ only. Notification permission and a high-importance duty channel are also required. Delivery/wake remains subject to Android and device behavior."
}
