package ca.mercury.guard

import org.junit.Assert.*
import org.junit.Test

class ShiftScreenTimingTest {
 @Test fun deadlineUsesServiceEpochAndElapsedTimeAtExactBoundary(){
  val epoch=1730000000000L
  assertEquals(1L,ShiftScreenTiming.remaining(epoch,10000,10999,epoch+1000))
  assertEquals(0L,ShiftScreenTiming.remaining(epoch,10000,11000,epoch+1000))
  assertEquals(0L,ShiftScreenTiming.remaining(epoch,10000,12000,epoch+1000))
 }
 @Test fun changedElapsedOriginCannotInventAnExpiredOrFutureShift(){
  for(values in listOf(longArrayOf(1730000000000,10000,9999,1730000001000),longArrayOf(0,10000,10001,1730000001000),longArrayOf(1730000000000,10000,10001,0))){
   try{ShiftScreenTiming.remaining(values[0],values[1],values[2],values[3]);fail("Invalid anchor accepted")}catch(_:IllegalArgumentException){}
  }
 }
 @Test fun overflowFailsClosedInsteadOfReversingClockOutEligibility(){
  try{ShiftScreenTiming.remaining(Long.MAX_VALUE,0,1,Long.MAX_VALUE);fail("Overflow accepted")}catch(_:ArithmeticException){}
 }
}
