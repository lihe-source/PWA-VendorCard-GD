'use strict';

const APP_VERSION = '1.0.0';
const ROOT_FOLDER_NAME = '廠商名片管家';
const INDEX_FILE_NAME = 'vendors-index.json';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DEFAULT_CATEGORIES = ['設備商', '材料商', '外包商', '顧問／服務', '客戶', '物流', '其他'];

const $ = (id) => document.getElementById(id);
const state = {
  token: '', tokenExpiresAt: 0, rootFolderId: '', indexFileId: '',
  index: { schemaVersion: 1, updatedAt: '', vendors: [] }, photoBlob: null,
  previewUrl: '', activeRecord: null, activeVendor: null, detailPhotoUrl: '',
  favoriteOnly: false, connected: false, syncing: false, confirmAction: null,
};

const prefs = {
  get clientId() { return localStorage.getItem('vcm.clientId') || ''; },
  set clientId(v) { localStorage.setItem('vcm.clientId', v); },
  get autoOcr() { return localStorage.getItem('vcm.autoOcr') !== 'false'; },
  set autoOcr(v) { localStorage.setItem('vcm.autoOcr', String(v)); },
  get dark() { return localStorage.getItem('vcm.dark') === 'true'; },
  set dark(v) { localStorage.setItem('vcm.dark', String(v)); },
  get lastConnected() { return localStorage.getItem('vcm.lastConnected') === 'true'; },
  set lastConnected(v) { localStorage.setItem('vcm.lastConnected', String(v)); },
  get rootFolderId() { return localStorage.getItem('vcm.rootFolderId') || ''; },
  set rootFolderId(v) { localStorage.setItem('vcm.rootFolderId', v); },
  get lastSync() { return localStorage.getItem('vcm.lastSync') || ''; },
  set lastSync(v) { localStorage.setItem('vcm.lastSync', v); },
};

let dbPromise;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('vendor-card-manager', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function idbRequest(storeName, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = action(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const cacheGet = (key) => idbRequest('cache', 'readonly', (s) => s.get(key));
const cachePut = (key, value) => idbRequest('cache', 'readwrite', (s) => s.put(value, key));
const pendingAll = () => idbRequest('pending', 'readonly', (s) => s.getAll());
const pendingPut = (value) => idbRequest('pending', 'readwrite', (s) => s.put(value));
const pendingDelete = (id) => idbRequest('pending', 'readwrite', (s) => s.delete(id));

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function nowIso() { return new Date().toISOString(); }
function formatTime(value) {
  if (!value) return '尚未同步';
  return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function initials(name = '') {
  const compact = name.trim();
  if (!compact) return '名';
  if (/^[\u3400-\u9fff]/.test(compact)) return compact.slice(-2);
  return compact.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}
function toast(message, type = '') {
  const el = $('toast');
  el.textContent = message; el.className = `toast show ${type}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = 'toast'; }, 2800);
}
function setBusy(on, text = '處理中…') { $('busyText').textContent = text; $('busyOverlay').hidden = !on; }
function setSyncState(mode, label) {
  const badge = $('syncBadge');
  badge.className = `sync-badge ${mode === 'connected' ? 'connected' : mode === 'syncing' ? 'syncing' : ''}`;
  $('syncBadgeText').textContent = label;
}

function showPage(name) {
  document.querySelectorAll('.page').forEach((el) => el.classList.toggle('active', el.dataset.page === name));
  document.querySelectorAll('.nav-btn').forEach((el) => el.classList.toggle('active', el.dataset.target === name));
  const subtitles = { info: '名片資訊快速整理', capture: '拍照辨識與建檔', settings: '雲端、辨識與版本' };
  $('headerSubtitle').textContent = subtitles[name];
  $('content').scrollTo({ top: 0, behavior: 'smooth' });
}

function applyPreferences() {
  $('clientIdInput').value = prefs.clientId;
  $('autoOcrToggle').checked = prefs.autoOcr;
  $('themeToggle').checked = prefs.dark;
  document.body.classList.toggle('dark', prefs.dark);
  $('lastSyncText').textContent = formatTime(prefs.lastSync);
  DEFAULT_CATEGORIES.forEach((name) => $('categoryList').insertAdjacentHTML('beforeend', `<option value="${escapeHtml(name)}"></option>`));
}

function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach((btn) => btn.addEventListener('click', () => showPage(btn.dataset.target)));
  $('bannerConnectBtn').addEventListener('click', () => showPage('settings'));
  $('syncBadge').addEventListener('click', () => showPage('settings'));
  $('emptyCaptureBtn').addEventListener('click', () => showPage('capture'));
  $('photoDropzone').addEventListener('click', () => $('photoInput').click());
  $('photoInput').addEventListener('change', handlePhoto);
  $('resetFormBtn').addEventListener('click', () => resetForm(true));
  $('cardForm').addEventListener('submit', saveForm);
  $('notes').addEventListener('input', () => { $('notesCount').textContent = $('notes').value.length; });
  $('searchInput').addEventListener('input', renderRecords);
  $('clearSearchBtn').addEventListener('click', () => { $('searchInput').value = ''; renderRecords(); $('searchInput').focus(); });
  $('categoryFilter').addEventListener('change', renderRecords);
  $('sortSelect').addEventListener('change', renderRecords);
  $('favoriteFilter').addEventListener('click', () => { state.favoriteOnly = !state.favoriteOnly; $('favoriteFilter').setAttribute('aria-pressed', String(state.favoriteOnly)); $('favoriteFilter').textContent = state.favoriteOnly ? '★ 只看收藏' : '☆ 只看收藏'; renderRecords(); });
  $('saveClientIdBtn').addEventListener('click', saveClientId);
  $('connectDriveBtn').addEventListener('click', () => connectDrive(true));
  $('syncNowBtn').addEventListener('click', syncNow);
  $('disconnectBtn').addEventListener('click', disconnectDrive);
  $('autoOcrToggle').addEventListener('change', (e) => { prefs.autoOcr = e.target.checked; toast('辨識設定已儲存'); });
  $('themeToggle').addEventListener('change', (e) => { prefs.dark = e.target.checked; document.body.classList.toggle('dark', e.target.checked); });
  $('checkUpdateBtn').addEventListener('click', () => checkForUpdate(true));
  document.querySelectorAll('[data-close-dialog]').forEach((b) => b.addEventListener('click', () => $('detailDialog').close()));
  $('editRecordBtn').addEventListener('click', editActiveRecord);
  $('deleteRecordBtn').addEventListener('click', requestDeleteActive);
  $('detailFavoriteBtn').addEventListener('click', toggleActiveFavorite);
  $('confirmCancel').addEventListener('click', () => $('confirmDialog').close());
  $('confirmOk').addEventListener('click', async () => { const fn = state.confirmAction; $('confirmDialog').close(); state.confirmAction = null; if (fn) await fn(); });
  window.addEventListener('online', () => { toast('網路已恢復，準備同步'); if (state.connected) syncNow(); });
  window.addEventListener('offline', () => toast('目前離線，新名片會先暫存在本機', 'error'));
}

function saveClientId() {
  const value = $('clientIdInput').value.trim();
  if (value && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(value)) return toast('Client ID 格式不正確', 'error');
  prefs.clientId = value;
  toast(value ? 'Google OAuth 設定已儲存' : 'Client ID 已清除');
}

async function waitForGoogle(timeout = 7000) {
  const started = Date.now();
  while (!window.google?.accounts?.oauth2 && Date.now() - started < timeout) await new Promise((r) => setTimeout(r, 150));
  return Boolean(window.google?.accounts?.oauth2);
}

async function connectDrive(interactive = true) {
  if (state.syncing) return;
  const clientId = $('clientIdInput').value.trim() || prefs.clientId;
  if (!clientId) { showPage('settings'); $('clientIdInput').focus(); return toast('請先填入 Google OAuth Client ID', 'error'); }
  prefs.clientId = clientId;
  if (!navigator.onLine) return toast('目前沒有網路，無法連接 Google Drive', 'error');
  if (!await waitForGoogle()) return toast('Google 登入元件載入失敗，請重新整理', 'error');
  setSyncState('syncing', '連線中');
  try {
    const response = await new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: DRIVE_SCOPE,
        callback: (r) => r.error ? reject(new Error(r.error)) : resolve(r),
        error_callback: (e) => reject(new Error(e.type || 'Google 登入視窗無法開啟')),
      });
      client.requestAccessToken({ prompt: interactive ? 'select_account' : '' });
    });
    state.token = response.access_token;
    state.tokenExpiresAt = Date.now() + Math.max(60, Number(response.expires_in || 3600) - 60) * 1000;
    state.connected = true; prefs.lastConnected = true;
    updateConnectionUi();
    const synced = await syncNow(false);
    if (synced) toast('Google Drive 已連線');
  } catch (error) {
    state.connected = false; updateConnectionUi();
    if (interactive) toast(humanizeError(error, 'Google Drive 連線失敗'), 'error');
  }
}

function disconnectDrive() {
  if (state.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(state.token, () => {});
  state.token = ''; state.connected = false; state.rootFolderId = ''; state.indexFileId = ''; prefs.lastConnected = false;
  updateConnectionUi(); toast('已中斷 Google Drive 連線');
}

function updateConnectionUi() {
  const on = state.connected && state.token;
  $('connectionBanner').hidden = Boolean(on);
  $('driveStatusText').textContent = on ? '已連線，可同步名片資料' : '尚未連線';
  $('connectDriveBtn').textContent = on ? '重新授權' : '連接 Google Drive';
  $('disconnectBtn').hidden = !on;
  setSyncState(on ? 'connected' : 'offline', on ? 'Drive 已連線' : '尚未連線');
  $('saveBtnText').textContent = on ? '儲存至 Google Drive' : '離線暫存（連線後上傳）';
}

function humanizeError(error, fallback = '操作失敗') {
  const message = String(error?.message || '');
  if (/401|登入已失效|invalid_token/.test(message)) return 'Google 登入已失效，請重新連線';
  if (/403/.test(message)) return 'Google Drive 權限不足，請確認已啟用 Drive API';
  if (/Failed to fetch|NetworkError|Load failed/.test(message)) return '無法連上服務，請檢查網路後重試';
  return message && message.length < 100 ? message : fallback;
}

async function driveFetch(url, options = {}) {
  if (!state.token || Date.now() > state.tokenExpiresAt) {
    state.connected = false; updateConnectionUi(); throw new Error('Google 登入已失效');
  }
  const fullUrl = url.startsWith('http') ? url : `https://www.googleapis.com${url}`;
  const headers = new Headers(options.headers || {}); headers.set('Authorization', `Bearer ${state.token}`);
  const response = await fetch(fullUrl, { ...options, headers });
  if (response.status === 401) { state.token = ''; state.connected = false; updateConnectionUi(); throw new Error('Google 登入已失效'); }
  if (!response.ok) { const text = await response.text(); throw new Error(`${response.status}: ${text.slice(0, 180)}`); }
  return response;
}
function qEscape(value) { return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
async function listDriveFiles(query) {
  const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime,parents)');
  const response = await driveFetch(`/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&pageSize=1000&fields=${fields}`);
  return (await response.json()).files || [];
}
async function createFolder(name, parentId) {
  const body = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const response = await driveFetch('/drive/v3/files?fields=id,name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}
async function patchDriveMetadata(fileId, metadata, params = '') {
  const response = await driveFetch(`/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,parents${params}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) });
  return response.json();
}
async function createDriveFile(name, parentId, blob, mimeType) {
  const boundary = `vcm_${uid().replaceAll('-', '')}`;
  const metadata = JSON.stringify({ name, parents: [parentId] });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
  const response = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,parents', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  return response.json();
}
async function updateDriveFile(fileId, blob, mimeType) {
  const response = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name`, { method: 'PATCH', headers: { 'Content-Type': mimeType }, body: blob });
  return response.json();
}
async function trashDriveFile(fileId) { if (fileId) await patchDriveMetadata(fileId, { trashed: true }); }
async function moveDriveFile(fileId, fromParent, toParent) {
  if (!fileId || !fromParent || fromParent === toParent) return;
  await patchDriveMetadata(fileId, {}, `&addParents=${encodeURIComponent(toParent)}&removeParents=${encodeURIComponent(fromParent)}`);
}
async function jsonBlob(value) { return new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }); }

async function ensureRootFolder() {
  if (state.rootFolderId) return state.rootFolderId;
  const cached = prefs.rootFolderId;
  if (cached) {
    try { await driveFetch(`/drive/v3/files/${encodeURIComponent(cached)}?fields=id,trashed`); state.rootFolderId = cached; return cached; } catch (_) { prefs.rootFolderId = ''; }
  }
  const files = await listDriveFiles(`name = '${qEscape(ROOT_FOLDER_NAME)}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`);
  const folder = files[0] || await createFolder(ROOT_FOLDER_NAME);
  state.rootFolderId = folder.id; prefs.rootFolderId = folder.id; return folder.id;
}
async function findOrCreateVendorFolder(name, oldVendor) {
  const known = state.index.vendors.find((v) => v.name.toLocaleLowerCase() === name.toLocaleLowerCase() && v.folderId !== oldVendor?.folderId);
  if (known) return known.folderId;
  if (oldVendor && oldVendor.contacts.length === 1 && oldVendor.name.toLocaleLowerCase() !== name.toLocaleLowerCase()) {
    await patchDriveMetadata(oldVendor.folderId, { name }); return oldVendor.folderId;
  }
  const sameFolder = state.index.vendors.find((v) => v.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (sameFolder) return sameFolder.folderId;
  const files = await listDriveFiles(`name = '${qEscape(name)}' and mimeType = 'application/vnd.google-apps.folder' and '${qEscape(state.rootFolderId)}' in parents and trashed = false`);
  return (files[0] || await createFolder(name, state.rootFolderId)).id;
}
async function upsertJsonFile(name, parentId, data, knownId = '') {
  const blob = await jsonBlob(data);
  let id = knownId;
  if (!id) {
    const files = await listDriveFiles(`name = '${qEscape(name)}' and '${qEscape(parentId)}' in parents and trashed = false`);
    id = files[0]?.id || '';
  }
  if (id) { await updateDriveFile(id, blob, 'application/json'); return id; }
  return (await createDriveFile(name, parentId, blob, 'application/json')).id;
}

function normalizeIndex(data) {
  if (!data || !Array.isArray(data.vendors)) return { schemaVersion: 1, updatedAt: '', vendors: [] };
  return { schemaVersion: 1, updatedAt: data.updatedAt || '', vendors: data.vendors.filter((v) => v && v.name && v.folderId).map((v) => ({ ...v, contacts: Array.isArray(v.contacts) ? v.contacts : [] })) };
}

async function syncNow(showMessage = true) {
  if (!state.token) { if (showMessage) await connectDrive(true); return; }
  if (state.syncing) return;
  state.syncing = true; setSyncState('syncing', '同步中');
  try {
    const rootId = await ensureRootFolder();
    let files = await listDriveFiles(`name = '${qEscape(INDEX_FILE_NAME)}' and '${qEscape(rootId)}' in parents and trashed = false`);
    if (files[0]) {
      state.indexFileId = files[0].id;
      const response = await driveFetch(`/drive/v3/files/${encodeURIComponent(state.indexFileId)}?alt=media`);
      state.index = normalizeIndex(await response.json());
    } else {
      state.index = { schemaVersion: 1, updatedAt: '', vendors: [] };
      state.index.updatedAt = nowIso();
      state.indexFileId = await upsertJsonFile(INDEX_FILE_NAME, rootId, state.index);
    }
    await cachePut('index', state.index);
    await flushPending();
    prefs.lastSync = nowIso(); $('lastSyncText').textContent = formatTime(prefs.lastSync);
    renderAll();
    if (showMessage) toast('名片資料已同步');
    return true;
  } catch (error) {
    toast(humanizeError(error, '同步失敗'), 'error');
    return false;
  } finally {
    state.syncing = false;
    setSyncState(state.connected ? 'connected' : 'offline', state.connected ? 'Drive 已連線' : '尚未連線');
  }
}

async function flushPending() {
  const items = await pendingAll();
  for (const item of items) {
    try { await persistRecord(item.record, item.photoBlob, null); await pendingDelete(item.id); } catch (error) { console.warn('Pending sync failed', item.id, error); break; }
  }
}

async function handlePhoto(event) {
  const file = event.target.files?.[0]; if (!file) return;
  if (!file.type.startsWith('image/')) return toast('請選擇圖片檔案', 'error');
  if (file.size > 25 * 1024 * 1024) return toast('照片超過 25 MB，請改用較小圖片', 'error');
  try {
    setBusy(true, '正在最佳化名片照片…');
    state.photoBlob = await compressImage(file);
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(state.photoBlob);
    $('photoPreview').src = state.previewUrl; $('photoPreview').hidden = false; $('cameraPrompt').hidden = true; $('replacePhotoHint').hidden = false;
    setBusy(false);
    if (prefs.autoOcr) await runOcr(state.photoBlob);
  } catch (error) { setBusy(false); toast('照片讀取失敗，請重新拍攝', 'error'); }
  finally { event.target.value = ''; }
}

async function compressImage(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (_) {
    bitmap = await new Promise((resolve, reject) => { const img = new Image(); const url = URL.createObjectURL(file); img.onload = () => { URL.revokeObjectURL(url); resolve(img); }; img.onerror = reject; img.src = url; });
  }
  const maxSide = 1800; const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('影像壓縮失敗')), 'image/jpeg', .86));
}

async function waitForTesseract(timeout = 9000) {
  const started = Date.now();
  while (!window.Tesseract && Date.now() - started < timeout) await new Promise((r) => setTimeout(r, 180));
  return Boolean(window.Tesseract);
}
async function runOcr(blob) {
  $('ocrPanel').hidden = false; $('ocrResultNote').hidden = true;
  if (!navigator.onLine && !window.Tesseract) { $('ocrPanel').hidden = true; return toast('第一次辨識需要網路下載辨識模型', 'error'); }
  if (!await waitForTesseract()) { $('ocrPanel').hidden = true; return toast('OCR 元件載入失敗，仍可手動輸入資料', 'error'); }
  try {
    const result = await Tesseract.recognize(blob, 'chi_tra+eng', { logger: (m) => {
      const pct = Math.round((m.progress || 0) * 100); $('ocrProgress').style.width = `${pct}%`; $('ocrPercent').textContent = `${pct}%`;
      const labels = { 'loading tesseract core': '載入辨識核心', 'initializing tesseract': '初始化辨識器', 'loading language traineddata': '載入繁中與英文模型', 'initializing api': '準備辨識', 'recognizing text': '正在辨識名片文字' };
      $('ocrStatus').textContent = labels[m.status] || '正在處理影像';
    }});
    const parsed = parseBusinessCard(result.data.text || '');
    fillOcrFields(parsed);
    const confidence = Math.round(result.data.confidence || 0);
    const found = [parsed.vendorName, parsed.contactName, parsed.phone, parsed.email].filter(Boolean).length;
    $('ocrResultNote').hidden = false;
    $('ocrResultNote').className = `ocr-result-note ${confidence < 55 || found < 2 ? 'warning' : ''}`;
    $('ocrResultNote').textContent = `辨識完成：找到 ${found}/4 個主要欄位，文字信心 ${confidence}%。請確認內容後再儲存。`;
  } catch (error) {
    $('ocrResultNote').hidden = false; $('ocrResultNote').className = 'ocr-result-note warning';
    $('ocrResultNote').textContent = '自動辨識未完成，請手動輸入或以光線均勻、正面平拍的照片重試。';
  } finally { $('ocrPanel').hidden = true; }
}

function parseBusinessCard(text) {
  const lines = text.split(/\r?\n/).map((s) => s.replace(/[|｜]/g, ' ').replace(/\s+/g, ' ').trim()).filter((s) => s.length > 1);
  const joined = lines.join(' ');
  const email = (joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0].replace(/[.,;]+$/, '');
  const phoneCandidates = lines.filter((l) => !l.includes('@')).flatMap((l) => l.match(/(?:\+?886[-\s]?)?(?:\(?0?\d{1,3}\)?[-\s]?)?\d{3,4}[-\s]?\d{3,4}(?:\s*(?:#|ext\.?|分機)\s*\d+)?/gi) || []);
  const phone = phoneCandidates.find((p) => { const n = p.replace(/\D/g, ''); return n.length >= 8 && n.length <= 15; }) || '';
  const vendorWords = /(股份有限公司|有限公司|企業社|工作室|商行|科技|工業|電子|機械|精密|實業|國際|公司|集團|CO\.?\s*,?\s*LTD|CORP(?:ORATION)?|COMPANY|TECH(?:NOLOGY)?|INDUSTR(?:Y|IES)|GROUP)/i;
  const vendorName = lines.filter((l) => vendorWords.test(l) && !l.includes('@') && l.length <= 80).sort((a, b) => (vendorWords.test(b) ? 1 : 0) - (vendorWords.test(a) ? 1 : 0) || b.length - a.length)[0] || lines.find((l) => /^[A-Z][A-Z\s&.-]{4,40}$/.test(l)) || lines[0] || '';
  const titleWords = /(董事長|總經理|副總|經理|主任|工程師|業務|採購|專員|顧問|執行長|CEO|CFO|CTO|MANAGER|ENGINEER|SALES|DIRECTOR|SPECIALIST)/i;
  const jobTitle = lines.find((l) => titleWords.test(l) && l !== vendorName && l.length <= 50) || '';
  const excluded = (l) => l === vendorName || l === jobTitle || l.includes('@') || /https?:|www\.|地址|TEL|FAX|電話|手機/i.test(l) || (phone && l.includes(phone));
  let contactName = lines.find((l) => !excluded(l) && /^[\u3400-\u9fff·‧]{2,5}$/.test(l)) || '';
  if (!contactName) contactName = lines.find((l) => !excluded(l) && /^[A-Z][a-z]+(?:[\s-][A-Z][a-z]+){1,3}$/.test(l)) || '';
  if (!contactName && jobTitle) { const i = lines.indexOf(jobTitle); contactName = [lines[i - 1], lines[i + 1]].find((l) => l && !excluded(l) && l.length <= 35) || ''; }
  return { vendorName: vendorName.replace(/^[-•·\s]+|[-•·\s]+$/g, ''), contactName, phone: phone.trim(), email, jobTitle };
}
function fillOcrFields(data) {
  ['vendorName', 'contactName', 'phone', 'email', 'jobTitle'].forEach((key) => { if (!$(`${key}`).value && data[key]) $(`${key}`).value = data[key]; });
}

function validateForm() {
  document.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  document.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
  let valid = true;
  for (const id of ['vendorName', 'contactName']) {
    const el = $(id); if (!el.value.trim()) { el.classList.add('invalid'); el.parentElement.querySelector('.field-error').textContent = '此欄位為必填'; valid = false; }
  }
  const email = $('email'); if (email.value && !email.validity.valid) { email.classList.add('invalid'); email.parentElement.querySelector('.field-error').textContent = '信箱格式不正確'; valid = false; }
  if (!$('phone').value.trim() && !$('email').value.trim()) { $('phone').classList.add('invalid'); $('phone').parentElement.querySelector('.field-error').textContent = '電話或信箱至少填寫一項'; valid = false; }
  if (!$('recordId').value && !state.photoBlob) { toast('請先拍攝或選擇名片照片', 'error'); valid = false; }
  return valid;
}
function getFormRecord() {
  const existing = findRecord($('recordId').value)?.record;
  const timestamp = nowIso();
  return {
    id: existing?.id || uid(), vendorName: $('vendorName').value.trim(), contactName: $('contactName').value.trim(),
    phone: $('phone').value.trim(), email: $('email').value.trim().toLowerCase(), category: $('category').value.trim() || '其他',
    jobTitle: $('jobTitle').value.trim(), notes: $('notes').value.trim(), favorite: $('favorite').checked,
    photoFileId: existing?.photoFileId || '', recordFileId: existing?.recordFileId || '',
    createdAt: existing?.createdAt || timestamp, updatedAt: timestamp,
  };
}

async function saveForm(event) {
  event.preventDefault(); if (!validateForm()) return;
  const record = getFormRecord(); const existingInfo = findRecord(record.id);
  if (!state.token) {
    if (existingInfo) return toast('編輯既有資料前請先重新連接 Google Drive', 'error');
    await pendingPut({ id: record.id, record, photoBlob: state.photoBlob, queuedAt: nowIso() });
    resetForm(false); await updatePendingCount(); renderRecords(); showPage('info');
    return toast('已離線暫存，連接 Drive 後會自動上傳');
  }
  try {
    setBusy(true, existingInfo ? '正在更新名片資料…' : '正在建立廠商資料夾…');
    await persistRecord(record, state.photoBlob, existingInfo);
    resetForm(false); renderAll(); showPage('info'); toast(existingInfo ? '名片資料已更新' : '名片已儲存至 Google Drive');
  } catch (error) { toast(humanizeError(error, '名片儲存失敗'), 'error'); }
  finally { setBusy(false); }
}

async function persistRecord(record, photoBlob, existingInfo = findRecord(record.id)) {
  await ensureRootFolder();
  const oldVendor = existingInfo?.vendor || null;
  const folderId = await findOrCreateVendorFolder(record.vendorName, oldVendor);
  if (existingInfo && oldVendor.folderId !== folderId) {
    await moveDriveFile(record.recordFileId, oldVendor.folderId, folderId);
    await moveDriveFile(record.photoFileId, oldVendor.folderId, folderId);
  }
  if (photoBlob) {
    if (record.photoFileId) await updateDriveFile(record.photoFileId, photoBlob, 'image/jpeg');
    else record.photoFileId = (await createDriveFile(`card-${record.id}.jpg`, folderId, photoBlob, 'image/jpeg')).id;
  }
  const recordForFile = { schemaVersion: 1, ...record };
  if (record.recordFileId) await updateDriveFile(record.recordFileId, await jsonBlob(recordForFile), 'application/json');
  else record.recordFileId = await upsertJsonFile(`contact-${record.id}.json`, folderId, recordForFile);

  const oldSnapshot = oldVendor ? { ...oldVendor, contacts: [...oldVendor.contacts] } : null;
  let vendors = state.index.vendors.map((v) => ({ ...v, contacts: v.contacts.filter((c) => c.id !== record.id) })).filter((v) => v.contacts.length || v.folderId === folderId);
  let target = vendors.find((v) => v.folderId === folderId);
  if (!target) { target = { id: uid(), name: record.vendorName, folderId, summaryFileId: '', contacts: [] }; vendors.push(target); }
  target.name = record.vendorName; target.contacts = [...target.contacts, record]; target.updatedAt = record.updatedAt;
  target.summaryFileId = await upsertJsonFile('vendor.json', folderId, { schemaVersion: 1, vendor: { name: target.name, category: record.category }, contacts: target.contacts, updatedAt: nowIso() }, target.summaryFileId);
  if (oldSnapshot && oldSnapshot.folderId !== folderId) {
    const oldCurrent = vendors.find((v) => v.folderId === oldSnapshot.folderId);
    await upsertJsonFile('vendor.json', oldSnapshot.folderId, { schemaVersion: 1, vendor: { name: oldSnapshot.name }, contacts: oldCurrent?.contacts || [], updatedAt: nowIso() }, oldSnapshot.summaryFileId);
  }
  state.index = { schemaVersion: 1, updatedAt: nowIso(), vendors: vendors.filter((v) => v.contacts.length) };
  state.indexFileId = await upsertJsonFile(INDEX_FILE_NAME, state.rootFolderId, state.index, state.indexFileId);
  await cachePut('index', state.index); prefs.lastSync = nowIso(); $('lastSyncText').textContent = formatTime(prefs.lastSync);
  return record;
}

function resetForm(showMessage = false) {
  $('cardForm').reset(); $('recordId').value = ''; $('notesCount').textContent = '0'; $('captureTitle').textContent = '拍攝名片'; $('saveBtnText').textContent = state.connected ? '儲存至 Google Drive' : '離線暫存（連線後上傳）';
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); state.previewUrl = ''; state.photoBlob = null;
  $('photoPreview').src = ''; $('photoPreview').hidden = true; $('cameraPrompt').hidden = false; $('replacePhotoHint').hidden = true; $('ocrPanel').hidden = true; $('ocrResultNote').hidden = true;
  $('cameraPrompt').querySelector('strong').textContent = '拍照或選擇名片照片'; $('cameraPrompt').querySelector('small').textContent = '請保持光線均勻、畫面端正且文字清楚';
  $('autoOcrToggle').checked = prefs.autoOcr; document.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid')); document.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
  if (showMessage) toast('表單已清除');
}

function findRecord(id) {
  if (!id) return null;
  for (const vendor of state.index.vendors) { const record = vendor.contacts.find((c) => c.id === id); if (record) return { vendor, record }; }
  return null;
}
function flattenRecords() { return state.index.vendors.flatMap((vendor) => vendor.contacts.map((record) => ({ vendor, record }))); }
function renderAll() { renderRecords(); updatePendingCount(); updateConnectionUi(); }

function renderRecords() {
  const query = $('searchInput')?.value.trim().toLocaleLowerCase() || '';
  const category = $('categoryFilter')?.value || 'all'; const sort = $('sortSelect')?.value || 'updated';
  const all = flattenRecords();
  let filtered = all.filter(({ vendor, record }) => {
    const haystack = [vendor.name, record.contactName, record.phone, record.email, record.jobTitle, record.notes].join(' ').toLocaleLowerCase();
    return (!query || haystack.includes(query)) && (category === 'all' || record.category === category) && (!state.favoriteOnly || record.favorite);
  });
  filtered.sort((a, b) => sort === 'vendor' ? a.vendor.name.localeCompare(b.vendor.name, 'zh-Hant') : sort === 'contact' ? a.record.contactName.localeCompare(b.record.contactName, 'zh-Hant') : new Date(b.record.updatedAt) - new Date(a.record.updatedAt));
  const grouped = new Map(); filtered.forEach((item) => { if (!grouped.has(item.vendor.folderId)) grouped.set(item.vendor.folderId, { vendor: item.vendor, records: [] }); grouped.get(item.vendor.folderId).records.push(item.record); });
  $('vendorList').innerHTML = [...grouped.values()].map(({ vendor, records }) => `
    <article class="vendor-group" data-vendor="${escapeHtml(vendor.folderId)}">
      <button class="vendor-head" type="button"><span class="vendor-logo">${escapeHtml(initials(vendor.name).slice(0,1))}</span><span><strong>${escapeHtml(vendor.name)}</strong><small>${escapeHtml(records[0]?.category || '其他')}・${records.length} 位聯絡人</small></span><span class="chevron">⌄</span></button>
      <div class="contact-list">${records.map((r) => `<button class="contact-row" type="button" data-record="${escapeHtml(r.id)}"><span class="avatar">${escapeHtml(initials(r.contactName))}</span><span class="contact-copy"><strong>${escapeHtml(r.contactName)}${r.jobTitle ? `・${escapeHtml(r.jobTitle)}` : ''}</strong><span>${escapeHtml(r.phone || r.email || '尚無聯絡方式')}</span></span><span class="star">${r.favorite ? '★' : '›'}</span></button>`).join('')}</div>
    </article>`).join('');
  $('vendorList').querySelectorAll('.vendor-head').forEach((b) => b.addEventListener('click', () => b.closest('.vendor-group').classList.toggle('collapsed')));
  $('vendorList').querySelectorAll('.contact-row').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.record)));
  $('emptyState').hidden = filtered.length > 0;
  $('resultMeta').textContent = all.length ? `顯示 ${filtered.length}／${all.length} 位聯絡人` : '';
  $('vendorCount').textContent = state.index.vendors.length; $('contactCount').textContent = all.length;
  updateCategoryOptions(all.map(({ record }) => record.category));
}
function updateCategoryOptions(values) {
  const select = $('categoryFilter'); const current = select.value;
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...values.filter(Boolean)])];
  select.innerHTML = '<option value="all">所有分類</option>' + cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  select.value = cats.includes(current) || current === 'all' ? current : 'all';
}
async function updatePendingCount() { try { $('pendingCount').textContent = (await pendingAll()).length; } catch (_) { $('pendingCount').textContent = '0'; } }

async function openDetail(id) {
  const info = findRecord(id); if (!info) return;
  state.activeRecord = info.record; state.activeVendor = info.vendor;
  const r = info.record;
  $('detailCategory').textContent = r.category || '其他'; $('detailVendor').textContent = info.vendor.name;
  $('detailAvatar').textContent = initials(r.contactName); $('detailName').textContent = r.contactName; $('detailJob').textContent = r.jobTitle || '未填職稱';
  $('detailFavoriteBtn').textContent = r.favorite ? '★' : '☆';
  $('detailPhone').href = r.phone ? `tel:${r.phone.replace(/[^\d+#]/g, '')}` : '#'; $('detailPhone').classList.toggle('disabled', !r.phone); $('detailPhone').querySelector('small').textContent = r.phone || '無電話';
  $('detailEmail').href = r.email ? `mailto:${r.email}` : '#'; $('detailEmail').classList.toggle('disabled', !r.email); $('detailEmail').querySelector('small').textContent = r.email || '無信箱';
  $('detailNotes').textContent = r.notes || '沒有備註'; $('detailUpdated').textContent = `更新：${formatTime(r.updatedAt)}`;
  $('detailPhoto').hidden = true; $('detailPhotoWrap').querySelector('.image-loader').hidden = false;
  $('detailPhotoWrap').querySelector('.image-loader').textContent = '載入名片照片…';
  $('detailDialog').showModal();
  if (state.detailPhotoUrl) URL.revokeObjectURL(state.detailPhotoUrl); state.detailPhotoUrl = '';
  if (r.photoFileId && state.token) {
    try { const response = await driveFetch(`/drive/v3/files/${encodeURIComponent(r.photoFileId)}?alt=media`); const blob = await response.blob(); state.detailPhotoUrl = URL.createObjectURL(blob); $('detailPhoto').src = state.detailPhotoUrl; $('detailPhoto').hidden = false; }
    catch (_) { $('detailPhotoWrap').querySelector('.image-loader').textContent = '照片載入失敗，請重新連接 Drive'; }
  } else $('detailPhotoWrap').querySelector('.image-loader').textContent = '連接 Drive 後可查看照片';
  $('detailPhotoWrap').querySelector('.image-loader').hidden = !$('detailPhoto').hidden;
}

function editActiveRecord() {
  const r = state.activeRecord; if (!r) return;
  $('detailDialog').close(); showPage('capture'); resetForm(false);
  $('captureTitle').textContent = '編輯名片'; $('recordId').value = r.id; $('vendorName').value = r.vendorName || state.activeVendor.name; $('contactName').value = r.contactName; $('phone').value = r.phone || ''; $('email').value = r.email || ''; $('category').value = r.category || ''; $('jobTitle').value = r.jobTitle || ''; $('notes').value = r.notes || ''; $('notesCount').textContent = (r.notes || '').length; $('favorite').checked = Boolean(r.favorite); $('saveBtnText').textContent = '更新 Google Drive 資料';
  $('cameraPrompt').querySelector('strong').textContent = '保留原照片或點此更換'; $('cameraPrompt').querySelector('small').textContent = '目前照片仍保存在 Google Drive';
}
function requestDeleteActive() {
  if (!state.activeRecord) return;
  $('confirmTitle').textContent = '刪除這張名片？'; $('confirmMessage').textContent = `${state.activeVendor.name}／${state.activeRecord.contactName} 的照片與資料會移至 Google Drive 垃圾桶。`;
  state.confirmAction = deleteActiveRecord; $('detailDialog').close(); $('confirmDialog').showModal();
}
async function deleteActiveRecord() {
  const r = state.activeRecord, vendor = state.activeVendor; if (!r || !vendor) return;
  if (!state.token) return toast('刪除前請先重新連接 Google Drive', 'error');
  setBusy(true, '正在刪除名片資料…');
  try {
    await trashDriveFile(r.photoFileId); await trashDriveFile(r.recordFileId);
    const contacts = vendor.contacts.filter((c) => c.id !== r.id);
    await upsertJsonFile('vendor.json', vendor.folderId, { schemaVersion: 1, vendor: { name: vendor.name }, contacts, updatedAt: nowIso() }, vendor.summaryFileId);
    state.index.vendors = state.index.vendors.map((v) => v.folderId === vendor.folderId ? { ...v, contacts } : v).filter((v) => v.contacts.length);
    state.index.updatedAt = nowIso(); state.indexFileId = await upsertJsonFile(INDEX_FILE_NAME, state.rootFolderId, state.index, state.indexFileId); await cachePut('index', state.index);
    state.activeRecord = null; state.activeVendor = null; renderAll(); toast('名片已移至 Google Drive 垃圾桶');
  } catch (error) { toast(humanizeError(error, '刪除失敗'), 'error'); }
  finally { setBusy(false); }
}
async function toggleActiveFavorite() {
  const r = state.activeRecord, vendor = state.activeVendor; if (!r || !vendor) return;
  if (!state.token) return toast('更新收藏前請先重新連接 Google Drive', 'error');
  r.favorite = !r.favorite; r.updatedAt = nowIso(); $('detailFavoriteBtn').textContent = r.favorite ? '★' : '☆';
  try {
    await updateDriveFile(r.recordFileId, await jsonBlob({ schemaVersion: 1, ...r }), 'application/json');
    await upsertJsonFile('vendor.json', vendor.folderId, { schemaVersion: 1, vendor: { name: vendor.name }, contacts: vendor.contacts, updatedAt: nowIso() }, vendor.summaryFileId);
    state.index.updatedAt = nowIso(); state.indexFileId = await upsertJsonFile(INDEX_FILE_NAME, state.rootFolderId, state.index, state.indexFileId); await cachePut('index', state.index); renderRecords();
    toast(r.favorite ? '已加入收藏' : '已取消收藏');
  } catch (error) { r.favorite = !r.favorite; toast(humanizeError(error, '收藏更新失敗'), 'error'); }
}

async function checkForUpdate(manual = false) {
  const button = $('checkUpdateBtn'); button.disabled = true; $('updateStatusText').textContent = '正在檢查版本…';
  try {
    const response = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('版本檔讀取失敗');
    const data = await response.json(); const latest = data.version || APP_VERSION; $('latestVersion').textContent = `V${latest}`;
    const hasUpdate = compareVersions(latest, APP_VERSION) > 0;
    if (hasUpdate) {
      $('updateStatusText').textContent = `發現 V${latest}，正在自動更新`;
      const reg = await navigator.serviceWorker?.getRegistration(); if (reg) { await reg.update(); if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); }
      toast(`發現 V${latest}，更新完成後會自動重新載入`);
    } else { $('updateStatusText').textContent = '目前已是最新版本'; if (manual) toast('目前已是最新版本'); }
  } catch (_) { $('latestVersion').textContent = '無法取得'; $('updateStatusText').textContent = navigator.onLine ? '版本檢查失敗，請稍後再試' : '離線中，恢復網路後再檢查'; if (manual) toast('無法檢查更新', 'error'); }
  finally { button.disabled = false; }
}
function compareVersions(a, b) { const aa = String(a).split('.').map(Number), bb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(aa.length, bb.length); i++) { const d = (aa[i] || 0) - (bb[i] || 0); if (d) return d; } return 0; }
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    reg.addEventListener('updatefound', () => { const worker = reg.installing; worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) { $('updateStatusText').textContent = '新版本已下載，準備套用'; worker.postMessage({ type: 'SKIP_WAITING' }); } }); });
    let refreshing = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!refreshing) { refreshing = true; location.reload(); } });
  } catch (error) { console.warn('Service worker registration failed', error); }
}

async function init() {
  applyPreferences(); bindEvents(); updateConnectionUi(); $('currentVersion').textContent = `V${APP_VERSION}`;
  try { const cached = await cacheGet('index'); if (cached) state.index = normalizeIndex(cached); } catch (_) {}
  renderAll();
  const initialPage = location.hash.replace('#', ''); if (['info', 'capture', 'settings'].includes(initialPage)) showPage(initialPage);
  await registerServiceWorker(); checkForUpdate(false);
}
document.addEventListener('DOMContentLoaded', init);
