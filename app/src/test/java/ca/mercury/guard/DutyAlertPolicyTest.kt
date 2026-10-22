package ca.mercury.guard
import org.junit.Assert.*
import org.junit.Test
class DutyAlertPolicyTest {
 @Test fun cadenceHasExactlyTwentyBoundedSlotsAndNoCatchupBurst() {
  assertNull(DutyAlertPolicy.slot(1000,999))
  assertEquals(0,DutyAlertPolicy.slot(1000,1000))
  assertEquals(0,DutyAlertPolicy.slot(1000,30999))
  assertEquals(1,DutyAlertPolicy.slot(1000,31000))
  assertEquals(19,DutyAlertPolicy.slot(1000,600999))
  assertNull(DutyAlertPolicy.slot(1000,601000))
  assertEquals((0..19).toSet(),(0L until 600000 step 1000).mapNotNull { DutyAlertPolicy.slot(0,it) }.toSet())
 }
 @Test fun mutedOrAlreadyAttemptedSlotDoesNotRepeat() {
  assertFalse(DutyAlertPolicy.shouldNotify(0,30000,1,false))
  assertFalse(DutyAlertPolicy.shouldNotify(0,60000,1,true))
  assertTrue(DutyAlertPolicy.shouldNotify(0,300000,1,false))
  assertFalse(DutyAlertPolicy.shouldNotify(0,600000,1,false))
 }
}
