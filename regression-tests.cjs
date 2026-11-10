/* Run: node --test regression-tests.cjs (Node 22+, no installation required).
   These tests use isolated doubles, never a real account or Drive folder. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
function base(extra={}){
  const c=vm.createContext({console,URL,URLSearchParams,Headers,Request,Response,Blob,AbortController,crypto:webcrypto,
    setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t;},clearTimeout,setInterval:()=>0,clearInterval,...extra});
  vm.runInContext(source('ocr-parser.js'),c);vm.runInContext(source('data-core.js'),c);return c;
}
const r=(id='a',more={})=>({id,vendorName:'A 廠商',contactName:'王小明',phone:'0912345678',updatedAt:'2026-09-01T00:00:00Z',...more});
const rev=(id,parents=[],more={})=>({id,kind:'record',parents,action:'upsert',record:r(),createdAt:id,...more});
test('concurrent edits of different contacts both survive',()=>{
  const d=base().VcmData,v=d.build({revisions:[rev('1'),rev('2',[],{record:r('b')})]});
  assert.equal(v.index.vendors[0].contacts.length,2);assert.equal(v.conflicts.length,0);
});
test('same-contact branches remain until explicit resolution',()=>{
  const d=base().VcmData,events=[rev('1'),rev('2',['1']),rev('3',['1'],{record:r('a',{phone:'0987654321'})})];
  assert.equal(d.build({revisions:events}).conflicts[0].heads.length,2);
  events.push(rev('4',['2','3']));assert.equal(d.build({revisions:events}).conflicts.length,0);
  assert.equal(events.length,4);
});
test('a tombstone hides a contact and a later revision restores it',()=>{
  const d=base().VcmData,events=[rev('1'),rev('2',['1'],{action:'delete'})];
  assert.equal(d.build({revisions:events}).deleted.length,1);assert.equal(d.build({revisions:events}).index.vendors.length,0);
  events.push(rev('3',['2']));assert.equal(d.build({revisions:events}).deleted.length,0);
});
test('category operations never erase contacts and normalize whitespace',()=>{
  const d=base().VcmData,s={revisions:[rev('1')],categories:['設備商'],categoryOps:[{kind:'category',id:'c1',name:' A　 B ',action:'add',createdAt:'1'}]};
  const view=d.build(s,[{kind:'category',id:'c2',name:'設備商',action:'remove',createdAt:'2'}]);
  assert.deepEqual([...view.index.categories],['A B']);assert.equal(view.index.vendors[0].contacts.length,1);
});
test('legacy contacts accept new revision parents without false conflict',()=>{
  const d=base().VcmData,old=r();
  const view=d.build({legacy:[old],revisions:[rev('2',[`legacy:${old.id}:${old.updatedAt}`])]});
  assert.equal(view.conflicts.length,0);assert.deepEqual([...view.cloudHeads.a.map(r=>r.id)],['2']);
});
test('OCR prioritizes TEL over FAX and separates Chinese name and title',()=>{
  const d=base().VcmData,parsed=d.parseBusinessCard('大同科技股份有限公司\n王小明 業務經理\nFAX: 04-22334455\nTEL: 04-23456789 #123\nsales@example.com');
  assert.equal(parsed.vendorName,'大同科技股份有限公司');assert.equal(parsed.contactName,'王小明');assert.equal(parsed.jobTitle,'業務經理');
  assert.equal(parsed.phone,'04-23456789 #123');assert.equal(parsed.email,'sales@example.com');
  assert.equal(d.parseBusinessCard('FAX: 04-22334455').phone,'');
});
test('Drive listing consumes every page',async()=>{
  const c=base();vm.runInContext(source('drive-store.js'),c);const drive=new c.VcmDrive('token','root',Date.now()+100000);
  let calls=0;drive.json=async url=>{calls++;return url.includes('pageToken=next')?{files:[{id:'b'}]}:{files:[{id:'a'}],nextPageToken:'next'};};
  assert.equal((await drive.list("'root' in parents")).length,2);assert.equal(calls,2);
});
test('lost upload response retries the same reserved ID and verifies 409 ownership',async()=>{
  const c=base();vm.runInContext(source('drive-store.js'),c);const drive=new c.VcmDrive('token','root',Date.now()+100000);
  let generated=0,saved=0,created=false;drive.generateId=async()=>`fixed-${++generated}`;
  const op={id:'operation'};const id=await drive.reserve(op,'entry',async()=>saved++);
  assert.equal(await drive.reserve(op,'entry',async()=>saved++),id);assert.equal(generated,1);assert.equal(saved,1);
  drive.json=async(url,options)=>{
    if(options?.method==='POST'){if(!created){created=true;throw new Error('Lost response');}const e=new Error('409');e.status=409;throw e;}
    return {parents:['root'],appProperties:{vcmOperation:'operation'}};
  };
  await assert.rejects(drive.createOnce(id,'entry.json','root',new Blob(['{}']),'application/json','operation'),/Lost/);
  assert.equal(await drive.createOnce(id,'entry.json','root',new Blob(['{}']),'application/json','operation'),id);
  await assert.rejects(drive.createOnce(id,'entry.json','root',new Blob(['{}']),'application/json','another'),/識別碼衝突/);
});
test('Drive requests bypass caches, use bounded paths and reject expired authorization',async()=>{
  let call;const c=base({fetch:async(url,options)=>{call={url,options};return new Response('{}');}});vm.runInContext(source('drive-store.js'),c);
  const drive=new c.VcmDrive('secret','root',Date.now()+100000);await drive.json('/drive/v3/files');
  assert.equal(call.options.cache,'no-store');assert.equal(call.options.headers.Authorization,'Bearer secret');
  await assert.rejects(drive.json('https://evil.example/'),/API/);drive.expiresAt=0;await assert.rejects(drive.json('/drive/v3/files'),/401/);
});
function worker(){
  const listeners={},deleted=[];
  const c=base({self:{registration:{scope:'https://user.github.io/cards/'},location:{origin:'https://user.github.io'},
    clients:{claim:async()=>{},matchAll:async()=>[]},addEventListener:(type,fn)=>listeners[type]=fn,skipWaiting:async()=>{}},
    caches:{keys:async()=>['another-app-cache','vendor-card-manager-%2Fother%2F-v1.2.0','vendor-card-manager-%2Fcards%2F-v1.2.0'],delete:async key=>deleted.push(key)}});
  vm.runInContext(source('sw.js'),c);return {listeners,deleted,c};
}
test('SW ignores Drive, OAuth and unrelated same-origin requests',()=>{
  const {listeners}=worker();let handled=false;
  for(const url of ['https://www.googleapis.com/drive/v3/files/x?alt=media','https://accounts.google.com/gsi/client','https://user.github.io/other/data.json']){
    listeners.fetch({request:new Request(url),respondWith:()=>handled=true});assert.equal(handled,false);
  }
  listeners.fetch({request:new Request('https://user.github.io/cards/app.js',{headers:{Authorization:'Bearer token'}}),respondWith:()=>handled=true});assert.equal(handled,false);
});
test('SW only deletes obsolete caches within this app scope',async()=>{
  const {listeners,deleted}=worker();let done;listeners.activate({waitUntil:p=>done=p});await done;
  assert.deepEqual(deleted,['vendor-card-manager-%2Fcards%2F-v1.2.0']);
});
test('SW waits for every open tab to acknowledge draft preservation',async()=>{
  const {listeners,c}=worker();const sent=[];let activated=false;
  c.self.clients.matchAll=async()=>['a','b'].map(id=>({id,url:'https://user.github.io/cards/index.html',postMessage:m=>sent.push({id,m})}));
  c.self.skipWaiting=async()=>{activated=true;};let preparation;
  listeners.message({data:{type:'PREPARE_UPDATE'},waitUntil:p=>preparation=p});await new Promise(resolve=>setImmediate(resolve));
  const requestId=sent[0].m.requestId;
  listeners.message({data:{type:'UPDATE_READY',requestId},source:{id:'a'}});assert.equal(activated,false);
  listeners.message({data:{type:'UPDATE_READY',requestId},source:{id:'b'},waitUntil:()=>{}});await preparation;assert.equal(activated,true);
});
function runtime(){
  const elements=new Map();
  function element(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,checked:false,disabled:false,style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},addEventListener(){},querySelector(){return element(id+'-child');},querySelectorAll(){return [];},reset(){for(const el of elements.values())el.value='';},close(){},showModal(){},focus(){}});return elements.get(id);}
  const stores={outbox:new Map(),drafts:new Map(),scoped:new Map(),meta:new Map(),pending:new Map()},storage=new Map();
  const S={get:async(n,k)=>stores[n].get(k),put:async(n,v,k)=>stores[n].set(k||v.id,structuredClone(v)),remove:async(n,k)=>stores[n].delete(k),all:async n=>[...stores[n].values()],
    pending:async scope=>[...stores.outbox.values()].filter(p=>p.scope===scope),enqueue:async(op,key)=>{stores.outbox.set(op.id,structuredClone(op));if(key)stores.drafts.delete(key);},
    transaction:async(names,mode,fn)=>fn({objectStore:n=>({put:(v,k)=>stores[n].set(k||v.id,structuredClone(v)),delete:k=>stores[n].delete(k)})})};
  const c=base({VcmStorage:S,document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){},body:{classList:{toggle(){}}}},
    navigator:{onLine:true},location:{hash:'',protocol:'https:'},window:{scrollTo(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},structuredClone});
  c.window=c;vm.runInContext(source('ui.js'),c);vm.runInContext(source('drive-store.js'),c);vm.runInContext(source('app.js'),c);vm.runInContext(source('capture.js'),c);
  vm.runInContext("renderAll=()=>{};renderRecords=()=>{};renderCategoryManager=()=>{};renderCategoryPicker=()=>{};updateConnectionUi=()=>{};showPage=()=>{};toast=(message)=>globalThis.lastToast=message;state.scope='account|folder';state.ready=true;",c);
  return {c,element,stores,run:code=>vm.runInContext(code,c)};
}
test('a valid save is committed to the outbox before network synchronization',async()=>{
  const t=runtime();t.element('vendorName').value='A';t.element('contactName').value='王小明';t.element('phone').value='0912345678';
  await t.run("validateForm=()=>true;state.photoBlob=new Blob(['image'],{type:'image/jpeg'});saveForm({preventDefault(){}})");
  assert.equal(t.stores.outbox.size,1);assert.equal([...t.stores.outbox.values()][0].photoBlob.size,5);
  assert.equal([...t.stores.outbox.values()][0].scope,'account|folder');
});
test('failed upload stays queued and sync reports failure',async()=>{
  const t=runtime(),op={...rev('1'),scope:'account|folder',status:'pending'};t.stores.outbox.set(op.id,op);
  t.c.repo={cache:{},load:async()=>({revisions:[],categoryOps:[]}),upload:async()=>{throw new Error('NetworkError');}};
  assert.equal(await t.run('state.repo=repo;state.connected=true;state.token="token";syncNow(true)'),false);
  assert.equal(t.stores.outbox.get('1').status,'failed');assert.match(t.c.lastToast,/未全部完成/);
});
test('committed remote operation removes its queue item without another upload',async()=>{
  const t=runtime(),op={...rev('1'),scope:'account|folder',status:'failed'};t.stores.outbox.set(op.id,op);let uploads=0;
  t.c.repo={cache:{},load:async()=>({revisions:[op],categoryOps:[]}),upload:async()=>uploads++};
  assert.equal(await t.run('state.repo=repo;state.connected=true;state.token="token";syncNow(true)'),true);
  assert.equal(uploads,0);assert.equal(t.stores.outbox.size,0);
});
test('stale edit becomes a visible conflict and is never uploaded silently',async()=>{
  const t=runtime(),op={...rev('2',['1']),scope:'account|folder',status:'pending'};t.stores.outbox.set(op.id,op);let uploads=0;
  t.c.repo={cache:{},load:async()=>({revisions:[rev('1'),rev('3',['1'])],categoryOps:[]}),upload:async()=>uploads++};
  assert.equal(await t.run('state.repo=repo;state.connected=true;state.token="token";syncNow(true)'),false);
  assert.equal(uploads,0);assert.equal(t.stores.outbox.get('2').status,'conflict');
});
test('scope reads never include another account or folder pending data',async()=>{
  const t=runtime();for(const scope of ['account|folder','other|folder','account|other'])t.stores.outbox.set(scope,{...rev(scope),scope});
  await t.run('refreshLocal()');assert.equal(t.run('state.pending.length'),1);assert.equal(t.run('state.pending[0].scope'),'account|folder');
});
test('draft includes the photo and preserves field values',async()=>{
  const t=runtime();t.element('contactName').value='王小明';await t.run("state.photoBlob=new Blob(['draft']);saveDraft()");
  const draft=[...t.stores.drafts.values()][0];assert.equal(draft.values.contactName,'王小明');assert.equal(draft.photoBlob.size,5);
});
test('late OCR result from a replaced photo cannot populate the current form',async()=>{
  const t=runtime();let resolve;const deferred=new Promise(r=>resolve=r);
  t.c.Tesseract={createWorker:async()=>({setParameters:async()=>{},recognize:()=>deferred,terminate:async()=>{}})};
  const work=t.run("runOcr(new Blob(['old']))");await new Promise(r=>setImmediate(r));t.run('state.photoGeneration++');
  resolve({data:{text:'大同科技股份有限公司\n王小明\nTEL: 04-23456789',confidence:90}});await work;
  assert.equal(t.element('contactName').value,'');
});
test('OCR preserves manual input made while recognition is running',async()=>{
  const t=runtime();let resolve;const deferred=new Promise(r=>resolve=r);t.c.Tesseract={createWorker:async()=>({setParameters:async()=>{},recognize:()=>deferred,terminate:async()=>{}})};
  const work=t.run("runOcr(new Blob(['image']))");await new Promise(r=>setImmediate(r));t.element('contactName').value='陳大文';t.run('state.fieldEdits.contactName=1');
  resolve({data:{text:'大同科技股份有限公司\n王小明\nTEL: 04-23456789',confidence:90}});await work;assert.equal(t.element('contactName').value,'陳大文');
});
test('all local HTML assets and manifest icons exist, IDs are unique',()=>{
  const html=source('index.html'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
  for(const m of html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g))assert.ok(fs.existsSync(path.join(__dirname,m[1])),m[1]);
  const manifest=JSON.parse(source('manifest.webmanifest'));for(const icon of manifest.icons)assert.ok(fs.existsSync(path.join(__dirname,icon.src)));
  assert.equal(JSON.parse(source('version.json')).version,'1.4.0');
  for(const file of ['app.js','ui.js'])for(const m of source(file).matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(m[1]),`${file}: missing ${m[1]}`);
});
test('IndexedDB request success does not acknowledge a transaction that later aborts',async()=>{
  let tx,request;
  const db={transaction:()=>{
    tx={objectStore:()=>({put:()=>{request={};return request;}})};return tx;
  }};
  const c=base({indexedDB:{open:()=>{const r={result:db};setImmediate(()=>r.onsuccess());return r;}}});
  vm.runInContext(source('storage.js'),c);
  let resolved=false;const work=c.VcmStorage.put('outbox',{id:'a'}).then(()=>{resolved=true;});
  await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
  request.onsuccess?.({target:{result:'a'}});await Promise.resolve();assert.equal(resolved,false);
  const rejection=assert.rejects(work,/Quota/);tx.error=new Error('Quota exceeded');tx.onabort();await rejection;assert.equal(resolved,false);
});
test('mobile OAuth request happens synchronously inside the initiating call',async()=>{
  const t=runtime();let requested=false;
  t.c.client={requestAccessToken:()=>{requested=true;throw new Error('popup_closed');}};
  t.run("prefs.clientId='123-example.apps.googleusercontent.com';$('clientIdInput').value=prefs.clientId;$('driveFolderInput').value=prefs.driveFolderUrl;tokenClient=client;connectDrive();");
  assert.equal(requested,true);await new Promise(r=>setImmediate(r));assert.equal(t.run('state.authInFlight'),false);
});
test('an in-flight old-scope read cannot replace the newly selected account view',async()=>{
  const t=runtime();let resolve;t.c.VcmStorage.pending=()=>new Promise(r=>resolve=r);
  const work=t.run('refreshLocal()');t.run("state.scope='other|folder';state.pending=[];");resolve([{...rev('old'),scope:'account|folder'}]);
  await work;assert.equal(t.run('state.pending.length'),0);
});
test('TEL and FAX on a shared line are kept separate',()=>{
 const o=base().VcmOcr.analyze([{text:'FAX: 04-22334455 TEL: 04-23456789 #123',confidence:90}]);
 assert.equal(o.suggested.phone,'04-23456789 #123');assert.equal(o.candidates.phone.length,1);
});
test('shared phone and email line yields both candidates',()=>{
 const o=base().VcmOcr.analyze([{text:'TEL: 04-23456789 sales@example.com',confidence:90}]);
 assert.equal(o.suggested.phone,'04-23456789');assert.equal(o.suggested.email,'sales@example.com');
});
test('uncertain digits are suggestions only, never automatically corrected',()=>{
 const o=base().VcmOcr.analyze([{text:'TEL: O4-23456789',confidence:95}]);
 assert.equal(o.suggested.phone,'04-23456789');assert.equal(o.automatic.phone,undefined);assert.equal(o.candidates.phone[0].corrected,true);
});
test('conflicting readings suppress automatic phone filling',()=>{
 const o=base().VcmOcr.analyze([{text:'Mobile: 0912-345-678',confidence:95},{text:'Mobile: 0912-345-679',confidence:95}]);
 assert.equal(o.candidates.phone.length,2);assert.equal(o.automatic.phone,undefined);
});
test('low confidence and generic Chinese phrases are not blindly auto-filled',()=>{
 const o=base().VcmOcr.analyze([{text:'專業服務\n姓名: 王小明\n範例科技有限公司\nTEL: 04-23456789',confidence:35}]);
 assert.equal(o.suggested.contactName,'王小明');assert.equal(Object.keys(o.automatic).length,0);
});
test('spaced Chinese name and adjacent title are parsed independently',()=>{
 const o=base().VcmOcr.mergeText('王 小 明 業務經理');assert.equal(o.suggested.contactName,'王小明');assert.equal(o.suggested.jobTitle,'業務經理');
});
test('email separators are normalized without guessing O/0 or l/1',()=>{
 const o=base().VcmOcr.mergeText('Email: user.Ol @ example . com');assert.equal(o.suggested.email,'user.Ol@example.com');
});
test('a bare tax ID or postal address does not become a telephone',()=>{
 const o=base().VcmOcr.mergeText('統一編號 12345678\n台中市北區中清路123號');assert.equal(o.suggested.phone,undefined);
});
test('cancelling an unresolved recognition releases the busy state',async()=>{
 const t=runtime();let terminated=0;t.c.Tesseract={createWorker:async()=>({setParameters:async()=>{},recognize:()=>new Promise(()=>{}),terminate:async()=>terminated++})};
 const work=t.run("runOcr(new Blob(['test']))");await new Promise(r=>setImmediate(r));t.run('cancelOcr()');await work;
 assert.equal(t.run('state.ocrBusy'),false);assert.equal(terminated,1);
});
test('completed OCR reuses its worker for the next recognition',async()=>{
 const t=runtime();let count=0;t.element('ocrMode').value='quick';
 t.c.Tesseract={createWorker:async()=>{count++;return {setParameters:async()=>{},recognize:async()=>({data:{text:'範例科技有限公司\nsales@example.com',confidence:95}}),terminate:async()=>{}};}};
 await t.run("runOcr(new Blob(['first']))");await t.run("runOcr(new Blob(['second']))");assert.equal(count,1);
 assert.equal(t.element('vendorName').value,'範例科技有限公司');assert.equal(t.run('state.ocrNeedsReview'),true);
});
test('OCR never replaces an existing manually filled company name',async()=>{
 const t=runtime();t.element('vendorName').value='已核對公司';t.element('ocrMode').value='quick';
 t.c.Tesseract={createWorker:async()=>({setParameters:async()=>{},recognize:async()=>({data:{text:'其他科技有限公司',confidence:99}}),terminate:async()=>{}})};
 await t.run("runOcr(new Blob(['photo']))");assert.equal(t.element('vendorName').value,'已核對公司');
});
test('unreviewed OCR data cannot be submitted to the outbox',async()=>{
 const t=runtime();t.element('ocrReviewPanel').scrollIntoView=()=>{};
 await t.run("state.ocrNeedsReview=true;saveForm({preventDefault(){}})");assert.equal(t.stores.outbox.size,0);assert.match(t.c.lastToast,/已核對/);
});
