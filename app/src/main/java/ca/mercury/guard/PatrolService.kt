package ca.mercury.guard

import android.Manifest
import android.app.*
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationListener
import android.location.LocationManager
import android.os.*
import org.json.JSONObject

/** Visible, voluntary demo tracking; never resumes automatically after reboot. */
class PatrolService : Service() {
 private var manager: LocationManager? = null
 private var listener: LocationListener? = null
 private lateinit var store: GuardStore
 private val handler = Handler(Looper.getMainLooper())
 private val session by lazy { DemoSession(this) }
 private val expiryCheck = object : Runnable {
  override fun run() {
   if (!session.active() || !hasLocation()) { stopSelf(); return }
   handler.postDelayed(this, 1000)
  }
 }
 private fun hasLocation() = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
 override fun onBind(intent: Intent?): IBinder? = null
 override fun onCreate() {
  super.onCreate()
  store = GuardStore(this)
  val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
  nm.createNotificationChannel(NotificationChannel("mercury_shift", "Active guard shift", NotificationManager.IMPORTANCE_LOW))
  val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
  val note = Notification.Builder(this, "mercury_shift").setContentTitle("Mercury Guard · Demo shift")
   .setContentText("Work-time GPS active · open app to end shift").setContentIntent(open)
   .setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).build()
  try {
   if (Build.VERSION.SDK_INT >= 29) startForeground(701, note, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
   else startForeground(701, note)
   if (!session.active() || !hasLocation()) { stopSelf(); return }
   manager = getSystemService(LOCATION_SERVICE) as LocationManager
   listener = LocationListener { loc ->
    if (session.active() && hasLocation()) store.record("gps", JSONObject().put("latitude",loc.latitude).put("longitude",loc.longitude).put("accuracy_m",loc.accuracy).put("mock",loc.isFromMockProvider))
    else stopSelf()
   }
   manager?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 30000L, 15f, listener!!)
   handler.post(expiryCheck)
  } catch (e: SecurityException) { store.record("gps_permission_missing"); stopSelf() }
    catch (e: IllegalArgumentException) { store.record("gps_unavailable"); stopSelf() }
 }
 override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY
 override fun onDestroy() {
  handler.removeCallbacksAndMessages(null)
  listener?.let { manager?.removeUpdates(it) }
  stopForeground(STOP_FOREGROUND_REMOVE)
  store.close()
  super.onDestroy()
 }
}
