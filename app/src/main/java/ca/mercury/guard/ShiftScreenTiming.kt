package ca.mercury.guard

/** Display timing uses the verified response's epoch and same-boot elapsed time, never wall time. */
internal object ShiftScreenTiming {
 fun remaining(serverEpoch:Long,anchorElapsed:Long,nowElapsed:Long,endsAt:Long):Long {
  require(endsAt>0)
  val observed=ConnectedLocationTiming.observationAt(serverEpoch,anchorElapsed,nowElapsed)
  return if(observed>=endsAt)0L else Math.subtractExact(endsAt,observed)
 }
}
