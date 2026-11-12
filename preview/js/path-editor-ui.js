import {coordinateOf,editSegment,recalculateSegment,manualWarning} from './path-editor.js';
import {twd97Label} from './twd97.js?v=v0731';
import {uid} from './planner.js?v=segments1';

// All mutations use the editor's existing scroll guard, autosave and history.
export function attachPathEditor({host,map,getDays,getRoute,data,onChange}){
 const panel=document.createElement('div');panel.className='path-editor';
 panel.innerHTML='<label><input type="checkbox" data-edit> 編輯路徑模式</label><div data-tools hidden><p>一般拖曳移動地圖；點地圖新增位置。選路段後可插入控制點，拖曳橙色控制點調整位置。</p><label>DAY <select data-day></select></label><label>選定路段 <select data-segment></select></label><label>點擊地圖 <select data-click><option value="node">新增節點</option><option value="control">插入控制點</option></select></label><label>連接模式 <select data-mode><option value="auto">自動（沿已連通路網；無網路時直線）</option><option value="straight">手動直線</option></select></label><button type="button" data-recalc>重新計算選定路段</button><p data-detail role="status"></p><div data-controls></div><details><summary>顯示於行程表的節點</summary><div data-visible></div></details><p>控制點之間使用指定折線，不吸附路網。切回自動並移除控制點，恢復原路段時間與線形。撤銷／重做使用頁面工具列。</p></div>';
 host.querySelector('[data-map]').before(panel);
 const $=s=>panel.querySelector(s),layer=L.layerGroup().addTo(map);
 const enabled=()=> $('[data-edit]').checked,day=()=>getDays()[Number($('[data-day]').value)||0];
 const segment=()=>{const items=day()?.items.filter(x=>x.type!=='rest')||[],to=items.find(x=>x.id===$('[data-segment]').value);return {to,from:items[items.indexOf(to)-1]}};
 const commit=fn=>{try{fn();map.closePopup();onChange();refresh()}catch(e){$('[data-detail]').textContent=e.message}};
 const change=fn=>commit(()=>{const {to,from}=segment();if(!from||!to||!coordinateOf(from,data)||!coordinateOf(to,data))throw Error('端點缺少可靠座標；請先選擇有座標的路段，不會推測或吸附位置。');editSegment(day(),to.id,fn)});
 function button(text,fn,parent){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;parent.append(b);return b;}
 function addLocation(coordinate,name){
  const d=day(),prev=d.items.filter(x=>x.type!=='rest').at(-1),id=uid();
  d.items.push({id,type:'manual-location',name:name.trim()||'手動節點',coordinate:[...coordinate],showInTable:true,note:'',isPeak:false,hasWater:false,incoming:prev?{kind:'manual',fromId:prev.id,toId:id,actualMinutes:null}:null});
 }
 function popup(coordinate){
  const box=document.createElement('div');box.className='path-popup';
  const text=document.createElement('p');text.textContent=`WGS84 ${coordinate[1].toFixed(6)}, ${coordinate[0].toFixed(6)} · ${twd97Label(coordinate)}`;box.append(text);
  const name=document.createElement('input');name.placeholder='自訂節點名稱';name.value='手動節點';name.maxLength=250;name.setAttribute('aria-label','自訂節點名稱');box.append(name);
  button('複製座標',async()=>{try{await navigator.clipboard.writeText(text.textContent)}catch{const range=document.createRange();range.selectNodeContents(text);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)}},box);
  button('加入行程',()=>commit(()=>addLocation(coordinate,name.value)),box);
  button('設為路徑控制點',()=>change(e=>e.controls.push({id:uid(),coordinate:[...coordinate],name:name.value})),box);
  const note=document.createElement('p');note.textContent=manualWarning;box.append(note);
  L.popup({autoPan:false}).setLatLng([coordinate[1],coordinate[0]]).setContent(box).openOn(map);
 }
 map.on('click',event=>{if(!enabled())return;const coordinate=[event.latlng.lng,event.latlng.lat];if($('[data-click]').value==='control')change(e=>e.controls.push({id:uid(),coordinate}));else popup(coordinate)});
 $('[data-edit]').onchange=()=>{$('[data-tools]').hidden=!enabled();map.closePopup();refresh()};
 $('[data-day]').onchange=refresh;$('[data-segment]').onchange=refresh;
 $('[data-mode]').onchange=()=>change(e=>{e.mode=$('[data-mode]').value});
 $('[data-recalc]').onclick=()=>commit(()=>{recalculateSegment(day(),segment().to?.id,getRoute());});
 function refresh(){
  const chosenDay=$('[data-day]').value,chosenSegment=$('[data-segment]').value;
  $('[data-day]').replaceChildren(...getDays().map((d,i)=>new Option('Day '+(i+1),String(i))));$('[data-day]').value=chosenDay||'0';if(!day())$('[data-day]').value='0';
  const items=day()?.items.filter(x=>x.type!=='rest')||[];
  $('[data-segment]').replaceChildren(...items.slice(1).map((to,i)=>new Option(items[i].name+' → '+to.name,to.id)));
  if(items.some(i=>i.id===chosenSegment))$('[data-segment]').value=chosenSegment;
  const {to,from}=segment(),edit=to?.pathEdit&&to.pathEdit.fromItemId===from?.id?to.pathEdit:null;
  $('[data-mode]').value=edit?.mode||'auto';$('[data-mode]').disabled=!to;$('[data-recalc]').disabled=!to;
  $('[data-detail]').textContent=to?(coordinateOf(from,data)&&coordinateOf(to,data)?'選定路段可編輯。'+((edit?.controls.length||edit?.mode==='straight'||to.incoming?.kind==='manual')?manualWarning:'沿既有已連通路網；來源線形缺漏仍會提示。'):'端點缺少可靠座標，無法產生手動線形。'):'請先在 DAY 加入至少兩個節點。';
  layer.clearLayers();$('[data-controls]').replaceChildren();
  for(const [index,c] of (edit?.controls||[]).entries()){
   const row=document.createElement('div');row.className='path-control';row.textContent=`控制點 ${index+1} · ${c.coordinate[1].toFixed(6)}, ${c.coordinate[0].toFixed(6)} `;
   if(index)button('向前移',()=>change(e=>{[e.controls[index-1],e.controls[index]]=[e.controls[index],e.controls[index-1]]}),row);
   button('刪除',()=>change(e=>e.controls.splice(index,1)),row);
   button('同位置新增 DAY 終點',()=>commit(()=>addLocation(c.coordinate,c.name||'手動節點')),row);
   $('[data-controls]').append(row);
   if(enabled())L.marker([c.coordinate[1],c.coordinate[0]],{draggable:true,icon:L.divIcon({className:'path-control-marker',html:String(index+1),iconSize:[44,44],iconAnchor:[22,22]})}).on('dragend',event=>{const p=event.target.getLatLng();change(e=>{e.controls[index].coordinate=[p.lng,p.lat]})}).addTo(layer);
  }
  $('[data-visible]').replaceChildren();
  for(const [i,item] of items.entries()){
   const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=item.showInTable!==false;check.disabled=i===0||i===items.length-1;check.onchange=()=>commit(()=>{item.showInTable=check.checked});label.append(check,document.createTextNode(item.name));$('[data-visible]').append(label);
  }
 }
 refresh();
 return {refresh,select(dayIndex,toId){if(!enabled())return;$('[data-day]').value=String(dayIndex);refresh();$('[data-segment]').value=toId;refresh()}};
}
