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
 @Test fun chunkReceiptIsExactOriginalScopeAndCannotAcknowledgeFinalEvidence(){
  val id=UUID.randomUUID().toString();val bytes=byteArrayOf(-1,-40,-1,-39);val metadata=JSONObject().put("evidence_id",UUID.randomUUID().toString()).put("sha256",GuardTransport.photoHash(bytes)).put("bytes",bytes.size)
  val receipt=JSONObject(metadata.toString()).put("event_id",id).put("chunk_index",0).put("chunk_sha256",GuardTransport.photoHash(bytes)).put("chunk_bytes",bytes.size).put("status","evidence_chunk_retained")
  GuardTransport.validateEvidenceChunkReceipt(receipt,id,metadata,0,bytes)
  assertThrows(IllegalArgumentException::class.java){GuardTransport.validateEvidenceReceipt(receipt,id,metadata)}
  for((field,value) in listOf("event_id" to UUID.randomUUID().toString(),"evidence_id" to UUID.randomUUID().toString(),"sha256" to "b".repeat(64),"chunk_sha256" to "b".repeat(64),"bytes" to 5,"chunk_bytes" to "4","chunk_index" to 1,"status" to "evidence_accepted_local_only")){
   assertThrows(IllegalArgumentException::class.java){GuardTransport.validateEvidenceChunkReceipt(JSONObject(receipt.toString()).put(field,value),id,metadata,0,bytes)}
  }
  assertThrows(IllegalArgumentException::class.java){GuardTransport.validateEvidenceChunkReceipt(JSONObject(receipt.toString()).put("foreign","value"),id,metadata,0,bytes)}
 }
}
