package ca.mercury.guard

import org.junit.Assert.*
import org.junit.Test
import ca.mercury.guard.CheckInAttentionTiming.Stage

/** Pure decisions only: no Android alarm, notification delivery or evidence is simulated. */
class CheckInAttentionTimingTest {
 private val start=1000L
 private val interval=1800000L
 private val end=start+7200000L
 private val window=1200000L
 private fun at(age:Long,last:Int=-1,silenced:Boolean=false,completed:Boolean=false,window:Long=this.window,end:Long=this.end)=
  CheckInAttentionTiming.evaluate(start,end,interval,window,start+age,last,silenced,completed)

 @Test fun greenYellowAndRedUseHalfOpenAgeBoundaries(){
  assertEquals(Stage.GREEN,at(0).stage)
  assertEquals(Stage.GREEN,at(119999).stage)
  assertEquals(Stage.YELLOW,at(120000).stage)
  assertEquals(Stage.YELLOW,at(299999).stage)
  assertEquals(Stage.RED,at(300000).stage)
  assertEquals(Stage.RED,at(599999).stage)
  assertTrue(at(599999).pulse)
 }

 @Test fun allTwentyBucketsMayBeAttemptedOnceAndThereIsNoTwentyFirstCue(){
  var last=-1
  var attempts=0
  for(index in 0 until 20){
   val age=index*30000L
   val current=at(age,last)
   assertEquals(index,current.cueIndex)
   assertTrue(current.notify)
   assertEquals(start,current.dueAt)
   assertEquals(start+age+30000,current.nextAt)
   last=current.cueIndex!!;attempts++
   val repeated=at(age+1,last)
   assertFalse(repeated.notify)
   assertEquals(index,repeated.cueIndex)
  }
  assertEquals(20,attempts)
  val exhausted=at(600000,last)
  assertEquals(CheckInAttentionTiming.Stage.RED,exhausted.stage)
  assertFalse(exhausted.notify);assertNull(exhausted.cueIndex)
  assertTrue(exhausted.budgetExhausted);assertFalse(exhausted.pulse)
  assertEquals(start+window,exhausted.nextAt)
 }

 @Test fun delayedCallbacksSkipOldBucketsRatherThanReplayingMissedCues(){
  val delayed=at(163000,last=0)
  assertEquals(5,delayed.cueIndex);assertTrue(delayed.notify)
  assertEquals(start+180000,delayed.nextAt)
  val same=at(179999,last=5)
  assertEquals(5,same.cueIndex);assertFalse(same.notify)
  val later=at(195000,last=5)
  assertEquals(6,later.cueIndex);assertTrue(later.notify)
  // A saved high-watermark also prevents a backwards time observation replaying a cue.
  assertFalse(at(195000,last=10).notify)
 }

 @Test fun shortResponseWindowsClipCuesAndNeverReachLaterStages(){
  val short=90000L
  for(age in listOf(0L,30000L,60000L,89999L)){
   val current=at(age,window=short)
   assertEquals(CheckInAttentionTiming.Stage.GREEN,current.stage)
   assertTrue(current.nextAt!!<=start+short)
  }
  val closed=at(short,window=short)
  assertEquals(CheckInAttentionTiming.Stage.CLOSED,closed.stage)
  assertFalse(closed.notify);assertFalse(closed.pulse);assertNull(closed.cueIndex)
  assertEquals(start+interval,closed.nextAt)
  val medium=240000L
  assertEquals(CheckInAttentionTiming.Stage.YELLOW,at(medium-1,window=medium).stage)
  assertEquals(7,at(medium-1,window=medium).cueIndex)
  assertEquals(CheckInAttentionTiming.Stage.CLOSED,at(medium,window=medium).stage)
 }

 @Test fun assignmentEndClipsTheWindowAndStopsEveryFutureCue(){
  val actualEnd=start+45000L
  val open=at(44999,end=actualEnd)
  assertEquals(actualEnd,open.deadlineAt)
  assertEquals(actualEnd,open.nextAt)
  assertEquals(1,open.cueIndex);assertTrue(open.notify)
  for(age in listOf(45000L,60000L,600000L,1800000L)){
   val ended=at(age,end=actualEnd)
   assertEquals(CheckInAttentionTiming.Stage.ENDED,ended.stage)
   assertFalse(ended.notify);assertFalse(ended.pulse)
   assertNull(ended.nextAt);assertNull(ended.cueIndex)
  }
 }

 @Test fun tenMinuteCueBudgetDoesNotCloseALongerApprovedResponseWindow(){
  for(age in listOf(600000L,900000L,window-1)){
   val quiet=at(age,last=19)
   assertEquals(CheckInAttentionTiming.Stage.RED,quiet.stage)
   assertEquals(start+window,quiet.deadlineAt)
   assertEquals(start+window,quiet.nextAt)
   assertTrue(quiet.budgetExhausted);assertFalse(quiet.notify)
  }
  val deadline=at(window,last=19)
  assertEquals(CheckInAttentionTiming.Stage.CLOSED,deadline.stage)
  assertEquals(start+window,deadline.deadlineAt)
  assertFalse(deadline.notify)
 }

 @Test fun silenceStopsAttentionWithoutCompletingTheCheckInOrChangingItsDeadline(){
  val quiet=at(350000,last=10,silenced=true)
  assertEquals(CheckInAttentionTiming.Stage.RED,quiet.stage)
  assertTrue(quiet.silenced);assertFalse(quiet.notify);assertFalse(quiet.pulse)
  assertNull(quiet.cueIndex);assertEquals(start+window,quiet.deadlineAt)
  assertEquals(start+interval,quiet.nextAt)
  assertEquals(CheckInAttentionTiming.Stage.CLOSED,at(window,silenced=true).stage)
  val complete=at(350000,last=10,completed=true)
  assertEquals(CheckInAttentionTiming.Stage.COMPLETE,complete.stage)
  assertFalse(complete.notify);assertFalse(complete.pulse)
  assertEquals(start+window,complete.deadlineAt)
  assertEquals(start+interval,complete.nextAt)
 }

 @Test fun futureStartAndNewSlotsUseTheirOwnUnattemptedState(){
  val waiting=at(-1,last=19,silenced=true,completed=true)
  assertEquals(CheckInAttentionTiming.Stage.WAITING,waiting.stage)
  assertEquals(start,waiting.nextAt);assertFalse(waiting.notify)
  assertFalse(waiting.silenced);assertNull(waiting.cueIndex)
  // The caller reads a distinct original-owner/policy/slot state for this next window.
  val next=at(interval,last=-1,silenced=false,completed=false)
  assertEquals(1L,next.slot);assertEquals(start+interval,next.dueAt)
  assertEquals(0,next.cueIndex);assertTrue(next.notify)
  assertEquals(CheckInAttentionTiming.Stage.GREEN,next.stage)
  assertEquals(start+interval+30000,next.nextAt)
 }

 @Test fun invalidSchedulesAndAttemptIndicesFailClosed(){
  for(last in listOf(-2,20,Int.MAX_VALUE))assertThrows(IllegalArgumentException::class.java){at(0,last=last)}
  for(badWindow in listOf(0L,interval+1))assertThrows(IllegalArgumentException::class.java){at(0,window=badWindow)}
  assertThrows(IllegalArgumentException::class.java){CheckInAttentionTiming.evaluate(0,end,interval,window,start)}
  assertThrows(IllegalArgumentException::class.java){CheckInAttentionTiming.evaluate(start,start,interval,window,start)}
  assertThrows(IllegalArgumentException::class.java){CheckInAttentionTiming.evaluate(start,end,0,window,start)}
 }
}
