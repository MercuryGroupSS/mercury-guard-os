import {dashboardBridgeState} from './dashboard-bridge-state.mjs';
import {prepareDashboardMapping} from './dashboard-mapping-input.mjs';
import {DatabaseSync} from 'node:sqlite';
import {deliverDashboardOnce} from './dashboard-delivery.mjs';
// Administrative API only. No device route can approve mappings or select destinations.
export class DashboardBindings {
 constructor(path){this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS dashboard_bindings(assignment TEXT,guard TEXT,vendor TEXT,site TEXT,revision INTEGER,body TEXT,PRIMARY KEY(assignment,guard,vendor,site));');}
 approve(value){
  const row=prepareDashboardMapping(value);
  const keys=[row.assignmentId,row.guardId,row.vendorId,row.siteId];this.db.exec('BEGIN IMMEDIATE');try{
   const prior=this.db.prepare('SELECT revision FROM dashboard_bindings WHERE assignment=? AND guard=? AND vendor=? AND site=?').get(...keys);
   if(prior&&row.revision<=prior.revision)throw Error('Mapping revision must advance');
   this.db.prepare('INSERT INTO dashboard_bindings VALUES(?,?,?,?,?,?) ON CONFLICT(assignment,guard,vendor,site) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(...keys,row.revision,JSON.stringify(row));
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 get({assignmentId,guardId,vendorId,siteId}){const row=this.db.prepare('SELECT body FROM dashboard_bindings WHERE assignment=? AND guard=? AND vendor=? AND site=?').get(assignmentId,guardId,vendorId,siteId);return row?JSON.parse(row.body):null;}
 close(){this.db.close();}
}
export function createDashboardBridge({store,bindings,outbox,shiftLifecycle,send=null,now=Date.now,batchSize=20}){
 if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>100)throw Error('Bounded bridge batch required');
 const state=dashboardBridgeState(outbox);
 let running=false,last={projected:0,failed:0,delivery:'disabled'};
 async function run(){
  if(running)return {...last,busy:true};running=true;let projected=0,failed=0;
  try{
   const cursor=await state.get('events');
   const rows=await store.eventsAfter(cursor,batchSize);
   const shiftCursor=await state.get('shifts');
   const shifts=shiftLifecycle?await shiftLifecycle.dashboardAfter(shiftCursor,batchSize):[];
   const alertCursor=await state.get('alerts');
   const alerts=shiftLifecycle?await store.alertsAfter(alertCursor,batchSize):[];
   const notices=[];
   for(const row of alerts)try{const record=await shiftLifecycle.dashboardNotice(JSON.parse(row.body));if(record)notices.push({body:JSON.stringify(record)});}catch{failed++;}
   for(const row of [...rows,...shifts,...notices])try{
    const record=JSON.parse(row.body),scope=record.scope;
    if(!record.vendor_id)continue;
    const mapping=await bindings.get({assignmentId:scope.assignment_id,guardId:scope.guard_id,vendorId:record.vendor_id,siteId:scope.site_id});
    if(!mapping?.active)continue;
    await outbox.enqueue(record,mapping);projected++;
   }catch{failed++;}
   await state.save('events',rows.length<batchSize?0:rows.at(-1).cursor);
   if(shiftLifecycle)await state.save('shifts',shifts.length<batchSize?0:shifts.at(-1).cursor);
   if(shiftLifecycle)await state.save('alerts',alerts.length<batchSize?0:alerts.at(-1).cursor);
   const delivery=send?await deliverDashboardOnce(outbox,async job=>{
    const p=JSON.parse(job.body),mapping=await bindings.get({assignmentId:p.assignment_id,guardId:p.guard_id,vendorId:p.vendor_id,siteId:p.site_id});
    if(!mapping?.active||mapping.revision!==p.mapping_revision||mapping.destination!==p.destination||mapping.dashboardShiftId!==p.dashboard_shift_id)throw Error('Original destination mapping no longer approved');
    return send(job);
   },now):'disabled';
   last={projected,failed,delivery};return last;
  }finally{running=false;}
 }
 return {run,status:()=>({...last,running})};
}
