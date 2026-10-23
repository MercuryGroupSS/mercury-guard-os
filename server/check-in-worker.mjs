import {checkInWorkerState} from './check-in-worker-state.mjs';
import {reconcileCheckIns} from './check-in-status.mjs';
// Local scheduler only: creates durable delivery-missing records, never sends notifications.
export function createCheckInWorker({store,devices,shiftLifecycle,now=Date.now,intervalMs=30000,batchSize=20,schedule=setInterval,cancel=clearInterval}){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<1000||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>100)throw Error('Invalid scheduler limits');
 const state=checkInWorkerState(store);
 let totalFailures=0;
 let timer=null,inflight=null,generation=0,last={processed:0,failed:0,at:null};
 async function sweep(epoch){
  let processed=0,failed=0;const at=now();
  try{
   if(!Number.isSafeInteger(at)||at<=0)throw Error('Trusted time required');
   const cursor=await state.cursor();
   const rows=await devices.scheduledAfter(cursor,batchSize);
   if(epoch!==generation)return last;
   for(const assignment of rows){
    try{
     const p=assignment.checkInPolicy;
     if(assignment.active!==true||!p||assignment.startsAt>at)continue;
     if(await state.finalized(assignment.assignmentId,p.revision))continue;
     if(epoch!==generation)break;
     const activeWindow=await shiftLifecycle?.checkInWindow(assignment);
     if(epoch!==generation)break;
     await reconcileCheckIns(store,assignment,at,{activeWindow});
     if(epoch!==generation)break;
     await state.mark(assignment.assignmentId,p.revision,at>=assignment.endsAt,at);
     processed++;
    }catch{failed++;}
   }
   // Advance past errors too, then retry on the next sweep instead of starving other assignments.
   const next=rows.length<batchSize?'':rows.at(-1).assignmentId;
   if(epoch===generation)await state.saveCursor(next);
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
