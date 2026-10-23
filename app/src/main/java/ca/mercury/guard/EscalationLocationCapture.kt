package ca.mercury.guard

import android.location.Location

/** Optional reported context only. Never starts GPS or waits for a fix. */
internal object EscalationLocationCapture {
 fun fromLocation(fix:Location?,at:Long,elapsedNanos:Long):EscalationLocation? {
  if(fix==null||fix.isFromMockProvider||!fix.hasAccuracy()||fix.elapsedRealtimeNanos<=0||fix.elapsedRealtimeNanos>elapsedNanos)return null
  val age=(elapsedNanos-fix.elapsedRealtimeNanos)/1000000
  if(age !in 0..300000)return null
  return try{EscalationRules.optionalLocation(EscalationLocation(Math.subtractExact(at,age),fix.latitude,fix.longitude,fix.accuracy.toDouble()),at)}catch(_:Exception){null}
 }
}
