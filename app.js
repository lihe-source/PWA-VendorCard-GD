'use strict';
const APP_VERSION='1.3.0';
const DEFAULT_DRIVE_FOLDER_URL='https://drive.google.com/drive/folders/1PqDRkf6ip0kp60i1BRgsMTMt2aCmvLum';
const DRIVE_SCOPE='https://www.googleapis.com/auth/drive';
const $=id=>document.getElementById(id);
const S=VcmStorage,D=VcmData;
const prefs={
  get clientId(){return localStorage.getItem('vcm.clientId')||'';},set clientId(v){localStorage.setItem('vcm.clientId',v);},
  get driveFolderUrl(){return localStorage.getItem('vcm.driveFolderUrl')||DEFAULT_DRIVE_FOLDER_URL;},set driveFolderUrl(v){localStorage.setItem('vcm.driveFolderUrl',v);},
  get autoOcr(){return localStorage.getItem('vcm.autoOcr')!=='false';},set autoOcr(v){localStorage.setItem('vcm.autoOcr',v);},
  get autoConnect(){return localStorage.getItem('vcm.autoConnect')!=='false';},set autoConnect(v){localStorage.setItem('vcm.autoConnect',v);},
  get dark(){return localStorage.getItem('vcm.dark')==='true';},set dark(v){localStorage.setItem('vcm.dark',v);}
};
const state={token:'',tokenExpiresAt:0,connected:false,rootFolderId:'',rootFolderName:'',profile:null,scope:'',repo:null,
  snapshot:{},index:{vendors:[],categories:[...D.defaults]},pending:[],view:null,lastSync:'',favoriteOnly:false,
  photoBlob:null,previewUrl:'',detailPhotoUrl:'',activeRecord:null,activeVendor:null,photoGeneration:0,detailGeneration:0,
  editBase:[],editRecord:null,ocrValues:{},fieldEdits:{},syncing:false,saving:false,photoLoading:false,authInFlight:false,
  confirmAction:null,updateLocked:false,ready:false,ocrBusy:false,switching:false};
let draftChain=Promise.resolve(),tokenClient=null,authAttempt=null,googleTimer=null,ocrWorker=null,ocrTail=Promise.resolve(),ocrIdleTimer=null,ocrEpoch=0;
let tabId=sessionStorage.getItem('vcm.tabId');if(!tabId){tabId=uid();sessionStorage.setItem('vcm.tabId',tabId);}
const draftKey=()=>`${state.scope}|draft:${tabId}`;
const fields=['recordId','vendorName','contactName','phone','email','category','jobTitle','notes'];
function confirmDo(title,message,fn,label='確認'){
  $('confirmTitle').textContent=title;$('confirmMessage').textContent=message;$('confirmOk').textContent=label;
  state.confirmAction=async()=>{try{await fn();}catch(e){toast(humanizeError(e),'error');}};$('confirmDialog').showModal();
}
function hasWork(){return state.saving||state.syncing||state.photoLoading||state.ocrBusy||state.authInFlight||state.switching;}
function captureDraft(){return {scope:state.scope,updatedAt:nowIso(),values:Object.fromEntries(fields.map(k=>[k,$(k).value])),favorite:$('favorite').checked,
  photoBlob:state.photoBlob,editBase:state.editBase,editRecord:state.editRecord,ocrValues:state.ocrValues};}
function saveDraft(){
  if(!state.ready||!state.scope)return Promise.resolve();
  const draft=captureDraft(),key=draftKey();
  const nonempty=draft.photoBlob||draft.favorite||Object.values(draft.values).some(Boolean);
  draftChain=draftChain.catch(()=>{}).then(()=>S.put('drafts',draft,key));
  return draftChain.then(()=>{$('draftStatus').textContent=nonempty?'草稿已保存在此裝置':'文字與照片會自動保留為草稿';},e=>{
    $('draftStatus').textContent='草稿儲存失敗，請勿關閉頁面；檢查裝置儲存空間。';throw e;
  });
}
function saveDraftSoon(){saveDraft().catch(()=>{});}
function displayPhoto(blob){
  if(state.previewUrl)URL.revokeObjectURL(state.previewUrl);
  state.photoBlob=blob;state.previewUrl=blob?URL.createObjectURL(blob):'';
  $('photoPreview').src=state.previewUrl;$('photoPreview').hidden=!blob;$('cameraPrompt').hidden=!!blob;
  $('replacePhotoHint').hidden=!blob;$('analyzePhotoBtn').hidden=!blob;
}
async function loadDraft(){
  let draft=await S.get('drafts',draftKey());
  if(!draft){const others=(await S.all('drafts')).filter(d=>d.scope===state.scope).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));draft=others[0];}
  if(!draft)return;
  for(const k of fields)$(k).value=String(draft.values?.[k]||'');
  $('favorite').checked=!!draft.favorite;state.editBase=draft.editBase||[];state.editRecord=draft.editRecord||null;state.ocrValues=draft.ocrValues||{};
  displayPhoto(draft.photoBlob||null);$('notesCount').textContent=$('notes').value.length;
  $('captureTitle').textContent=$('recordId').value?'編輯名片':'拍攝名片';$('draftStatus').textContent='已復原尚未完成的草稿';
}
async function switchScope(profile,folder){
  state.switching=true;
  try {
  await saveDraft();state.ready=false;state.photoGeneration++;state.detailGeneration++;
  $('detailDialog').close();$('confirmDialog').close();state.confirmAction=null;
  state.profile=profile;state.rootFolderId=folder;state.scope=`${profile?.permissionId||'local'}|${folder}`;
  state.snapshot={};state.pending=[];state.lastSync='';state.activeRecord=null;state.activeVendor=null;
  resetForm();const cached=await S.get('scoped',state.scope);
  if(cached){state.snapshot=cached.snapshot||{};state.lastSync=cached.lastSync||'';if(state.repo)state.repo.cache=cached.fileCache||{};}
  await refreshLocal();await loadDraft();state.ready=true;renderAll();
  } finally { state.switching=false; }
}
async function refreshLocal(){const scope=state.scope;const pending=await S.pending(scope);if(scope!==state.scope)return;state.pending=pending.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));state.view=D.build(state.snapshot,state.pending);state.index=state.view.index;}
function renderAll(){renderRecords();renderCategoryManager();renderCategoryPicker();updatePendingCount();updateConnectionUi();renderQueue();}
async function updatePendingCount(){$('pendingCount').textContent=state.pending.length;}
function managedCategories(){return state.index.categories||[];}
function renderQueue(){
  $('pendingList').innerHTML=state.pending.map(op=>`<div class="queue-item"><div><strong>${escapeHtml(op.kind==='record'?`${op.record.vendorName}／${op.record.contactName}`:`分類：${op.name}`)}</strong><small>${escapeHtml(op.status==='conflict'?'版本已變更，請確認保留哪份內容':op.error||'已保存在本機，等待上傳')}</small></div><div class="queue-actions"><button type="button" class="text-btn" data-retry="${escapeHtml(op.id)}">${op.status==='conflict'?'保留本機':'重試'}</button>${op.status==='conflict'?`<button type="button" class="text-btn" data-discard="${escapeHtml(op.id)}">採用雲端</button>`:''}</div></div>`).join('')||'<p class="settings-footnote">目前沒有待同步項目。</p>';
  $('pendingList').querySelectorAll('[data-retry]').forEach(b=>b.onclick=()=>retryPending(b.dataset.retry));
  $('pendingList').querySelectorAll('[data-discard]').forEach(b=>b.onclick=()=>confirmDo('採用雲端版本？','會捨棄這筆尚未同步的本機修改；Drive 目前內容與歷史修訂保持不變。',async()=>{if(state.syncing)throw new Error('請等待同步完成後再處理');await S.remove('outbox',b.dataset.discard);await refreshLocal();renderAll();},'捨棄本機修改'));
  $('conflictList').innerHTML=(state.view?.conflicts||[]).map(c=>`<div class="queue-item"><span>${escapeHtml(c.heads[0].record.vendorName)}／${escapeHtml(c.heads[0].record.contactName)}：${c.heads.length} 份版本</span><button class="text-btn" type="button" data-conflict="${escapeHtml(c.id)}">檢視版本</button></div>`).join('');
  $('conflictList').querySelectorAll('[data-conflict]').forEach(b=>b.onclick=()=>openConflict(b.dataset.conflict));
  $('deletedList').innerHTML=(state.view?.deleted||[]).map(r=>`<div class="queue-item"><span>${escapeHtml(r.vendorName)}／${escapeHtml(r.contactName)}</span><button type="button" class="text-btn" data-restore="${escapeHtml(r.id)}">復原</button></div>`).join('')||'<p class="settings-footnote">沒有已封存名片。</p>';
  $('deletedList').querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>{const r=state.view.deleted.find(r=>r.id===b.dataset.restore);confirmDo('復原名片？',`${r.vendorName}／${r.contactName}`,async()=>{await queueRecord(r,'upsert',null,r._heads);if(state.connected)await syncNow();});});
  $('categorySyncNote').textContent=state.pending.some(p=>p.kind==='category')?'分類已保存在本機，等待同步。':'分類選單與目前帳號、資料夾同步。';
  $('lastSyncText').textContent=formatTime(state.lastSync);
}
async function addManagedCategory(raw,selectAfter=false){
  const name=D.normalize(raw);if(!name||name.length>30){toast('請輸入 1～30 字的分類名稱','error');return '';}
  const canonical=managedCategories().find(c=>D.key(c)===D.key(name));
  if(canonical){if(selectAfter)selectCategory(canonical);return canonical;}
  try{await queueCategory(name,'add');$('manageCategoryInput').value='';if(selectAfter)selectCategory(name);toast('分類已新增');return name;}
  catch(e){toast(humanizeError(e),'error');return '';}
}
async function quickAddCategory(){await addManagedCategory($('category').value,true);}
function requestRemoveCategory(name){confirmDo('刪除分類？',`從選單移除「${name}」；既有名片保留原分類。`,()=>queueCategory(name,'remove'),'刪除分類');}
async function queueCategory(name,action){
  if(state.updateLocked)throw new Error('正在套用更新');
  await S.enqueue({id:uid(),kind:'category',scope:state.scope,name:D.normalize(name),action,status:'pending',createdAt:nowIso()});
  await refreshLocal();renderAll();if(state.connected&&navigator.onLine)void syncNow(false);
}
function getFormRecord(){
  const old=state.editRecord||{},time=nowIso();
  return D.record({...old,id:$('recordId').value||uid(),vendorName:D.normalize($('vendorName').value),contactName:$('contactName').value.trim(),phone:$('phone').value.trim(),
    email:$('email').value.trim(),category:D.normalize($('category').value)||managedCategories()[0]||'',jobTitle:$('jobTitle').value.trim(),notes:$('notes').value.trim(),
    favorite:$('favorite').checked,createdAt:old.createdAt||time,updatedAt:time});
}
async function queueRecord(record,action='upsert',blob=null,parents=[],clearDraft=false){
  if(state.updateLocked)throw new Error('正在套用更新');
  if(state.pending.some(p=>p.kind==='record'&&p.record.id===record.id))throw new Error('此名片尚有待同步修改，請先到設定處理');
  const op={id:uid(),schemaVersion:2,kind:'record',scope:state.scope,action,record:D.record({...record,updatedAt:nowIso()}),photoBlob:blob,parents:[...parents],createdAt:nowIso(),status:'pending'};
  await draftChain.catch(()=>{});await S.enqueue(op,clearDraft?draftKey():false);await refreshLocal();renderAll();
  return op;
}
async function saveForm(event){
  event.preventDefault();if(state.saving||state.updateLocked||state.photoLoading||state.switching||!validateForm())return;
  const category=D.normalize($('category').value),known=managedCategories().find(c=>D.key(c)===D.key(category));
  if(category&&!known&&category!==state.editRecord?.category){openCategoryMenu();return toast('請從選單選擇分類，或按「新增」建立此分類','error');}
  if(known)$('category').value=known;
  state.saving=true;$('saveCardBtn').disabled=true;
  try{const r=getFormRecord();await queueRecord(r,'upsert',state.photoBlob,state.editBase,true);resetForm();showPage('info');toast('資料已保存在本機，等待同步');}
  catch(e){toast(humanizeError(e,'儲存失敗，請保留目前表單'),'error');}
  finally{state.saving=false;$('saveCardBtn').disabled=false;}
  if(state.connected&&navigator.onLine)void syncNow(false);
}
async function retryPending(id){
  const op=state.pending.find(p=>p.id===id);if(!op)return;
  if(op.status==='conflict'){
    const heads=(state.view.cloudHeads[op.record.id]||[]).map(r=>r.id);
    confirmDo('保留這份本機修改？',`本機內容：${op.record.contactName}／${op.record.phone||op.record.email}。將它作為新修訂；雲端舊修訂仍會保留。取消後可查看雲端版本。`,async()=>{
      const replacement={...op,id:uid(),parents:heads,ids:{},folderId:'',status:'pending',error:'',createdAt:nowIso()};
      await S.transaction(['outbox'], 'readwrite',tx=>{tx.objectStore('outbox').put(replacement);tx.objectStore('outbox').delete(op.id);});
      await refreshLocal();renderAll();await syncNow();
    },'保留本機修改');return;
  }
  if(!state.connected){showPage('settings');connectDrive();return;}
  await syncNow();
}
function openConflict(id){
  const conflict=state.view.conflicts.find(c=>c.id===id);if(!conflict)return;
  $('conflictOptions').innerHTML=conflict.heads.map((rev,i)=>`<section class="conflict-version"><h3>版本 ${i+1}${rev.action==='delete'?'（封存）':''}</h3><p>${escapeHtml(rev.record.vendorName)}／${escapeHtml(rev.record.contactName)}</p><p>${escapeHtml(rev.record.phone)} ${escapeHtml(rev.record.email)}</p><p>${escapeHtml(rev.record.category)}・${escapeHtml(rev.record.jobTitle)}</p><p>${escapeHtml(rev.record.notes)}</p><small>${escapeHtml(rev.record.updatedAt)}</small><button class="btn btn-secondary btn-block" type="button" data-version="${i}">採用此版本</button></section>`).join('');
  $('conflictOptions').querySelectorAll('[data-version]').forEach(b=>b.onclick=()=>{
    const rev=conflict.heads[Number(b.dataset.version)];$('conflictDialog').close();
    confirmDo('確認合併版本？','採用選定內容作為新修訂，所有歷史版本仍保留在 Drive。',async()=>{await queueRecord(rev.record,rev.action,null,conflict.heads.map(r=>r.id));await syncNow();});
  });$('conflictDialog').showModal();
}
async function syncNow(showMessage=true){
  if(state.syncing||state.updateLocked)return false;
  if(!state.connected||!state.repo||!navigator.onLine){if(showMessage)toast('待同步資料已保留，請連線後重試','error');return false;}
  state.syncing=true;setSyncState('syncing','同步中');const repo=state.repo,scope=state.scope;
  const run=async()=>{
    const snapshot=await repo.load();if(state.scope!==scope)throw new Error('儲存位置已切換');
    state.snapshot=snapshot;
    const save=op=>S.put('outbox',op);
    const items=(await S.pending(scope)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    let errors=0;
    for(const op of items){
      if(state.scope!==scope||repo.closed)throw new Error('儲存位置已切換');
      const collection=op.kind==='record'?snapshot.revisions:snapshot.categoryOps;
      if(collection.some(r=>r.id===op.id)){await S.remove('outbox',op.id);continue;}
      if(op.kind==='record'){
        const heads=(D.build(snapshot).cloudHeads[op.record.id]||[]).map(r=>r.id);
        if(!D.sameHeads(heads,op.parents)){op.status='conflict';op.error='雲端版本已變更';await save(op);errors++;continue;}
      }
      try{
        op.status='uploading';op.error='';await save(op);
        const payload=await repo.upload(op,save);collection.push(payload);
        // The local snapshot and queue removal commit together after Drive confirms the immutable entry.
        await S.transaction(['outbox','scoped'], 'readwrite',tx=>{
          tx.objectStore('scoped').put({snapshot,fileCache:repo.cache,lastSync:state.lastSync},scope);tx.objectStore('outbox').delete(op.id);
        });
      }catch(e){op.status='failed';op.error=humanizeError(e,'上傳失敗，可重試');await save(op);errors++;if(e.status===401||/401|授權已過期/.test(e.message))throw e;}
    }
    state.lastSync=nowIso();await S.put('scoped',{snapshot,fileCache:repo.cache,lastSync:state.lastSync},scope);
    await refreshLocal();renderAll();
    if(showMessage||errors)toast(errors?`同步未全部完成：${errors} 筆需要處理`:'名片與分類已同步',errors?'error':'');
    return !errors;
  };
  try{return navigator.locks?await navigator.locks.request(`vcm-sync:${scope}`,run):await run();}
  catch(e){if(/401|授權已過期/.test(e.message)){state.connected=false;state.token='';sessionStorage.removeItem('vcm.session');repo.close();}
    toast(humanizeError(e,'同步失敗；本機資料已保留'),'error');await refreshLocal().catch(()=>{});renderAll();return false;}
  finally{state.syncing=false;updateConnectionUi();}
}
async function saveDriveSettings(){
  if(hasWork())return toast('請等待目前工作完成');
  const clientId=$('clientIdInput').value.trim(),folderUrl=canonicalDriveFolderUrl($('driveFolderInput').value);
  if(clientId&&!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId))return toast('Client ID 格式不正確','error');
  if(!folderUrl)return toast('請填入有效的 Drive 資料夾網址或 ID','error');
  state.switching=true;
  try {
  const changed=clientId!==prefs.clientId||folderUrl!==canonicalDriveFolderUrl(prefs.driveFolderUrl);
  if(changed){await saveDraft();state.repo?.close();state.repo=null;state.connected=false;state.token='';state.rootFolderName='';sessionStorage.removeItem('vcm.session');localStorage.removeItem('vcm.lastProfile');}
  prefs.clientId=clientId;prefs.driveFolderUrl=folderUrl;
  if(changed)await switchScope(null,parseDriveFolderId(folderUrl));
  prepareGoogle();updateDriveLocationUi();updateConnectionUi();toast('連線設定已儲存；原位置的待同步資料仍保留');
  } finally { state.switching=false; }
}
function prepareGoogle(){
  clearTimeout(googleTimer);tokenClient=null;
  const until=Date.now()+10000;
  const attempt=()=>{
    if(!prefs.clientId)return;
    if(!window.google?.accounts?.oauth2){if(Date.now()<until)googleTimer=setTimeout(attempt,200);else $('driveStatusText').textContent='Google 登入元件尚未載入，請檢查網路後重試';return;}
    const client=google.accounts.oauth2.initTokenClient({client_id:prefs.clientId,scope:DRIVE_SCOPE,
      callback:response=>{const a=authAttempt;if(!a||a.client!==client)return;response.error?a.reject(new Error(response.error)):a.resolve(response);},
      error_callback:error=>{if(authAttempt?.client===client)authAttempt.reject(new Error(error.type||'Google 登入未完成'));}});
    tokenClient=client;
  };attempt();
}
function connectDrive(interactive=true){
  if(hasWork()||state.updateLocked)return;
  if(!prefs.clientId){showPage('settings');return toast('請先填入並儲存 Google OAuth Client ID','error');}
  if($('clientIdInput').value.trim()!==prefs.clientId||canonicalDriveFolderUrl($('driveFolderInput').value)!==canonicalDriveFolderUrl(prefs.driveFolderUrl))return toast('請先按「儲存連線設定」','error');
  if(!navigator.onLine)return toast('目前離線，請恢復網路後再登入','error');
  if(!tokenClient){prepareGoogle();return toast('Google 登入元件載入中，請稍後再點一次','error');}
  state.authInFlight=true;setSyncState('syncing','連線中');
  // requestAccessToken is invoked synchronously in the button click to preserve iOS user activation.
  const client=tokenClient;
  const promise=new Promise((resolve,reject)=>{authAttempt={resolve,reject,client};});
  const timer=setTimeout(()=>{authAttempt?.reject(new Error('Google 登入逾時，請重試'));},60000);
  try{client.requestAccessToken({prompt:'',...(state.profile?.emailAddress?{hint:state.profile.emailAddress}:{})});}
  catch(e){authAttempt.reject(e);}
  promise.then(r=>acceptToken(r.access_token,Date.now()+(Number(r.expires_in)||3600)*1000-60000))
    .catch(e=>{toast(humanizeError(e,'Google 登入未完成'),'error');})
    .finally(()=>{clearTimeout(timer);authAttempt=null;state.authInFlight=false;prepareGoogle();updateConnectionUi();if(state.connected)void syncNow(false);});
}
async function acceptToken(token,expiresAt){
  const repo=new VcmDrive(token,parseDriveFolderId(prefs.driveFolderUrl),expiresAt);
  const {user,folder}=await repo.verify();await saveDraft();state.repo?.close();state.repo=repo;
  state.token=token;state.tokenExpiresAt=expiresAt;state.connected=true;state.rootFolderName=folder.name;
  if(state.scope!==`${user.permissionId}|${repo.root}`)await switchScope(user,repo.root);
  else{state.profile=user;const cached=await S.get('scoped',state.scope);repo.cache=cached?.fileCache||{};}
  sessionStorage.setItem('vcm.session',JSON.stringify({token,expiresAt,clientId:prefs.clientId,profile:user.permissionId,folder:repo.root}));
  localStorage.setItem('vcm.lastProfile',JSON.stringify(user));updateConnectionUi();updateDriveLocationUi();await updateImportStatus();
}
async function scheduleAutomaticConnect(){
  if(!prefs.autoConnect||state.connected||state.authInFlight||!navigator.onLine)return;
  let session;try{session=JSON.parse(sessionStorage.getItem('vcm.session')||'null');}catch{}
  if(!session||session.clientId!==prefs.clientId||session.folder!==parseDriveFolderId(prefs.driveFolderUrl)||session.expiresAt<=Date.now()){updateConnectionUi();return;}
  state.authInFlight=true;
  try{await acceptToken(session.token,session.expiresAt);}
  catch(e){sessionStorage.removeItem('vcm.session');toast(humanizeError(e,'自動連線未完成'),'error');}
  finally{state.authInFlight=false;updateConnectionUi();}
  if(state.connected)await syncNow(false);
}
async function disconnectDrive(){
  if(hasWork())return toast('請等待目前工作完成再中斷連線');
  state.switching=true;
  try {
  await saveDraft();state.repo?.close();state.repo=null;state.token='';state.connected=false;state.rootFolderName='';
  sessionStorage.removeItem('vcm.session');localStorage.removeItem('vcm.lastProfile');
  await switchScope(null,parseDriveFolderId(prefs.driveFolderUrl));updateDriveLocationUi();await updateImportStatus();toast('已登出；此裝置上的原帳號資料仍保留並隔離');
  } finally { state.switching=false; }
}
function updateConnectionUi(){
  const on=state.connected&&state.token;
  $('connectionBanner').hidden=!!on;$('driveStatusText').textContent=on?`${state.profile?.emailAddress||state.profile?.displayName||'已登入'}・可同步名片`:state.profile?'目前顯示此帳號的離線資料，連線後可同步':'尚未登入；新資料會存入本機待認領區';
  $('connectDriveBtn').textContent=on?'重新授權':'登入／恢復 Google Drive';$('disconnectBtn').hidden=!state.profile;
  if(!state.syncing&&!state.authInFlight)setSyncState(on?'connected':'offline',on?'Drive 已連線':state.profile?'離線資料':'尚未連線');
  $('saveBtnText').textContent=on?'儲存並同步':'儲存至本機待同步';
  $('scopeLabel').textContent=`${state.profile?.emailAddress||state.profile?.displayName||'未登入（本機待認領）'}／${state.rootFolderName||state.rootFolderId}`;
}
async function updateImportStatus(){
  const legacy=await S.all('pending'),local=await S.pending(`local|${parseDriveFolderId(prefs.driveFolderUrl)}`);
  const oldCategories=localStorage.getItem('vcm.categoriesDirty')==='true';
  $('importLocalBtn').hidden=!state.connected||(!legacy.length&&!local.length&&!oldCategories);
  $('importStatus').textContent=legacy.length||local.length||oldCategories?`有 ${legacy.length+local.length} 筆未綁定帳號的待同步資料${oldCategories?'及舊版分類變更':''}；登入後可確認匯入目的地。`:'沒有待認領資料；切換帳號不會自動搬移其他帳號名片。';
}
async function importLocal(){
  if(!state.connected||hasWork())return toast('請先登入並完成同步');
  const target=state.scope;
  confirmDo('匯入待認領資料？',`目的帳號：${state.profile.emailAddress||state.profile.displayName}；資料夾：${state.rootFolderName}（${state.rootFolderId}）。會匯入待同步名片與舊版新增分類，請確認它們屬於此帳號。舊版刪除分類請於新版重新操作。`,async()=>{
    if(target!==state.scope||!state.connected)throw new Error('連線已變更，請重新確認');
    const legacy=await S.all('pending');
    for(const old of legacy){
      const op={id:uid(),kind:'record',scope:target,action:'upsert',record:D.record(old.record),photoBlob:old.photoBlob,parents:[],createdAt:nowIso(),status:'pending'};
      await S.importLegacy(old,op);
    }
    const local=await S.pending(`local|${state.rootFolderId}`);
    await S.transaction(['outbox'], 'readwrite',tx=>{for(const op of local)tx.objectStore('outbox').put({...op,scope:target});});
    if(localStorage.getItem('vcm.categoriesDirty')==='true'){
      const categories=JSON.parse(localStorage.getItem('vcm.categories')||'[]');
      if(!Array.isArray(categories))throw new Error('舊版分類格式錯誤，原資料已保留');
      for(const name of categories.map(D.normalize).filter(Boolean))await S.enqueue({id:uid(),kind:'category',scope:target,name,action:'add',status:'pending',createdAt:nowIso()});
      localStorage.setItem('vcm.categoriesDirty','false');
    }
    await refreshLocal();renderAll();await updateImportStatus();await syncNow();
  },'確認匯入');
}
async function handlePhoto(event){
  const file=event.target.files?.[0];event.target.value='';if(!file||state.updateLocked)return;
  if(!file.type.startsWith('image/'))return toast('請選擇照片檔案','error');
  if(file.size>25*1024*1024)return toast('照片超過 25 MB，請選擇較小照片','error');
  const generation=++state.photoGeneration;state.photoLoading=true;
  try{const blob=await compressImage(file);if(generation!==state.photoGeneration)return;
    if(blob.size>5*1024*1024)throw new Error('壓縮後照片仍超過 5 MB');
    displayPhoto(blob);await saveDraft();if(prefs.autoOcr||event.target.id==='uploadInput')void runOcr(blob);
  }catch(e){toast(humanizeError(e,'照片無法讀取，HEIC 請轉為 JPEG 後重試'),'error');}
  finally{if(generation===state.photoGeneration)state.photoLoading=false;}
}
async function getOcrWorker(){
  if(ocrWorker)return ocrWorker;
  if(!window.Tesseract)throw new Error('OCR 元件尚未載入，需要網路下載');
  const epoch=ocrEpoch;
  const worker=await Tesseract.createWorker('chi_tra+eng',1,{logger:m=>{
    if(!state.ocrBusy)return;const percent=Math.round((m.progress||0)*100);
    $('ocrProgress').style.width=`${percent}%`;$('ocrPercent').textContent=`${percent}%`;
    $('ocrStatus').textContent=m.status==='recognizing text'?'正在辨識名片文字':'載入繁中與英文辨識模型…';
  }});
  if(epoch!==ocrEpoch){await worker.terminate();throw new Error('辨識工作已取消');}
  ocrWorker=worker;return ocrWorker;
}
function runOcr(blob){
  const generation=state.photoGeneration,edits={...state.fieldEdits};
  clearTimeout(ocrIdleTimer);
  const run=async()=>{
    if(generation!==state.photoGeneration)return;
    state.ocrBusy=true;$('analyzePhotoBtn').disabled=true;$('ocrPanel').hidden=false;$('ocrResultNote').hidden=true;
    let timer;
    try{
      const job=(async()=>{const worker=await getOcrWorker();return worker.recognize(blob);})();
      const result=await Promise.race([job,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('辨識逾時')),120000);})]);
      if(generation!==state.photoGeneration)return;
      const parsed=D.parseBusinessCard(result.data.text);
      for(const key of ['vendorName','contactName','phone','email','jobTitle']){
        const unchanged=(state.fieldEdits[key]||0)===(edits[key]||0);
        if(unchanged&&(!$(key).value||$(key).value===state.ocrValues[key])&&parsed[key]){$(key).value=parsed[key];state.ocrValues[key]=parsed[key];}
      }
      await saveDraft();$('ocrResultNote').textContent=`辨識完成，文字信心 ${Math.round(result.data.confidence||0)}%。公司與姓名可能辨識不準，請逐欄確認。`;
      $('ocrResultNote').hidden=false;
    }catch(e){
      ocrEpoch++;if(ocrWorker){void ocrWorker.terminate();ocrWorker=null;}
      if(generation===state.photoGeneration){$('ocrResultNote').hidden=false;$('ocrResultNote').textContent='辨識未完成，照片與已輸入資料仍保留；可重試或手動填寫。';}
    }finally{
      clearTimeout(timer);state.ocrBusy=false;$('analyzePhotoBtn').disabled=false;$('ocrPanel').hidden=true;
      ocrIdleTimer=setTimeout(()=>{if(ocrWorker&&!state.ocrBusy){void ocrWorker.terminate();ocrWorker=null;}},90000);
    }
  };
  ocrTail=ocrTail.catch(()=>{}).then(run);return ocrTail;
}
async function openDetail(id){
  const info=findRecord(id);if(!info)return;
  state.activeRecord=info.record;state.activeVendor=info.vendor;const r=info.record,generation=++state.detailGeneration,scope=state.scope;
  $('detailCategory').textContent=r.category||'未分類';$('detailVendor').textContent=r.vendorName;$('detailAvatar').textContent=initials(r.contactName);$('detailName').textContent=r.contactName;$('detailJob').textContent=r.jobTitle||'未填職稱';
  $('detailFavoriteBtn').textContent=r.favorite?'★':'☆';
  $('detailPhone').href=r.phone?`tel:${r.phone.replace(/[^\d+#]/g,'')}`:'#';$('detailPhone').querySelector('small').textContent=r.phone||'無電話';$('detailPhone').classList.toggle('disabled',!r.phone);
  $('detailEmail').href=r.email?`mailto:${encodeURIComponent(r.email)}`:'#';$('detailEmail').querySelector('small').textContent=r.email||'無信箱';$('detailEmail').classList.toggle('disabled',!r.email);
  $('detailNotes').textContent=r.notes||'沒有備註';$('detailUpdated').textContent=`更新：${formatTime(r.updatedAt)}`;$('detailSyncStatus').textContent=r._conflict?'版本衝突，請到設定處理':r._pending?'本機待同步':'已同步的本機副本';
  $('editRecordBtn').disabled=r._pending||r._conflict;$('deleteRecordBtn').disabled=r._pending||r._conflict;$('detailFavoriteBtn').disabled=r._pending||r._conflict;
  $('detailPhoto').hidden=true;const loader=$('detailPhotoWrap').querySelector('.image-loader');loader.hidden=false;loader.textContent='載入名片照片…';$('detailDialog').showModal();
  if(state.detailPhotoUrl)URL.revokeObjectURL(state.detailPhotoUrl);state.detailPhotoUrl='';
  try{
    const op=state.pending.find(p=>p.kind==='record'&&p.record.id===id);
    let blob=op?.photoBlob;
    if(!blob&&r.photoFileId)blob=await S.get('scoped',`${scope}|photo:${r.photoFileId}`);
    if(!blob&&r.photoFileId&&state.connected){blob=await state.repo.photo(r.photoFileId);await S.put('scoped',blob,`${scope}|photo:${r.photoFileId}`).catch(()=>{});}
    if(generation!==state.detailGeneration||scope!==state.scope)return;
    if(blob){state.detailPhotoUrl=URL.createObjectURL(blob);$('detailPhoto').src=state.detailPhotoUrl;$('detailPhoto').hidden=false;loader.hidden=true;}
    else loader.textContent='照片尚未快取，連接 Drive 後可查看';
  }catch(e){if(generation===state.detailGeneration)loader.textContent=humanizeError(e,'照片載入失敗，請重新連線');}
}
async function editActiveRecord(){
  const r=state.activeRecord;if(!r||r._pending||r._conflict)return;
  const edit=async()=>{$('detailDialog').close();resetForm();state.editRecord=D.record(r);state.editBase=[...r._heads];
    for(const k of fields)$(k).value=k==='recordId'?r.id:r[k]||'';$('favorite').checked=!!r.favorite;$('notesCount').textContent=(r.notes||'').length;
    $('captureTitle').textContent='編輯名片';$('cameraPrompt').querySelector('strong').textContent='保留原照片或點此更換';$('cameraPrompt').querySelector('small').textContent='儲存時會保留原有照片';await saveDraft();showPage('capture');};
  if(state.photoBlob||fields.some(k=>$(k).value)){$('detailDialog').close();confirmDo('取代目前草稿？','尚未完成的表單將被這張名片取代。',edit,'開始編輯');}else await edit();
}
function requestDeleteActive(){
  const r=state.activeRecord;if(!r)return;$('detailDialog').close();
  confirmDo('封存這張名片？',`${r.vendorName}／${r.contactName} 將從名片資訊隱藏，可在設定復原。Drive 的歷史資料與照片會保留。`,async()=>{await queueRecord(r,'delete',null,r._heads);if(state.connected)await syncNow();},'封存');
}
async function toggleActiveFavorite(){
  const r=state.activeRecord;if(!r)return;
  try{await queueRecord({...r,favorite:!r.favorite},'upsert',null,r._heads);$('detailDialog').close();if(state.connected)await syncNow(false);}
  catch(e){toast(humanizeError(e),'error');}
}
async function exportBackup(){
  const pending=await S.pending(state.scope),drafts=(await S.all('drafts')).filter(d=>d.scope===state.scope);
  const encode=blob=>new Promise((resolve,reject)=>{if(!blob)return resolve(null);const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
  for(const op of pending){op.photoDataUrl=await encode(op.photoBlob);delete op.photoBlob;}
  for(const d of drafts){d.photoDataUrl=await encode(d.photoBlob);delete d.photoBlob;}
  const blob=new Blob([JSON.stringify({appVersion:APP_VERSION,exportedAt:nowIso(),scope:state.scope,snapshot:state.snapshot,pending,drafts},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`vendor-card-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已匯出資料備份；雲端照片仍存放於 Drive');
}
let updateRegistration=null,refreshing=false,prepareRequest=null,updateSaving=false;
async function readyForUpdate(){
  if(!prepareRequest||hasWork()||updateSaving)return;
  const request=prepareRequest;updateSaving=true;
  try{await saveDraft();if(prepareRequest!==request||hasWork())return;
    state.updateLocked=true;document.querySelectorAll('dialog[open]').forEach(d=>d.close());state.confirmAction=null;
    setBusy(true,'草稿已保留，正在套用更新…');$('updateStatusText').textContent='草稿已保留，正在套用新版本…';
    request.worker.postMessage({type:'UPDATE_READY',requestId:request.id});prepareRequest=null;
  }catch(e){state.updateLocked=false;setBusy(false);$('updateStatusText').textContent='草稿儲存失敗，已延後更新';}
  finally{updateSaving=false;}
}
async function checkForUpdate(manual=false){
  $('checkUpdateBtn').disabled=true;
  try{
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),15000);let data;
    try{const r=await fetch(`./version.json?t=${Date.now()}`,{cache:'no-store',signal:ctrl.signal});if(!r.ok)throw new Error('版本讀取失敗');data=await r.json();}finally{clearTimeout(timer);}
    $('latestVersion').textContent=`V${data.version}`;
    if(compareVersions(data.version,APP_VERSION)>0){
      $('updateStatusText').textContent='發現新版本，會在工作完成並保留草稿後更新';
      if(!updateRegistration)throw new Error('更新元件尚未就緒');await updateRegistration.update();
      updateRegistration.waiting?.postMessage({type:'PREPARE_UPDATE'});
    }else{$('updateStatusText').textContent='目前已是最新版本';if(manual)toast('目前已是最新版本');}
  }catch(e){$('updateStatusText').textContent='暫時無法檢查更新；目前版本可繼續使用';}
  finally{$('checkUpdateBtn').disabled=false;}
}
async function registerServiceWorker(){
  if(!('serviceWorker'in navigator)||location.protocol==='file:')return;
  navigator.serviceWorker.addEventListener('message',e=>{
    if(e.data?.type==='PREPARE_UPDATE'){prepareRequest={id:e.data.requestId,worker:e.source};void readyForUpdate();}
    if(e.data?.type==='UPDATE_CANCELLED'){state.updateLocked=false;setBusy(false);prepareRequest=null;$('updateStatusText').textContent='其他分頁尚在工作，稍後會再試';}
  });
  navigator.serviceWorker.addEventListener('controllerchange',async()=>{
    if(refreshing)return;refreshing=true;
    while(hasWork())await new Promise(r=>setTimeout(r,300));
    try{await saveDraft();location.reload();}catch(e){refreshing=false;state.updateLocked=false;toast('草稿未儲存，請先保留資料再重新載入','error');}
  });
  try{
    const reg=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});updateRegistration=reg;
    const prepare=worker=>{if(worker?.state==='installed'&&navigator.serviceWorker.controller)worker.postMessage({type:'PREPARE_UPDATE'});};
    reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>prepare(worker));});
    if(reg.waiting)reg.waiting.postMessage({type:'PREPARE_UPDATE'});
    setInterval(()=>{void readyForUpdate();if(!prepareRequest&&!state.updateLocked&&reg.waiting)reg.waiting.postMessage({type:'PREPARE_UPDATE'});},3000);
  }catch(e){$('updateStatusText').textContent='PWA 離線元件無法啟用，請使用 HTTPS 開啟';}
}
async function init(){
  sessionStorage.removeItem('vcm.accessToken');sessionStorage.removeItem('vcm.tokenExpiresAt');
  applyPreferences();bindEvents();$('currentVersion').textContent=`V${APP_VERSION}`;
  $('cardForm').addEventListener('input',e=>{if(e.target.id)state.fieldEdits[e.target.id]=(state.fieldEdits[e.target.id]||0)+1;saveDraftSoon();});
  $('importLocalBtn').onclick=importLocal;$('exportBackupBtn').onclick=()=>exportBackup().catch(e=>toast(humanizeError(e),'error'));
  $('closeConflictBtn').onclick=()=>$('conflictDialog').close();
  document.addEventListener('visibilitychange',()=>{if(document.hidden)saveDraftSoon();else{if(state.connected)void syncNow(false);void checkForUpdate();}});
  window.addEventListener('beforeunload',e=>{if(state.photoLoading||state.saving){e.preventDefault();e.returnValue='';}});
  window.addEventListener('unhandledrejection',e=>{console.error(e.reason);toast(humanizeError(e.reason,'操作失敗，請保留目前資料後重試'),'error');});
  // manipulation disables double-tap zoom; 16px fields avoid focus zoom on iOS.
  document.addEventListener('dblclick',e=>{if(e.target.closest('button,a,label,.photo-dropzone'))e.preventDefault();});
  const viewport=()=>{const v=window.visualViewport;document.documentElement.style.setProperty('--keyboard-inset',`${v?Math.max(0,innerHeight-v.height-v.offsetTop):0}px`);};
  window.visualViewport?.addEventListener('resize',viewport);viewport();
  try{
    let profile=null;try{profile=JSON.parse(localStorage.getItem('vcm.lastProfile')||'null');}catch{}
    await switchScope(profile,parseDriveFolderId(prefs.driveFolderUrl));await updateImportStatus();
    prepareGoogle();await registerServiceWorker();void checkForUpdate();void scheduleAutomaticConnect();
  }catch(e){$('draftStatus').textContent='本機儲存無法使用，請勿關閉未儲存資料';toast(humanizeError(e),'error');}
  const page=location.hash.slice(1);if(['info','capture','settings'].includes(page))showPage(page);
}
document.addEventListener('DOMContentLoaded',init);
