package ca.mercury.guard
import org.junit.Assert.*
import org.junit.Test

class FullScreenAlertPolicyTest {
 // Synthetic OS snapshot: no test grants special access or changes keyguard.
 private data class FakeAccess(val consent: Boolean=true,val os: Boolean=true,val notifications: Boolean=true,
  val high: Boolean=true,val locked: Boolean=true,val active: Boolean=true,val attempted: Boolean=false) {
  fun eligible()=FullScreenAlertPolicy.allowed(consent,os,notifications,high,locked,active,attempted)
 }
 @Test fun grantedSnapshotSelectsFullScreenAndEachMissingRequirementFallsBack() {
  val granted=FakeAccess()
  assertTrue(granted.eligible())
  listOf(granted.copy(consent=false),granted.copy(os=false),granted.copy(notifications=false),
   granted.copy(high=false),granted.copy(locked=false),granted.copy(active=false),granted.copy(attempted=true))
   .forEach { assertFalse(it.toString(),it.eligible()) }
 }
 @Test fun allCombinationsFailClosedExceptFullyEligibleSnapshot() {
  for(mask in 0 until 128) {
   fun bit(i:Int)=mask and (1 shl i)!=0
   assertEquals(mask==63,FullScreenAlertPolicy.allowed(bit(0),bit(1),bit(2),bit(3),bit(4),bit(5),bit(6)))
  }
 }
 @Test fun revocationAndRecreationDoNotRelaunch() {
  val initial=FakeAccess();assertTrue(initial.eligible())
  assertFalse(initial.copy(attempted=true).eligible())
  assertFalse(initial.copy(os=false).eligible())
  assertFalse(initial.copy(consent=false).eligible())
 }
}
