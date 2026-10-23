import {createHash} from 'node:crypto';
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
const fields=['guardId','vendorId','siteId','assignmentId'];
export function scopeKey(scope){if(!scope||fields.some(k=>!stable(scope[k])))throw Error('Trusted message scope required');return createHash('sha256').update(JSON.stringify(fields.map(k=>scope[k]))).digest('hex');}
export function prepareDispatchVersion(scope,value){
  const key=scopeKey(scope);
  if(!value||!stable(value.message_id)||!Number.isSafeInteger(value.version)||value.version<1||!['active','retracted'].includes(value.state)||!Number.isSafeInteger(value.issued_at)||value.issued_at<=0||value.due_at!==null&&(!Number.isSafeInteger(value.due_at)||value.due_at<value.issued_at))throw Error('Invalid dispatch version');
  if(typeof value.title!=='string'||typeof value.body!=='string'||value.title.length>200||value.body.length>8000||value.state==='active'&&(!value.title.trim()||!value.body.trim())||value.state==='retracted'&&(value.title!==''||value.body!==''))throw Error('Invalid dispatch content');
  const record=Object.fromEntries(['message_id','version','state','title','body','issued_at','due_at'].map(k=>[k,value[k]])),body=JSON.stringify(record);
 return {key,record,body};
}
export {stable};
