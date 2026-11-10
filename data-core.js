'use strict';
// Pure reducers: cloud revisions are immutable; only a new revision can resolve branches.
globalThis.VcmData = (() => {
  const defaults = ['設備商', '材料商', '外包商', '顧問／服務', '客戶', '物流', '其他'];
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const key = value => normalize(value).toLocaleLowerCase('zh-TW');
  const strings = ['vendorName','contactName','phone','email','category','jobTitle','notes','photoFileId','folderId','createdAt','updatedAt'];
  function record(input) {
    if (!input || typeof input.id !== 'string' || !input.id || input.id.length > 160) throw new Error('名片資料格式不正確');
    const out = { id: input.id, favorite: !!input.favorite };
    for (const field of strings) out[field] = String(input[field] || '').slice(0, field === 'notes' ? 5000 : 500);
    out.vendorName = normalize(out.vendorName); out.category = normalize(out.category);
    return out;
  }
  const order = (a,b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id));
  function build(snapshot = {}, pending = []) {
    const groups = new Map();
    const add = rev => {
      if (!rev || typeof rev.id !== 'string' || !Array.isArray(rev.parents) || !['upsert','delete'].includes(rev.action)) throw new Error('修訂資料格式不正確');
      const r = record(rev.record);
      if (!groups.has(r.id)) groups.set(r.id, new Map());
      groups.get(r.id).set(rev.id, { ...rev, record:r });
    };
    for (const raw of snapshot.legacy || []) {
      const r = record(raw); add({id:`legacy:${r.id}:${r.updatedAt}`,parents:[],action:'upsert',record:r,createdAt:r.updatedAt});
    }
    for (const rev of snapshot.revisions || []) add(rev);
    const cloudHeads = {};
    for (const [id,nodes] of groups) {
      const parents = new Set([...nodes.values()].flatMap(r=>r.parents));
      cloudHeads[id] = [...nodes.values()].filter(r=>!parents.has(r.id)).sort(order);
    }
    for (const op of pending.filter(op=>op.kind==='record' && op.status!=='conflict')) add(op);
    const visible = [], deleted = [], conflicts = [];
    for (const [id,nodes] of groups) {
      const parents = new Set([...nodes.values()].flatMap(r=>r.parents));
      const heads = [...nodes.values()].filter(r=>!parents.has(r.id)).sort(order);
      if (!heads.length) throw new Error('修訂資料形成循環，已停止同步');
      const chosen = heads[heads.length-1];
      const r = {...chosen.record, _heads:heads.map(r=>r.id), _conflict:heads.length>1,
        _pending:pending.some(p=>p.kind==='record' && p.record.id===id)};
      if (heads.length>1) conflicts.push({id,heads});
      if (chosen.action==='delete' && heads.length===1) deleted.push(r); else visible.push(r);
    }
    const cats = new Map();
    for (const name of Array.isArray(snapshot.categories) ? snapshot.categories : defaults) {
      if (normalize(name)) cats.set(key(name),normalize(name));
    }
    const categoryChanges = [...(snapshot.categoryOps || []),...pending.filter(p=>p.kind==='category')];
    categoryChanges.sort(order).forEach(op=>{
      if (!['add','remove'].includes(op.action) || !normalize(op.name)) throw new Error('分類修訂格式不正確');
      if(op.action==='remove')cats.delete(key(op.name)); else cats.set(key(op.name),normalize(op.name));
    });
    const vendors = new Map();
    for (const r of visible) {
      const k = key(r.vendorName);
      if (!vendors.has(k)) vendors.set(k,{name:r.vendorName,folderId:r.folderId||`local:${k}`,contacts:[]});
      vendors.get(k).contacts.push(r);
    }
    return {index:{schemaVersion:2,categories:[...cats.values()],vendors:[...vendors.values()]},cloudHeads,conflicts,deleted};
  }
  function sameHeads(a,b) { return JSON.stringify([...a].sort())===JSON.stringify([...b].sort()); }
  function parseBusinessCard(text) {
    const values=VcmOcr.mergeText(text).suggested;
    return Object.fromEntries(VcmOcr.keys.map(key=>[key,values[key]||'']));
  }
  return {normalize,key,record,build,sameHeads,parseBusinessCard,defaults};
})();
