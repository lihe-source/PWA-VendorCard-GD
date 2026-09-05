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
    const lines = String(text).normalize('NFKC').split(/\r?\n/).map(normalize).filter(Boolean);
    const email = (lines.join(' ').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[''])[0];
    const number = line => (line.match(/(?:\+?886[\s-]?)?(?:\(?0?\d{1,3}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}(?:\s*(?:#|ext\.?|分機)\s*\d+)?/gi)||[]).find(p=>p.replace(/\D/g,'').length>=8)||'';
    // A fax-only number must never be presented as the voice telephone.
    const phoneLines = lines.filter(l=>!/@|FAX|傳真/i.test(l));
    const phone = phoneLines.filter(l=>/mobile|cell|手機|行動/i.test(l)).map(number).find(Boolean)
      || phoneLines.filter(l=>/TEL|電話/i.test(l)).map(number).find(Boolean) || phoneLines.map(number).find(Boolean)||'';
    const vendorWords = /股份有限公司|有限公司|企業社|工作室|商行|科技|工業|電子|機械|精密|實業|國際|公司|集團|CO\.?\s*,?\s*LTD|CORP(?:ORATION)?|COMPANY|TECHNOLOGY|INDUSTRIES|GROUP/i;
    const vendorName = lines.find(l=>vendorWords.test(l)&&!/@|https?:|www\./i.test(l)) || '';
    const titlePattern = /董事長|總經理|副總(?:經理)?|(?:業務|採購)?經理|主任|工程師|業務|採購|專員|顧問|執行長|CEO|CFO|CTO|MANAGER|ENGINEER|SALES|DIRECTOR|SPECIALIST/i;
    const titleLine = lines.find(l=>l!==vendorName && titlePattern.test(l) && !/@|https?:|www\./i.test(l))||'';
    const candidates = lines.filter(l=>l!==vendorName&&!/@|https?:|www\.|地址|TEL|FAX|電話|手機|\d/i.test(l));
    let contactName = candidates.find(l=>/^[\u3400-\u9fff·‧]{2,5}$/.test(l)&&!titlePattern.test(l))||'';
    let jobTitle = titleLine;
    if(titleLine){
      const split = titleLine.match(/^([\u3400-\u9fff·‧]{2,5})\s+(.+)$/);
      const reverse = titleLine.match(/^(.+?)\s+([\u3400-\u9fff·‧]{2,5})$/);
      if(split&&titlePattern.test(split[2])) {contactName=contactName||split[1];jobTitle=split[2];}
      else if(reverse&&titlePattern.test(reverse[1])) {contactName=contactName||reverse[2];jobTitle=reverse[1];}
    }
    contactName = contactName || candidates.find(l=>/^[A-Z][a-z]+(?:[ -][A-Z][a-z]+){1,3}$/.test(l)&&!titlePattern.test(l))||'';
    return {vendorName,contactName,phone:phone.trim(),email,jobTitle};
  }
  return {normalize,key,record,build,sameHeads,parseBusinessCard,defaults};
})();
