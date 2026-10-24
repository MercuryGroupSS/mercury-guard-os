package ca.mercury.guard

import org.junit.Assert.*
import org.junit.Test

class PhotoChunkPlanTest {
 @Test fun boundaryAndMaximumPreserveEveryOriginalByteOnce(){
  for(size in listOf(1,1048576,1048577,20*1048576)){
   val ranges=(0 until PhotoChunkPlan.count(size)).map{PhotoChunkPlan.range(size,it)}
   assertEquals(0,ranges.first().first);assertEquals(size-1,ranges.last().last)
   assertEquals(size,ranges.sumOf{it.count()});assertTrue(ranges.all{it.count() in 1..1048576});assertTrue(ranges.size<=20)
   for(index in 1 until ranges.size)assertEquals(ranges[index-1].last+1,ranges[index].first)
  }
 }
 @Test fun invalidSizeOrIndexCannotCreateUnboundedTransfer(){
  for(size in listOf(-1,0,20*1048576+1,Int.MAX_VALUE))assertThrows(IllegalArgumentException::class.java){PhotoChunkPlan.count(size)}
  for(index in listOf(-1,1,Int.MAX_VALUE))assertThrows(IllegalArgumentException::class.java){PhotoChunkPlan.range(1048576,index)}
 }
 @Test fun canonicalProofBindsOriginalPhotoAndEachPieceWithoutAmbiguousEncoding(){
  val event="11111111-1111-4111-8111-111111111111";val evidence="22222222-2222-4222-8222-222222222222"
  val message=PhotoChunkPlan.proofMessage("mercury-local","a".repeat(64),event,evidence,"b".repeat(64),1048577,1,"c".repeat(64),1)
  assertEquals(listOf("mercury-evidence-chunk-v1","mercury-local","a".repeat(64),event,evidence,"b".repeat(64),"1048577","1","c".repeat(64),"1").joinToString("\n"),message)
  assertThrows(IllegalArgumentException::class.java){PhotoChunkPlan.proofMessage("mercury-local\nextra","a".repeat(64),event,evidence,"b".repeat(64),1048577,1,"c".repeat(64),1)}
  assertThrows(IllegalArgumentException::class.java){PhotoChunkPlan.proofMessage("mercury-local","A".repeat(64),event,evidence,"b".repeat(64),1048577,1,"c".repeat(64),1)}
  assertThrows(IllegalArgumentException::class.java){PhotoChunkPlan.proofMessage("mercury-local","a".repeat(64),event,evidence,"b".repeat(64),1048577,0,"c".repeat(64),1)}
 }
}
