package ca.mercury.guard

import org.json.JSONObject

/** Optional owner-approved presentation preset. It grants no capture or attendance authority. */
data class CheckInAttentionPolicy private constructor(val profile:String) {
 companion object {
  const val PROFILE="calm_progressive_v1"
  fun parse(value:JSONObject):CheckInAttentionPolicy {
   require(value.keys().asSequence().toSet()==setOf("version","profile"))
   val version=value.get("version");require((version is Int||version is Long)&&(version as Number).toLong()==1L)
   require(value.get("profile") is String&&value.getString("profile")==PROFILE)
   return CheckInAttentionPolicy(PROFILE)
  }
 }
 fun json()=JSONObject().put("version",1).put("profile",profile)
}

/** Logical cue attempts, never a promise of Android alarm delivery or evidence of a missed check. */
object CheckInAttentionTiming {
 const val CUE_INTERVAL_MS=30000L
 const val MAX_ATTEMPTS=20
 const val BUDGET_MS=600000L
 const val PULSE_MS=4000L
 enum class Stage { WAITING,GREEN,YELLOW,RED,COMPLETE,CLOSED,ENDED }
 data class Decision(val slot:Long,val dueAt:Long?,val deadlineAt:Long?,val stage:Stage,
  val cueIndex:Int?,val notify:Boolean,val nextAt:Long?,val pulse:Boolean,val silenced:Boolean,val budgetExhausted:Boolean)
 fun evaluate(start:Long,end:Long,interval:Long,window:Long,now:Long,lastAttempt:Int=-1,silenced:Boolean=false,completed:Boolean=false):Decision {
  require(start>0&&end>start&&interval>0&&window in 1..interval&&lastAttempt in -1 until MAX_ATTEMPTS)
  if(now>=end)return Decision(-1,null,null,Stage.ENDED,null,false,null,false,silenced,false)
  if(now<start)return Decision(-1,start,null,Stage.WAITING,null,false,start,false,false,false)
  val slot=(now-start)/interval;val due=Math.addExact(start,Math.multiplyExact(slot,interval))
  val deadline=minOf(Math.addExact(due,window),end);val nextSlot=minOf(Math.addExact(due,interval),end)
  if(now>=deadline)return Decision(slot,due,deadline,Stage.CLOSED,null,false,nextSlot,false,silenced,now-due>=BUDGET_MS)
  if(completed)return Decision(slot,due,deadline,Stage.COMPLETE,null,false,nextSlot,false,silenced,false)
  val age=now-due;val stage=when{age<120000->Stage.GREEN;age<300000->Stage.YELLOW;else->Stage.RED}
  val attentionEnd=minOf(Math.addExact(due,BUDGET_MS),deadline)
  if(silenced)return Decision(slot,due,deadline,stage,null,false,nextSlot,false,true,now>=attentionEnd)
  if(now>=attentionEnd)return Decision(slot,due,deadline,stage,null,false,deadline,false,false,true)
  val index=(age/CUE_INTERVAL_MS).toInt();check(index in 0 until MAX_ATTEMPTS)
  val next=minOf(Math.addExact(due,Math.multiplyExact(index+1L,CUE_INTERVAL_MS)),attentionEnd)
  // A delayed callback attempts only its current bucket. Older buckets are never replayed.
  return Decision(slot,due,deadline,stage,index,index>lastAttempt,next,true,false,false)
 }
}
