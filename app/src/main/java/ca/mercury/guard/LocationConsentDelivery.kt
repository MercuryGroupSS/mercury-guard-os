package ca.mercury.guard

import android.content.Context
import android.net.Network
import android.os.SystemClock

/** Only self-reducing withdrawals retry automatically. Consent never starts a collector in the background. */
internal class LocationConsentDelivery(private val context:Context,private val config:GuardServiceConfig,private val authority:UploadAuthority,network:Network?,private val cancellation:UploadCancellation):java.io.Closeable {
 private val store=LocationConsentStore(context)
 private val identity=DeviceIdentity(context)
 private val client=GuardAccountClient(config.endpoint,network,cancellation)
 private val account=EscalationScope(config.uploadBinding(),config.deviceId,authority.thumbprint,authority.subject,authority.guardId,authority.vendorId)
 private fun permitted()=!cancellation.cancelled()&&UploadAuthorityStore(context).current(authority,config)&&identity.publicIdentity()?.thumbprint==authority.thumbprint
 fun one(record:LocationConsentRecord,action:String){
  check(record.scope.account==account&&permitted());cancellation.check()
  val result=client.locationConsent(authority.session(),config.deviceId,identity,config.audience,record.intent(action))
  store.accept(record.id,record.scope,action,result)
 }
 fun run():Boolean {
  val started=SystemClock.elapsedRealtime();var count=0
  for(record in store.list(account).filter{it.withdrawn&&it.withdrawalReceipt==null&&it.reviewGeneration!=authority.generation}.reversed()){
   if(!permitted())return false
   if(count++>=10||SystemClock.elapsedRealtime()-started>=20000)return true
   try{one(record,"withdraw")}catch(e:GuardAccountClient.HttpFailure){
    when(UploadPolicy.failure(e.statusCode)){
     UploadPolicy.Failure.REAUTHENTICATE->{UploadAuthorityStore(context).clear(authority.generation);cancellation.cancel();return false}
     UploadPolicy.Failure.RETRY->return permitted()
     UploadPolicy.Failure.REVIEW->store.review(record.id,record.scope,authority.generation)
    }
   }catch(_:Exception){return permitted()}
  }
  return false
 }
 override fun close(){store.close()}
}
