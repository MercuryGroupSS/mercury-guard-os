package ca.mercury.guard

import org.json.JSONObject
import java.security.MessageDigest
import java.util.Base64

object EscalationProtocol {
 const val MAX_INTENT_BYTES=11264
 private val fields=setOf("version","escalation_id","guard_id","vendor_id","assignment_id","occurred_at_ms","urgency","description","location")
 private val receiptFields=setOf("version","escalation_id","intent_sha256","status","received_at_ms")
 fun hash(raw:String)=MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
 fun encode(raw:String)=Base64.getUrlEncoder().withoutPadding().encodeToString(raw.toByteArray(Charsets.UTF_8))
 private fun text(j:JSONObject,key:String)=j.get(key) as? String?:error("Escalation text required")
 private fun integer(j:JSONObject,key:String):Long {val n=j.get(key);require(n is Int||n is Long);return (n as Number).toLong().also{require(it in 1..9007199254740991L)}}
 fun raw(intent:EscalationIntent):String {
  val location=intent.location?.let{JSONObject().put("at_ms",it.atMillis).put("latitude",it.latitude).put("longitude",it.longitude).put("accuracy_m",it.accuracy).put("mock",false)}
  val raw=JSONObject().put("version",1).put("escalation_id",intent.id).put("guard_id",intent.guardId).put("vendor_id",intent.vendorId)
   .put("assignment_id",intent.assignmentId?:JSONObject.NULL).put("occurred_at_ms",intent.occurredAt).put("urgency",intent.urgency).put("description",intent.description).put("location",location?:JSONObject.NULL).toString()
  require(raw.toByteArray(Charsets.UTF_8).size<=MAX_INTENT_BYTES);return raw
 }
 fun parse(raw:String):EscalationIntent {
  require(raw.toByteArray(Charsets.UTF_8).size<=MAX_INTENT_BYTES)
  val j=JSONObject(raw);require(j.keys().asSequence().toSet()==fields&&integer(j,"version")==1L)
  val location=if(j.isNull("location"))null else j.getJSONObject("location").let{l->
   require(l.keys().asSequence().toSet()==setOf("at_ms","latitude","longitude","accuracy_m","mock")&&l.get("mock")==false)
   for(k in listOf("latitude","longitude","accuracy_m"))require(l.get(k) is Number)
   EscalationLocation(integer(l,"at_ms"),l.getDouble("latitude"),l.getDouble("longitude"),l.getDouble("accuracy_m"))
  }
  return EscalationIntent(text(j,"escalation_id"),text(j,"guard_id"),text(j,"vendor_id"),if(j.isNull("assignment_id"))null else text(j,"assignment_id"),integer(j,"occurred_at_ms"),text(j,"urgency"),text(j,"description"),location)
 }
 fun receipt(value:JSONObject,id:String,hash:String):JSONObject {
  require(value.keys().asSequence().toSet()==receiptFields&&integer(value,"version")==1L)
  require(value.get("escalation_id")==id&&value.get("intent_sha256")==hash&&value.get("status")=="received_by_guard_service")
  integer(value,"received_at_ms");return JSONObject(value.toString())
 }
 fun status(value:JSONObject,id:String,hash:String,priorReceipt:JSONObject?=null):JSONObject {
  require(value.keys().asSequence().toSet()==receiptFields+"acknowledgement")
  val state=value.get("status");require(state in setOf("received_by_guard_service","operator_acknowledged"))
  val received=JSONObject(value.toString()).apply{remove("acknowledgement");put("status","received_by_guard_service")}
  receipt(received,id,hash)
  if(priorReceipt!=null)for(k in receiptFields)require(priorReceipt.get(k)==received.get(k))
  if(state=="received_by_guard_service")require(value.isNull("acknowledgement")) else{
   val ack=value.getJSONObject("acknowledgement");require(ack.keys().asSequence().toSet()==setOf("operator_subject","acknowledged_at_ms","note"))
   require(EscalationRules.uuid(text(ack,"operator_subject"))&&integer(ack,"acknowledged_at_ms")>=integer(value,"received_at_ms")&&EscalationRules.description(text(ack,"note")))
  }
  return JSONObject(value.toString())
 }
 fun statusPayload(id:String):String {require(EscalationRules.uuid(id));return JSONObject().put("escalation_id",id).toString()}
}
