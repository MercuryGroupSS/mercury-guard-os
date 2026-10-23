package ca.mercury.guard

/** Pure timing decision; alarms never authorize capture or mark a check complete. */
object ReminderTiming {
 data class Decision(val slot:Long,val notify:Boolean,val nextAt:Long?,val expiresAt:Long?)
 fun evaluate(start:Long,end:Long,interval:Long,window:Long,now:Long,lastAttempt:Long,completed:Boolean):Decision {
  require(start>0&&end>start&&interval>0&&window in 1..interval)
  if(now>=end)return Decision(-1,false,null,null)
  if(now<start)return Decision(-1,false,start,null)
  val slot=(now-start)/interval;val due=Math.addExact(start,Math.multiplyExact(slot,interval));val deadline=minOf(Math.addExact(due,window),end)
  return Decision(slot,now<deadline&&!completed&&lastAttempt<slot,minOf(Math.addExact(due,interval),end),deadline)
 }
}
