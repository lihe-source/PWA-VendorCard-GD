'use strict';

// Browser data is a scoped replica/outbox. Google Drive remains authoritative.
globalThis.VcmStorage = (() => {
  let opening;
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open('vendor-card-manager', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
        if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('scoped')) db.createObjectStore('scoped');
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('outbox')) {
          const store = db.createObjectStore('outbox', { keyPath: 'id' });
          store.createIndex('scope', 'scope');
        }
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); opening = null; };
        resolve(req.result);
      };
      req.onerror = () => { opening = null; reject(req.error); };
      req.onblocked = () => { opening = null; reject(new Error('請關閉其他舊版名片管家分頁後重試')); };
    });
    return opening;
  }
  async function transaction(names, mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('本機資料寫入失敗'));
      tx.onabort = () => reject(tx.error || new Error('本機資料寫入已取消'));
      try { action(tx, (value) => { result = value; }); } catch (error) { tx.abort(); reject(error); }
    });
  }
  const get = (name, key) => transaction([name], 'readonly', (tx, done) => { tx.objectStore(name).get(key).onsuccess = (e) => done(e.target.result); });
  const put = (name, value, key) => transaction([name], 'readwrite', (tx) => { tx.objectStore(name).put(value, key); });
  const remove = (name, key) => transaction([name], 'readwrite', (tx) => { tx.objectStore(name).delete(key); });
  const all = (name) => transaction([name], 'readonly', (tx, done) => { tx.objectStore(name).getAll().onsuccess = (e) => done(e.target.result); });
  const pending = (scope) => transaction(['outbox'], 'readonly', (tx, done) => { tx.objectStore('outbox').index('scope').getAll(scope).onsuccess = (e) => done(e.target.result); });
  // Commit the queue entry and clear the source draft together; never acknowledge request.onsuccess alone.
  const enqueue = (op, clearDraft = false) => transaction(['outbox', 'drafts'], 'readwrite', (tx) => {
    tx.objectStore('outbox').put(op);
    if (clearDraft) tx.objectStore('drafts').put({scope:op.scope,updatedAt:new Date().toISOString(),values:{}},clearDraft);
  });
  const importLegacy = (old, op) => transaction(['outbox', 'pending', 'meta'], 'readwrite', (tx) => {
    tx.objectStore('meta').put(old, `legacy-pending-backup:${old.id}`);
    tx.objectStore('outbox').put(op);
    tx.objectStore('pending').delete(old.id);
  });
  return { open, transaction, get, put, remove, all, pending, enqueue, importLegacy };
})();
