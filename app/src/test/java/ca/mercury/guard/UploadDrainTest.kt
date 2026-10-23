package ca.mercury.guard

import org.junit.Assert.*
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

class UploadDrainTest {
 private class Port:UploadDrainPort<String,String>{
  val batches=mutableListOf<String>();val photos=mutableListOf<String>();val delivered=mutableListOf<String>();val retained=mutableListOf<String>();val attempts=mutableListOf<String>()
  var allowed=true;var stopped=false;var verifications=0;var verifyFailure:Int?=null
  var send:(String)->Unit={};var verifyAction:()->Unit={}
  override fun permitted()=allowed
  override fun verify(){verifications++;verifyAction();verifyFailure?.let{throw UploadRequestFailure(it)}}
  override fun nextBatch()=batches.firstOrNull()
  override fun sendBatch(batch:String){attempts.add(batch);send(batch);batches.remove(batch);delivered.add(batch)}
  override fun reviewBatch(batch:String,status:Int){batches.remove(batch);retained.add("$batch:$status")}
  override fun nextPhoto()=photos.firstOrNull()
  override fun sendPhoto(photo:String){attempts.add(photo);send(photo);photos.remove(photo);delivered.add(photo)}
  override fun reviewPhoto(photo:String,status:Int){photos.remove(photo);retained.add("$photo:$status")}
  override fun stopAuthority(){stopped=true;allowed=false}
 }
 @Test fun drainsAllBatchesAndPhotosAcrossBoundedScheduledRuns(){
  val p=Port();p.batches.addAll((1..101).map{"batch-$it"});p.photos.addAll((1..9).map{"photo-$it"})
  var runs=0
  while(UploadDrain(p){0}.run()){runs++;assertTrue(runs<10)}
  assertEquals(110,p.delivered.size);assertTrue(runs>1);assertTrue(p.batches.isEmpty());assertTrue(p.photos.isEmpty())
 }
 @Test fun transientFailureRetriesOriginalIdentityAndDoesNotQuarantine(){
  val p=Port();p.batches.add("same-signed-request");var attempts=0
  p.send={if(attempts++==0)throw UploadRequestFailure(503)}
  assertTrue(UploadDrain(p){0}.run());assertTrue(p.retained.isEmpty());assertFalse(p.stopped)
  assertFalse(UploadDrain(p){0}.run());assertEquals(listOf("same-signed-request","same-signed-request"),p.attempts)
 }
 @Test fun genericScopeDenialRetainsOriginalAndOtherScopesProgressAfterReverification(){
  for(status in listOf(400,403,404,409)){
   val p=Port();p.batches.addAll(listOf("old-scope","current-scope"));p.send={if(it=="old-scope")throw UploadRequestFailure(status)}
   assertFalse(UploadDrain(p){0}.run());assertEquals(listOf("old-scope:$status"),p.retained)
   assertEquals(listOf("current-scope"),p.delivered);assertEquals(2,p.verifications);assertFalse(p.stopped)
  }
 }
 @Test fun revokedAccountStopsRetriesAndDoesNotReviewAsAPermanentRecordFailure(){
  val p=Port();p.batches.addAll(listOf("old","new"));p.send={throw UploadRequestFailure(403)}
  p.verifyAction={if(p.verifications==2)throw UploadRequestFailure(401)}
  assertFalse(UploadDrain(p){0}.run());assertTrue(p.stopped);assertTrue(p.retained.isEmpty());assertEquals(2,p.batches.size)
 }
 @Test fun preflightRevocationDoesNotSendAnyRecord(){
  for(status in listOf(401,403)){
   val p=Port();p.batches.add("original");p.verifyFailure=status
   assertFalse(UploadDrain(p){0}.run());assertTrue(p.stopped);assertTrue(p.attempts.isEmpty());assertEquals(listOf("original"),p.batches)
  }
 }
 @Test fun expiryOrGuardSwitchBetweenRequestsStopsWorkWithoutRetry(){
  val p=Port();p.batches.addAll(listOf("original-guard-1","original-guard-2"));p.photos.add("original-photo")
  p.send={p.allowed=false}
  assertFalse(UploadDrain(p){0}.run());assertEquals(listOf("original-guard-1"),p.delivered);assertEquals(listOf("original-photo"),p.photos)
 }
 @Test fun cancellationDuringTransportFailureDoesNotReschedule(){
  val p=Port();p.batches.add("original");p.send={p.allowed=false;throw java.io.IOException("Stopped")}
  assertFalse(UploadDrain(p){0}.run());assertEquals(listOf("original"),p.batches);assertTrue(p.retained.isEmpty())
 }
 @Test fun operationAndTimeBoundsAreHonored(){
  val p=Port();p.batches.addAll(listOf("a","b"));p.photos.add("photo")
  assertTrue(UploadDrain(p){0}.run(maxOperations=1));assertEquals(listOf("a"),p.delivered)
  var now=0L;p.send={now=90001};assertTrue(UploadDrain(p){now}.run());assertEquals(listOf("a","b"),p.delivered)
 }
 @Test fun unreadablePhotoRemainsForReviewAndDoesNotBlockLaterPhotos(){
  val p=Port();p.photos.addAll(listOf("missing","good"));p.send={if(it=="missing")throw UploadEvidenceUnavailable()}
  assertFalse(UploadDrain(p){0}.run());assertEquals(listOf("missing:0"),p.retained);assertEquals(listOf("good"),p.delivered)
 }
 @Test fun expiryIsMonotonicAndCannotSurviveRestartOrTimeReversal(){
  assertTrue(UploadPolicy.valid(100,1000,2,999,2))
  for(pair in listOf(1000L to 2,99L to 2,200L to 3,200L to -1))assertFalse(UploadPolicy.valid(100,1000,2,pair.first,pair.second))
  assertFalse(UploadPolicy.valid(0,86400001,2,1,2))
 }
 @Test fun cancellationDisconnectsCurrentRequestAndRefusesTheNext(){
  var disconnected=false
  val c=object:HttpURLConnection(URL("https://example.test")){override fun connect(){};override fun usingProxy()=false;override fun disconnect(){disconnected=true}}
  val token=UploadCancellation();token.attach(c);token.cancel();assertTrue(disconnected);assertTrue(token.cancelled())
  try{token.attach(c);fail("Cancelled request resumed")}catch(_:IllegalStateException){}
 }
}
