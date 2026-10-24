import {actions,catalogs,label,formatValue,buildReviewedPayload,valuesForRow,AdminClient,PendingChange,ReportPhotoPreview,reportPresentation,reportDate} from './model.mjs';
const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
let pending=null,kind='vendors',page=0,cursors=[''],items=[],nextCursor=null,readVersion=0,loading=false,applying=false,selectedReport=null,reportVersion=0,reviewVersion=0,reviewing=false;
function notice(text,error=false){$('notice').textContent=text;$('notice').dataset.error=String(error);}
function signedOut(){readVersion++;reviewVersion++;items=[];clearReport();if(pending?.attempted)pending.uncertain=true;$('records').replaceChildren();$('review-details').replaceChildren();$('request-id').textContent='';$('receipt-details').replaceChildren();$('receipt-title').textContent='';$('reason').value='';renderFields();$('workspace').hidden=true;$('session').hidden=true;$('sign-in').hidden=false;$('password').value='';$('email').focus();}
const client=new AdminClient({onSessionLost:()=>{signedOut();notice('Your session or administrator access is unavailable. Sign in again to continue.',true);}});
const photoPreview=new ReportPhotoPreview({client});
function clearReport(){
 reportVersion++;selectedReport=null;photoPreview.clear();$('report-image').removeAttribute('src');$('report-image').hidden=true;$('report-title').textContent='Select a report';$('report-state').replaceChildren(node('p','Choose a received report to review its details and private evidence.','muted'));$('report-observation').replaceChildren();$('report-attribution').replaceChildren();$('report-attribution').parentElement.hidden=true;$('report-photo').hidden=true;$('photo-status').textContent='';$('load-photo').disabled=false;$('report-panel').hidden=true;
}
function syncPanels(){const reports=kind==='received_reports';$('reports-help').hidden=!reports;$('records-title').textContent=reports?'Received reports':kind==='escalations'?'Escalations':'Directory';$('report-panel').hidden=!reports;$('change-panel').hidden=reports||!!pending&&pending.owner!==client.session?.subject;}
function reportRows(parent,rows){parent.replaceChildren();for(const [title,value]of rows)parent.append(node('dt',title),node('dd',value===undefined||value===null?'—':String(value)));}
function selectReport(report){
 clearReport();selectedReport=report;const view=reportPresentation(report);syncPanels();$('report-title').textContent=view.title;$('report-state').replaceChildren(node('span','Report received','status'),node('span',view.photoLabel,'status'+(report.media.state==='pending'?' pending':'')));reportRows($('report-observation'),view.rows);
 reportRows($('report-attribution'),[['Guard ID',report.guard_id],['Vendor ID',report.vendor_id],['Site ID',report.site_id],['Assignment ID',report.assignment_id],['Observed on device',reportDate(report.observation.occurred_at_ms)],['Received by inbox',reportDate(report.received_at)],['Destination',report.destination],['Dashboard shift ID',report.dashboard_shift_id],['Mapping revision',report.mapping_revision],['Report delivery ID',report.delivery_id],['Original event ID',report.observation.event_id],['Device fingerprint',report.observation.device_thumbprint],...(report.media.state==='stored'?[['Photo bytes',report.media.bytes],['Photo fingerprint',report.media.sha256]]:[])]);$('report-attribution').parentElement.hidden=false;
 if(report.media.state!=='not_applicable'){$('report-photo').hidden=false;$('photo-status').textContent=report.media.state==='stored'?'Photo received and stored privately. Load it to view.':'The report is saved. A matching private photo is not available in this inbox yet. Refresh to check delivery.';$('load-photo').hidden=report.media.state!=='stored';$('photo-privacy').hidden=report.media.state!=='stored';}
 renderTable();$('report-title').focus();
}
async function loadPhoto(){
 const report=selectedReport,version=reportVersion;if(!report||kind!=='received_reports'||!client.session)return;$('load-photo').disabled=true;$('report-image').removeAttribute('src');$('report-image').hidden=true;$('photo-status').textContent='Loading and checking the private photo…';
 try{const url=await photoPreview.load(report.media);if(!url||version!==reportVersion||selectedReport!==report||!client.session||kind!=='received_reports')return;$('report-image').src=url;$('report-image').hidden=false;$('load-photo').hidden=true;$('photo-status').textContent='Private photo loaded. Size and fingerprint match the received record.';}
 catch(error){if(version!==reportVersion||selectedReport!==report)return;$('photo-status').textContent=error.message;$('load-photo').disabled=false;}
}
function textField(field,parent,values={}){
 const wrapper=node('label',field.label);let input;
 if(field.type==='select'){input=node('select');for(const [value,title]of field.options){const option=node('option',title);option.value=value;input.append(option);}}
 else if(field.type==='textarea'){input=node('textarea');input.rows=field.key==='body'?4:3;}
 else{input=node('input');input.type=field.type??'text';}
 input.name=field.key;input.id='field-'+field.key;input.setAttribute('aria-label',field.label);input.required=!field.optional;input.autocomplete='off';
 if(field.max&&field.type!=='number')input.maxLength=field.max;if(field.min!==undefined)input.min=field.min;if(field.max!==undefined&&field.type==='number')input.max=field.max;if(field.pattern)input.pattern=field.pattern;
 if(field.step!==undefined)input.step=field.step;
 if(values[field.key]!==undefined&&values[field.key]!==null)input.value=String(values[field.key]);else if(field.value!==undefined)input.value=field.value;
 wrapper.append(input);if(field.hint)wrapper.append(node('small',field.hint));parent.append(wrapper);return input;
}
function optionalGroup(parent,key,title,fields,values,enabled){
 const group=node('fieldset',undefined,'optional-group'),legend=node('legend',title),toggleLabel=node('label','Include '+title.toLowerCase(),'checkbox-label'),toggle=node('input');toggle.type='checkbox';toggle.name=key;toggle.checked=enabled;toggleLabel.prepend(toggle);group.append(legend,toggleLabel);
 const content=node('div');for(const field of fields)textField(field,content,values);group.append(content);parent.append(group);
 const sync=()=>{const enabled=toggle.checked&&!toggle.disabled;content.hidden=!enabled;for(const input of content.querySelectorAll('input,textarea,select'))input.disabled=!enabled;};toggle.addEventListener('change',sync);sync();return {content,toggle,sync};
}
function renderFields(values={}){
 const schema=actions[$('action').value],escalation=$('action').value==='escalation.acknowledge';$('action-help').textContent=schema.help;$('reason-label').textContent=escalation?'Response shown to guard':'Reason for change';$('reason').placeholder=escalation?'Confirm you received this request and describe the next step.':'Why is this change approved?';$('fields').replaceChildren();
 for(const field of schema.fields)textField(field,$('fields'),values);
 if(schema.route){const r=values.patrolRoute??{};optionalGroup($('fields'),'routeEnabled','Patrol route',[
  {key:'routeId',label:'Route ID',type:'text',max:200},{key:'routeRevision',label:'Route revision',type:'number',min:1,max:2147483647,value:1},
  {key:'routeGpsRequired',label:'Checkpoint capture policy',type:'select',options:[['','Legacy manual checkpoints'],['true','Require a fresh, consented GPS fix']],hint:'GPS approval attests that the exact reviewed location notice covers user-triggered checkpoint fixes. Expand the purpose only with new route/policy/notice revisions and new guard consent. A failed GPS fix cannot fall back to manual.'},
  {key:'checkpoints',label:'Checkpoints',type:'textarea',max:26000,hint:'One per line: entrance | Main entrance. Use unique IDs. Guards may choose any order.'},
  {key:'rounds',label:'Patrol rounds (optional)',type:'textarea',optional:true,max:26000,hint:'Leave empty for one pass. To repeat checkpoints, approve one round per line: opening | Opening patrol. Use unique IDs and labels. Guards select an approved round; rounds never reset automatically.'}
 ],{routeId:r.routeId,routeRevision:r.revision,routeGpsRequired:r.gps_required===true?'true':'',checkpoints:r.checkpoints?.map(c=>c.id+' | '+c.label).join('\n'),rounds:r.rounds?.map(round=>round.id+' | '+round.label).join('\n')},!!values.patrolRoute);}
 if(schema.policy){const p=values.checkInPolicy??{};optionalGroup($('fields'),'policyEnabled','Timed check-ins',[
  {key:'policyRevision',label:'Policy revision',type:'number',min:1,max:2147483647,value:1},{key:'interval',label:'Interval (minutes)',type:'number',min:1,max:1440,value:60},
  {key:'window',label:'Response window (seconds)',type:'number',min:1,max:86400,value:120},{key:'evidenceAge',label:'Evidence freshness (seconds)',type:'number',min:1,max:300,value:30},
  {key:'accuracy',label:'Maximum GPS uncertainty (metres)',type:'number',min:1,max:1000,value:50}
 ],{policyRevision:p.revision,interval:p.interval_ms?p.interval_ms/60000:undefined,window:p.window_ms?p.window_ms/1000:undefined,evidenceAge:p.max_evidence_age_ms?p.max_evidence_age_ms/1000:undefined,accuracy:p.max_accuracy_m},!!values.checkInPolicy);}
 if(schema.locationPolicy){const p=values.locationPolicy??{},f=p.geofence??{},location=optionalGroup($('fields'),'locationPolicyEnabled','Authorized location policy',[
  {key:'locationRevision',label:'Location policy revision',type:'number',min:1,max:Number.MAX_SAFE_INTEGER},
  {key:'locationNoticeRevision',label:'Location notice revision',type:'number',min:1,max:Number.MAX_SAFE_INTEGER},
  {key:'locationNotice',label:'Full reviewed location notice',type:'textarea',max:2000,hint:'Use the complete approved notice shown to the individual guard. Review computes its exact UTF-8 SHA-256 fingerprint; it does not write or infer consent.'},
  {key:'locationInterval',label:'Sample interval (milliseconds)',type:'number',min:1000,max:3600000},
  {key:'locationDistance',label:'Minimum displacement (metres)',type:'number',min:0,max:10000,step:'any'},
  {key:'locationFreshness',label:'Maximum fix age (milliseconds)',type:'number',min:1000,max:300000},
  {key:'locationAccuracy',label:'Maximum GPS uncertainty (metres)',type:'number',min:0,max:1000,step:'any'},
  {key:'locationLease',label:'Maximum capture lease (milliseconds)',type:'number',min:1000,max:900000}
 ],{locationRevision:p.revision,locationNoticeRevision:p.notice_revision,locationNotice:p.notice_text,locationInterval:p.sample_interval_ms,locationDistance:p.min_distance_m,locationFreshness:p.max_fix_age_ms,locationAccuracy:p.max_accuracy_m,locationLease:p.max_capture_lease_ms},!!values.locationPolicy);
  location.content.prepend(node('p','No operational values or notice are selected for you. Approval does not start collection: the signed-in guard must separately review and consent, and the phone must have a current authorized shift and capture lease.','muted'));
  const circle=optionalGroup(location.content,'locationCircleEnabled','Approved circle geofence',[
   {key:'locationFenceId',label:'Geofence ID',type:'text',max:200,pattern:'[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}'},
   {key:'locationFenceRevision',label:'Geofence revision',type:'number',min:1,max:Number.MAX_SAFE_INTEGER},
   {key:'locationLatitude',label:'Approved circle latitude',type:'number',min:-90,max:90,step:'any'},
   {key:'locationLongitude',label:'Approved circle longitude',type:'number',min:-180,max:180,step:'any'},
   {key:'locationRadius',label:'Approved circle radius (metres)',type:'number',min:0,max:100000,step:'any'}
  ],{locationFenceId:f.id,locationFenceRevision:f.revision,locationLatitude:f.latitude,locationLongitude:f.longitude,locationRadius:f.radius_m},!!p.geofence);
  circle.content.prepend(node('p','Leave this circle disabled unless its geometry was explicitly approved. The server labels each uncertain device observation; no geofence alert is triggered.','muted'));
  const sync=()=>{location.sync();circle.sync();};location.toggle.addEventListener('change',sync);sync();
 }
}
function startChange(action=$('action').value,values={}){
 if(pending){notice('Finish or confirm the current change before preparing another.',true);return;}
 reviewVersion++;
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
 if(kind==='received_reports'){
  const list=node('div',undefined,'report-list');for(const report of shown){const view=reportPresentation(report),card=node('button',undefined,'report-card');card.type='button';card.setAttribute('aria-pressed',String(selectedReport?.delivery_id===report.delivery_id));card.setAttribute('aria-label',view.title+' from '+report.guard_id+' at '+report.site_id);const top=node('span',undefined,'report-card-top');top.append(node('strong',view.title),node('time','Received '+reportDate(report.received_at)));card.append(top,node('span',view.summary.length>180?view.summary.slice(0,177)+'…':view.summary,'report-summary'),node('span','Guard '+report.guard_id+' · Site '+report.site_id,'report-scope'));const states=node('span',undefined,'report-card-states');states.append(node('span','Report received','status'),node('span',view.photoLabel,'status'+(report.media?.state==='pending'?' pending':'')));card.append(states);card.addEventListener('click',()=>selectReport(report));list.append(card);}$('records').append(list);return;
 }
 const table=node('table'),head=node('thead'),header=node('tr');for(const key of config.columns)header.append(node('th',label(key)));if(config.action)header.append(node('th','Action'));head.append(header);table.append(head);const body=node('tbody');
 for(const row of shown){const tr=node('tr'),display=kind==='escalations'?{...row,urgency:row.intent?.urgency,description:row.intent?.description}:row;for(const key of config.columns){const td=node('td'),value=display[key];
   if(typeof value==='boolean')td.append(node('span',key==='active'?(value?'Active':'Inactive'):key==='revoked'?(value?'Revoked':'Valid'):(value?'Yes':'No'),'status'+(key==='revoked'?value?' off':'':value?'':' off')));
   else if(value&&typeof value==='object'){const d=node('details'),summary=node('summary','View details'),pre=node('pre',formatValue(key,value),'detail-text');d.append(summary,pre);td.append(d);}
   else td.textContent=formatValue(key,value);tr.append(td);}
  if(config.action){const td=node('td'),button=node('button',kind==='assignments'?'Message':kind==='devices'?'Revoke':kind==='escalations'?'Acknowledge':'Manage','quiet');button.type='button';button.disabled=!!pending||kind==='devices'&&row.revoked||kind==='escalations'&&row.status==='operator_acknowledged';button.addEventListener('click',()=>{startChange(config.action,valuesForRow(kind,row));$('change-panel').scrollIntoView({block:'start',behavior:'smooth'});$('action').focus();});td.append(button);tr.append(td);}body.append(tr);
 }table.append(body);$('records').append(table);
}
async function loadPage(reset=false){
 if(!client.session)return;clearReport();syncPanels();if(reset){page=0;cursors=[''];}const version=++readVersion,selected=kind,after=cursors[page]??'';loading=true;items=[];nextCursor=null;$('records').replaceChildren(node('div','Loading records…','empty'));$('filter').disabled=true;$('refresh').disabled=true;$('next').disabled=true;$('previous').disabled=true;
 $('page-info').textContent='Loading '+catalogs[kind].label.toLowerCase()+'…';
 try{const data=await client.request('/v1/admin/catalog?'+new URLSearchParams({kind:selected,...(after?{after}:{})}));if(version!==readVersion||selected!==kind)return;
  if(data.kind!==selected||!Array.isArray(data.items)||data.items.length>50||data.next_cursor!==null&&(typeof data.next_cursor!=='string'||data.next_cursor.length>4096))throw Error('The records response was incomplete. Refresh to try again.');
  items=data.items;nextCursor=data.next_cursor;renderTable();
 }catch(error){if(version!==readVersion)return;items=[];nextCursor=null;$('records').replaceChildren(node('div','Records unavailable. Refresh to try again.','empty'));notice(error.message,true);}
 finally{if(version===readVersion){loading=false;$('filter').disabled=false;$('refresh').disabled=false;$('previous').disabled=page===0;$('next').disabled=!nextCursor;}}
}
for(const [key,config]of Object.entries(catalogs)){const button=node('button',config.label);button.type='button';button.dataset.kind=key;button.setAttribute('aria-current',key===kind?'page':'false');button.addEventListener('click',()=>{kind=key;$('filter').value='';for(const b of $('catalog-nav').children)b.setAttribute('aria-current',b===button?'page':'false');loadPage(true);});$('catalog-nav').append(button);}
for(const [key,schema]of Object.entries(actions)){const option=node('option',schema.label);option.value=key;$('action').append(option);}renderFields();
$('action').addEventListener('change',()=>{reviewVersion++;renderFields();});$('filter').addEventListener('input',()=>{clearReport();syncPanels();renderTable();});$('refresh').addEventListener('click',()=>loadPage());$('close-report').addEventListener('click',()=>{clearReport();syncPanels();renderTable();});$('load-photo').addEventListener('click',loadPhoto);
$('report-image').addEventListener('error',()=>{if(!selectedReport||!$('report-image').hasAttribute('src'))return;photoPreview.clear();$('report-image').removeAttribute('src');$('report-image').hidden=true;$('load-photo').hidden=false;$('load-photo').disabled=false;$('photo-status').textContent='This photo could not be displayed. Reload it or ask the owner to review the saved evidence.';});
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
$('sign-out').addEventListener('click',async()=>{
 const confirmation=client.logout(),generation=client.generation;signedOut();const pendingHelp=pending?' The pending change remains in this tab. Sign in as the same administrator to confirm it.':'';notice('Signed out on this Mac. Confirming server sign-out…'+pendingHelp);
 const result=await confirmation;if(generation!==client.generation||result===null||client.session)return;
 notice((result==='signed_out'?'Signed out on this Mac and server sign-out confirmed.':result==='session_unavailable'?'Signed out on this Mac. The server session is already unavailable.':'Signed out on this Mac. Server sign-out could not be confirmed; the server session may remain valid until it expires.')+pendingHelp,result==='unconfirmed');
});
$('change-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!client.session||pending||reviewing)return;
 const owner=client.session.subject,generation=client.generation,version=reviewVersion,values=Object.fromEntries(new FormData($('change-form'))),action=$('action').value,reason=$('reason').value;reviewing=true;$('review-change').disabled=true;
 try{const payload=await buildReviewedPayload(action,values);if(version!==reviewVersion||generation!==client.generation||client.session?.subject!==owner||pending)return;pending=new PendingChange({owner,action,reason,payload,requestId:crypto.randomUUID()});showReview();renderTable();notice('Review the change before applying.');}catch(error){if(version===reviewVersion&&generation===client.generation)notice(error.message,true);}finally{reviewing=false;$('review-change').disabled=false;}
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
$('new-change').addEventListener('click',()=>{if(kind==='received_reports')$('catalog-nav').querySelector('[data-kind="vendors"]').click();startChange();$('change-panel').scrollIntoView({block:'start',behavior:'smooth'});$('action').focus();});$('another-change').addEventListener('click',()=>startChange());
function checkSession(){if(!client.session)return;const seconds=Math.ceil((client.session.expiresAt*1000-Date.now())/1000);if(seconds<=0){client.clear();signedOut();notice('Session expired. Sign in again.'+(pending?' Your pending request remains in this tab.':''));return;}$('session-time').textContent='Session · '+Math.ceil(seconds/60)+' min';}
setInterval(checkSession,1000);document.addEventListener('visibilitychange',checkSession);window.addEventListener('pageshow',checkSession);
window.addEventListener('beforeunload',event=>{if(pending?.attempted){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{client.clear();signedOut();});
