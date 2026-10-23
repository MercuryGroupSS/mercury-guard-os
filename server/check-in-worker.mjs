import {reconcileCheckIns} from './check-in-status.mjs';
// Local scheduler only: creates durable delivery-missing records, never sends notifications.
export function createCheckInWorker({store,devices,now=Date.now,intervalMs=30000,batchSize=20,schedule=setInterval,cancel=clearInterval}){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<1000||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>100)throw Error('Invalid scheduler limits');
 store.db.exec(`CREATE TABLE IF NOT EXISTS check_in_worker_state(id INTEGER PRIMARY KEY CHECK(id=1),cursor TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS check_in_worker_runs(assignment TEXT,revision INTEGER,finalized INTEGER NOT NULL,last_success INTEGER NOT NULL,PRIMARY KEY(assignment,revision));`);
 let totalFailures=0;
 let timer=null,running=false,last={processed:0,failed:0,at:null};
 function run(){
  if(running)return last;running=true;
  let processed=0,failed=0;const at=now();
  try{
   if(!Number.isSafeInteger(at)||at<=0)throw Error('Trusted time required');
   const cursor=store.db.prepare('SELECT cursor FROM check_in_worker_state WHERE id=1').get()?.cursor??'';
   const rows=devices.scheduledAfter(cursor,batchSize);
   for(const assignment of rows){
    try{
     const p=assignment.checkInPolicy;
     if(assignment.active!==true||!p||assignment.startsAt>at)continue;
     const prior=store.db.prepare('SELECT finalized FROM check_in_worker_runs WHERE assignment=? AND revision=?').get(assignment.assignmentId,p.revision);
     if(prior?.finalized)continue;
     reconcileCheckIns(store,assignment,at);
     store.db.prepare('INSERT INTO check_in_worker_runs VALUES(?,?,?,?) ON CONFLICT(assignment,revision) DO UPDATE SET finalized=excluded.finalized,last_success=excluded.last_success').run(assignment.assignmentId,p.revision,Number(at>=assignment.endsAt),at);
     processed++;
    }catch{failed++;}
   }
   // Advance past errors too, then retry on the next sweep instead of starving other assignments.
   const next=rows.length<batchSize?'':rows.at(-1).assignmentId;
   store.db.prepare('INSERT INTO check_in_worker_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor').run(next);
   totalFailures+=failed;last={processed,failed,at};return last;
  }finally{running=false;}
 }
 return {run,status:()=>({...last,totalFailures,running:timer!==null}),start(){if(timer!==null)return;run();timer=schedule(()=>{try{run();}catch{totalFailures++;last={processed:0,failed:1,at:now()};}},intervalMs);timer?.unref?.();},stop(){if(timer!==null){cancel(timer);timer=null;}}};
}
