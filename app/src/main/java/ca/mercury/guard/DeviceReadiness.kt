package ca.mercury.guard

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.SystemClock

/** Process-local service observations; never persisted as proof of tracking or presence. */
object TrackingStatus {
 @Volatile var requesting = false
 @Volatile var lastFixElapsed = -1L
 fun stopped() { requesting = false; lastFixElapsed = -1L }
}

class DeviceReadiness(private val context: Context) {
 fun preciseLocationGranted() = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
 fun notificationPermissionGranted() = Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
 fun gpsEnabled(): Boolean = try { (context.getSystemService(Context.LOCATION_SERVICE) as LocationManager).isProviderEnabled(LocationManager.GPS_PROVIDER) } catch (_: Exception) { false }
 fun notificationsEnabled(): Boolean {
  val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  return notificationPermissionGranted() && manager.areNotificationsEnabled() && manager.getNotificationChannel("mercury_shift")?.importance != NotificationManager.IMPORTANCE_NONE
 }
 fun trackingDescription(): String {
  if (!DemoSession(context).active()) return "GPS tracking: stopped · no active demo shift"
  if (!preciseLocationGranted()) return "GPS tracking: unavailable · precise location not granted"
  if (!gpsEnabled()) return "GPS tracking: unavailable · device GPS disabled"
  if (!TrackingStatus.requesting) return "GPS tracking: no active request observed"
  val last = TrackingStatus.lastFixElapsed
  if (last < 0) return "GPS tracking: requesting updates · waiting for a fix"
  val age = ((SystemClock.elapsedRealtime() - last).coerceAtLeast(0) / 1000)
  return "GPS tracking: requesting updates · last fix ${age}s ago"
 }
}
