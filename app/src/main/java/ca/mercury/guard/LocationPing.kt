package ca.mercury.guard

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.*
import android.os.*
import org.json.JSONObject

/** A fresh one-shot fix; permission denial, cancellation and timeout never become success. */
class LocationPing(private val context: Context) {
 private val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
 private val handler = Handler(Looper.getMainLooper())
 private var listener: LocationListener? = null
 private var completion: ((JSONObject?) -> Unit)? = null
 fun cancel() { finish(null) }
 private fun finish(value: JSONObject?) {
  val callback = completion; completion = null
  listener?.let { try { manager.removeUpdates(it) } catch (_: SecurityException) {} }
  listener = null; handler.removeCallbacksAndMessages(null); callback?.invoke(value)
 }
 fun request(done: (JSONObject?) -> Unit) {
  cancel(); completion = done
  if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) { finish(null); return }
  val requested = SystemClock.elapsedRealtimeNanos()
  listener = object : LocationListener {
   override fun onLocationChanged(location: Location) {
    if (location.elapsedRealtimeNanos < requested || !location.hasAccuracy()) return
    finish(JSONObject().put("latitude",location.latitude).put("longitude",location.longitude)
     .put("accuracy_m",location.accuracy).put("fix_at",location.time)
     .put("fix_elapsed_nanos",location.elapsedRealtimeNanos).put("mock",location.isFromMockProvider))
   }
   override fun onProviderEnabled(provider: String) {}
   override fun onProviderDisabled(provider: String) { finish(null) }
   @Deprecated("Android 9 callback") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
  }
  try {
   if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) { finish(null); return }
   manager.requestLocationUpdates(LocationManager.GPS_PROVIDER,0L,0f,listener!!,Looper.getMainLooper())
  } catch (_: Exception) { finish(null); return }
  handler.postDelayed({ finish(null) },20_000)
 }
}
