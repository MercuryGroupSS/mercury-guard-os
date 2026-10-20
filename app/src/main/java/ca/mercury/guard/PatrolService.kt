package ca.mercury.guard

import android.Manifest
import android.app.*
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import org.json.JSONObject

/** GPS is on only while an explicitly started shift is active; no boot or off-shift tracking. */
class PatrolService : Service() {
 private var manager: LocationManager? = null
 private var listener: LocationListener? = null
 override fun onBind(intent: Intent?): IBinder? = null
 override fun onCreate() {
  super.onCreate()
  val channelId = "mercury_shift"
  val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
  nm.createNotificationChannel(NotificationChannel(channelId, "Active guard shift", NotificationManager.IMPORTANCE_LOW))
  val note = Notification.Builder(this, channelId).setContentTitle("Mercury Guard · Shift active")
   .setContentText("Work-time location tracking is enabled")
   .setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).build()
  if (Build.VERSION.SDK_INT >= 29) startForeground(701, note, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
  else startForeground(701, note)
  if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
   manager = getSystemService(LOCATION_SERVICE) as LocationManager
   listener = LocationListener { loc -> GuardStore(this).record("gps", JSONObject().put("latitude",loc.latitude).put("longitude",loc.longitude).put("accuracy_m",loc.accuracy)) }
   try { manager?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 30000L, 15f, listener!!) }
   catch (_: SecurityException) { GuardStore(this).record("gps_permission_missing") }
  }
 }
 override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY
 override fun onDestroy() { listener?.let { manager?.removeUpdates(it) }; super.onDestroy() }
}
