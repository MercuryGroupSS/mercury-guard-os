package ca.mercury.guard

import android.location.Location
import org.json.JSONObject

/** A point fix measured after this particular user request; wall time is never capture authority. */
internal class AuthorizedPatrolLocation private constructor(val requestedAt:Long,val fixAt:Long,val at:Long,val latitude:Double,val longitude:Double,val accuracy:Double,private val consent:AuthorizedLocationConsent){
 fun data()=JSONObject().put("requested_at_ms",requestedAt).put("fix_at_ms",fixAt).put("consent_id",consent.id)
  .put("policy_revision",consent.policy.revision).put("notice_revision",consent.policy.noticeRevision)
  .put("policy_sha256",consent.policy.sha256).put("notice_sha256",consent.policy.noticeSha256)
  .put("latitude",latitude).put("longitude",longitude).put("accuracy_m",accuracy).put("mock",false)
 companion object {
  fun fromLocation(location:Location,grant:VerifiedShiftGrant,anchor:ServerTimeAnchor,requestedNanos:Long,nowNanos:Long):AuthorizedPatrolLocation? {return try{
   val consent=grant.location?:return null
   val times=PatrolPointTiming.check(anchor.epochMillis,anchor.elapsedMillis,requestedNanos,location.elapsedRealtimeNanos,nowNanos,grant.notBeforeEpoch,grant.expiresEpoch,consent.policy.maxAge)?:return null
   if(location.isFromMockProvider||!location.hasAccuracy()||!location.latitude.isFinite()||location.latitude !in -90.0..90.0||!location.longitude.isFinite()||location.longitude !in -180.0..180.0||!location.accuracy.isFinite()||location.accuracy<=0||location.accuracy>consent.policy.maxAccuracy)return null
   AuthorizedPatrolLocation(times.requested,times.fix,times.observed,location.latitude,location.longitude,location.accuracy.toDouble(),consent)
  }catch(_:Exception){null}}
 }
}

/** Shared monotonic conversion makes request <= fresh fix <= observation exact at millisecond precision. */
internal object PatrolPointTiming {
 data class Times(val requested:Long,val fix:Long,val observed:Long)
 fun check(epoch:Long,anchorElapsed:Long,requestedNanos:Long,fixNanos:Long,nowNanos:Long,notBefore:Long,expires:Long,maxAge:Long):Times? = try{
  require(requestedNanos>0&&fixNanos>=requestedNanos&&nowNanos>=fixNanos&&maxAge>0)
  fun at(nanos:Long)=ConnectedLocationTiming.observationAt(epoch,anchorElapsed,nanos/1000000)
  val times=Times(at(requestedNanos),at(fixNanos),at(nowNanos))
  require(notBefore>0&&times.requested>=notBefore&&times.requested<=times.fix&&times.fix<=times.observed&&times.observed<expires&&times.observed-times.fix<=maxAge)
  times
 }catch(_:Exception){null}
}
