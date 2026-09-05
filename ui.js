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
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateBackToTop();
}

function applyPreferences() {
  $('clientIdInput').value = prefs.clientId;
  $('driveFolderInput').value = prefs.driveFolderUrl;
  $('autoOcrToggle').checked = prefs.autoOcr;
  $('autoConnectToggle').checked = prefs.autoConnect;
  $('themeToggle').checked = prefs.dark;
  document.body.classList.toggle('dark', prefs.dark);
  $('lastSyncText').textContent = formatTime(state.lastSync);
  updateDriveLocationUi();
}

function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach((btn) => btn.addEventListener('click', () => showPage(btn.dataset.target)));
  $('bannerConnectBtn').addEventListener('click', () => showPage('settings'));
  $('syncBadge').addEventListener('click', () => showPage('settings'));
  $('emptyCaptureBtn').addEventListener('click', () => showPage('capture'));
  $('photoDropzone').addEventListener('click', () => $('photoInput').click());
  $('photoInput').addEventListener('change', handlePhoto);
  $('uploadInput').addEventListener('change', handlePhoto);
  $('takePhotoBtn').addEventListener('click', () => $('photoInput').click());
  $('uploadPhotoBtn').addEventListener('click', () => $('uploadInput').click());
  $('analyzePhotoBtn').addEventListener('click', () => state.photoBlob && runOcr(state.photoBlob));
  $('resetFormBtn').addEventListener('click', () => confirmDo('清除草稿？','會清除此帳號與資料夾目前正在編輯的草稿。',async()=>{resetForm();await saveDraft();},'清除'));
  $('cardForm').addEventListener('submit', saveForm);
  $('notes').addEventListener('input', () => { $('notesCount').textContent = $('notes').value.length; });
  $('searchInput').addEventListener('input', () => { clearTimeout(state.searchTimer);state.searchTimer=setTimeout(renderRecords,150); });
  $('clearSearchBtn').addEventListener('click', () => { $('searchInput').value = ''; renderRecords(); $('searchInput').focus(); });
  $('categoryFilter').addEventListener('change', renderRecords);
  $('sortSelect').addEventListener('change', renderRecords);
  $('favoriteFilter').addEventListener('click', () => { state.favoriteOnly = !state.favoriteOnly; $('favoriteFilter').setAttribute('aria-pressed', String(state.favoriteOnly)); $('favoriteFilter').textContent = state.favoriteOnly ? '★ 只看收藏' : '☆ 只看收藏'; renderRecords(); });
  $('saveClientIdBtn').addEventListener('click', saveDriveSettings);
  $('connectDriveBtn').addEventListener('click', () => connectDrive(true));
  $('syncNowBtn').addEventListener('click', () => state.connected ? syncNow() : connectDrive());
  $('disconnectBtn').addEventListener('click', disconnectDrive);
  $('autoOcrToggle').addEventListener('change', (e) => { prefs.autoOcr = e.target.checked; toast('辨識設定已儲存'); });
  $('autoConnectToggle').addEventListener('change', (e) => { prefs.autoConnect = e.target.checked; if (e.target.checked) scheduleAutomaticConnect(); toast(e.target.checked ? '已啟用自動連線' : '已停用自動連線'); });
  $('themeToggle').addEventListener('change', (e) => { prefs.dark = e.target.checked; document.body.classList.toggle('dark', e.target.checked); });
  $('checkUpdateBtn').addEventListener('click', () => checkForUpdate(true));
  document.querySelectorAll('[data-close-dialog]').forEach((b) => b.addEventListener('click', () => $('detailDialog').close()));
  $('editRecordBtn').addEventListener('click', editActiveRecord);
  $('deleteRecordBtn').addEventListener('click', requestDeleteActive);
  $('detailFavoriteBtn').addEventListener('click', toggleActiveFavorite);
  $('confirmCancel').addEventListener('click', () => { state.confirmAction = null; $('confirmDialog').close(); });
  $('confirmOk').addEventListener('click', async () => { const fn = state.confirmAction; $('confirmDialog').close(); state.confirmAction = null; if (fn) await fn(); });
  $('category').addEventListener('focus', openCategoryMenu);
  $('category').addEventListener('input', openCategoryMenu);
  $('category').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCategoryMenu(); if (e.key === 'Enter' && !$('categoryMenu').hidden) { e.preventDefault(); const first = $('categoryOptions').querySelector('.category-option'); first ? selectCategory(first.dataset.category) : quickAddCategory(); } });
  $('categoryToggleBtn').addEventListener('click', toggleCategoryMenu);
  $('quickAddCategoryBtn').addEventListener('click', quickAddCategory);
  $('addManagedCategoryBtn').addEventListener('click', () => addManagedCategory($('manageCategoryInput').value));
  $('manageCategoryInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addManagedCategory(e.target.value); } });
  document.addEventListener('pointerdown', (e) => { if (!$('categoryCombobox').contains(e.target)) closeCategoryMenu(); });
  $('backToTopBtn').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  window.addEventListener('scroll', updateBackToTop, { passive: true });
  window.addEventListener('online', () => { toast('網路已恢復，準備同步'); state.connected ? syncNow() : scheduleAutomaticConnect(); });
  window.addEventListener('offline', () => toast('目前離線，新名片會先暫存在本機', 'error'));
}

function updateBackToTop() {
  const infoActive = $('infoPage').classList.contains('active');
  $('backToTopBtn').classList.toggle('show', infoActive && window.scrollY > 260);
}

function openCategoryMenu() {
  $('categoryMenu').hidden = false; $('categoryCombobox').classList.add('open'); $('category').setAttribute('aria-expanded', 'true'); renderCategoryPicker();
}

function closeCategoryMenu() {
  $('categoryMenu').hidden = true; $('categoryCombobox').classList.remove('open'); $('category').setAttribute('aria-expanded', 'false');
}

function toggleCategoryMenu() { $('categoryMenu').hidden ? openCategoryMenu() : closeCategoryMenu(); }

function renderCategoryPicker() {
  const query = VcmData.key($('category').value);
  const categories = managedCategories().filter((name) => !query || name.toLocaleLowerCase().includes(query));
  $('categoryOptions').innerHTML = categories.length ? categories.map((name) => `<button class="category-option ${name === $('category').value ? 'selected' : ''}" type="button" role="option" data-category="${escapeHtml(name)}" aria-selected="${name === $('category').value}">${escapeHtml(name)}</button>`).join('') : '<div class="category-empty">找不到符合的分類</div>';
  $('categoryOptions').querySelectorAll('.category-option').forEach((button) => button.addEventListener('click', () => selectCategory(button.dataset.category)));
  const exact = managedCategories().some((name) => name.toLocaleLowerCase() === query);
  $('quickAddCategoryBtn').textContent = query && !exact ? `＋ 新增「${$('category').value.trim()}」` : '＋ 新增分類';
}

function selectCategory(name) { $('category').value = name; closeCategoryMenu(); saveDraftSoon(); }

function renderCategoryManager() {
  $('managedCategoryList').innerHTML = managedCategories().map((name) => `<span class="managed-category-item">${escapeHtml(name)}<button type="button" data-remove-category="${escapeHtml(name)}" aria-label="刪除 ${escapeHtml(name)}">×</button></span>`).join('');
  $('managedCategoryList').querySelectorAll('[data-remove-category]').forEach((button) => button.addEventListener('click', () => requestRemoveCategory(button.dataset.removeCategory)));
}

function parseDriveFolderId(value) {
  const raw = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (!/(^|\.)drive\.google\.com$/i.test(url.hostname)) return '';
    return (url.pathname.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || [])[1] || url.searchParams.get('id') || '';
  } catch (_) { return ''; }
}

function canonicalDriveFolderUrl(value) {
  const id = parseDriveFolderId(value); return id ? `https://drive.google.com/drive/folders/${id}` : '';
}

function updateDriveLocationUi() {
  const url = canonicalDriveFolderUrl($('driveFolderInput')?.value || prefs.driveFolderUrl) || DEFAULT_DRIVE_FOLDER_URL;
  $('openFolderLink').href = url;
  $('driveLocationText').textContent = state.rootFolderName ? `${state.rootFolderName}（已驗證）` : `Folder ID：${parseDriveFolderId(url) || '格式錯誤'}`;
}

function humanizeError(error, fallback = '操作失敗') {
  const message = String(error?.message || '');
  if (/401|登入已失效|invalid_token/.test(message)) return 'Google 登入已失效，請重新連線';
  if (/403/.test(message)) return 'Google Drive 權限不足，請確認已啟用 Drive API';
  if (/Failed to fetch|NetworkError|Load failed/.test(message)) return '無法連上服務，請檢查網路後重試';
  return message && message.length < 100 ? message : fallback;
}

async function compressImage(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (_) {
    bitmap = await new Promise((resolve, reject) => { const img = new Image(); const url = URL.createObjectURL(file); img.onload = () => { URL.revokeObjectURL(url); resolve(img); }; img.onerror = () => { URL.revokeObjectURL(url);reject(new Error('圖片格式無法讀取')); }; img.src = url; });
  }
  const maxSide = 1800; const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('影像壓縮失敗')), 'image/jpeg', .86));
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

function resetForm(showMessage = false) {
  state.photoGeneration++;state.photoLoading=false;state.editBase=[];state.editRecord=null;state.ocrValues={};state.fieldEdits={};
  $('cardForm').reset(); $('recordId').value = ''; $('notesCount').textContent = '0'; $('captureTitle').textContent = '拍攝名片'; $('saveBtnText').textContent = state.connected ? '儲存至 Google Drive' : '離線暫存（連線後上傳）';
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); state.previewUrl = ''; state.photoBlob = null;
  $('photoPreview').src = ''; $('photoPreview').hidden = true; $('cameraPrompt').hidden = false; $('replacePhotoHint').hidden = true; $('ocrPanel').hidden = true; $('ocrResultNote').hidden = true;
  $('analyzePhotoBtn').hidden = true; closeCategoryMenu();
  $('cameraPrompt').querySelector('strong').textContent = '拍攝名片並自動分析'; $('cameraPrompt').querySelector('small').textContent = '請保持光線均勻、畫面端正且文字清楚';
  $('autoOcrToggle').checked = prefs.autoOcr; document.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid')); document.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
  if (showMessage) toast('表單已清除');
}

function findRecord(id) {
  if (!id) return null;
  for (const vendor of state.index.vendors) { const record = vendor.contacts.find((c) => c.id === id); if (record) return { vendor, record }; }
  return null;
}

function flattenRecords() { return state.index.vendors.flatMap((vendor) => vendor.contacts.map((record) => ({ vendor, record }))); }

function renderRecords() {
  const query = $('searchInput')?.value.trim().toLocaleLowerCase() || '';
  const category = $('categoryFilter')?.value || 'all'; const sort = $('sortSelect')?.value || 'updated';
  const all = flattenRecords();
  let filtered = all.filter(({ vendor, record }) => {
    const haystack = [vendor.name, record.contactName, record.phone, record.email, record.jobTitle, record.notes, record.phone.replace(/\D/g,'')].join(' ').toLocaleLowerCase();
    return (!query || haystack.includes(query)) && (category === 'all' || record.category === category) && (!state.favoriteOnly || record.favorite);
  });
  filtered.sort((a, b) => sort === 'vendor' ? a.vendor.name.localeCompare(b.vendor.name, 'zh-Hant') : sort === 'contact' ? a.record.contactName.localeCompare(b.record.contactName, 'zh-Hant') : new Date(b.record.updatedAt) - new Date(a.record.updatedAt));
  const grouped = new Map(); filtered.forEach((item) => { if (!grouped.has(item.vendor.folderId)) grouped.set(item.vendor.folderId, { vendor: item.vendor, records: [] }); grouped.get(item.vendor.folderId).records.push(item.record); });
  $('vendorList').innerHTML = [...grouped.values()].map(({ vendor, records }) => `
    <article class="vendor-group" data-vendor="${escapeHtml(vendor.folderId)}">
      <button class="vendor-head" type="button"><span class="vendor-logo">${escapeHtml(initials(vendor.name).slice(0,1))}</span><span><strong>${escapeHtml(vendor.name)}</strong><small>${escapeHtml(records[0]?.category || '其他')}・${records.length} 位聯絡人</small></span><span class="chevron">⌄</span></button>
      <div class="contact-list">${records.map((r) => `<button class="contact-row" type="button" data-record="${escapeHtml(r.id)}"><span class="avatar">${escapeHtml(initials(r.contactName))}</span><span class="contact-copy"><strong>${escapeHtml(r.contactName)}${r.jobTitle ? `・${escapeHtml(r.jobTitle)}` : ''}${r._conflict ? ' ⚠ 衝突' : r._pending ? ' · 待同步' : ''}</strong><span>${escapeHtml(r.phone || r.email || '尚無聯絡方式')}</span></span><span class="star">${r.favorite ? '★' : '›'}</span></button>`).join('')}</div>
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
  const cats = [...new Set([...managedCategories(), ...values.filter(Boolean)])];
  select.innerHTML = '<option value="all">所有分類</option>' + cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  select.value = cats.includes(current) || current === 'all' ? current : 'all';
}

function compareVersions(a, b) { const aa = String(a).split('.').map(Number), bb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(aa.length, bb.length); i++) { const d = (aa[i] || 0) - (bb[i] || 0); if (d) return d; } return 0; }
