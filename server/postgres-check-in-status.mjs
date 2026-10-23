import {isDeepStrictEqual} from 'node:util';
import {checkInPolicy} from './check-in-policy.mjs';
export async function reconcilePostgresCheckIns(store,assignment,now=Date.now()){
 if(!Number.isSafeInteger(now)||now<=0)throw Error('Trusted time required');
 const p=checkInPolicy(assignment.checkInPolicy,assignment.startsAt,assignment.endsAt),count=Math.ceil((p.ends_at-p.starts_at)/p.interval_ms);
 if(count>10000)throw Error('Schedule exceeds bounded reconciliation');
 return store.devices.transaction(async client=>{
  // Shares the event/media lock so each deadline decision sees one committed delivery state.
  await client.query('SELECT pg_advisory_xact_lock(724910621355083::bigint)');
  const policy=(await client.query('SELECT check_in_policy FROM mercury_guard.assignments WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4 AND starts_at_ms=$5 AND ends_at_ms=$6 FOR SHARE',[assignment.assignmentId,assignment.guardId,assignment.vendorId,assignment.siteId,assignment.startsAt,assignment.endsAt])).rows[0];
  if(!policy||!isDeepStrictEqual(policy.check_in_policy,p))throw Error('Approved check-in policy mismatch');
  const h=(await client.query(`SELECT h.clocked_in,h.clocked_out,h.ends_at FROM mercury_guard.shift_sessions h
   JOIN mercury_guard.assignments a ON a.assignment_id=h.assignment
   JOIN mercury_guard.guards g ON g.guard_id=h.guard AND g.vendor_id=h.vendor
   JOIN mercury_guard.vendors v ON v.vendor_id=h.vendor JOIN mercury_guard.sites s ON s.site_id=h.site
   WHERE h.assignment=$1 AND h.guard=$2 AND h.vendor=$3 AND h.site=$4 AND h.starts_at=$5 AND h.ends_at=$6
    AND a.active AND g.active AND v.active AND s.active FOR SHARE OF h,a,g,v,s`,[assignment.assignmentId,assignment.guardId,assignment.vendorId,assignment.siteId,assignment.startsAt,assignment.endsAt])).rows[0];
  const window=h?{startsAt:Number(h.clocked_in),endsAt:Math.min(Number(h.ends_at),h.clocked_out===null?Number(h.ends_at):Number(h.clocked_out))}:null;
  const saved=(await client.query(`SELECT c.slot,e.received_at,m.received_at AS media_at FROM mercury_guard.ingested_check_ins c
   JOIN mercury_guard.ingested_events e ON e.device=c.device AND e.id=c.event_id AND e.guard_id=c.guard_id AND e.assignment_id=c.assignment_id
   LEFT JOIN mercury_guard.ingested_media m ON m.device=e.device AND m.event_id::text=e.body#>>'{event,data,photo_event_id}'
   WHERE c.guard_id=$1 AND c.assignment_id=$2 AND c.revision=$3`,[assignment.guardId,assignment.assignmentId,p.revision])).rows;
  const observations=new Map(saved.map(r=>[Number(r.slot),r]));if(observations.size!==saved.length)throw Error('Ambiguous check-in observation');
  const reasons=new Map((await client.query(`SELECT body#>'{event,data,slot}' AS slot,count(*) n FROM mercury_guard.ingested_events
   WHERE guard_id=$1 AND assignment_id=$2 AND body#>>'{event,kind}'='check_in_miss_reason' AND body#>>'{event,data,policy_revision}'=$3
   GROUP BY body#>'{event,data,slot}'`,[assignment.guardId,assignment.assignmentId,String(p.revision)])).rows.map(r=>[Number(r.slot),Number(r.n)]));
  const slots=[],missing=[];
  for(let slot=0;slot<count;slot++){
   const due=p.starts_at+slot*p.interval_ms;if(due>now)break;const deadline=Math.min(due+p.window_ms,p.ends_at),saved=observations.get(slot);
   const eligible=window!==null&&due>=window.startsAt&&deadline<=window.endsAt;
   if(!eligible&&!saved)continue;
   const received=saved?Number(saved.received_at):null,mediaAt=saved?.media_at==null?null:Number(saved.media_at);
   const complete=received!==null&&mediaAt!==null&&received<=now&&mediaAt<=now,onTime=complete&&received<deadline&&mediaAt<deadline;
   if(eligible&&now>=deadline&&!onTime)missing.push({guard_id:assignment.guardId,assignment_id:assignment.assignmentId,revision:p.revision,slot,deadline,detected_at:now});
   slots.push({full_confirmed_window:eligible,reason_count:reasons.get(slot)??0,slot,due_at:due,deadline_at:deadline,status:complete?(onTime?'evidence_received':'evidence_received_after_deadline'):saved?'photo_delivery_pending':now>=deadline?'delivery_missing':'due'});
  }
  if(missing.length)await client.query(`INSERT INTO mercury_guard.missed_check_ins SELECT * FROM jsonb_to_recordset($1::jsonb)
   AS x(guard_id text,assignment_id text,revision bigint,slot bigint,deadline bigint,detected_at bigint) ON CONFLICT DO NOTHING`,[JSON.stringify(missing)]);
  await client.query(`INSERT INTO mercury_guard.check_in_alert_outbox(guard_id,assignment_id,revision,slot,body)
   SELECT guard_id,assignment_id,revision,slot,jsonb_build_object('kind','check_in_delivery_missing','guard_id',guard_id,'assignment_id',assignment_id,'policy_revision',revision,'slot',slot,'deadline_at',deadline,'detected_at',detected_at)
   FROM mercury_guard.missed_check_ins WHERE guard_id=$1 AND assignment_id=$2 AND revision=$3 ON CONFLICT DO NOTHING`,[assignment.guardId,assignment.assignmentId,p.revision]);
  const misses=new Map((await client.query('SELECT slot,detected_at FROM mercury_guard.missed_check_ins WHERE guard_id=$1 AND assignment_id=$2 AND revision=$3',[assignment.guardId,assignment.assignmentId,p.revision])).rows.map(r=>[Number(r.slot),Number(r.detected_at)]));
  let missed=0;const rows=slots.map(r=>{const detected=misses.get(r.slot)??null;if(detected!==null)missed++;return {...r,delivery_deadline_missed:detected!==null,missing_detected_at:detected};});
  return {assignment_id:assignment.assignmentId,policy_revision:p.revision,server_time_ms:now,total_due:rows.length,total_deadlines_missed:missed,slots:rows.slice(-100),earlier_slots_omitted:Math.max(0,rows.length-100),dispatch_delivery:'not_connected'};
 });
}
