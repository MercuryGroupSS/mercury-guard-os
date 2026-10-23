package ca.mercury.guard

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class EscalationRulesTest {
 private fun intent(description:String="Need assistance",at:Long=1000000,location:EscalationLocation?=null)=EscalationIntent(UUID.randomUUID().toString(),"guard","vendor",null,at,"assistance",description,location)
 private fun rejected(action:()->Unit){try{action();fail("Invalid escalation accepted")}catch(_:IllegalArgumentException){}}
 @Test fun unicodeUsesCodePointsAndRejectsBrokenSurrogatesAndControls(){
  assertTrue(EscalationRules.description("🚨".repeat(2000)));assertFalse(EscalationRules.description("🚨".repeat(2001)))
  for(text in listOf("", " \n\t\uFEFF", "broken\uD83D", "broken\uDC00", "hidden\u0000", "hidden\u007F"))assertFalse(text,EscalationRules.description(text))
  assertTrue(EscalationRules.description("Need\nassistance\tplease\r\nCafé 🚨"))
 }
 @Test fun immutableModelAllowsNoAssignmentAndMissingLocationButRejectsBadScopeOrUrgency(){
  assertNull(intent().assignmentId);assertNull(intent().location)
  rejected{intent().copy(id="NOT-A-UUID")};rejected{intent().copy(id="00000000-0000-4000-8000-00000000000A")}
  rejected{intent().copy(guardId="another guard")};rejected{intent().copy(vendorId="")}
  rejected{intent().copy(assignmentId="untrusted assignment")};rejected{intent().copy(urgency="emergency_called")};rejected{intent(at=0)}
 }
 @Test fun staleFutureInaccurateOrNonFiniteLocationIsOptionalAndNeverReplacesIntent(){
  val good=EscalationLocation(999000,45.0,-73.0,5.0);assertEquals(good,EscalationRules.optionalLocation(good,1000000));assertNotNull(intent(location=good))
  for(value in listOf(good.copy(atMillis=699999),good.copy(atMillis=1000001),good.copy(accuracy=0.0),good.copy(accuracy=1000.1),good.copy(latitude=Double.NaN),good.copy(longitude=181.0))){
   assertNull(EscalationRules.optionalLocation(value,1000000));rejected{intent(location=value)}
  }
  assertNull(EscalationRules.optionalLocation(null,1000000))
 }
}
