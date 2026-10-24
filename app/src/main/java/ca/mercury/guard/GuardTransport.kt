package ca.mercury.guard

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** HTTPS transport foundation. Caller owns verified capture scope and session lifecycle.
 * Local pilot receipts deliberately cannot acknowledge the operational demo outbox. */
class GuardTransport(private val endpoint: String,private val network:android.net.Network?=null,private val cancellation:UploadCancellation?=null) {
 class HttpFailure(val statusCode:Int):IllegalStateException("Upload unavailable (HTTP $statusCode)")
 data class PilotReceipt(val batchId: String, val eventIds: Set<String>)
 init {
  val uri = URI(endpoint)
  require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null)
  require(uri.path.isNullOrEmpty() || uri.path == "/")
 }
 fun sendPilotBatch(accessToken: String, proof: JSONObject, expectedBatchId: String, expectedIds: Set<String>): PilotReceipt {
  require(accessToken.isNotBlank() && accessToken.length <= 16384 && accessToken.none { it.isWhitespace() })
  require(proof.getInt("version") == 2) { "Original capture scope required" }
  val bytes = proof.toString().toByteArray(Charsets.UTF_8)
  require(bytes.size <= 360000)
  cancellation?.check();val url=URL(endpoint.trimEnd('/') + "/v2/batches")
  val connection = (network?.openConnection(url)?:url.openConnection()) as HttpURLConnection
  try {
   cancellation?.attach(connection);cancellation?.check()
   connection.requestMethod = "POST"; connection.instanceFollowRedirects = false
   connection.connectTimeout = 10000; connection.readTimeout = 10000; connection.doOutput = true
   connection.setRequestProperty("Authorization", "Bearer $accessToken")
   connection.setRequestProperty("Content-Type", "application/json")
   connection.setFixedLengthStreamingMode(bytes.size)
   cancellation?.check();connection.outputStream.use { cancellation?.check();it.write(bytes) }
   if(connection.responseCode!=200)throw HttpFailure(connection.responseCode)
   val body = connection.inputStream.use { input ->
    val buffer = java.io.ByteArrayOutputStream(); val chunk = ByteArray(4096)
    while (true) { val count = input.read(chunk); if (count < 0) break; check(buffer.size() + count <= 32768); buffer.write(chunk,0,count) }
    buffer.toString("UTF-8")
   }
   return validatePilotReceipt(JSONObject(body), expectedBatchId, expectedIds)
  } finally { cancellation?.detach(connection);connection.disconnect() }
 }
 fun sendPilotEvidence(accessToken:String,eventId:String,metadata:JSONObject,bytes:ByteArray,identity:DeviceIdentity,audience:String):JSONObject {
  // Snapshot original ownership/hash/bytes before networking. A chunk receipt
  // never acknowledges local evidence; only the unchanged final receipt does.
  require(bytes.size.toLong() in 1..EvidenceStore.MAX_PHOTO_BYTES)
  val expected=JSONObject(metadata.toString());val original=bytes.copyOf()
  require(java.util.UUID.fromString(eventId).toString()==eventId)
  require(accessToken.isNotBlank()&&accessToken.length<=16384&&accessToken.none{it.isWhitespace()})
  require(original.size.toLong() in 1..EvidenceStore.MAX_PHOTO_BYTES && expected.getLong("bytes")==original.size.toLong())
  require(expected.getString("sha256")==photoHash(original))
  for(index in 0 until PhotoChunkPlan.count(original.size)){
   cancellation?.check();val range=PhotoChunkPlan.range(original.size,index);val part=original.copyOfRange(range.first,range.last+1)
   val hash=photoHash(part);val signature=identity.signEvidenceChunk(audience,eventId,expected,index,hash,part.size)
   val receipt=sendEvidencePart(accessToken,"$eventId/chunks/$index","application/octet-stream",part,hash,signature)
   validateEvidenceChunkReceipt(receipt,eventId,expected,index,part)
  }
  cancellation?.check();return sendEvidencePart(accessToken,"$eventId/finalize","application/json","{}".toByteArray(Charsets.UTF_8)).also{validateEvidenceReceipt(it,eventId,expected)}
 }
 private fun sendEvidencePart(accessToken:String,path:String,type:String,bytes:ByteArray,chunkHash:String?=null,chunkSignature:String?=null):JSONObject {
  cancellation?.check();val url=URL(endpoint.trimEnd('/')+"/v1/evidence/"+path)
  val connection=(network?.openConnection(url)?:url.openConnection()) as HttpURLConnection
  try{
   cancellation?.attach(connection);cancellation?.check()
   connection.requestMethod="POST";connection.instanceFollowRedirects=false;connection.connectTimeout=10000;connection.readTimeout=10000;connection.doOutput=true
   connection.setRequestProperty("Authorization","Bearer $accessToken");connection.setRequestProperty("Content-Type",type);chunkHash?.let{connection.setRequestProperty("X-Mercury-Chunk-SHA256",it)};chunkSignature?.let{connection.setRequestProperty("X-Mercury-Chunk-Signature",it)};connection.setFixedLengthStreamingMode(bytes.size)
   cancellation?.check();connection.outputStream.use{cancellation?.check();it.write(bytes)}
   if(connection.responseCode!=200)throw HttpFailure(connection.responseCode)
   val raw=connection.inputStream.use{input->
    val out=java.io.ByteArrayOutputStream();val chunk=ByteArray(1024)
    while(true){val count=input.read(chunk);if(count<0)break;check(out.size()+count<=8192);out.write(chunk,0,count)}
    out.toString("UTF-8")
   }
   return JSONObject(raw)
  }finally{cancellation?.detach(connection);connection.disconnect()}
 }
 companion object {
  internal fun photoHash(bytes:ByteArray)=java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
  internal fun validateEvidenceChunkReceipt(receipt:JSONObject,eventId:String,metadata:JSONObject,index:Int,bytes:ByteArray){
   require(receipt.keys().asSequence().toSet()==setOf("event_id","evidence_id","sha256","bytes","chunk_index","chunk_sha256","chunk_bytes","status"))
   require(receipt.get("event_id")==eventId&&receipt.get("evidence_id")==metadata.get("evidence_id")&&receipt.get("sha256")==metadata.get("sha256")&&receipt.get("status")=="evidence_chunk_retained")
   fun number(name:String):Long {val value=receipt.get(name);require(value is Int||value is Long);return (value as Number).toLong()}
   require(number("bytes")==metadata.getLong("bytes")&&number("chunk_index")==index.toLong()&&number("chunk_bytes")==bytes.size.toLong()&&receipt.get("chunk_sha256")==photoHash(bytes))
   require(PhotoChunkPlan.range(metadata.getInt("bytes"),index).count()==bytes.size)
  }
  fun validateEvidenceReceipt(receipt:JSONObject,eventId:String,metadata:JSONObject){
   require(receipt.keys().asSequence().toSet()==setOf("event_id","evidence_id","sha256","bytes","status"))
   require(receipt.get("event_id")==eventId&&receipt.get("evidence_id")==metadata.get("evidence_id")&&receipt.get("sha256")==metadata.get("sha256")&&receipt.get("status")=="evidence_accepted_local_only")
   val size=receipt.get("bytes");require(size is Int || size is Long);require((size as Number).toLong()==metadata.getLong("bytes"))
  }

  fun validatePilotReceipt(receipt: JSONObject, expectedBatchId: String, expectedIds: Set<String>): PilotReceipt {
   require(expectedIds.isNotEmpty() && expectedIds.size <= 100)
   require(receipt.keys().asSequence().toSet() == setOf("batch_id","event_ids","status"))
   require(receipt.getString("batch_id") == expectedBatchId && receipt.getString("status") == "accepted_local_only")
   val values = receipt.getJSONArray("event_ids"); val ids = (0 until values.length()).map { values.get(it) }
   require(ids.all { it is String } && ids.size == ids.toSet().size && ids.toSet() == expectedIds)
   return PilotReceipt(expectedBatchId,expectedIds.toSet())
  }
 }
}
