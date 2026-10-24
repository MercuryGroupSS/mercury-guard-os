package ca.mercury.guard

import org.junit.Assert.*
import org.junit.Test

class PatrolPointTimingTest {
 private val epoch=1730000000000L
 private fun timing(request:Long=1000123456,fix:Long=1100000000,now:Long=1200000000,start:Long=epoch,end:Long=epoch+1000,age:Long=1000)=PatrolPointTiming.check(epoch,1000,request,fix,now,start,end,age)
 @Test fun onlyPostRequestSameBootFixMapsToOrderedTrustedEpochs(){
  val t=timing()!!;assertEquals(epoch,t.requested);assertEquals(epoch+100,t.fix);assertEquals(epoch+200,t.observed)
  assertNull(timing(fix=1000123455));assertNull(timing(now=1099999999));assertNull(timing(request=0))
 }
 @Test fun originalGrantAndPolicyBoundsAreHalfOpen(){
  assertNotNull(timing(end=epoch+201));assertNull(timing(end=epoch+200));assertNull(timing(start=epoch+1))
  assertNotNull(timing(age=100));assertNull(timing(age=99))
 }
 @Test fun elapsedOriginReversalAndArithmeticOverflowFailClosed(){
  assertNull(PatrolPointTiming.check(epoch,2000,1000000000,1100000000,1200000000,epoch,epoch+1000,1000))
  assertNull(PatrolPointTiming.check(Long.MAX_VALUE,0,1000000,2000000,3000000,epoch,Long.MAX_VALUE,1000))
 }
}
