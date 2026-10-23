package ca.mercury.guard
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID
class EvidenceReceiptTest {
 @Test fun mediaReceiptMustMatchExactPhotoAndDoesNotAcceptMetadataReceipt(){
  val id=UUID.randomUUID().toString();val metadata=JSONObject().put("evidence_id",UUID.randomUUID().toString()).put("sha256","a".repeat(64)).put("bytes",100)
  val receipt=JSONObject(metadata.toString()).put("event_id",id).put("status","evidence_accepted_local_only")
  GuardTransport.validateEvidenceReceipt(receipt,id,metadata)
  for((field,value) in listOf("event_id" to UUID.randomUUID().toString(),"sha256" to "b".repeat(64),"bytes" to 101,"bytes" to "100","status" to "accepted_local_only")){
   try{GuardTransport.validateEvidenceReceipt(JSONObject(receipt.toString()).put(field,value),id,metadata);fail("Invalid media receipt accepted")}catch(_:IllegalArgumentException){}
  }
 }
}
