package ca.mercury.guard
import org.junit.Assert.assertEquals
import org.junit.Test
class DutyTimingTest {
 @Test fun exactStageBoundaries() {
  listOf(-1L to "scheduled",0L to "green",119999L to "green",120000L to "yellow",299999L to "yellow",300000L to "red",599999L to "red",600000L to "missed",900000L to "missed").forEach { (age,stage) -> assertEquals(stage,DutyTiming.stage(age)) }
 }
}
