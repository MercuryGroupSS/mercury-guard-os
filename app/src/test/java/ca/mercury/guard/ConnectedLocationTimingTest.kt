package ca.mercury.guard

import org.junit.Assert.*
import org.junit.Test

class ConnectedLocationTimingTest {
 @Test fun firstFixNeedsNoAssumedMovementAndCadenceIsAnExplicitPolicyBoundary(){
  assertTrue(ConnectedLocationTiming.sampleDue(10000,-1,5000,null,10.0))
  assertFalse(ConnectedLocationTiming.sampleDue(14999,10000,5000,100.0,10.0))
  assertTrue(ConnectedLocationTiming.sampleDue(15000,10000,5000,10.0,10.0))
 }
 @Test fun insufficientInvalidOrReversedObservationsCannotProduceASample(){
  assertFalse(ConnectedLocationTiming.sampleDue(20000,10000,5000,9.99,10.0))
  assertFalse(ConnectedLocationTiming.sampleDue(20000,10000,5000,Double.NaN,10.0))
  assertFalse(ConnectedLocationTiming.sampleDue(9000,10000,5000,100.0,10.0))
  assertFalse(ConnectedLocationTiming.sampleDue(-1,-1,5000,null,10.0))
 }
 @Test fun asymmetricUplinkCannotMakeCaptureTimestampAheadOfTheServerReceiptBound(){
  // Request starts0, server creates response500, response completes510, sample occurs520.
  val at=ConnectedLocationTiming.observationAt(500,510,520)
  assertEquals(510,at);assertTrue(at<=520)
  assertEquals(500,ConnectedLocationTiming.observationAt(500,510,510))
  try{ConnectedLocationTiming.observationAt(500,510,509);fail("Clock reversal accepted")}catch(_:IllegalArgumentException){}
 }
 @Test fun zeroMovementPolicyDoesNotInventADistanceFilter(){assertTrue(ConnectedLocationTiming.sampleDue(20000,10000,5000,0.0,0.0))}
 @Test fun renewalIsBeforeOriginalExpiryAndCannotExtendAnExpiredLease(){
  assertEquals(15000,ConnectedLocationTiming.renewalAt(10000,20000));assertEquals(10000,ConnectedLocationTiming.renewalAt(10000,10001))
  for(end in listOf(9999L,10000L)){try{ConnectedLocationTiming.renewalAt(10000,end);fail("Expired lease renewed locally")}catch(_:IllegalArgumentException){}}
 }
}
