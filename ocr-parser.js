'use strict';
// Rule scores are ranking signals, not calibrated accuracy probabilities.
globalThis.VcmOcr = (() => {
  const keys=['vendorName','contactName','phone','email','jobTitle'];
  const labels={vendorName:'廠商名稱',contactName:'聯繫人姓名',phone:'電話',email:'電子信箱',jobTitle:'職稱'};
  const norm=s=>String(s||'').normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/[\t ]+/g,' ').trim();
  const compact=s=>norm(s).replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'$1');
  const company=/(?:股份有限公司|有限公司|企業社|工作室|商行|實業|科技|工業|電子|機械|精密|公司|集團|\b(?:co\.?\s*,?\s*ltd\.?|corp(?:oration)?\.?|company|inc\.?|limited|technology|industries|group)\b)/i;
  const title=/(?:董事長|總經理|副總經理|執行長|(?:業務|採購|專案|產品|技術|區域)?(?:副理|經理|主任|工程師|專員)|顧問|業務代表|業務|採購|\b(?:CEO|CFO|CTO|(?:sales |account |general |project )?manager|engineer|sales|director|specialist)\b)/i;
  const nameOK=s=>/^[\u3400-\u9fff·‧]{2,5}$/.test(s)||/^[A-Za-z][A-Za-z.'’-]+(?: [A-Za-z][A-Za-z.'’-]+){1,3}$/.test(s);
  const address=/地址|address|路\d|街\d|區.*路|\d.*(?:號|樓)|\b(?:road|street|avenue)\b/i;
  function extractLines(data,pass){
    const detailed=(data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[]));
    const source=detailed.length?detailed:String(data.text||'').split(/\r?\n/).map(text=>({text,confidence:data.confidence}));
    return source.map(l=>({text:norm(l.text),confidence:Number.isFinite(l.confidence)?l.confidence:0,pass})).filter(l=>l.text);
  }
  function analyze(passes){
    const candidates=Object.fromEntries(keys.map(k=>[k,[]]));
    const lines=passes.flatMap((p,i)=>extractLines(p,i));
    const add=(field,value,score,line,reason,corrected=false)=>{
      value=norm(value).replace(/^[\s:：|,;]+|[\s|;,]+$/g,'');
      if(!value||value.length>(field==='vendorName'?100:field==='email'?120:60))return;
      const list=candidates[field],found=list.find(c=>c.value.toLowerCase()===value.toLowerCase());
      const c={value,score,confidence:Math.round(line.confidence||0),source:line.text,reason,corrected,passes:[line.pass]};
      if(found){if(!found.passes.includes(line.pass))found.passes.push(line.pass);if(score>found.score)Object.assign(found,{score,reason,source:line.text});found.confidence=Math.max(found.confidence,c.confidence);found.corrected=found.corrected||corrected;}
      else list.push(c);
    };
    for(const line of lines){
      const raw=line.text,s=compact(raw);
      // Only normalize spaces around @ and dots. Never guess O/0 or l/1 in emails.
      const emailText=raw.replace(/\s*@\s*/g,'@').replace(/\s*\.\s*/g,'.');
      for(const m of emailText.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi))add('email',m[0],92,line,'電子信箱格式');
      // Split labeled segments so a TEL and FAX on the same line remain independent.
      const segments=raw.split(/(?=\b(?:TEL(?:EPHONE)?|FAX|MOBILE|MOB|CELL|PHONE)\b\s*[:：.]?|(?:電話|傳真|手機|行動電話)\s*[:：]?)/i);
      for(let segment of segments){
        if(/^(?:FAX|傳真)/i.test(segment)||address.test(segment))continue;
        segment=segment.replace(/[A-Z0-9._%+-]+\s*@\s*[A-Z0-9.-]+\.[A-Z]{2,}/gi,'');
        const labeled=/^(?:TEL|PHONE|MOBILE|MOB|CELL|電話|手機|行動電話)/i.test(segment);
        const cleaned=segment.replace(/^(?:TELEPHONE|TEL|PHONE|MOBILE|MOB|CELL|電話|手機|行動電話)\s*[:：.]?\s*/i,'');
        // Lookalike corrections are suggestions ONLY, limited to a labeled numeric context.
        const numeric=labeled?cleaned.replace(/[OoＯ]/g,'0').replace(/[Il|]/g,'1'):cleaned;
        for(const m of numeric.matchAll(/(?:\+\d{1,3}[ -]?)?\(?\d{2,4}\)?[ -]?\d{3,4}[ -]?\d{3,4}(?:\s*(?:#|ext\.?|分機)\s*\d{1,6})?/gi)){
          const value=m[0].trim(),digits=value.split(/#|ext\.?|分機/i)[0].replace(/\D/g,'');
          if(digits.length<8||digits.length>15||(!labeled&&!/^(?:0|\+)/.test(value)))continue;
          const mobile=/^(?:09|\+886[ -]?9)/.test(value);
          const corrected=numeric!==cleaned;
          add('phone',value,corrected?65:labeled?mobile?96:92:mobile?85:70,line,corrected?'數字字形修正，請核對':mobile?'行動電話':'電話號碼',corrected);
        }
      }
      if(!/@|https?:|www\./i.test(s)&&!address.test(s)){
        if(company.test(s))add('vendorName',s.replace(/^(?:公司|廠商|company)\s*[:：]\s*/i,''),90,line,'公司名稱關鍵字');
        const labeled=s.match(/^(?:聯絡人|聯繫人|姓名|contact|name)\s*[:：]\s*(.+)$/i);
        const tm=s.match(title);
        if(tm&&!company.test(s)){
          add('jobTitle',tm[0],80,line,'職稱關鍵字');
          const rest=s.replace(tm[0],'').replace(/^[\s:：|/,-]+|[\s:：|/,-]+$/g,'');
          if(nameOK(rest)&&!title.test(rest))add('contactName',rest,82,line,'姓名與職稱分離');
        }
        if(labeled&&nameOK(labeled[1]))add('contactName',labeled[1],92,line,'姓名標籤');
        else if(nameOK(s)&&!company.test(s)&&!title.test(s)&&!/部門|服務|品質|專業|創新|事業|總部|辦公室|客服|中心/.test(s))add('contactName',s,64,line,'可能為姓名，需確認');
      }
    }
    const suggested={},automatic={};
    for(const key of keys){
      candidates[key].forEach(c=>{c.rank=c.score+Math.min(6,(c.passes.length-1)*6);});
      candidates[key].sort((a,b)=>b.rank-a.rank||b.confidence-a.confidence);
      candidates[key]=candidates[key].slice(0,8);
      const [first,second]=candidates[key];
      if(first){suggested[key]=first.value;
        // Low-confidence results and competing readings stay in the review table.
        if(first.score>=85&&first.confidence>=78&&!first.corrected&&(!second||first.rank-second.rank>=12))automatic[key]=first.value;
      }
    }
    return {candidates,suggested,automatic,lines,text:passes.map((p,i)=>`【辨識 ${i+1}】\n${p.text||''}`).join('\n\n')};
  }
  function mergeText(text){return analyze([{text,confidence:0}]);}
  return {keys,labels,norm,analyze,mergeText,extractLines};
})();
