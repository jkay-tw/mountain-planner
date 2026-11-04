// Export the self-contained SVG at 2× resolution; no external map tiles or data.
export async function profilePng(svg){
 const clone=svg.cloneNode(true),box=svg.viewBox.baseVal,scale=2;
 clone.setAttribute('width',box.width);clone.setAttribute('height',box.height);
 // Styles must survive serialization outside the page stylesheet.
 clone.querySelectorAll('.profile-grid text,.profile-node-label text').forEach(e=>e.setAttribute('stroke','none'));
 const source=new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(source);
 try{
  const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('圖片轉換失敗，請重試。'));img.src=url});
  const canvas=document.createElement('canvas');canvas.width=box.width*scale;canvas.height=box.height*scale;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('瀏覽器不支援圖片轉換。');ctx.scale(scale,scale);ctx.drawImage(img,0,0,box.width,box.height);
  return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG 轉換失敗。')),'image/png'));
 }finally{URL.revokeObjectURL(url)}
}
export function bindProfileExports(root=document){
 root.addEventListener('click',async event=>{
  const button=event.target.closest?.('[data-profile-export]');if(!button)return;
  const card=button.closest('.profile-card'),svg=card?.querySelector('svg'),status=card?.querySelector('[data-profile-export-status]');if(!svg)return;
  button.disabled=true;status.textContent='正在產生圖片…';
  try{
   if(button.dataset.profileExport==='copy'){
    if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw Error('此瀏覽器無法複製圖片，請使用「下載 PNG」。');
    // Start clipboard write inside the click gesture; PNG generation may be async.
    await navigator.clipboard.write([new ClipboardItem({'image/png':profilePng(svg)})]);status.textContent='已複製圖片';
   }else{
    const blob=await profilePng(svg),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(svg.getAttribute('aria-label')||'高度剖面')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='已產生 PNG';
   }
  }catch(error){status.textContent=button.dataset.profileExport==='copy'?'無法複製圖片，請使用「下載 PNG」。':error.message}
  finally{button.disabled=false}
 });
}
