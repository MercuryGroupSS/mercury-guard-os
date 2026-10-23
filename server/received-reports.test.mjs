import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {projectDashboardObservation} from './dashboard-delivery.mjs';
import {receivedReportCursor,parseReceivedReportCursor,receivedObservation} from './received-reports.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
test('received report cursor preserves submillisecond ordering and rejects altered or unbounded positions',()=>{
 const time='2026-10-23T23:59:59.123456Z',id='a'.repeat(64),cursor=receivedReportCursor(time,id);
 assert.deepEqual(parseReceivedReportCursor(cursor),[time,id]);assert.equal(parseReceivedReportCursor(''),null);
 for(const value of [null,[],cursor+'=',cursor+'a','x'.repeat(201),'r1.'+Buffer.from(JSON.stringify(['2026-02-31T23:59:59.123456Z',id])).toString('base64url'),'r1.'+Buffer.from(JSON.stringify([time,id,'extra'])).toString('base64url')])assert.throws(()=>parseReceivedReportCursor(value));
 assert.throws(()=>receivedReportCursor(time,'a'.repeat(63)));assert.throws(()=>receivedReportCursor('2026-10-23T23:59:59.123Z',id));
});
test('historical received observations retain original stable scope and fail closed on changed hash, projection or receipt',()=>{
 const mapping={assignmentId:'assignment',guardId:'individual-guard',vendorId:'company',siteId:'site',destination:'ops',dashboardShiftId:'source-shift',revision:7,active:true};
 const value=projectDashboardObservation({vendor_id:mapping.vendorId,scope:{assignment_id:mapping.assignmentId,guard_id:mapping.guardId,site_id:mapping.siteId,device_thumbprint:'b'.repeat(64)},event:{event_id:randomUUID(),kind:'incident',at:Date.now(),data:{description:'Synthetic report'}}},mapping),raw=JSON.stringify(value),row={...value,raw_body:raw,payload_sha256:hash(raw),receipt:{delivery_id:value.delivery_id,destination:value.destination,payload_sha256:hash(raw),status:'stored_in_integration_inbox'}};
 assert.equal(JSON.stringify(receivedObservation(row)),JSON.stringify(value));
 assert.throws(()=>receivedObservation({...row,raw_body:raw.replace('Synthetic report','altered report')}));
 assert.throws(()=>receivedObservation({...row,guard_id:'other-guard'}));
 assert.throws(()=>receivedObservation({...row,dashboard_shift_id:'other-shift'}));
 assert.throws(()=>receivedObservation({...row,mapping_revision:8}));
 assert.throws(()=>receivedObservation({...row,receipt:{...row.receipt,status:'delivered'}}));
 assert.throws(()=>receivedObservation({...row,delivery_id:'c'.repeat(64)}));
});
