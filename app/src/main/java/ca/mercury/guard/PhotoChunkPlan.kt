package ca.mercury.guard

/** Original JPEGs have at most20 deterministic1MiB pieces; no recompression or new identity. */
internal object PhotoChunkPlan {
 const val CHUNK_BYTES=1024*1024
 const val MAX_BYTES=20*CHUNK_BYTES
 fun count(size:Int):Int {require(size in 1..MAX_BYTES);return (size-1)/CHUNK_BYTES+1}
 fun range(size:Int,index:Int):IntRange {require(index in 0 until count(size));val start=index*CHUNK_BYTES;return start until minOf(size,start+CHUNK_BYTES)}
 fun proofMessage(audience:String,thumbprint:String,eventId:String,evidenceId:String,sha256:String,size:Int,index:Int,chunkHash:String,chunkBytes:Int):String {
  require(audience.matches(Regex("[A-Za-z0-9._:/-]{1,128}")))
  require(listOf(thumbprint,sha256,chunkHash).all{it.matches(Regex("[a-f0-9]{64}"))})
  require(listOf(eventId,evidenceId).all{it.matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))})
  val range=range(size,index);require(chunkBytes==range.last-range.first+1)
  return listOf("mercury-evidence-chunk-v1",audience,thumbprint,eventId,evidenceId,sha256,size.toString(),index.toString(),chunkHash,chunkBytes.toString()).joinToString("\n")
 }
}
