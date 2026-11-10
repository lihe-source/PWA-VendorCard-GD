'use strict';
// One bounded OCR job at a time. Cancelling a job rejects its await, not just its UI.
let captureTask=null,ocrLoadPromise=null,editorSource=null,editorAngle=0,editorPreview=0;
function setCaptureBusy(on){state.ocrBusy=on;$('analyzePhotoBtn').disabled=on;$('cancelOcrBtn').hidden=!on;$('ocrPanel').hidden=!on;}
function resetOcrReview(){state.ocrReview=null;state.ocrNeedsReview=false;$('ocrReviewPanel').hidden=true;$('ocrReviewed').checked=false;$('rawOcrText').value='';$('qualityHint').textContent='';}
function cancelOcr(message='辨識已取消，照片與手動輸入仍保留'){
  if(!captureTask){setCaptureBusy(false);return;}
  clearTimeout(ocrIdleTimer);ocrEpoch++;
  const task=captureTask;captureTask=null;task?.reject(Error(message));
  if(ocrWorker){void ocrWorker.terminate().catch(()=>{});ocrWorker=null;}
  setCaptureBusy(false);if(task){$('ocrResultNote').hidden=false;$('ocrResultNote').textContent=message;}
}
async function loadOcrLibrary(){
  if(window.Tesseract)return;
  if(!ocrLoadPromise)ocrLoadPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script'),timer=setTimeout(()=>{script.remove();reject(Error('OCR 程式下載逾時，請確認網路'));},20000);
    script.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
    script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('OCR 元件下載失敗，請檢查網路後重試'));};document.head.append(script);
  }).catch(e=>{ocrLoadPromise=null;throw e;});
  await ocrLoadPromise;
}
async function getOcrWorker(){
  if(ocrWorker)return ocrWorker;
  const epoch=ocrEpoch;await loadOcrLibrary();if(epoch!==ocrEpoch)throw Error('已取消');
  const worker=await Tesseract.createWorker(['chi_tra','eng'],1,{
    workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
    corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
    logger:m=>{if(!captureTask||epoch!==ocrEpoch)return;const task=captureTask,p=Math.round((m.progress||0)*100);
      $('ocrProgress').style.width=`${p}%`;$('ocrPercent').textContent=`${p}%`;
      $('ocrStatus').textContent=m.status==='recognizing text'?`第 ${task.pass} 次文字辨識`:'下載／載入繁中英文模型…';},
    errorHandler:e=>{if(captureTask&&epoch===ocrEpoch)captureTask.reject(Error(String(e)));}
  });
  if(epoch!==ocrEpoch){await worker.terminate();throw Error('已取消');}
  ocrWorker=worker;return worker;
}
async function handlePhoto(event){
  const file=event.target.files?.[0],force=event.target.id==='uploadInput';event.target.value='';if(!file||state.updateLocked||state.saving)return;
  if(!file.type.startsWith('image/'))return toast('請選擇 JPEG、PNG 或可解碼的照片','error');
  if(file.size>25*1024*1024)return toast('照片超過 25 MB，請先縮小','error');
  cancelOcr();const generation=++state.photoGeneration;state.photoLoading=true;
  $('qualityHint').textContent='正在處理照片…';
  try{
    const prepared=await VcmImage.prepare(file);if(generation!==state.photoGeneration)return;
    // Only clear values previously auto-filled and still unedited. Preserve deliberate user input.
    for(const key of VcmOcr.keys)if(state.ocrValues[key]&&$(key).value===state.ocrValues[key]&&!state.fieldEdits[key])$(key).value='';
    state.ocrValues={};resetOcrReview();displayPhoto(prepared);await saveDraft();
    const quality=await VcmImage.quality(prepared);if(generation!==state.photoGeneration)return;
    $('qualityHint').textContent=`${quality.width} × ${quality.height} · ${quality.hints.join('；')||'建議先裁切背景，確認文字朝向正確'}`;
    if(prefs.autoOcr||force)void runOcr(prepared);
  }catch(e){if(generation===state.photoGeneration)toast(humanizeError(e),'error');}
  finally{if(generation===state.photoGeneration)state.photoLoading=false;}
}
async function runOcr(input){
  if(!input||state.updateLocked||state.saving)return;
  cancelOcr();clearTimeout(ocrIdleTimer);const generation=state.photoGeneration,epoch=ocrEpoch,edits={...state.fieldEdits};
  let reject,timeout;const stop=new Promise((_,r)=>reject=r),task={reject,generation,pass:1};captureTask=task;
  setCaptureBusy(true);$('ocrResultNote').hidden=true;
  const passes=[];let partial=false;
  const current=()=>captureTask===task&&generation===state.photoGeneration&&epoch===ocrEpoch;
  const job=(async()=>{
    const worker=await getOcrWorker();if(!current())throw Error('已取消');
    await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1',user_defined_dpi:'300'});
    const first=await worker.recognize(input,{}, {text:true,blocks:true});if(!current())throw Error('已取消');passes.push(first.data);
    if(($('ocrMode')?.value||'precise')==='precise'){
      task.pass=2;let enhanced;
      try{
        enhanced=await VcmImage.transform(input,{enhance:true,max:2600});if(!current())throw Error('已取消');
        await worker.setParameters({tessedit_pageseg_mode:'6'});
        const result=await worker.recognize(enhanced,{}, {text:true,blocks:true});if(!current())throw Error('已取消');passes.push(result.data);
      }catch(e){if(!current())throw e;partial=true;}
      finally{if(enhanced)enhanced.width=enhanced.height=1;}
    }
    return VcmOcr.analyze(passes);
  })();
  try{
    timeout=setTimeout(()=>reject(Error('辨識超過 150 秒，請裁切名片或切換快速模式後重試')),150000);
    const review=await Promise.race([job,stop]);if(!current())return;
    state.ocrReview=review;state.ocrNeedsReview=true;$('ocrReviewed').checked=false;
    let filled=0;
    for(const key of VcmOcr.keys){
      if(review.automatic[key]&&!$(key).value&&(state.fieldEdits[key]||0)===(edits[key]||0)){
        $(key).value=review.automatic[key];state.ocrValues[key]=$(key).value;filled++;
      }
    }
    renderOcrReview();await saveDraft();
    $('ocrResultNote').hidden=false;$('ocrResultNote').textContent=`已填入 ${filled} 個空白欄位；其他候選請在下表核對。${partial?'第二次辨識未完成，保留第一次結果。':''}辨識分數不代表正確率。`;
  }catch(e){if(current()){
    if(passes.length){state.ocrReview=VcmOcr.analyze(passes);state.ocrNeedsReview=true;renderOcrReview();await saveDraft().catch(()=>{});}
    $('ocrResultNote').hidden=false;$('ocrResultNote').textContent=humanizeError(e,'辨識失敗，可重試或手動輸入');
    ocrEpoch++;if(ocrWorker){void ocrWorker.terminate().catch(()=>{});ocrWorker=null;}
  }}finally{
    clearTimeout(timeout);if(captureTask===task){captureTask=null;setCaptureBusy(false);
      ocrIdleTimer=setTimeout(()=>{if(!captureTask&&ocrWorker){void ocrWorker.terminate().catch(()=>{});ocrWorker=null;}},60000);
    }
  }
}
function renderOcrReview(){
  const review=state.ocrReview;if(!review)return;
  $('ocrReviewPanel').hidden=false;$('rawOcrText').value=review.text;
  $('ocrReviewRows').innerHTML=VcmOcr.keys.map(key=>{
    const list=review.candidates[key],best=list[0];
    return `<tr><th scope="row">${VcmOcr.labels[key]}</th><td><input id="ocrValue_${key}" aria-label="${VcmOcr.labels[key]}辨識候選" value="${escapeHtml(best?.value||'')}" maxlength="${key==='email'?120:100}" placeholder="未找到，請手動補充"><select data-candidate="${key}" aria-label="${VcmOcr.labels[key]}其他候選"><option value="">${list.length?`${list.length} 個候選，點此切換`:'無自動候選'}</option>${list.map((c,i)=>`<option value="${i}">${escapeHtml(c.value)}${c.corrected?'（有字形修正）':''}</option>`).join('')}</select><small id="ocrSource_${key}">${escapeHtml(best?`${best.reason}｜原文：${best.source}`:'可從下方原始文字複製到這個欄位')}</small></td><td><button type="button" class="text-btn" data-apply="${key}">採用</button></td></tr>`;
  }).join('');
  for(const key of VcmOcr.keys){
    const input=$('ocrValue_'+key);if(review.edits?.[key]!==undefined)input.value=review.edits[key];
    input.oninput=()=>{review.edits={...review.edits,[key]:input.value};saveDraftSoon();};
  }
  $('ocrReviewRows').querySelectorAll('[data-candidate]').forEach(select=>select.onchange=()=>{
    if(select.value==='')return;const key=select.dataset.candidate,c=review.candidates[key][Number(select.value)];
    $('ocrValue_'+key).value=c.value;$('ocrSource_'+key).textContent=`${c.reason}｜原文：${c.source}`;
    review.edits={...review.edits,[key]:c.value};saveDraftSoon();
  });
  $('ocrReviewRows').querySelectorAll('[data-apply]').forEach(button=>button.onclick=()=>applyCandidate(button.dataset.apply));
}
function applyCandidate(key){
  const value=$('ocrValue_'+key).value.trim();if(!value)return toast('請先選取或填入候選文字');
  if($(key).maxLength>0&&value.length>$(key).maxLength)return toast('候選內容超出欄位長度，請先縮短','error');
  const apply=()=>{const el=$(key);if(value.length>el.maxLength&&el.maxLength>0)throw Error('內容超出欄位長度');el.value=value;state.fieldEdits[key]=(state.fieldEdits[key]||0)+1;state.ocrNeedsReview=true;$('ocrReviewed').checked=false;saveDraftSoon();toast('已填入，請核對名片原圖');};
  if($(key).value&&$(key).value!==value)confirmDo('取代目前欄位？',`${VcmOcr.labels[key]}：「${$(key).value}」改為「${value}」`,apply,'確認取代');else apply();
}
let draftDebounce;
function setupCapture(){
  $('cancelOcrBtn').onclick=()=>cancelOcr();$('editImageBtn').onclick=openImageEditor;
  $('closeImageEditor').onclick=()=>{$('imageEditor').close();editorSource=null;editorPreview++;};
  $('imageEditor').addEventListener('close',()=>{state.imageEditing=false;editorSource=null;editorPreview++;});
  $('rotateImageBtn').onclick=()=>{editorAngle=(editorAngle+90)%360;void previewEditor();};
  for(const id of ['cropLeft','cropRight','cropTop','cropBottom','deskewAngle'])$(id).oninput=()=>{clearTimeout(draftDebounce);draftDebounce=setTimeout(()=>void previewEditor(),100);};
  $('resetImageBtn').onclick=()=>{editorAngle=0;for(const id of ['cropLeft','cropRight','cropTop','cropBottom','deskewAngle'])$(id).value=0;void previewEditor();};
  $('applyImageBtn').onclick=applyImageEdit;
  $('applyOcrEmpty').onclick=()=>{for(const key of VcmOcr.keys)if(!$(key).value&&$('ocrValue_'+key).value)applyCandidate(key);};
  $('parseOcrText').onclick=()=>{const text=$('rawOcrText').value.slice(0,20000);state.ocrReview=VcmOcr.mergeText(text);state.ocrReview.text=text;state.ocrNeedsReview=true;$('ocrReviewed').checked=false;renderOcrReview();saveDraftSoon();};
  $('ocrReviewed').onchange=()=>{state.ocrNeedsReview=!$('ocrReviewed').checked;saveDraftSoon();};
  $('rawOcrText').oninput=()=>{if(state.ocrReview){state.ocrReview.text=$('rawOcrText').value;saveDraftSoon();}};
  $('ocrMode').value=localStorage.getItem('vcm.ocrMode')||'precise';$('ocrMode').onchange=()=>localStorage.setItem('vcm.ocrMode',$('ocrMode').value);
}
function editorOptions(max=2600){return {max,angle:editorAngle+Number($('deskewAngle').value),left:Number($('cropLeft').value),right:Number($('cropRight').value),top:Number($('cropTop').value),bottom:Number($('cropBottom').value)};}
async function openImageEditor(){
  if(!state.photoBlob||state.photoLoading||state.saving)return;
  cancelOcr();editorSource=state.photoBlob;editorAngle=0;
  for(const id of ['cropLeft','cropRight','cropTop','cropBottom','deskewAngle'])$(id).value=0;
  state.imageEditing=true;$('imageEditor').showModal();await previewEditor();
}
async function previewEditor(){
  const ticket=++editorPreview,source=editorSource;if(!source)return;
  try{const preview=await VcmImage.transform(source,editorOptions(1000));
    if(ticket!==editorPreview){preview.width=preview.height=1;return;}
    const canvas=$('editorCanvas');canvas.width=preview.width;canvas.height=preview.height;canvas.getContext('2d').drawImage(preview,0,0);preview.width=preview.height=1;
    $('cropReadout').textContent=`左 ${$('cropLeft').value}%／右 ${$('cropRight').value}%／上 ${$('cropTop').value}%／下 ${$('cropBottom').value}% · 微調 ${$('deskewAngle').value}°`;
  }catch(e){toast(humanizeError(e),'error');}
}
async function applyImageEdit(){
  if(!editorSource)return;const generation=++state.photoGeneration;state.photoLoading=true;$('applyImageBtn').disabled=true;
  try{const canvas=await VcmImage.transform(editorSource,editorOptions());const output=await VcmImage.blob(canvas,'image/jpeg',.94);canvas.width=canvas.height=1;
    if(generation!==state.photoGeneration)return;if(output.size>5*1024*1024)throw Error('裁切照片過大，請縮小範圍');
    displayPhoto(output);resetOcrReview();await saveDraft();$('imageEditor').close();editorSource=null;editorPreview++;void runOcr(output);
  }catch(e){toast(humanizeError(e),'error');}finally{state.photoLoading=false;$('applyImageBtn').disabled=false;}
}
