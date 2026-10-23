package ca.mercury.guard
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
class GuardTransportTest {
 private fun receipt()=JSONObject("""{"batch_id":"batch","event_ids":["event"],"status":"accepted_local_only"}""")
 private fun rejected(block:()->Unit) { try { block(); fail("Expected rejection") } catch (_:IllegalArgumentException) {} }
 @Test fun pilotReceiptMustMatchEntireSubmittedBatch() {
  assertEquals(setOf("event"),GuardTransport.validatePilotReceipt(receipt(),"batch",setOf("event")).eventIds)
  rejected {GuardTransport.validatePilotReceipt(receipt(),"other",setOf("event"))}
  rejected {GuardTransport.validatePilotReceipt(receipt(),"batch",setOf("other"))}
  rejected {GuardTransport.validatePilotReceipt(receipt().put("status","delivered"),"batch",setOf("event"))}
  rejected {GuardTransport.validatePilotReceipt(receipt().put("extra",true),"batch",setOf("event"))}
  rejected {GuardTransport.validatePilotReceipt(receipt().put("event_ids",org.json.JSONArray("[\"event\",\"event\"]")),"batch",setOf("event"))}
 }
 @Test fun tokenCannotBeSentToCleartextOrEmbeddedCredentialOrigin() {
  for(url in listOf("http://example.com","https://user:password@example.com","https://example.com/path","https://example.com?redirect=1")) rejected {GuardTransport(url)}
  GuardTransport("https://example.com")
 }
}
