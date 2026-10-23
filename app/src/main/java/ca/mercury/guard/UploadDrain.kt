package ca.mercury.guard

class UploadRequestFailure(val status:Int):Exception("Upload request unavailable")
class UploadEvidenceUnavailable:Exception("Local evidence unavailable")
interface UploadDrainPort<B,P>{
 fun permitted():Boolean
 fun verify()
 fun nextBatch():B?
 fun sendBatch(batch:B)
 fun reviewBatch(batch:B,status:Int)
 fun nextPhoto():P?
 fun sendPhoto(photo:P)
 fun reviewPhoto(photo:P,status:Int)
 fun stopAuthority()
}
/** Bounded work; stopped/expired authority never becomes a retry or permission to another guard. */
class UploadDrain<B,P>(private val port:UploadDrainPort<B,P>,private val elapsed:()->Long){
 fun run(maxOperations:Int=40,maxDuration:Long=90000):Boolean {
  require(maxOperations>0&&maxDuration>0)
  val started=elapsed();var operations=0
  try{
   if(!port.permitted())return false
   port.verify()
   while(port.permitted()){
    if(operations>=maxOperations||elapsed()-started>=maxDuration)return true
    val batch=port.nextBatch()
    if(batch!=null){
     if(!port.permitted())return false
     try{port.sendBatch(batch)}catch(e:UploadRequestFailure){
      when(UploadPolicy.failure(e.status)){
       UploadPolicy.Failure.REAUTHENTICATE->{port.stopAuthority();return false}
       UploadPolicy.Failure.RETRY->return port.permitted()
       UploadPolicy.Failure.REVIEW->{port.verify();if(!port.permitted())return false;port.reviewBatch(batch,e.status)}
      }
     }
     operations++
    }
    if(!port.permitted())return false
    if(operations>=maxOperations||elapsed()-started>=maxDuration)return true
    val photo=port.nextPhoto()
    if(photo!=null){
     if(!port.permitted())return false
     try{port.sendPhoto(photo)}catch(e:UploadEvidenceUnavailable){port.reviewPhoto(photo,0)}catch(e:UploadRequestFailure){
      when(UploadPolicy.failure(e.status)){
       UploadPolicy.Failure.REAUTHENTICATE->{port.stopAuthority();return false}
       UploadPolicy.Failure.RETRY->return port.permitted()
       UploadPolicy.Failure.REVIEW->{port.verify();if(!port.permitted())return false;port.reviewPhoto(photo,e.status)}
      }
     }
     operations++
    }
    if(batch==null&&photo==null)return false
   }
  }catch(e:UploadRequestFailure){if(e.status==401||e.status==403){port.stopAuthority();return false};return port.permitted()}
  catch(_:Exception){return port.permitted()}
  return false
 }
}
