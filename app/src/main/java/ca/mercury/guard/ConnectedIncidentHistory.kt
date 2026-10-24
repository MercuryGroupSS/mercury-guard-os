package ca.mercury.guard

import org.json.JSONObject

/** Receipt states concern this service only. No dashboard, payroll or operator acknowledgement. */
internal enum class ConnectedIncidentReceiptState(val label:String) {
 SAVED_LOCALLY("Saved on this phone · service receipt pending"),
 SERVICE_ACCEPTED("Service accepted this record · dashboard delivery not confirmed"),
 RETAINED_FOR_REVIEW("Delivery attempt retained for review · no service receipt confirmed"),
 RECEIPT_UNAVAILABLE("Record retained · service receipt details unavailable")
}

/** A bounded read-only projection. The encrypted event and its original owner remain immutable. */
internal class ConnectedIncidentRecord(val sequence:Long,val eventId:String,val observedAt:Long,
 val description:String,val guardId:String,val siteId:String,val assignmentId:String,
 val captureGrantId:String,val receiptState:ConnectedIncidentReceiptState,val receiptBatchId:String?) {
 override fun toString()="ConnectedIncidentRecord(redacted)"
}
internal class ConnectedIncidentPage(val items:List<ConnectedIncidentRecord>,val nextBeforeSequence:Long?) {
 override fun toString()="ConnectedIncidentPage(redacted)"
}

internal object ConnectedIncidentHistory {
 const val MAX_PAGE=50
 const val DEFAULT_PAGE=25
 private const val MAX_SAFE=9007199254740991L
 fun description(value:String):String {
  require(value.isNotBlank()&&value.length<=ConnectedIncidentDraftStore.MAX_LENGTH&&String(value.toByteArray(Charsets.UTF_8),Charsets.UTF_8)==value){"Invalid incident description"}
  return value
 }
 fun owner(value:JSONObject):ConnectedIncidentDraftScope {
  require(value.keys().asSequence().toSet()==setOf("configuration","device_id","thumbprint","subject","guard_id","vendor_id","site_id","assignment_id"))
  fun text(key:String)=value.get(key) as? String?:error("Original incident owner required")
  return ConnectedIncidentDraftScope(text("configuration"),text("device_id"),text("thumbprint"),text("subject"),text("guard_id"),text("vendor_id"),text("site_id"),text("assignment_id"))
 }
 fun matches(owner:ConnectedIncidentDraftScope,binding:GrantBinding)=owner.guardId==binding.guardId&&owner.siteId==binding.siteId&&owner.assignmentId==binding.assignmentId&&owner.thumbprint==binding.deviceThumbprint
 private fun integer(value:JSONObject,key:String):Long {
  val item=value.get(key);require(item is Int||item is Long);return (item as Number).toLong()
 }
 fun project(record:JSONObject,expected:ConnectedIncidentDraftScope,sequence:Long,state:ConnectedIncidentReceiptState,batchId:String?):ConnectedIncidentRecord {
  require(sequence in 1..MAX_SAFE)
  require(record.keys().asSequence().toSet()==setOf("scope","event","incident_owner"))
  require(owner(record.getJSONObject("incident_owner"))==expected){"Original incident owner mismatch"}
  val scope=record.getJSONObject("scope")
  require(scope.keys().asSequence().toSet()==setOf("guard_id","site_id","assignment_id","device_thumbprint","revocation_version"))
  val binding=GrantBinding(scope.getString("guard_id"),scope.getString("site_id"),scope.getString("assignment_id"),scope.getString("device_thumbprint"),integer(scope,"revocation_version"))
  require(matches(expected,binding)&&binding.revocationVersion>0)
  val event=record.getJSONObject("event")
  require(event.keys().asSequence().toSet()==setOf("event_id","sequence","at","kind","data"))
  val id=event.get("event_id") as? String?:error("Original event required")
  require(EscalationRules.uuid(id)&&integer(event,"sequence")==sequence&&event.get("kind")=="incident")
  val at=integer(event,"at");require(at in 0..MAX_SAFE)
  val data=event.getJSONObject("data");require(data.keys().asSequence().toSet()==setOf("description","capture_grant_id"))
  val text=description(data.get("description") as? String?:error("Incident description required"))
  val grant=data.get("capture_grant_id") as? String?:error("Original grant required");require(PatrolPlan.identifier(grant))
  require((state==ConnectedIncidentReceiptState.SERVICE_ACCEPTED)==(batchId!=null))
  if(batchId!=null)require(EscalationRules.uuid(batchId))
  return ConnectedIncidentRecord(sequence,id,at,text,expected.guardId,expected.siteId,expected.assignmentId,grant,state,batchId)
 }
}
