package ca.mercury.guard

import org.json.JSONObject

/** Parsed only from the authenticated service response, never a local route editor or Intent. */
object AuthorizedPatrolRoute {
 private fun text(j:JSONObject,key:String)=j.get(key) as? String?:error("Patrol text required")
 fun parse(j:JSONObject):PatrolPlan {
  require(j.keys().asSequence().toSet()==setOf("routeId","revision","checkpoints")+(if(j.has("rounds"))setOf("rounds") else emptySet()))
  val revision=j.get("revision");require(revision is Int||revision is Long)
  val rawPoints=j.getJSONArray("checkpoints");require(rawPoints.length() in 1..100)
  val points=(0 until rawPoints.length()).map{index->val p=rawPoints.getJSONObject(index);require(p.keys().asSequence().toSet()==setOf("id","label"));PatrolCheckpoint(text(p,"id"),text(p,"label"))}
  val rounds=if(j.has("rounds")){
   val values=j.getJSONArray("rounds");require(values.length() in 1..100)
   (0 until values.length()).map{index->val r=values.getJSONObject(index);require(r.keys().asSequence().toSet()==setOf("id","label"));PatrolRound(text(r,"id"),text(r,"label"))}
  }else null
  return PatrolPlan(text(j,"routeId"),(revision as Number).toLong(),points,rounds)
 }
}
