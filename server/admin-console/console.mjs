import {actions,catalogs,label,formatValue,buildPayload,valuesForRow,AdminClient,PendingChange} from './model.mjs';
const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
let pending=null,kind='vendors',page=0,cursors=[''],items=[],nextCursor=null,readVersion=0,loading=false,applying=false;
function notice(text,error=false){$('notice').textContent=text;$('notice').dataset.error=String(error);}
function signedOut(){readVersion++;items=[];if(pending?.attempted)pending.uncertain=true;$('records').replaceChildren();$('review-details').replaceChildren();$('request-id').textContent='';$('receipt-details').replaceChildren();$('receipt-title').textContent='';$('reason').value='';renderFields();$('workspace').hidden=true;$('session').hidden=true;$('sign-in').hidden=false;$('password').value='';$('email').focus();}
const client=new AdminClient({onSessionLost:()=>{signedOut();notice('Your session or administrator access is unavailable. Sign in again to continue.',true);}});
function textField(field,parent,values={}){
 const wrapper=node('label',field.label);let input;
 if(field.type==='select'){input=node('select');for(const [value,title]of field.options){const option=node('option',title);option.value=value;input.append(option);}}
 else if(field.type==='textarea'){input=node('textarea');input.rows=field.key==='body'?4:3;}
 else{input=node('input');input.type=field.type??'text';}
 input.name=field.key;input.id='field-'+field.key;input.setAttribute('aria-label',field.label);input.required=!field.optional;input.autocomplete='off';
 if(field.max&&field.type!=='number')input.maxLength=field.max;if(field.min!==undefined)input.min=field.min;if(field.max!==undefined&&field.type==='number')input.max=field.max;if(field.pattern)input.pattern=field.pattern;
 if(values[field.key]!==undefined&&values[field.key]!==null)input.value=String(values[field.key]);else if(field.value!==undefined)input.value=field.value;
 wrapper.append(input);if(field.hint)wrapper.append(node('small',field.hint));parent.append(wrapper);return input;
}
function optionalGroup(parent,key,title,fields,values,enabled){
 const group=node('fieldset',undefined,'optional-group'),legend=node('legend',title),toggleLabel=node('label','Include '+title.toLowerCase(),'checkbox-label'),toggle=node('input');toggle.type='checkbox';toggle.name=key;toggle.checked=enabled;toggleLabel.prepend(toggle);group.append(legend,toggleLabel);
 const content=node('div');for(const field of fields)textField(field,content,values);group.append(content);parent.append(group);
 const sync=()=>{content.hidden=!toggle.checked;for(const input of content.querySelectorAll('input,textarea,select'))input.disabled=!toggle.checked;};toggle.addEventListener('change',sync);sync();
}
function renderFields(values={}){
 const schema=actions[$('action').value];$('action-help').textContent=schema.help;$('fields').replaceChildren();
 for(const field of schema.fields)textField(field,$('fields'),values);
 if(schema.route){const r=values.patrolRoute??{};optionalGroup($('fields'),'routeEnabled','Patrol route',[
  {key:'routeId',label:'Route ID',type:'text',max:200},{key:'routeRevision',label:'Route revision',type:'number',min:1,max:2147483647,value:1},
  {key:'checkpoints',label:'Checkpoints',type:'textarea',max:26000,hint:'One per line: entrance | Main entrance. Use unique IDs. Guards may choose any order.'}
 ],{routeId:r.routeId,routeRevision:r.revision,checkpoints:r.checkpoints?.map(c=>c.id+' | '+c.label).join('\n')},!!values.patrolRoute);}
 if(schema.policy){const p=values.checkInPolicy??{};optionalGroup($('fields'),'policyEnabled','Timed check-ins',[
  {key:'policyRevision',label:'Policy revision',type:'number',min:1,max:2147483647,value:1},{key:'interval',label:'Interval (minutes)',type:'number',min:1,max:1440,value:60},
  {key:'window',label:'Response window (seconds)',type:'number',min:1,max:86400,value:120},{key:'evidenceAge',label:'Evidence freshness (seconds)',type:'number',min:1,max:300,value:30},
  {key:'accuracy',label:'Maximum GPS uncertainty (metres)',type:'number',min:1,max:1000,value:50}
 ],{policyRevision:p.revision,interval:p.interval_ms?p.interval_ms/60000:undefined,window:p.window_ms?p.window_ms/1000:undefined,evidenceAge:p.max_evidence_age_ms?p.max_evidence_age_ms/1000:undefined,accuracy:p.max_accuracy_m},!!values.checkInPolicy);}
}
function startChange(action=$('action').value,values={}){
 if(pending){notice('Finish or confirm the current change before preparing another.',true);return;}
 $('action').value=action;renderFields(values);$('reason').value='';$('change-form').hidden=false;$('review').hidden=true;$('receipt').hidden=true;$('change-title').textContent='Prepare a change';$('new-change').disabled=false;
}
function details(parent,value){parent.replaceChildren();for(const [key,item]of Object.entries(value)){parent.append(node('dt',label(key)),node('dd',formatValue(key,item)));}}
function showReview(){
 const request=JSON.parse(pending.body);details($('review-details'),{action:actions[request.action].label,...request.payload,reason:request.reason});$('request-id').textContent='Request ID · '+request.request_id;
 $('review-status').textContent=pending.uncertain?'This request has an unconfirmed outcome. Retry the same request or resolve its saved outcome.':'Check the target, status, and reason. Applying records an immutable audit receipt.';$('apply-change').textContent=pending.attempted?'Retry same request':'Apply change';$('apply-change').disabled=false;$('edit-change').disabled=pending.attempted;$('resolve-change').hidden=!pending.uncertain;$('resolve-help').hidden=!pending.uncertain;$('resolve-change').disabled=false;
 $('change-form').hidden=true;$('review').hidden=false;$('receipt').hidden=true;$('new-change').disabled=true;$('change-title').textContent='Review change';$('apply-change').focus();
}
function renderTable(){
 const filter=$('filter').value.trim().toLowerCase(),shown=filter?items.filter(row=>JSON.stringify(row).toLowerCase().includes(filter)):items,config=catalogs[kind];
 $('records').replaceChildren();$('page-info').textContent=`${config.label} · page ${page+1} · ${shown.length} of ${items.length} shown`;
 if(!shown.length){$('records').append(node('div',filter?'No records match this page’s filter.':'No records on this page.','empty'));return;}
 const table=node('table'),head=node('thead'),header=node('tr');for(const key of config.columns)header.append(node('th',label(key)));if(config.action)header.append(node('th','Action'));head.append(header);table.append(head);const body=node('tbody');
 for(const row of shown){const tr=node('tr');for(const key of config.columns){const td=node('td'),value=row[key];
   if(typeof value==='boolean')td.append(node('span',key==='active'?(value?'Active':'Inactive'):key==='revoked'?(value?'Revoked':'Valid'):(value?'Yes':'No'),'status'+(key==='revoked'?value?' off':'':value?'':' off')));
   else if(value&&typeof value==='object'){const d=node('details'),summary=node('summary','View details'),pre=node('pre',formatValue(key,value),'detail-text');d.append(summary,pre);td.append(d);}
   else td.textContent=formatValue(key,value);tr.append(td);}
  if(config.action){const td=node('td'),button=node('button',kind==='assignments'?'Message':kind==='devices'?'Revoke':'Manage','quiet');button.type='button';button.disabled=!!pending||kind==='devices'&&row.revoked;button.addEventListener('click',()=>{startChange(config.action,valuesForRow(kind,row));$('change-panel').scrollIntoView({block:'start',behavior:'smooth'});$('action').focus();});td.append(button);tr.append(td);}body.append(tr);
 }table.append(body);$('records').append(table);
}
async function loadPage(reset=false){
 if(!client.session)return;if(reset){page=0;cursors=[''];}const version=++readVersion,selected=kind,after=cursors[page]??'';loading=true;items=[];nextCursor=null;$('records').replaceChildren(node('div','Loading records…','empty'));$('filter').disabled=true;$('refresh').disabled=true;$('next').disabled=true;$('previous').disabled=true;
 $('page-info').textContent='Loading '+catalogs[kind].label.toLowerCase()+'…';
 try{const data=await client.request('/v1/admin/catalog?'+new URLSearchParams({kind:selected,...(after?{after}:{})}));if(version!==readVersion||selected!==kind)return;
  if(data.kind!==selected||!Array.isArray(data.items)||data.items.length>50||data.next_cursor!==null&&typeof data.next_cursor!=='string')throw Error('The records response was incomplete. Refresh to try again.');
  items=data.items;nextCursor=data.next_cursor;renderTable();
 }catch(error){if(version!==readVersion)return;items=[];nextCursor=null;$('records').replaceChildren(node('div','Records unavailable. Refresh to try again.','empty'));notice(error.message,true);}
 finally{if(version===readVersion){loading=false;$('filter').disabled=false;$('refresh').disabled=false;$('previous').disabled=page===0;$('next').disabled=!nextCursor;}}
}
for(const [key,config]of Object.entries(catalogs)){const button=node('button',config.label);button.type='button';button.dataset.kind=key;button.setAttribute('aria-current',key===kind?'page':'false');button.addEventListener('click',()=>{kind=key;$('filter').value='';for(const b of $('catalog-nav').children)b.setAttribute('aria-current',b===button?'page':'false');loadPage(true);});$('catalog-nav').append(button);}
for(const [key,schema]of Object.entries(actions)){const option=node('option',schema.label);option.value=key;$('action').append(option);}renderFields();
$('action').addEventListener('change',()=>renderFields());$('filter').addEventListener('input',renderTable);$('refresh').addEventListener('click',()=>loadPage());
$('next').addEventListener('click',()=>{if(loading||!nextCursor)return;cursors[++page]=nextCursor;$('filter').value='';loadPage();});$('previous').addEventListener('click',()=>{if(loading||page===0)return;page--;$('filter').value='';loadPage();});
$('login-form').addEventListener('submit',async event=>{
 event.preventDefault();$('login-submit').disabled=true;notice('Checking administrator access…');
 const password=$('password').value;$('password').value='';
 try{const session=await client.login($('email').value,password);$('sign-in').hidden=true;$('workspace').hidden=false;$('session').hidden=false;
  $('change-panel').hidden=!!pending&&pending.owner!==session.subject;
  if(pending){$('new-change').disabled=true;if(pending.owner!==session.subject)notice('This tab has an unconfirmed change from another administrator. Sign in as that administrator to retry.',true);else{showReview();notice('Signed in. Retry or resolve the pending request to confirm its result.');}}
  else{notice('Administrator access confirmed.');startChange();}await loadPage(true);
 }catch(error){notice(error.message,true);}finally{$('login-submit').disabled=false;}
});
$('sign-out').addEventListener('click',()=>{client.clear();signedOut();notice(pending?'Signed out. The pending change remains in this tab. Sign in as the same administrator to confirm it.':'Signed out.');});
$('change-form').addEventListener('submit',event=>{
 event.preventDefault();if(!client.session||pending)return;
 try{const values=Object.fromEntries(new FormData($('change-form'))),action=$('action').value,payload=buildPayload(action,values);pending=new PendingChange({owner:client.session.subject,action,reason:$('reason').value,payload,requestId:crypto.randomUUID()});showReview();renderTable();notice('Review the change before applying.');}catch(error){notice(error.message,true);}
});
$('edit-change').addEventListener('click',()=>{if(applying||pending?.uncertain)return;pending=null;$('review').hidden=true;$('change-form').hidden=false;$('new-change').disabled=false;$('change-title').textContent='Prepare a change';renderTable();$('reason').focus();});
async function submitChange(resolve=false){
 if(!pending||!client.session||applying)return;applying=true;const change=pending;$('apply-change').disabled=true;$('resolve-change').disabled=true;$('edit-change').disabled=true;$('review-status').textContent=resolve?'Resolving the recorded outcome…':'Applying and confirming receipt…';
 try{const request=change.request(client.session.subject),result=await client.request(resolve?'/v1/admin/resolve':'/v1/admin/actions',{method:'POST',body:request}),receipt=change.confirm(result);if(pending!==change)return;
  pending=null;$('review').hidden=true;$('receipt').hidden=false;$('receipt-title').textContent=actions[receipt.action].label;details($('receipt-details'),{request_id:receipt.request_id,status:receipt.status==='applied'?'Applied':'Closed without applying',...receipt.result,recorded:new Date(receipt.server_time_ms).toLocaleString()});$('change-title').textContent='Saved receipt';$('new-change').disabled=false;notice(receipt.status==='applied'?'Change applied and receipt confirmed.':'Request closed without applying. You can now prepare a corrected change.');await loadPage();
 }catch(error){if(pending!==change)return;change.uncertain=true;$('review-status').textContent=error.message+' No matching receipt is confirmed. Keep this tab open. Retry uses the same request ID; resolve confirms or closes that ID.';$('apply-change').textContent='Retry same request';$('apply-change').disabled=!client.session||client.session.subject!==change.owner;$('resolve-change').hidden=false;$('resolve-help').hidden=false;$('resolve-change').disabled=!client.session||client.session.subject!==change.owner;$('edit-change').disabled=true;notice(error.message,true);
 }finally{applying=false;}
}
$('apply-change').addEventListener('click',()=>submitChange());$('resolve-change').addEventListener('click',()=>submitChange(true));
$('new-change').addEventListener('click',()=>{startChange();$('change-panel').scrollIntoView({block:'start',behavior:'smooth'});$('action').focus();});$('another-change').addEventListener('click',()=>startChange());
setInterval(()=>{if(!client.session)return;const seconds=Math.ceil((client.session.expiresAt*1000-Date.now())/1000);if(seconds<=0){client.clear();signedOut();notice('Session expired. Sign in again.'+(pending?' Your pending request remains in this tab.':''));return;}$('session-time').textContent='Session · '+Math.ceil(seconds/60)+' min';},1000);
window.addEventListener('beforeunload',event=>{if(pending?.attempted){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{client.clear();signedOut();});
