import {checkInPolicy} from './check-in-policy.mjs';
// Missing delivery is distinct from proving that a guard failed to capture offline.
export function reconcileCheckIns(store,assignment,now=Date.now()){
 if(!Number.isSafeInteger(now)||now<=0)throw Error('Trusted time required');
 const p=checkInPolicy(assignment.checkInPolicy,assignment.startsAt,assignment.endsAt);
 const count=Math.ceil((p.ends_at-p.starts_at)/p.interval_ms);
 if(count>10000)throw Error('Schedule exceeds bounded reconciliation');
 const rows=[];let missed=0;
 const reasons=new Map(store.db.prepare("SELECT json_extract(body,'$.event.data.slot') AS slot,count(*) AS n FROM events WHERE json_extract(body,'$.scope.guard_id')=? AND json_extract(body,'$.scope.assignment_id')=? AND json_extract(body,'$.event.kind')='check_in_miss_reason' AND json_extract(body,'$.event.data.policy_revision')=? GROUP BY json_extract(body,'$.event.data.slot')").all(assignment.guardId,assignment.assignmentId,p.revision).map(r=>[r.slot,r.n]));
 store.db.exec('BEGIN IMMEDIATE');
 try{
  for(let slot=0;slot<count;slot++){
   const due=p.starts_at+slot*p.interval_ms;if(due>now)break;
   const deadline=Math.min(due+p.window_ms,p.ends_at);
   const saved=store.db.prepare('SELECT e.body,e.received_at FROM check_ins c JOIN events e ON e.id=c.event_id WHERE c.guard=? AND c.assignment=? AND c.revision=? AND c.slot=? AND json_extract(e.body,\'$.scope.guard_id\')=c.guard AND json_extract(e.body,\'$.scope.assignment_id\')=c.assignment').all(assignment.guardId,assignment.assignmentId,p.revision,slot);
   if(saved.length>1)throw Error('Ambiguous check-in observation');
   let received=null,mediaAt=null;
   if(saved.length){
    const event=JSON.parse(saved[0].body);received=saved[0].received_at||null;
    const media=store.db.prepare('SELECT received_at FROM media WHERE device=? AND event_id=?').get(event.scope.device_thumbprint,event.event.data.photo_event_id);
    mediaAt=media?.received_at||null;
   }
   const complete=received!==null&&mediaAt!==null&&received<=now&&mediaAt<=now;
   const onTime=complete&&received<deadline&&mediaAt<deadline;
   if(now>=deadline&&!onTime){
    store.db.prepare('INSERT OR IGNORE INTO missed_check_ins VALUES(?,?,?,?,?,?)').run(assignment.guardId,assignment.assignmentId,p.revision,slot,deadline,now);
   }
   const miss=store.db.prepare('SELECT detected_at FROM missed_check_ins WHERE guard=? AND assignment=? AND revision=? AND slot=?').get(assignment.guardId,assignment.assignmentId,p.revision,slot);
   if(miss)missed++;
   const reasonCount=reasons.get(slot)??0;
   rows.push({reason_count:reasonCount,slot,due_at:due,deadline_at:deadline,
    status:complete?(onTime?'evidence_received':'evidence_received_after_deadline'):saved.length?'photo_delivery_pending':now>=deadline?'delivery_missing':'due',
    delivery_deadline_missed:!!miss,missing_detected_at:miss?.detected_at??null});
  }
  store.db.exec('COMMIT');
 }catch(e){store.db.exec('ROLLBACK');throw e;}
 return {assignment_id:assignment.assignmentId,policy_revision:p.revision,server_time_ms:now,total_due:rows.length,total_deadlines_missed:missed,slots:rows.slice(-100),earlier_slots_omitted:Math.max(0,rows.length-100),dispatch_delivery:'not_connected'};
}
