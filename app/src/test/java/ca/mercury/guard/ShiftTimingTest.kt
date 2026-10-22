package ca.mercury.guard

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ShiftTimingTest {
 @Test fun clockOutAppearsOnlyAtOrAfterScheduledEnd() {
  assertFalse(ShiftTiming.atOrAfterEnd(999,1000))
  assertTrue(ShiftTiming.atOrAfterEnd(1000,1000))
  assertTrue(ShiftTiming.atOrAfterEnd(1001,1000))
  assertFalse(ShiftTiming.atOrAfterEnd(1001,-1))
 }
 @Test fun overnightShiftUsesFullTimestamp() {
  val end = Instant.parse("2026-10-22T06:00:00Z").toEpochMilli()
  assertFalse(ShiftTiming.atOrAfterEnd(Instant.parse("2026-10-21T23:59:00Z").toEpochMilli(),end))
  assertFalse(ShiftTiming.atOrAfterEnd(Instant.parse("2026-10-22T05:59:59Z").toEpochMilli(),end))
  assertTrue(ShiftTiming.atOrAfterEnd(end,end))
 }
 @Test fun missingShiftFailedAuthenticationMissingChecksAndRepeatCannotClockIn() {
  assertTrue(ShiftTiming.mayClockIn(true,true,true,false))
  assertFalse(ShiftTiming.mayClockIn(false,true,true,false))
  assertFalse(ShiftTiming.mayClockIn(true,false,true,false))
  assertFalse(ShiftTiming.mayClockIn(true,true,false,false))
  assertFalse(ShiftTiming.mayClockIn(true,true,true,true))
 }
}
