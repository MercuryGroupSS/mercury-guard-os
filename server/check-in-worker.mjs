import {reconcileCheckIns} from './check-in-status.mjs';
// Local scheduler only: creates durable delivery-missing records, never sends notifications.
export function createCheckInWorker({store,devices,shiftLifecycle,now=Date.now,intervalMs=30000,batchSize=20,schedule=setInterval,cancel=clearInterval}){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<1000||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>100)throw Error('Invalid scheduler limits');
 store.db.exec(`CREATE TABLE IF NOT EXISTS check_in_worker_state(id INTEGER PRIMARY KEY CHECK(id=1),cursor TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS check_in_worker_runs(assignment TEXT,revision INTEGER,finalized INTEGER NOT NULL,last_success INTEGER NOT NULL,PRIMARY KEY(assignment,revision));`);
 let totalFailures=0;
 let timer=null,inflight=null,generation=0,last={processed:0,failed:0,at:null};
 async function sweep(epoch){
  let processed=0,failed=0;const at=now();
  try{
   if(!Number.isSafeInteger(at)||at<=0)throw Error('Trusted time required');
   const cursor=store.db.prepare('SELECT cursor FROM check_in_worker_state WHERE id=1').get()?.cursor??'';
   const rows=await devices.scheduledAfter(cursor,batchSize);
   if(epoch!==generation)return last;
   for(const assignment of rows){
    try{
     const p=assignment.checkInPolicy;
     if(assignment.active!==true||!p||assignment.startsAt>at)continue;
     const prior=store.db.prepare('SELECT finalized FROM check_in_worker_runs WHERE assignment=? AND revision=?').get(assignment.assignmentId,p.revision);
     if(prior?.finalized)continue;
     reconcileCheckIns(store,assignment,at,{activeWindow:shiftLifecycle?.checkInWindow(assignment)});
     store.db.prepare('INSERT INTO check_in_worker_runs VALUES(?,?,?,?) ON CONFLICT(assignment,revision) DO UPDATE SET finalized=excluded.finalized,last_success=excluded.last_success').run(assignment.assignmentId,p.revision,Number(at>=assignment.endsAt),at);
     processed++;
    }catch{failed++;}
   }
   // Advance past errors too, then retry on the next sweep instead of starving other assignments.
   const next=rows.length<batchSize?'':rows.at(-1).assignmentId;
   store.db.prepare('INSERT INTO check_in_worker_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor').run(next);
   totalFailures+=failed;last={processed,failed,at};return last;
  }catch(error){totalFailures++;last={processed,failed:failed+1,at};throw error;}
 }
 function run(){
  if(inflight)return inflight;
  inflight=sweep(generation).finally(()=>{inflight=null;});return inflight;
 }
 const tick=()=>timer===null?Promise.resolve(last):run().catch(()=>last);
 return {run,status:()=>({...last,totalFailures,running:timer!==null,inflight:inflight!==null}),
  async start(){if(timer!==null)return inflight;timer=schedule(tick,intervalMs);timer?.unref?.();try{return await run();}catch(error){await this.stop();throw error;}},
  async stop(){generation++;if(timer!==null){cancel(timer);timer=null;}await inflight?.catch(()=>{});}
 };
}
