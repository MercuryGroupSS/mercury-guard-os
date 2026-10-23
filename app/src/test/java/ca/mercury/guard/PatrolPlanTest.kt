package ca.mercury.guard

import org.junit.Assert.*
import org.junit.Test

class PatrolPlanTest {
 private val points=listOf(PatrolCheckpoint("entrance","Entrance"),PatrolCheckpoint("perimeter","Perimeter"))
 private val rounds=listOf(PatrolRound("opening","Opening patrol"),PatrolRound("closing","Closing patrol"))
 private fun reject(action:()->Unit){try{action();fail("Invalid patrol choice accepted")}catch(_:IllegalArgumentException){}catch(_:IllegalStateException){}}
 @Test fun declaredRoundsAndCheckpointsCanBeSelectedInAnyOrder(){
  val plan=PatrolPlan("route",3,points,rounds)
  val closingPerimeter=plan.choice("perimeter","closing");val openingEntrance=plan.choice("entrance","opening")
  assertEquals(PatrolChoice("route",3,"perimeter","closing"),closingPerimeter)
  assertEquals(PatrolChoice("route",3,"entrance","opening"),openingEntrance)
  assertEquals("opening",plan.choice("perimeter","opening").roundId)
  reject{plan.choice("entrance")};reject{plan.choice("entrance","invented")};reject{plan.choice("unassigned","opening")}
 }
 @Test fun legacyRouteKeepsOnePassAndCannotInventRound(){
  val plan=PatrolPlan("legacy",1,points)
  assertNull(plan.rounds);assertNull(plan.round(null));assertNull(plan.choice("perimeter").roundId)
  reject{plan.choice("entrance","")};reject{plan.choice("entrance","opening")}
 }
 @Test fun snapshotsCopyRoundAndCheckpointLists(){
  val mutablePoints=points.toMutableList();val mutableRounds=rounds.toMutableList();val plan=PatrolPlan("route",1,mutablePoints,mutableRounds)
  mutablePoints.clear();mutableRounds[0]=PatrolRound("changed","Changed");assertEquals(2,plan.checkpoints.size);assertEquals("opening",plan.rounds!![0].id)
 }
 @Test fun roundsMustBeExplicitBoundedAndUnambiguous(){
  for(values in listOf(emptyList(),listOf(PatrolRound("same","A"),PatrolRound("same","B")),listOf(PatrolRound("a","Same"),PatrolRound("b"," same ")),listOf(PatrolRound("a"," ")),listOf(PatrolRound("invalid/id","A")),(1..101).map{PatrolRound("round-$it","Round $it")}))reject{PatrolPlan("route",1,points,values)}
  val plan=PatrolPlan("route",1,points,listOf(PatrolRound("round"," Trimmed label ")));assertEquals("Trimmed label",plan.rounds!![0].label)
 }
 @Test fun invalidRouteRevisionOrCheckpointCannotBeSelected(){
  reject{PatrolPlan("route",0,points,rounds)};reject{PatrolPlan("route",9007199254740992L,points,rounds)}
  reject{PatrolPlan("route",1,emptyList(),rounds)};reject{PatrolPlan("route",1,listOf(points[0],points[0]),rounds)}
  reject{PatrolPlan("route",1,listOf(PatrolCheckpoint("a"," ")),rounds)}
 }
}
