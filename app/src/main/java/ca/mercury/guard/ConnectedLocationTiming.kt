package ca.mercury.guard

internal object ConnectedLocationTiming {
 fun sampleDue(now:Long,last:Long,interval:Long,moved:Double?,minimum:Double):Boolean {
  require(interval in 1000..3600000&&minimum.isFinite()&&minimum in 0.0..10000.0)
  if(now<0||last>=0&&(now<last||now-last<interval))return false
  return moved==null||moved.isFinite()&&moved>=minimum
 }
 fun observationAt(serverEpoch:Long,responseCompleted:Long,now:Long):Long {require(serverEpoch>0&&responseCompleted>=0&&now>=responseCompleted);return Math.addExact(serverEpoch,now-responseCompleted)}
 fun renewalAt(now:Long,expires:Long):Long {require(now>=0&&expires>now);return now+(expires-now)/2}
}
