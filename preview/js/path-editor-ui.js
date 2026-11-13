import {attachmentCandidates,directSpanCandidates,refitConfirmedSpan} from './network-attachment.js';
import {coordinateOf,editSegment,recalculateSegment,manualWarning,insertShapeControl,updateShapeControl,deleteShapeControl,splitManualShape} from './path-editor.js';
import {twd97Label} from './twd97.js?v=v0731';
import {uid} from './planner.js?v=segments1';

// All mutations use the editor's existing scroll guard, autosave and history.
export function attachPathEditor({host,map,getDays,getRoute,data,onChange}){
 const panel=document.createElement('div');panel.className='path-editor';
 panel.innerHTML='<label><input type="checkbox" data-edit> 編輯路徑模式</label><div data-tools hidden><label>DAY <select data-day></select></label><label>選定路段 <select data-segment></select></label><label>點擊地圖 <select data-click><option value="node">新增節點</option><option value="control">插入控制點</option></select></label><label>連接模式 <select data-mode><option value="auto">自動路網</option><option value="straight">手動直線</option></select></label><button type="button" data-recalc>重新計算選定路段</button><p data-detail role="status"></p><details><summary>控制點與操作</summary><div data-controls></div></details><details><summary>連接路網（需確認）</summary><p>只列附近候選，不代表已連通。確認後保留原座標，以幾何接入所選參考路段端點，再按重算；接入部分不視為已核實步道。</p><div data-connections></div></details><details><summary>顯示於行程表的節點</summary><div data-visible></div></details><details><summary>操作說明與資料限制</summary><p>拖曳移動地圖，點擊新增位置。控制點使用指定折線，不自動吸附。切回自動並移除控制點，可恢復原線形。復原／重做在頁面工具列。手動路段尚無高程，不代表實際步道、合法或安全可通行。</p></details></div>';
 host.querySelector('[data-map]').before(panel);
 const $=s=>panel.querySelector(s),layer=L.layerGroup().addTo(map);
 const enabled=()=> $('[data-edit]').checked,day=()=>getDays()[Number($('[data-day]').value)||0];
 const segment=()=>{const items=day()?.items.filter(x=>x.type!=='rest')||[],to=items.find(x=>x.id===$('[data-segment]').value);return {to,from:items[items.indexOf(to)-1]}};
 let feedback='',popupBox=null,previewMarker=null;
 function closePopup(){map.closePopup();popupBox?.remove();popupBox=null;if(previewMarker){map.removeLayer(previewMarker);previewMarker=null;}}
 const commit=fn=>{try{feedback=fn()||'';closePopup();onChange();refresh()}catch(e){$('[data-detail]').textContent=e.message}};
 const change=fn=>commit(()=>{const {to,from}=segment();if(!from||!to||!coordinateOf(from,data)||!coordinateOf(to,data))throw Error('端點缺少可靠座標；請先選擇有座標的路段，不會推測或吸附位置。');editSegment(day(),to.id,fn);if(to.pathEdit?.autoReference&&to.pathEdit.mode==='straight')return refitConfirmedSpan(to.pathEdit,from,to,data,getRoute())?'已依確認線形微調接入；控制點座標保持不變。':'無法沿原確認線形微調，保留手動折線；請核對路徑。'});
 function addControl(coordinate,name=''){
  const {to,from}=segment();if(!from||!to||!coordinateOf(from,data)||!coordinateOf(to,data)){feedback='端點缺少可靠座標，無法新增控制點。';refresh();return}
  const edit=to.pathEdit?.fromItemId===from.id?to.pathEdit:null;
  if(edit?.shape){commit(()=>{const id=insertShapeControl(day(),to.id,edit.shape.map(p=>p.coordinate),coordinate,coordinate);const c=to.pathEdit.controls.find(x=>x.id===id);if(c)c.name=name;if(to.pathEdit.autoReference)return refitConfirmedSpan(to.pathEdit,from,to,data,getRoute())?'已插入控制點，並依確認線形微調接入。':'已插入控制點；無法沿原確認線形微調，保留手動折線。';return '已在最近的線段插入控制點。'});return}
  change(e=>e.controls.push({id:uid(),coordinate:[...coordinate],name}));
 }
 function button(text,fn,parent){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;parent.append(b);return b;}
 function addLocation(coordinate,name){
  const d=day(),prev=d.items.filter(x=>x.type!=='rest').at(-1),id=uid();
  d.items.push({id,type:'manual-location',name:name.trim()||'手動節點',coordinate:[...coordinate],showInTable:true,note:'',isPeak:false,hasWater:false,incoming:prev?{kind:'manual',fromId:prev.id,toId:id,actualMinutes:null}:null});
 }
 function popup(coordinate){
  const box=document.createElement('div');box.className='path-popup';
  const text=document.createElement('p');text.className='path-coordinate';text.textContent=twd97Label(coordinate);box.append(text);
  const more=document.createElement('details');more.innerHTML='<summary>座標與路徑說明</summary>';const info=document.createElement('p');info.textContent=`WGS84 ${coordinate[1].toFixed(6)}, ${coordinate[0].toFixed(6)}。手動路段尚無高程；幾何連接不代表可通行。`;more.append(info);
  const name=document.createElement('input');name.placeholder='自訂節點名稱';name.value='手動節點';name.maxLength=250;name.setAttribute('aria-label','自訂節點名稱');box.append(name);
  button('複製座標',async()=>{try{await navigator.clipboard.writeText(text.textContent)}catch{const range=document.createRange();range.selectNodeContents(text);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)}},box);
  button('加入行程',()=>commit(()=>addLocation(coordinate,name.value)),box);
  button('設為路徑控制點',()=>addControl(coordinate,name.value),box);
  box.append(more);
  closePopup();previewMarker=L.circleMarker([coordinate[1],coordinate[0]],{radius:7,color:'#fff',weight:3,fillColor:'#b95220',fillOpacity:1,interactive:false}).addTo(map);button('關閉',closePopup,box);L.DomEvent.disableClickPropagation(box);L.DomEvent.disableScrollPropagation(box);map.getContainer().append(box);popupBox=box;
 }
 map.on('click',event=>{if(!enabled())return;const coordinate=[event.latlng.lng,event.latlng.lat];if($('[data-click]').value==='control')addControl(coordinate);else popup(coordinate)});
 $('[data-edit]').onchange=()=>{$('[data-tools]').hidden=!enabled();closePopup();refresh()};
 $('[data-day]').onchange=()=>{feedback='';refresh()};$('[data-segment]').onchange=()=>{feedback='';refresh()};
 $('[data-mode]').onchange=()=>change(e=>{e.mode=$('[data-mode]').value});
 $('[data-recalc]').onclick=()=>{
  const {from,to}=segment();
  if(from?.type==='manual-location'&&to?.type==='manual-location'&&!from.networkConnection&&!to.networkConnection&&!to.pathEdit?.controls?.length&&(!to.pathEdit||to.pathEdit.mode==='auto')){
   const candidates=directSpanCandidates(from,to,data,getRoute());
   if(candidates.length===1){
    const candidate=candidates[0];
    if(!confirm(`找到 1 條方向連通的參考線形（${candidate.sourceName}；兩端距離約 ${Math.round(candidate.distanceA)}、${Math.round(candidate.distanceB)} 公尺）。使用此線形作為手動規劃參考？原座標保留，接入部分尚未驗證。`)){feedback='已取消使用候選線形；原路徑保持不變。';refresh();return}
    commit(()=>{editSegment(day(),to.id,e=>{e.mode='straight';e.controls=[];e.shape=candidate.coordinates.map(coordinate=>({coordinate:[...coordinate]}));e.candidateSource={spanId:candidate.spanId,name:candidate.sourceName,url:candidate.sourceUrl};e.autoReference=true});return '已依確認的參考線形建立路徑；手動接入、時間及高程請另行核對。'});return;
   }
   if(candidates.length>1){feedback='附近有多條可能線形，請展開「連接路網」確認兩端，避免誤選。';refresh();return}
  }
  commit(()=>recalculateSegment(day(),to?.id,getRoute()));
 };
 function refresh(){
  const chosenDay=$('[data-day]').value,chosenSegment=$('[data-segment]').value;
  $('[data-day]').replaceChildren(...getDays().map((d,i)=>new Option('Day '+(i+1),String(i))));$('[data-day]').value=chosenDay||'0';if(!day())$('[data-day]').value='0';
  const items=day()?.items.filter(x=>x.type!=='rest')||[];
  $('[data-segment]').replaceChildren(...items.slice(1).map((to,i)=>new Option(items[i].name+' → '+to.name,to.id)));
  if(items.some(i=>i.id===chosenSegment))$('[data-segment]').value=chosenSegment;
  const {to,from}=segment(),edit=to?.pathEdit&&to.pathEdit.fromItemId===from?.id?to.pathEdit:null;
  $('[data-mode]').value=edit?.mode||'auto';$('[data-mode]').disabled=!to;$('[data-recalc]').disabled=!to;
  $('[data-detail]').textContent=feedback||(to?(coordinateOf(from,data)&&coordinateOf(to,data)?((edit?.controls.length||edit?.mode==='straight'||to.incoming?.kind==='manual')?'手動路段：尚無高程。':'沿既有已連通路網。'):'端點缺少可靠座標，無法產生手動線形。'):'點地圖新增位置，或先在 DAY 加入節點。');
  layer.clearLayers();$('[data-controls]').replaceChildren();
  for(const [index,c] of (edit?.controls||[]).entries()){
   const row=document.createElement('div');row.className='path-control';row.textContent=`${index+1} · ${twd97Label(c.coordinate)} `;
   if(index&&!edit?.shape)button('向前移',()=>change(e=>{[e.controls[index-1],e.controls[index]]=[e.controls[index],e.controls[index-1]]}),row);
   button('刪除',()=>change(e=>deleteShapeControl(e,index)),row);
   button('同位置新增 DAY 終點',()=>commit(()=>addLocation(c.coordinate,c.name||'手動節點')),row);
   $('[data-controls]').append(row);
   if(enabled()){
    const content=document.createElement('div');content.append(document.createTextNode(`控制點 ${index+1} · ${twd97Label(c.coordinate)}`));
    button('刪除控制點',()=>change(e=>deleteShapeControl(e,index)),content);
    L.marker([c.coordinate[1],c.coordinate[0]],{draggable:true,icon:L.divIcon({className:'path-control-marker',html:'<span>'+String(index+1)+'</span>',iconSize:[44,44],iconAnchor:[22,22]})}).bindPopup(content,{autoPan:false}).on('dragend',event=>{const p=event.target.getLatLng();change(e=>updateShapeControl(e,index,[p.lng,p.lat]))}).addTo(layer);
   }
  }
  $('[data-connections]').replaceChildren();
  for(const item of [from,to].filter(x=>x?.type==='manual-location')){
   const row=document.createElement('div'),label=document.createElement('label'),select=document.createElement('select'),candidates=attachmentCandidates(item,data);
   label.textContent=item.name;select.setAttribute('aria-label',item.name+'的候選連接路段');select.append(new Option('選擇候選路段／連接端',''));
   candidates.forEach((c,i)=>select.append(new Option(c.label+'（距線約 '+Math.round(c.distance)+' m）',String(i))));label.append(select);row.append(label);
   const confirm=button('確認連接',()=>{const c=candidates[Number(select.value)];if(select.value===''||!c)return;commit(()=>{item.networkConnection={spanId:c.spanId,nodeId:c.nodeId};for(const dest of day().items)if(dest.pathEdit?.fromItemId===item.id||dest.id===item.id)delete dest.pathEdit?.networkNodeIds;return '已確認連接 '+c.label+'；原座標保留，請按重新計算。';})},row);confirm.disabled=true;select.onchange=()=>{confirm.disabled=select.value===''};
   if(item.networkConnection){const status=document.createElement('small');status.textContent='已確認：'+item.networkConnection.nodeId;row.append(status);button('取消連接',()=>commit(()=>{delete item.networkConnection;return '已取消路網連接，原座標保留。'}),row);}
   $('[data-connections]').append(row);
  }
  $('[data-visible]').replaceChildren();
  for(const [i,item] of items.entries()){
   const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=item.showInTable!==false;check.disabled=i===0||i===items.length-1;check.onchange=()=>commit(()=>{item.showInTable=check.checked});label.append(check,document.createTextNode(item.name));$('[data-visible]').append(label);
  }
 }
 refresh();
 function choose(dayIndex,toId){$('[data-day]').value=String(dayIndex);refresh();$('[data-segment]').value=toId;refresh()}
 return {refresh,isEnabled:enabled,select(dayIndex,toId){if(enabled())choose(dayIndex,toId)},
  insertAt(dayIndex,toId,geometry,at,coordinate){if(!enabled())return;choose(dayIndex,toId);commit(()=>{insertShapeControl(day(),toId,geometry,at,coordinate);const {from,to}=segment();if(to.pathEdit.autoReference)return refitConfirmedSpan(to.pathEdit,from,to,data,getRoute())?'已插入控制點，並依確認線形微調接入。':'已插入控制點；無法沿原確認線形微調，保留手動折線。';return '已插入控制點；此段為手動幾何，高程與時間需另確認。'})},
  splitAt(dayIndex,toId,geometry,at,name){if(!enabled())return;choose(dayIndex,toId);commit(()=>{splitManualShape(day(),toId,geometry,at,name);return '已插入行程節點；前後兩段時間待填，原路段時間保留於備份資料。'})}
 };
}
