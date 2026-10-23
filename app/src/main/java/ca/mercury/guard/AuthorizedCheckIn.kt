package ca.mercury.guard

import org.json.JSONObject

/** Trusted service schedule; local observations are not biometric or location attestation. */
data class AuthorizedCheckInPolicy private constructor(val revision:Long,val startsAt:Long,val endsAt:Long,val interval:Long,val window:Long,val maxAge:Long,val maxAccuracy:Double){
 fun slotAt(at:Long):Long {require(at>=startsAt && at<endsAt);return (at-startsAt)/interval}
 fun validate(slot:Long,biometricAt:Long,location:JSONObject,photoAt:Long,at:Long){
  require(slot>=0)
  val due=Math.addExact(startsAt,Math.multiplyExact(slot,interval));val end=minOf(Math.addExact(due,window),endsAt)
  require(due<endsAt && at in due until end && biometricAt in due..at && at-biometricAt<=maxAge)
  val fix=integer(location,"at");val accuracy=location.getDouble("accuracy_m");val lat=location.getDouble("latitude");val lon=location.getDouble("longitude")
  require(fix in biometricAt..at && at-fix<=maxAge && location.get("mock")==false && accuracy>0 && accuracy<=maxAccuracy && lat in -90.0..90.0 && lon in -180.0..180.0)
  require(photoAt in fix..at && at-photoAt<=maxAge)
 }
 companion object {
  private fun integer(j:JSONObject,k:String):Long {val v=j.get(k);require(v is Int || v is Long);return (v as Number).toLong()}
  fun parse(j:JSONObject):AuthorizedCheckInPolicy {
   val p=AuthorizedCheckInPolicy(integer(j,"revision"),integer(j,"starts_at"),integer(j,"ends_at"),integer(j,"interval_ms"),integer(j,"window_ms"),integer(j,"max_evidence_age_ms"),j.getDouble("max_accuracy_m"))
   require(p.revision>0 && p.startsAt>0 && p.endsAt>p.startsAt && p.interval in 60000..86400000 && p.window in 1000..p.interval && p.maxAge in 1000..minOf(300000,p.window) && p.maxAccuracy>0 && p.maxAccuracy<=1000)
   return p
  }
 }
}
data class AuthorizedCheckInEvidence(val policy:AuthorizedCheckInPolicy,val slot:Long,val biometricAt:Long,val location:JSONObject)
