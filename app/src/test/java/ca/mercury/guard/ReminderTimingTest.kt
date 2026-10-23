package ca.mercury.guard
import org.junit.Assert.*
import org.junit.Test
class ReminderTimingTest {
 private fun at(now:Long,last:Long = -1,done:Boolean=false)=ReminderTiming.evaluate(1000,131000,60000,10000,now,last,done)
 @Test fun futureDueAndClosedWindowsAreDistinct(){
  assertFalse(at(999).notify);assertEquals(1000L,at(999).nextAt)
  assertTrue(at(1000).notify);assertTrue(at(10999).notify)
  assertFalse(at(11000).notify);assertEquals(61000L,at(11000).nextAt)
  assertTrue(at(61000).notify);assertEquals(1L,at(61000).slot)
 }
 @Test fun savedOrAlreadyAttemptedSlotDoesNotReplayButNextSlotStillReminds(){
  assertFalse(at(2000,0).notify);assertFalse(at(2000,done=true).notify)
  assertTrue(at(62000,0).notify);assertFalse(at(62000,1).notify)
 }
 @Test fun delayedAlarmSkipsExpiredWindowsAndAssignmentEndStopsAllWork(){
  assertFalse(at(75000).notify);assertEquals(121000L,at(75000).nextAt)
  assertTrue(at(130999).notify);assertEquals(131000L,at(130999).expiresAt)
  assertFalse(at(131000).notify);assertNull(at(131000).nextAt);assertNull(at(500000).nextAt)
 }
}
