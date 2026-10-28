package ca.mercury.guard

import org.json.JSONObject

/** Local attribution only. This metadata is never added to the signed event or its wire proof. */
internal object ConnectedEventOwnership {
 fun account(owner:ConnectedDispatchOwner)=EscalationScope(owner.configuration,owner.deviceId,owner.scope.binding.deviceThumbprint,owner.subject,owner.scope.binding.guardId,owner.scope.vendorId)
 fun binding(value:JSONObject):GrantBinding {
  require(value.keys().asSequence().toSet()==setOf("guard_id","site_id","assignment_id","device_thumbprint","revocation_version"))
  fun text(key:String)=value.get(key) as? String?:error("Original event binding required")
  val revision=value.get("revocation_version");require(revision is Int||revision is Long)
  return GrantBinding(text("guard_id"),text("site_id"),text("assignment_id"),text("device_thumbprint"),(revision as Number).toLong())
 }
 fun owner(record:JSONObject):ConnectedDispatchOwner? {
  val binding=binding(record.getJSONObject("scope"));val kind=record.getJSONObject("event").getString("kind")
  val key=when(kind){"incident"->"incident_owner";"dispatch_ack"->"dispatch_owner";"photo_evidence"->"photo_owner";"check_in","check_in_miss_reason"->"check_in_owner";"patrol_checkpoint"->if(record.has("patrol_owner"))"patrol_owner" else if(record.has("location_owner")&&record.getJSONObject("event").getJSONObject("data").has("location"))"location_owner" else "patrol_owner";"location"->"location_owner";else->return null}
  if(!record.has(key))return null // Never infer a connected owner from a legacy capture grant or Guard ID.
  val result=when(key){
   "incident_owner"->{val o=ConnectedIncidentHistory.owner(record.getJSONObject(key));require(ConnectedIncidentHistory.matches(o,binding));ConnectedDispatchOwner(o.configuration,o.deviceId,o.subject,DispatchScope(binding,o.vendorId))}
   "location_owner"->{val o=LocationConsentScope.parse(record.getJSONObject(key));require(o.binding==binding);ConnectedDispatchOwner(o.account.configuration,o.account.deviceId,o.account.subject,DispatchScope(binding,o.account.vendorId)).also{require(account(it)==o.account)}}
   else->ConnectedAttentionOwner.parse(record.getJSONObject(key))
  }
  require(result.scope.binding==binding){"Original event binding and owner differ"}
  // A GPS checkpoint has both owners. They must attest to the same original account and binding.
  if(kind=="patrol_checkpoint"&&record.getJSONObject("event").getJSONObject("data").has("location")){
   val location=LocationConsentScope.parse(record.getJSONObject("location_owner"));require(location.binding==binding&&location.account==account(result))
  }
  return result
 }
 fun belongs(record:JSONObject,expected:EscalationScope):Boolean=try{owner(record)?.let{account(it)==expected}?:false}catch(_:Exception){false}
}

/** Every sensitive write rechecks current authority after the immutable-record and local withdrawal reads. */
internal class ConnectedUploadFence(private val current:()->Unit,private val original:()->Unit,private val reducing:()->Unit={}):()->Unit {
 override fun invoke(){current();original();reducing();current()}
}
