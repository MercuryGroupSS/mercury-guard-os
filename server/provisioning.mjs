import {mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {LocalGuardDirectory} from './local-guard-directory.mjs';
import {LocalDeviceAssignments} from './local-device-assignments.mjs';
import {DashboardBindings} from './dashboard-bridge.mjs';
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
function fields(row,required,optional=[]){if(!row||typeof row!=='object'||Array.isArray(row)||required.some(k=>!Object.hasOwn(row,k))||Object.keys(row).some(k=>![...required,...optional].includes(k)))throw Error('Provisioning fields invalid');}
function unique(rows,key,normalize=x=>x){const values=rows.map(r=>normalize(r[key]));if(values.some(x=>typeof x!=='string'||!x)||new Set(values).size!==values.length)throw Error('Duplicate or missing provisioning identity');}
function populate(value,directory,devices,bindings){
 for(const v of value.vendors)directory.addVendor(v);
 for(const g of value.guards){directory.addGuard(g);directory.setLoginEmail(g.guardId,g.email);}
 for(const d of value.devices)devices.enroll(d);
 for(const a of value.assignments)devices.assign(a);
 for(const b of value.dashboardBindings)bindings.approve(b);
}
export function validateProvisioning(value){
 fields(value,['version','vendors','guards','devices','assignments','dashboardBindings']);if(value.version!==1)throw Error('Unsupported provisioning version');
 for(const key of ['vendors','guards','devices','assignments','dashboardBindings'])if(!Array.isArray(value[key])||value[key].length>1000)throw Error('Bounded provisioning lists required');
 for(const v of value.vendors){fields(v,['vendorId','kind','active']);if(!stable(v.vendorId)||!['company','individual'].includes(v.kind)||typeof v.active!=='boolean')throw Error('Invalid vendor');}
 for(const g of value.guards){fields(g,['guardId','authSubject','vendorId','email','active']);if(![g.guardId,g.authSubject,g.vendorId].every(stable)||typeof g.email!=='string'||typeof g.active!=='boolean')throw Error('Invalid guard');}
 for(const d of value.devices){fields(d,['deviceId','mode','active','revoked','publicKeySpki'],['siteId','guardId']);if(d.mode==='site'&&Object.hasOwn(d,'guardId')||d.mode==='personal'&&Object.hasOwn(d,'siteId'))throw Error('Ambiguous device binding');}
 for(const a of value.assignments)fields(a,['assignmentId','guardId','vendorId','siteId','startsAt','endsAt','active'],['patrolRoute','checkInPolicy']);
 for(const b of value.dashboardBindings)fields(b,['assignmentId','guardId','vendorId','siteId','dashboardShiftId','destination','revision','active']);
 unique(value.vendors,'vendorId');unique(value.guards,'guardId');unique(value.guards,'authSubject');unique(value.guards,'email',x=>typeof x==='string'?x.toLowerCase():x);unique(value.devices,'deviceId');unique(value.assignments,'assignmentId');unique(value.dashboardBindings,'assignmentId');
 const vendors=new Map(value.vendors.map(x=>[x.vendorId,x])),guards=new Map(value.guards.map(x=>[x.guardId,x])),assignments=new Map(value.assignments.map(x=>[x.assignmentId,x]));
 for(const g of value.guards)if(!vendors.has(g.vendorId)||g.active&&!vendors.get(g.vendorId).active)throw Error('Guard vendor link unavailable');
 for(const d of value.devices)if(d.mode==='personal'&&!guards.get(d.guardId)?.active)throw Error('Personal device guard unavailable');
 for(const a of value.assignments){
  const guard=guards.get(a.guardId);if(!guard?.active||guard.vendorId!==a.vendorId||!vendors.get(a.vendorId)?.active)throw Error('Assignment identity mismatch');
  if(!value.devices.some(d=>d.mode==='site'&&d.siteId===a.siteId||d.mode==='personal'&&d.guardId===a.guardId))throw Error('No eligible phone for assignment');
 }
 for(const b of value.dashboardBindings){const a=assignments.get(b.assignmentId);if(!a||['guardId','vendorId','siteId'].some(k=>a[k]!==b[k]))throw Error('Dashboard mapping mismatch');}
 const directory=new LocalGuardDirectory(':memory:'),devices=new LocalDeviceAssignments(':memory:'),bindings=new DashboardBindings(':memory:');
 try{populate(value,directory,devices,bindings);}finally{directory.close();devices.close();bindings.close();}
 return Object.fromEntries(['vendors','guards','devices','assignments','dashboardBindings'].map(k=>[k,value[k].length]));
}
// Creates only a new directory. It never activates a configuration or updates an existing app.
export function createProvisioning(value,output){
 const counts=validateProvisioning(value);mkdirSync(output,{mode:0o700});
 const directory=new LocalGuardDirectory(join(output,'directory.sqlite')),devices=new LocalDeviceAssignments(join(output,'devices.sqlite')),bindings=new DashboardBindings(join(output,'dashboard-bindings.sqlite'));
 try{populate(value,directory,devices,bindings);}finally{directory.close();devices.close();bindings.close();}
 for(const file of ['directory.sqlite','devices.sqlite','dashboard-bindings.sqlite'])chmodSync(join(output,file),0o600);
 const manifest={version:1,status:'validated_not_activated',counts};writeFileSync(join(output,'provisioning.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});return manifest;
}
