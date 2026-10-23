package ca.mercury.guard

import android.content.Context
import android.net.Network
import android.os.SystemClock

internal object EscalationForeground {
 private val lock=Any();private val requests=mutableSetOf<UploadCancellation>()
 fun add(cancellation:UploadCancellation)=synchronized(lock){requests.add(cancellation)}
 fun remove(cancellation:UploadCancellation)=synchronized(lock){requests.remove(cancellation)}
 fun cancel(){val active=synchronized(lock){requests.toList().also{requests.clear()}};active.forEach{it.cancel()}}
}
internal class EscalationDelivery(private val context:Context,private val config:GuardServiceConfig,private val authority:UploadAuthority,
 network:Network?,private val cancellation:UploadCancellation,private val db:EscalationStore=EscalationStore(context)):
 java.io.Closeable {
 val scope=EscalationScope(config.uploadBinding(),config.deviceId,authority.thumbprint,authority.subject,authority.guardId,authority.vendorId)
 private val store=UploadAuthorityStore(context)
 private val identity=DeviceIdentity(context)
 private val client=GuardAccountClient(config.endpoint,network,cancellation)
 private fun permitted()=try{!cancellation.cancelled()&&store.current(authority,config)&&identity.publicIdentity()?.thumbprint==authority.thumbprint}catch(_:Exception){false}
 private fun check(){cancellation.check();check(permitted()){ "Escalation authority ended" }}
 private fun session():GuardAccountClient.Session {check();return authority.session()}
 private fun stop(){store.clear(authority.generation);cancellation.cancel()}
 private fun verify(){
  val s=session();val p=client.profile(s)
  if(p.getString("guard_id")!=authority.guardId||p.getString("vendor_id")!=authority.vendorId||p.getString("auth_subject")!=authority.subject)throw GuardAccountClient.HttpFailure(401)
  check();client.assignments(s,config.deviceId,identity,config.audience);check()
 }
 /** A saved receipt can be recovered after assignment cancellation by status, without editing its intent. */
 private fun deliver(lease:EscalationLease):Boolean {
  var settled=false
  try{
   val r=lease.record
   val snapshot=try{client.escalationStatus(session(),config.deviceId,identity,config.audience,r.id)}catch(e:GuardAccountClient.HttpFailure){if(e.statusCode!=404||r.receipt!=null)throw e;null}
   if(snapshot!=null){db.accepted(lease,snapshot,true);settled=true;return false}
   val receipt=client.createEscalation(session(),config.deviceId,identity,config.audience,r.raw)
   db.accepted(lease,receipt,false);settled=true;return false
  }catch(e:GuardAccountClient.HttpFailure){
   when(UploadPolicy.failure(e.statusCode)){
    UploadPolicy.Failure.REAUTHENTICATE->{stop();return false}
    UploadPolicy.Failure.RETRY->return permitted()
    UploadPolicy.Failure.REVIEW->{
     // A generic denial does not establish permanent rejection or erase a receipt.
     try{verify()}catch(auth:GuardAccountClient.HttpFailure){if(auth.statusCode==401||auth.statusCode==403)stop();return permitted()}
     check();db.release(lease,authority.generation,e.statusCode);settled=true;return false
    }
   }
  }catch(_:java.io.IOException){return permitted()}
  catch(_:Exception){
   if(permitted()){try{db.release(lease,authority.generation,0);settled=true}catch(_:Exception){}}
   return false
  }finally{if(!settled)try{db.release(lease)}catch(_:Exception){}}
 }
 fun one(id:String):EscalationRecord? {
  check();try{verify()}catch(e:GuardAccountClient.HttpFailure){if(e.statusCode==401||e.statusCode==403)stop();throw e}
  val lease=db.claim(scope,authority.generation,id)
  if(lease!=null)deliver(lease)
  return db.get(id,scope)
 }
 fun run():Boolean {
  val started=SystemClock.elapsedRealtime()
  try{
   if(!permitted())return false
   if(!db.awaiting(scope,authority.generation))return false
   verify()
   repeat(10){
    if(!permitted())return false
    if(SystemClock.elapsedRealtime()-started>=20000)return true
    val lease=db.claim(scope,authority.generation)?:return db.awaiting(scope,authority.generation)
    if(deliver(lease))return permitted()
   }
   return permitted()&&db.awaiting(scope,authority.generation)
  }catch(e:GuardAccountClient.HttpFailure){if(e.statusCode==401||e.statusCode==403){stop();return false};return permitted()}
  catch(_:Exception){return permitted()}
 }
 override fun close(){db.close()}
}
