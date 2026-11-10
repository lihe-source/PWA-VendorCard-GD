'use strict';
globalThis.VcmImage=(()=>{
  async function decode(blob){
    try{return await createImageBitmap(blob,{imageOrientation:'from-image'});}catch{
      return new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(blob);img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('照片無法解碼，請改用 JPEG／PNG'));};img.src=url;});
    }
  }
  const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c;};
  const blob=(c,type='image/png',quality=.94)=>new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('圖片處理失敗')),type,quality));
  async function transform(input,{left=0,right=0,top=0,bottom=0,angle=0,max=2600,enhance=false}={}){
    const img=await decode(input);
    try{
      const w=img.width||img.naturalWidth,h=img.height||img.naturalHeight;
      const x=w*left/100,y=h*top/100,cw=w*(100-left-right)/100,ch=h*(100-top-bottom)/100;
      if(cw<64||ch<64)throw Error('裁切範圍太小，請保留整張名片');
      const radians=angle*Math.PI/180,cos=Math.abs(Math.cos(radians)),sin=Math.abs(Math.sin(radians));
      const rw=cw*cos+ch*sin,rh=cw*sin+ch*cos,scale=Math.min(1,max/Math.max(rw,rh));
      const out=canvas(rw*scale,rh*scale),ctx=out.getContext('2d',{willReadFrequently:enhance});
      ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);ctx.translate(out.width/2,out.height/2);ctx.rotate(radians);
      ctx.drawImage(img,x,y,cw,ch,-cw*scale/2,-ch*scale/2,cw*scale,ch*scale);ctx.setTransform(1,0,0,1,0,0);
      if(enhance){
        const pixels=ctx.getImageData(0,0,out.width,out.height),a=pixels.data,hist=new Uint32Array(256);
        for(let i=0;i<a.length;i+=4)hist[Math.round(.299*a[i]+.587*a[i+1]+.114*a[i+2])]++;
        const total=a.length/4;let sum=0,lo=0,hi=255;
        for(let i=0;i<256;i++){sum+=hist[i];if(sum>=total*.02){lo=i;break;}}
        sum=0;for(let i=255;i>=0;i--){sum+=hist[i];if(sum>=total*.02){hi=i;break;}}
        const range=Math.max(45,hi-lo);
        for(let i=0;i<a.length;i+=4){const gray=.299*a[i]+.587*a[i+1]+.114*a[i+2];const v=Math.max(0,Math.min(255,(gray-lo)*255/range));a[i]=a[i+1]=a[i+2]=v;}
        ctx.putImageData(pixels,0,0);
      }
      return out;
    }finally{img.close?.();}
  }
  async function prepare(input){
    const c=await transform(input);let output=await blob(c,'image/jpeg',.94);
    if(output.size>5*1024*1024)output=await blob(c,'image/jpeg',.82);
    if(output.size>5*1024*1024)throw Error('照片處理後仍過大，請裁切後重新上傳');
    c.width=c.height=1;return output;
  }
  async function quality(input){
    const img=await decode(input);try{
      const width=img.width||img.naturalWidth,height=img.height||img.naturalHeight;
      const c=canvas(400,400*height/width),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,c.width,c.height);
      const a=ctx.getImageData(0,0,c.width,c.height).data;let mean=0,sq=0;
      for(let i=0;i<a.length;i+=4){const g=(a[i]+a[i+1]+a[i+2])/3;mean+=g;sq+=g*g;}
      const n=a.length/4;mean/=n;const sd=Math.sqrt(Math.max(0,sq/n-mean*mean));c.width=c.height=1;
      const hints=[];if(Math.max(width,height)<1200)hints.push('解析度偏低，建議重新近拍');if(mean<65)hints.push('畫面偏暗');if(sd<28)hints.push('對比偏低，建議調整光線或使用加強辨識');
      return {width,height,hints};
    }finally{img.close?.();}
  }
  return {decode,transform,blob,prepare,quality};
})();
