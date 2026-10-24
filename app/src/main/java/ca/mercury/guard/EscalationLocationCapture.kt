package ca.mercury.guard

import android.location.Location

/** Optional reported context only. Never starts GPS or waits for a fix. */
internal object EscalationLocationCapture {
 /** Permission can be withdrawn after the check; either outcome simply omits optional GPS. */
 internal fun latest(context:android.content.Context,at:Long,elapsedNanos:Long=android.os.SystemClock.elapsedRealtimeNanos(),read:((android.location.LocationManager)->Location?)?=null):EscalationLocation? {
  if(context.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)!=android.content.pm.PackageManager.PERMISSION_GRANTED)return null
  return try{
   val manager=context.getSystemService(android.content.Context.LOCATION_SERVICE) as android.location.LocationManager
   val fix=if(read==null)manager.getLastKnownLocation(android.location.LocationManager.GPS_PROVIDER)else read(manager)
   fromLocation(fix,at,elapsedNanos)
  }catch(_:SecurityException){null}catch(_:Exception){null}
 }

 fun fromLocation(fix:Location?,at:Long,elapsedNanos:Long):EscalationLocation? {
  if(fix==null||fix.isFromMockProvider||!fix.hasAccuracy()||fix.elapsedRealtimeNanos<=0||fix.elapsedRealtimeNanos>elapsedNanos)return null
  val age=(elapsedNanos-fix.elapsedRealtimeNanos)/1000000
  if(age !in 0..300000)return null
  return try{EscalationRules.optionalLocation(EscalationLocation(Math.subtractExact(at,age),fix.latitude,fix.longitude,fix.accuracy.toDouble()),at)}catch(_:Exception){null}
 }
}
