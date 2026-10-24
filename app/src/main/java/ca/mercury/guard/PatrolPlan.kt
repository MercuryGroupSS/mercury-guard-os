package ca.mercury.guard

import java.util.Locale

data class PatrolCheckpoint(val id:String,val label:String)
data class PatrolRound(val id:String,val label:String)
data class PatrolChoice(val routeId:String,val revision:Long,val checkpointId:String,val roundId:String?)
data class PatrolCheckpointKey(val roundId:String?,val checkpointId:String)

/** Trusted assignment snapshot. A declared round must be selected explicitly; no local reset invents a round. */
class PatrolPlan(val routeId:String,val revision:Long,checkpoints:List<PatrolCheckpoint>,rounds:List<PatrolRound>?=null,val gpsRequired:Boolean=false){
 val checkpoints=checkpoints.toList()
 val rounds=rounds?.map{PatrolRound(it.id,it.label.trim())}
 companion object {
  internal fun identifier(value:String)=value.matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}"))
 }
 init{
  require(identifier(routeId)&&revision in 1..9007199254740991L)
  require(checkpoints.size in 1..100&&checkpoints.all{identifier(it.id)&&it.label.isNotBlank()&&it.label.length<=200}&&checkpoints.map{it.id}.toSet().size==checkpoints.size)
  if(rounds!=null){
   require(rounds.size in 1..100&&rounds.all{identifier(it.id)&&it.label.isNotBlank()&&it.label.length<=200})
   require(rounds.map{it.id}.toSet().size==rounds.size&&rounds.map{it.label.trim().lowercase(Locale.ROOT)}.toSet().size==rounds.size)
  }
 }
 fun round(id:String?):PatrolRound? {
  val declared=rounds
  if(declared==null){require(id==null){"This route has one legacy pass"};return null}
  require(id!=null){"Choose an authorized patrol round"}
  return declared.firstOrNull{it.id==id}?:error("Patrol round is not assigned")
 }
 fun choice(checkpointId:String,roundId:String?=null):PatrolChoice {
  require(checkpoints.any{it.id==checkpointId}){ "Checkpoint is not assigned" }
  round(roundId)
  return PatrolChoice(routeId,revision,checkpointId,roundId)
 }
}
