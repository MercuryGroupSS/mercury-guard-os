package ca.mercury.guard

import android.location.Location
import org.json.JSONObject

internal class ConnectedLocationSample private constructor(val at:Long,val fixAt:Long,val latitude:Double,val longitude:Double,val accuracy:Double){
 fun data(authorization:AuthorizedLocationConsent)=JSONObject().put("consent_id",authorization.id).put("policy_revision",authorization.policy.revision).put("policy_sha256",authorization.policy.sha256)
  .put("fix_at_ms",fixAt).put("latitude",latitude).put("longitude",longitude).put("accuracy_m",accuracy).put("mock",false)
 companion object {
  fun fromLocation(location:Location,grant:VerifiedShiftGrant,at:Long,elapsedNanos:Long):ConnectedLocationSample? {
   val p=grant.location?.policy?:return null
   if(location.isFromMockProvider||!location.hasAccuracy()||location.elapsedRealtimeNanos<=0||location.elapsedRealtimeNanos>elapsedNanos)return null
   val age=(elapsedNanos-location.elapsedRealtimeNanos)/1000000
   val fix=try{Math.subtractExact(at,age)}catch(_:Exception){return null}
   if(age !in 0..p.maxAge||fix<grant.notBeforeEpoch||at>=grant.expiresEpoch||at<fix||!location.latitude.isFinite()||location.latitude !in -90.0..90.0||!location.longitude.isFinite()||location.longitude !in -180.0..180.0||!location.accuracy.isFinite()||location.accuracy<=0||location.accuracy>p.maxAccuracy)return null
   return ConnectedLocationSample(at,fix,location.latitude,location.longitude,location.accuracy.toDouble())
  }
 }
}
