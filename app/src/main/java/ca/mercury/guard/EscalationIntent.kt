package ca.mercury.guard

import java.util.UUID

data class EscalationLocation(val atMillis:Long,val latitude:Double,val longitude:Double,val accuracy:Double)
data class EscalationIntent(val id:String,val guardId:String,val vendorId:String,val assignmentId:String?,val occurredAt:Long,val urgency:String,val description:String,val location:EscalationLocation?){
 init{
  require(EscalationRules.uuid(id)&&PatrolPlan.identifier(guardId)&&PatrolPlan.identifier(vendorId)&&(assignmentId==null||PatrolPlan.identifier(assignmentId)))
  require(occurredAt in 1..9007199254740991L&&urgency in setOf("urgent","assistance")&&EscalationRules.description(description))
  require(location==null||EscalationRules.validLocation(location,occurredAt))
 }
}
object EscalationRules {
 fun uuid(value:String)=try{UUID.fromString(value).toString()==value}catch(_:Exception){false}
 fun description(value:String):Boolean {
  if(value.trim{it.isWhitespace()||it=='\uFEFF'}.isEmpty()||value.codePointCount(0,value.length)>2000)return false
  var index=0
  while(index<value.length){
   val ch=value[index]
   if(ch in '\u0000'..'\u0008'||ch in '\u000B'..'\u000C'||ch in '\u000E'..'\u001F'||ch=='\u007F')return false
   if(Character.isHighSurrogate(ch)){if(index+1>=value.length||!Character.isLowSurrogate(value[index+1]))return false;index++}
   else if(Character.isLowSurrogate(ch))return false
   index++
  }
  return true
 }
 fun validLocation(value:EscalationLocation,at:Long)=value.atMillis in 1..at&&at-value.atMillis<=300000&&value.latitude.isFinite()&&value.latitude in -90.0..90.0&&value.longitude.isFinite()&&value.longitude in -180.0..180.0&&value.accuracy.isFinite()&&value.accuracy>0&&value.accuracy<=1000
 fun optionalLocation(value:EscalationLocation?,at:Long):EscalationLocation?=value?.takeIf{validLocation(it,at)}
}
