package ca.mercury.guard

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** HTTPS transport foundation. Caller owns verified capture scope and session lifecycle.
 * Local pilot receipts deliberately cannot acknowledge the operational demo outbox. */
class GuardTransport(private val endpoint: String) {
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
  val connection = URL(endpoint.trimEnd('/') + "/v2/batches").openConnection() as HttpURLConnection
  try {
   connection.requestMethod = "POST"; connection.instanceFollowRedirects = false
   connection.connectTimeout = 10000; connection.readTimeout = 10000; connection.doOutput = true
   connection.setRequestProperty("Authorization", "Bearer $accessToken")
   connection.setRequestProperty("Content-Type", "application/json")
   connection.setFixedLengthStreamingMode(bytes.size)
   connection.outputStream.use { it.write(bytes) }
   check(connection.responseCode == 200) { "Report not accepted (HTTP ${connection.responseCode})" }
   val body = connection.inputStream.use { input ->
    val buffer = java.io.ByteArrayOutputStream(); val chunk = ByteArray(4096)
    while (true) { val count = input.read(chunk); if (count < 0) break; check(buffer.size() + count <= 32768); buffer.write(chunk,0,count) }
    buffer.toString("UTF-8")
   }
   return validatePilotReceipt(JSONObject(body), expectedBatchId, expectedIds)
  } finally { connection.disconnect() }
 }
 fun sendPilotEvidence(accessToken:String,eventId:String,metadata:JSONObject,bytes:ByteArray):JSONObject {
  require(java.util.UUID.fromString(eventId).toString()==eventId)
  require(accessToken.isNotBlank()&&accessToken.length<=16384&&accessToken.none{it.isWhitespace()})
  require(bytes.size.toLong() in 1..EvidenceStore.MAX_PHOTO_BYTES && metadata.getLong("bytes")==bytes.size.toLong())
  val hash=java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
  require(metadata.getString("sha256")==hash)
  val connection=URL(endpoint.trimEnd('/')+"/v1/evidence/"+eventId).openConnection() as HttpURLConnection
  try{
   connection.requestMethod="POST";connection.instanceFollowRedirects=false;connection.connectTimeout=10000;connection.readTimeout=10000;connection.doOutput=true
   connection.setRequestProperty("Authorization","Bearer $accessToken");connection.setRequestProperty("Content-Type","image/jpeg");connection.setFixedLengthStreamingMode(bytes.size)
   connection.outputStream.use{it.write(bytes)}
   check(connection.responseCode==200){"Evidence not accepted (HTTP ${connection.responseCode})"}
   val raw=connection.inputStream.use{input->
    val out=java.io.ByteArrayOutputStream();val chunk=ByteArray(1024)
    while(true){val count=input.read(chunk);if(count<0)break;check(out.size()+count<=8192);out.write(chunk,0,count)}
    out.toString("UTF-8")
   }
   return JSONObject(raw).also{validateEvidenceReceipt(it,eventId,metadata)}
  }finally{connection.disconnect()}
 }
 companion object {
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
