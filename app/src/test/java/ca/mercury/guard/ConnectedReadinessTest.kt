package ca.mercury.guard

import org.junit.Assert.*
import org.junit.Test

class ConnectedReadinessTest {
 private fun snapshot()=ConnectedReadiness.Snapshot(ConnectedReadiness.Access.AVAILABLE,ConnectedReadiness.Access.AVAILABLE,ConnectedReadiness.Access.AVAILABLE,ConnectedReadiness.Channel.NOT_CREATED,ConnectedReadiness.Channel.BLOCKED,ConnectedReadiness.Access.BLOCKED,ConnectedReadiness.Consent.ACCEPTED,true)
 @Test fun availablePermissionsAndCollectionNeverClaimFreshFixPresenceOrScheduledReminder(){
  val text=snapshot().lines().joinToString("\n")
  assertTrue(text.contains("fresh location and permission to continue are checked separately"));assertTrue(text.contains("not checked here"));assertTrue(text.contains("do not prove"));assertTrue(text.contains("no reminder is enabled here"))
  assertTrue(text.contains("not created on this phone"));assertTrue(text.contains("channel: blocked"))
 }
 @Test fun unreadableConsentAndProviderAreUnavailableRatherThanDisabledOrAccepted(){
  val text=snapshot().copy(gps=ConnectedReadiness.Access.UNAVAILABLE,consent=ConnectedReadiness.Consent.UNAVAILABLE,collecting=null).lines().joinToString("\n")
  assertTrue(text.contains("GPS provider: unavailable to inspect"));assertTrue(text.contains("no consent state is assumed"));assertTrue(text.contains("Collection for this consent: not verified"));assertFalse(text.contains("service accepted this consent"))
 }
 @Test fun withdrawnReceiptCannotBePresentedAsConsentOrActiveAuthority(){
  for(state in listOf(ConnectedReadiness.Consent.WITHDRAWAL_PENDING,ConnectedReadiness.Consent.WITHDRAWN)){
   val text=snapshot().copy(consent=state,collecting=false).lines().joinToString("\n")
   assertTrue(text.contains("withdraw"));assertFalse(text.contains("service accepted this consent"));assertTrue(text.contains("no sharing session observed on this phone"))
  }
 }
 @Test fun lateRefreshAndClosedViewCannotAcceptOldResponse(){
  val fence=ConnectedReadFence();val first=fence.begin();val second=fence.begin()
  assertFalse(fence.accepts(first));assertTrue(fence.accepts(second));fence.close();assertFalse(fence.accepts(first));assertFalse(fence.accepts(second))
  try{fence.begin();fail("Closed view reopened")}catch(_:IllegalStateException){}
 }
}
