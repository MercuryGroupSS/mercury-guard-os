const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
export function prepareDashboardMapping(value){
 if(!value||['assignmentId','guardId','vendorId','siteId','dashboardShiftId','destination'].some(k=>!id(value[k]))||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.active!=='boolean')throw Error('Explicit approved binding required');
 return Object.fromEntries(['assignmentId','guardId','vendorId','siteId','dashboardShiftId','destination','revision','active'].map(k=>[k,value[k]]));
}
