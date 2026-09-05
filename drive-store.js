'use strict';
globalThis.VcmDrive = class {
  constructor(token, root, expiresAt) { this.token=token;this.root=root;this.expiresAt=expiresAt;this.controllers=new Set();this.cache={};this.folders=[]; }
  close(){this.closed=true;for(const c of this.controllers)c.abort();}
  async fetch(path,options={}) {
    if(this.closed)throw new Error('連線已切換，工作保留在原帳號');
    if(Date.now()>=this.expiresAt)throw new Error('401：Google 授權已過期');
    if(!path.startsWith('/drive/v3/')&&!path.startsWith('/upload/drive/v3/'))throw new Error('不支援的 API 路徑');
    const ctrl=new AbortController();this.controllers.add(ctrl);
    const timer=setTimeout(()=>ctrl.abort(),45000);
    try {
      const response=await fetch('https://www.googleapis.com'+path,{...options,cache:'no-store',signal:ctrl.signal,
        headers:{...options.headers,Authorization:`Bearer ${this.token}`}});
      // Read the body before clearing the timeout: stalled downloads must also expire.
      const blob=await response.blob();
      if(!response.ok){const err=new Error(`${response.status}：${(await blob.text()).slice(0,180)}`);err.status=response.status;throw err;}
      return {json:async()=>JSON.parse(await blob.text()),blob:async()=>blob};
    } catch(e) {if(e.name==='AbortError')throw new Error(this.closed?'連線已切換':'連線逾時，資料已保留，可重試');throw e;}
    finally{clearTimeout(timer);this.controllers.delete(ctrl);}
  }
  async json(path,options){return (await this.fetch(path,options)).json();}
  async list(q){
    const files=[];let pageToken='';
    do {const args=new URLSearchParams({q:`(${q}) and trashed = false`,fields:'nextPageToken,files(id,name,mimeType,modifiedTime,parents,appProperties)',pageSize:'1000',spaces:'drive',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
      if(pageToken)args.set('pageToken',pageToken);
      const data=await this.json('/drive/v3/files?'+args);files.push(...(data.files||[]));pageToken=data.nextPageToken||'';
    }while(pageToken);return files;
  }
  static quote(s){return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
  async verify(){
    const user=(await this.json('/drive/v3/about?fields=user(permissionId,emailAddress,displayName)')).user;
    if(!user?.permissionId)throw new Error('無法驗證 Google 帳號');
    const folder=await this.json(`/drive/v3/files/${encodeURIComponent(this.root)}?supportsAllDrives=true&fields=id,name,mimeType,trashed,capabilities(canAddChildren)`);
    if(folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder'||!folder.capabilities?.canAddChildren)throw new Error('指定資料夾不存在或沒有寫入權限');
    this.profile=user;this.folder=folder;return {user,folder};
  }
  async readJson(file){
    const cached=this.cache[file.id];if(cached?.modifiedTime===file.modifiedTime)return cached.data;
    const data=await this.json(`/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`);
    this.cache[file.id]={modifiedTime:file.modifiedTime,data};return data;
  }
  async load(){
    const rootFiles=await this.list(`'${VcmDrive.quote(this.root)}' in parents`);
    this.folders=rootFiles.filter(f=>f.mimeType==='application/vnd.google-apps.folder').sort((a,b)=>a.id.localeCompare(b.id));
    const snapshot={legacy:[],revisions:[],categoryOps:[],categories:[...VcmData.defaults]};
    const knownFolders=new Set(this.folders.map(f=>f.id));
    for(const file of rootFiles.filter(f=>f.name==='vendors-index.json').sort((a,b)=>String(a.modifiedTime).localeCompare(String(b.modifiedTime)))){
      const old=await this.readJson(file);if(!Array.isArray(old.vendors))throw new Error('舊版名片索引格式不正確，已停止同步');
      if(Array.isArray(old.categories))snapshot.categories=old.categories;
      for(const vendor of old.vendors){if(!knownFolders.has(vendor.folderId))continue;for(const r of vendor.contacts||[])snapshot.legacy.push({...r,vendorName:r.vendorName||vendor.name,folderId:vendor.folderId});}
    }
    const files=rootFiles.filter(f=>/^category-change-.*\.json$/.test(f.name));
    for(let i=0;i<this.folders.length;i+=20){
      const q=this.folders.slice(i,i+20).map(f=>`'${VcmDrive.quote(f.id)}' in parents`).join(' or ');
      files.push(...(await this.list(`(${q}) and mimeType = 'application/json'`)).filter(f=>/^(entry-|contact-).*\.json$/.test(f.name)));
    }
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(3,files.length)},async()=>{
      while(cursor<files.length){const f=files[cursor++];const data=await this.readJson(f);
        if(f.name.startsWith('category-change-')){if(data.kind!=='category')throw new Error('分類檔案格式不正確');snapshot.categoryOps.push(data);}
        else if(f.name.startsWith('entry-')){
          if(data.kind!=='record'||data.schemaVersion!==2||!knownFolders.has(f.parents?.[0]))throw new Error('名片修訂格式不正確');
          snapshot.revisions.push({...data,record:{...data.record,folderId:f.parents[0]}});
        }else snapshot.legacy.push({...data,folderId:f.parents[0]});
      }
    }));
    // Old contact files may be newer than their legacy index; choose deterministically.
    const legacy=new Map();for(const r of snapshot.legacy){const old=legacy.get(r.id);if(!old||String(r.updatedAt)>String(old.updatedAt))legacy.set(r.id,r);}
    snapshot.legacy=[...legacy.values()];VcmData.build(snapshot);
    const keep=new Set([...rootFiles,...files].map(f=>f.id));for(const id of Object.keys(this.cache))if(!keep.has(id))delete this.cache[id];
    return snapshot;
  }
  async generateId(){return (await this.json('/drive/v3/files/generateIds?count=1&space=drive&type=files')).ids[0];}
  async reserve(op,name,save){if(!op.ids)op.ids={};if(!op.ids[name]){op.ids[name]=await this.generateId();await save(op);}return op.ids[name];}
  async createOnce(id,name,parent,blob,mimeType,operationId){
    const metadata={id,name,parents:[parent],appProperties:{vcmOperation:operationId}};
    let path='/drive/v3/files?fields=id&supportsAllDrives=true',body,headers;
    if(mimeType==='application/vnd.google-apps.folder'){
      body=JSON.stringify({...metadata,mimeType});headers={'Content-Type':'application/json'};
    }else{
      const boundary='vcm_'+crypto.randomUUID().replaceAll('-','');
      body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,blob,`\r\n--${boundary}--`]);
      path='/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true';headers={'Content-Type':`multipart/related; boundary=${boundary}`};
    }
    try{await this.json(path,{method:'POST',headers,body});}
    catch(e){
      if(e.status!==409)throw e;
      const existing=await this.json(`/drive/v3/files/${encodeURIComponent(id)}?fields=id,parents,appProperties,trashed&supportsAllDrives=true`);
      if(existing.trashed||!existing.parents?.includes(parent)||existing.appProperties?.vcmOperation!==operationId)throw new Error('上傳識別碼衝突，請保留待同步資料');
    }
    return id;
  }
  async photo(id){
    if(!/^[\w-]+$/.test(id))throw new Error('照片識別碼格式不正確');
    const meta=await this.json(`/drive/v3/files/${id}?fields=parents,mimeType,trashed&supportsAllDrives=true`);
    if(meta.trashed||!meta.mimeType?.startsWith('image/')||!meta.parents?.some(p=>this.folders.some(f=>f.id===p)))throw new Error('照片不在目前資料夾的廠商資料內');
    return (await this.fetch(`/drive/v3/files/${id}?alt=media&supportsAllDrives=true`)).blob();
  }
  async upload(op,save){
    let parent=this.root;
    if(op.kind==='record'){
      if(!op.folderId){
        const folders=await this.list(`'${VcmDrive.quote(this.root)}' in parents and mimeType = 'application/vnd.google-apps.folder'`);
        const known=folders.filter(f=>VcmData.key(f.name)===VcmData.key(op.record.vendorName)).sort((a,b)=>a.id.localeCompare(b.id))[0];
        if(known)op.folderId=known.id;
        else{const id=await this.reserve(op,'folder',save);await this.createOnce(id,op.record.vendorName,this.root,null,'application/vnd.google-apps.folder',op.id);op.folderId=id;}
        await save(op);
      }
      parent=op.folderId;
      const parentMeta=await this.json(`/drive/v3/files/${encodeURIComponent(parent)}?fields=parents,trashed&supportsAllDrives=true`);
      if(parentMeta.trashed||!parentMeta.parents?.includes(this.root))throw new Error('廠商資料夾已移動，請先還原資料夾後重試');
      if(!this.folders.some(f=>f.id===parent))this.folders.push({id:parent,name:op.record.vendorName});
      let photoBlob=op.photoBlob;
      if(!photoBlob&&op.record.photoFileId&&op.record.folderId!==parent&&op.action!=='delete')photoBlob=await this.photo(op.record.photoFileId);
      if(photoBlob){
        const id=await this.reserve(op,'photo',save);
        await this.createOnce(id,`card-${op.id}.jpg`,parent,photoBlob,photoBlob.type||'image/jpeg',op.id);
        op.record.photoFileId=id;
      }
      op.record.folderId=parent;await save(op);
    }
    const id=await this.reserve(op,'entry',save);
    const payload=op.kind==='record'?{schemaVersion:2,kind:op.kind,id:op.id,parents:op.parents,action:op.action,record:VcmData.record(op.record),createdAt:op.createdAt}
      :{schemaVersion:2,kind:'category',id:op.id,name:op.name,action:op.action,createdAt:op.createdAt};
    await this.createOnce(id,`${op.kind==='record'?'entry':'category-change'}-${op.id}.json`,parent,new Blob([JSON.stringify(payload)],{type:'application/json'}),'application/json',op.id);
    return payload;
  }
};
