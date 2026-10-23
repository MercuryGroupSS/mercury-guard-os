import {DatabaseSync} from 'node:sqlite';
import {deliverDashboardOnce} from './dashboard-delivery.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
// Administrative API only. No device route can approve mappings or select destinations.
export class DashboardBindings {
 constructor(path){this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS dashboard_bindings(assignment TEXT,guard TEXT,vendor TEXT,site TEXT,revision INTEGER,body TEXT,PRIMARY KEY(assignment,guard,vendor,site));');}
 approve(value){
  if(!value||['assignmentId','guardId','vendorId','siteId','dashboardShiftId','destination'].some(k=>!id(value[k]))||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.active!=='boolean')throw Error('Explicit approved binding required');
  const row=Object.fromEntries(['assignmentId','guardId','vendorId','siteId','dashboardShiftId','destination','revision','active'].map(k=>[k,value[k]]));
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
 outbox.db.exec('CREATE TABLE IF NOT EXISTS dashboard_bridge_state(id INTEGER PRIMARY KEY CHECK(id=1),cursor INTEGER NOT NULL)');
 outbox.db.exec('CREATE TABLE IF NOT EXISTS dashboard_shift_bridge_state(id INTEGER PRIMARY KEY CHECK(id=1),cursor INTEGER NOT NULL)');
 outbox.db.exec('CREATE TABLE IF NOT EXISTS dashboard_alert_bridge_state(id INTEGER PRIMARY KEY CHECK(id=1),cursor INTEGER NOT NULL)');
 let running=false,last={projected:0,failed:0,delivery:'disabled'};
 async function run(){
  if(running)return {...last,busy:true};running=true;let projected=0,failed=0;
  try{
   const cursor=outbox.db.prepare('SELECT cursor FROM dashboard_bridge_state WHERE id=1').get()?.cursor??0;
   const rows=store.db.prepare('SELECT rowid AS cursor,body FROM events WHERE rowid>? ORDER BY rowid LIMIT ?').all(cursor,batchSize);
   const shiftCursor=outbox.db.prepare('SELECT cursor FROM dashboard_shift_bridge_state WHERE id=1').get()?.cursor??0;
   const shifts=shiftLifecycle?shiftLifecycle.dashboardAfter(shiftCursor,batchSize):[];
   const alertCursor=outbox.db.prepare('SELECT cursor FROM dashboard_alert_bridge_state WHERE id=1').get()?.cursor??0;
   const alerts=shiftLifecycle?store.db.prepare('SELECT rowid AS cursor,body FROM check_in_alert_outbox WHERE rowid>? ORDER BY rowid LIMIT ?').all(alertCursor,batchSize):[];
   const notices=[];
   for(const row of alerts)try{const record=shiftLifecycle.dashboardNotice(JSON.parse(row.body));if(record)notices.push({body:JSON.stringify(record)});}catch{failed++;}
   for(const row of [...rows,...shifts,...notices])try{
    const record=JSON.parse(row.body),scope=record.scope;
    if(!record.vendor_id)continue;
    const mapping=bindings.get({assignmentId:scope.assignment_id,guardId:scope.guard_id,vendorId:record.vendor_id,siteId:scope.site_id});
    if(!mapping?.active)continue;
    outbox.enqueue(record,mapping);projected++;
   }catch{failed++;}
   outbox.db.prepare('INSERT INTO dashboard_bridge_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor').run(rows.length<batchSize?0:rows.at(-1).cursor);
   if(shiftLifecycle)outbox.db.prepare('INSERT INTO dashboard_shift_bridge_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor').run(shifts.length<batchSize?0:shifts.at(-1).cursor);
   if(shiftLifecycle)outbox.db.prepare('INSERT INTO dashboard_alert_bridge_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor').run(alerts.length<batchSize?0:alerts.at(-1).cursor);
   const delivery=send?await deliverDashboardOnce(outbox,async job=>{
    const p=JSON.parse(job.body),mapping=bindings.get({assignmentId:p.assignment_id,guardId:p.guard_id,vendorId:p.vendor_id,siteId:p.site_id});
    if(!mapping?.active||mapping.revision!==p.mapping_revision||mapping.destination!==p.destination||mapping.dashboardShiftId!==p.dashboard_shift_id)throw Error('Original destination mapping no longer approved');
    return send(job);
   },now):'disabled';
   last={projected,failed,delivery};return last;
  }finally{running=false;}
 }
 return {run,status:()=>({...last,running})};
}
