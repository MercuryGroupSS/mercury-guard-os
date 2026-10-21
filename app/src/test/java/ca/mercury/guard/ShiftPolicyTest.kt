package ca.mercury.guard
import org.junit.Assert.*
import org.junit.Test
class ShiftPolicyTest {
 @Test fun noGrantDenies() { assertFalse(ShiftPolicy.permits(-1,100,1,1)) }
 @Test fun activeSessionPermits() { assertTrue(ShiftPolicy.permits(100,200,1,1)) }
 @Test fun expiryBoundaryDenies() { assertFalse(ShiftPolicy.permits(100,100+ShiftPolicy.MAX_DURATION_MS,1,1)) }
 @Test fun beforeExpiryPermits() { assertTrue(ShiftPolicy.permits(100,99+ShiftPolicy.MAX_DURATION_MS,1,1)) }
 @Test fun rebootDenies() { assertFalse(ShiftPolicy.permits(100,200,1,2)) }
 @Test fun clockRollbackDenies() { assertFalse(ShiftPolicy.permits(200,100,1,1)) }
}
