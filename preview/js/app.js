import {loadManifest,loadRoute} from './data-loader.js';
import {allNodes,shortestPath,uid,round2,edgeActual,buildTimeline,summarizeDay,recalcConnections,formatDuration,missingSegments,canDeleteItem,normalizeDay,retargetSplitIncoming} from './planner.js';
import {validatePlan} from './validation.js';
import {addRouteIdentity,migrateDaysToNodeIds,findNodeById} from './node-identity.js';
import {exportExcel} from './exporter.js';
import {filterLocations} from './node-browser.js?v=v074';

const $=id=>document.getElementById(id);
const STORAGE_KEY='mountain-planner.autosave.v1';
const APP_VERSION='v0.7.9 Preview';
const COLLAPSE_KEY='mountain-planner.collapsed-days.v1';
let collapsedDays=new Set();
let manifest,route=null,nodes=[],days=[],drag=null,tripStartDate='';
let snapshots=[],at=-1,restoring=false;
function checkpoint(){if(restoring)return;const state=JSON.stringify({routeId:route?.route_id||null,tripStartDate,days});if(state===snapshots[at])return;snapshots=snapshots.slice(0,at+1);snapshots.push(state);if(snapshots.length>50)snapshots.shift();at=snapshots.length-1;buttons()}
function buttons(){
  ['undoBtn','floatUndoBtn'].forEach(id=>{if($(id))$(id).disabled=at<1});
  ['redoBtn','floatRedoBtn'].forEach(id=>{if($(id))$(id).disabled=at>=snapshots.length-1});
}
async function restore(i){if(i<0||i>=snapshots.length)return;const x=JSON.parse(snapshots[i]);restoring=true;try{if(x.routeId)await loadGroup(x.routeId);else setNoRoute();$('routeSelect').value=x.routeId||'';tripStartDate=x.tripStartDate;$('tripDate').value=tripStartDate;days=migrateDaysToNodeIds(x.days,route);$('dayCount').value=String(days.length);at=i;render();buttons()}finally{restoring=false}}
const checkMissing=()=>{const n=days.reduce((sum,d)=>sum+missingSegments(d),0);return n===0||confirm('有 '+n+' 個路段未填時間，匯出結果含未完成時間。仍繼續？')};


const newDay=i=>({id:uid(),startTime:i?'05:30':'06:00',coefficient:.8,linkedStart:false,note:'',items:[]});
const locs=d=>d.items.filter(x=>x.type!=='rest');
const first=d=>locs(d)[0]||null;
const last=d=>{const a=locs(d);return a[a.length-1]||null};
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clampMin=v=>Math.max(0,Number(v)||0);

async function init(){
  manifest=await loadManifest();
  if($('appVersion'))$('appVersion').textContent=APP_VERSION;
  $('routeSelect').innerHTML='<option value="">請選擇上河圖</option>'+manifest.routes.map(r=>'<option value="'+r.id+'">'+r.id+'｜'+r.name+'</option>').join('');
  $('dayCount').innerHTML=Array.from({length:10},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+' 天</option>').join('');

  try{collapsedDays=new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY)||'[]'))}catch(e){collapsedDays=new Set()}

  const restored=loadAutosave();
  if(restored?.routeId&&manifest.routes.some(r=>r.id===restored.routeId)){
    await loadGroup(restored.routeId);
    $('routeSelect').value=restored.routeId;
  }else{
    setNoRoute();
    $('routeSelect').value='';
  }

  tripStartDate=restored?.tripStartDate||'';
  $('tripDate').value=tripStartDate;
  days=restored?.days?.length?sanitizeDays(migrateDaysToNodeIds(restored.days,route)):[newDay(0)];
  $('dayCount').value=String(days.length);
  bindGlobal();
  render(false);checkpoint();
}

async function loadGroup(id){
  const meta=manifest.routes.find(r=>r.id===id);
  if(!meta){setNoRoute();return}
  route=addRouteIdentity(await loadRoute(meta.file));
  nodes=allNodes(route);
  $('routeMeta').textContent=route.route_id+'｜'+route.route_name+'｜'+route.status;
}
function setNoRoute(){
  route=null;nodes=[];$('routeMeta').textContent='尚未選擇上河圖';
}

function sanitizeDays(rawDays){
  return rawDays.slice(0,10).map((d,i)=>({
    id:d.id||uid(),
    startTime:d.startTime||(i?'05:30':'06:00'),
    coefficient:Number(d.coefficient)||.8,
    linkedStart:i>0?!!d.linkedStart:false,
    note:d.note||'',
    items:Array.isArray(d.items)?d.items.map(x=>({...x,id:x.id||uid()})):[]
  }));
}

function saveAutosave(){
  try{
    localStorage.setItem(STORAGE_KEY,JSON.stringify({
      format:'mountain-planner',schemaVersion:1,
      routeId:route?.route_id||null,
      datasetVersion:manifest.dataset_version,
      tripStartDate,days
    }));
  }catch(e){}
}
function loadAutosave(){
  try{const x=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');return x?.format==='mountain-planner'?x:null}catch(e){return null}
}
function clearAutosave(){try{localStorage.removeItem(STORAGE_KEY)}catch(e){}}

function bindGlobal(){
  $('routeSelect').onchange=async e=>{
    const id=e.target.value;
    if(days.some(d=>d.items.length)&&!confirm('切換上河圖會清空目前行程，確定切換？')){
      e.target.value=route?.route_id||'';return;
    }
    if(id)await loadGroup(id);else setNoRoute();
    days=[newDay(0)];
    $('dayCount').value='1';
    render();
  };
  $('tripDate').onchange=e=>{tripStartDate=e.target.value;render()};
  $('dayCount').onchange=e=>{
    const n=+e.target.value;
    while(days.length<n)days.push(newDay(days.length));
    days=days.slice(0,n);
    render();
  };
  $('undoBtn').onclick=()=>restore(at-1);$('redoBtn').onclick=()=>restore(at+1);
  $('floatUndoBtn').onclick=()=>restore(at-1);$('floatRedoBtn').onclick=()=>restore(at+1);
  const mobileMap={mobileUndo:'undoBtn',mobileRedo:'redoBtn',mobileSave:'saveBtn',mobileImport:'importBtn',mobileCopy:'copyBtn',mobileExcel:'exportBtn',mobileReset:'resetBtn'};
  Object.entries(mobileMap).forEach(([from,to])=>{if($(from))$(from).onclick=()=>{$(to).click();document.querySelector('.global-menu')?.removeAttribute('open')}});
  const floatHistory=$('floatingHistory'),syncFloating=()=>{if(floatHistory)floatHistory.classList.toggle('visible',window.scrollY>240)};
  window.addEventListener('scroll',syncFloating,{passive:true});syncFloating();
  document.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey))return;const a=document.activeElement;if(['INPUT','TEXTAREA','SELECT'].includes(a?.tagName))return;const k=e.key.toLowerCase();if(k==='z'||k==='y'){e.preventDefault();restore(at+(k==='y'||e.shiftKey?1:-1))}});
  // Close popovers when interacting elsewhere. Keep the clicked menu open
  // and allow native <details>/<summary> to handle its own toggle.
  const menus='.row-menu[open],.header-more[open],.global-menu[open]';
  document.addEventListener('click',e=>{
    document.querySelectorAll(menus).forEach(menu=>{
      if(!menu.contains(e.target))menu.open=false;
    });
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape')document.querySelectorAll(menus+'[open]').forEach(menu=>menu.open=false);
  });
  $('resetBtn').onclick=()=>{
    if(!confirm('確定清除全部行程？可使用復原還原。'))return;
    setNoRoute();$('routeSelect').value='';
    tripStartDate='';$('tripDate').value='';
    days=[newDay(0)];$('dayCount').value='1';
    clearAutosave();render();
  };
  $('exportBtn').onclick=async()=>{
    if(!route){alert('請先選擇上河圖');return}
    if(!days.some(d=>locs(d).length)){alert('請先建立行程');return}
    if(!checkMissing())return;
    await exportExcel({route,days,datasetVersion:manifest.dataset_version,tripStartDate});
  };
  $('copyBtn').onclick=copyTextItinerary;
  $('saveBtn').onclick=downloadPlan;
  $('importBtn').onclick=()=>$('importFile').click();
  $('importFile').onchange=importPlan;
}

function unlinkNextIfEndpointChanges(day){
  const i=days.indexOf(day),next=days[i+1];
  if(next?.linkedStart){next.linkedStart=false;const f=first(next);if(f)f._linkedStart=false}
}
function addNode(day,nodeId){
  if(!route){alert('請先選擇上河圖');return}
  const selected=findNodeById(route,nodeId);
  if(!selected){alert('找不到所選的官方地點');return}
  const name=selected.name;
  const p=last(day);
  if(p)unlinkNextIfEndpointChanges(day);
  if(!p){
    day.items.push({id:uid(),type:'location',name,nodeId,note:'',isPeak:false,hasWater:false,incoming:null});
    return;
  }
  if(p.type==='manual-location'){
    const id=uid();
    day.items.push({id,type:'location',name,nodeId,note:'',isPeak:false,hasWater:false,incoming:{kind:'manual',fromId:p.id,toId:id,actualMinutes:null}});
    return;
  }
  const path=shortestPath(route,p.nodeId,nodeId);
  if(!path){alert('找不到 '+p.name+' → '+name+' 的上河路徑');return}
  path.segments.forEach((s,i)=>day.items.push({
    id:uid(),type:'location',name:s.to,nodeId:s.toId,
    note:'',isPeak:false,hasWater:false,
    incoming:{kind:'official',from:s.from,to:s.to,fromNodeId:s.fromId,toNodeId:s.toId,officialMinutes:s.minutes,actualMinutes:null,source:route.source.image_url}
  }));
}

function connectToPrevious(i){
  if(i<1)return;
  const prevEnd=last(days[i-1]),d=days[i];
  if(!prevEnd){d.linkedStart=false;return}
  const f=first(d);
  if(f&&f.type===prevEnd.type&&(f.type==='location'?f.nodeId&&f.nodeId===prevEnd.nodeId:f.name===prevEnd.name)){
    f.incoming=null;f._linkedStart=true;d.linkedStart=true;
  }else{
    d.items.unshift({id:uid(),type:prevEnd.type,name:prevEnd.name,...(prevEnd.nodeId?{nodeId:prevEnd.nodeId}:{}),note:'',isPeak:!!prevEnd.isPeak,hasWater:!!prevEnd.hasWater,incoming:null,_linkedStart:true});
    d.linkedStart=true;
  }
  normalizeDay(d,route);
}
function addManualStart(d){
  if(d.linkedStart){d.linkedStart=false;const f=first(d);if(f)f._linkedStart=false}
  if(locs(d).length===0){
    d.items.unshift({id:uid(),type:'manual-location',name:'手動起點',note:'',isPeak:false,hasWater:false,incoming:null});
  }else{
    d.items.unshift({id:uid(),type:'manual-location',name:'手動起點',note:'',isPeak:false,hasWater:false,incoming:null});
    normalizeDay(d,route);
  }
  d.linkedStart=false;render();
}
function addManualEnd(d){
  if(locs(d).length)unlinkNextIfEndpointChanges(d);
  const p=last(d),id=uid();
  d.items.push({id,type:'manual-location',name:'手動終點',note:'',isPeak:false,hasWater:false,
    incoming:p?{kind:'manual',fromId:p.id,toId:id,actualMinutes:null}:null});
  render();
}

function insertRest(d,afterIdx){d.items.splice(afterIdx+1,0,{id:uid(),type:'rest',minutes:15});render()}
function insertManualBefore(d,destIdx){
  const dest=d.items[destIdx],prev=[...d.items.slice(0,destIdx)].reverse().find(x=>x.type!=='rest');if(!dest||!prev)return;
  const m={id:uid(),type:'manual-location',name:'手動節點',auto:false,waypoint:true,note:'',isPeak:false,hasWater:false,incoming:{kind:'manual',fromId:prev.id,toId:null,actualMinutes:null}};
  m.incoming.toId=m.id;
  dest.incoming={kind:'manual',fromId:m.id,toId:dest.id,actualMinutes:null};
  d.items.splice(destIdx,0,m);render();
}
function removeItem(d,idx){
  if(!canDeleteItem(d,idx))return;
  const target=d.items[idx],wasEnd=target&&target.type!=='rest'&&last(d)?.id===target.id,wasStart=target&&target.type!=='rest'&&first(d)?.id===target.id;
  if(wasEnd)unlinkNextIfEndpointChanges(d);
  if(wasStart)d.linkedStart=false;
  d.items.splice(idx,1);
  normalizeDay(d,route);
  render();
}

function splitDay(i,idx){
 if(i>=9){alert('最多 10 天');return}
 const d=days[i],cut=d.items[idx];if(!cut||cut.type==='rest'||!d.items.slice(0,idx).some(x=>x.type!=='rest')){alert('請選擇起點之後的地點');return}
 let next=days[i+1];if(next?.items.length&&!confirm('下一天已有行程，移入的路段會排在前面並重算連接。確定？'))return;
 if(!next){next=newDay(i+1);days.push(next)}
 const moved=d.items.splice(idx+1);const start={...cut,id:uid(),incoming:null,_linkedStart:true};
 retargetSplitIncoming(moved,cut.id,start.id);
 next.items=[start,...moved,...next.items.filter((x,j)=>!(j===0&&x._linkedStart))];next.linkedStart=true;
 normalizeDay(next,route);$('dayCount').value=String(days.length);render();
}
function copyTextItinerary(){
  const blocks=[];
  days.forEach((d,i)=>{
    const rows=buildTimeline(d).rows.filter(r=>r.type!=='rest');
    if(!rows.length)return;
    blocks.push('D'+(i+1)+'：'+rows.map(r=>r.arrival+' '+r.name+(r.isPeak?'⛰':'')+(r.hasWater?'💧':'')).join('→')+'。');
  });
  const text=blocks.join('\n\n');if(!checkMissing())return;
  if(!text){alert('目前沒有可複製的行程');return}
  const done=()=>toast('已複製文字行程');
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done));else fallbackCopy(text,done);
}
function fallbackCopy(text,done){const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();done()}
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),1800)}

function downloadPlan(){
  if(!checkMissing())return;
  if(!route&&!days.some(d=>d.items.length)){alert('目前沒有可匯出的行程');return}
  const payload={format:'mountain-planner',schemaVersion:1,savedAt:new Date().toISOString(),routeId:route?.route_id||null,datasetVersion:manifest.dataset_version,tripStartDate,days};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(route?route.route_id+'_'+route.route_name:'mountain-planner')+'.mplan.json';
  a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function importPlan(e){
 const file=e.target.files?.[0];e.target.value='';if(!file)return;
 try{
  const data=validatePlan(JSON.parse(await file.text()),manifest.routes.map(r=>r.id));
  let loaded=null;if(data.routeId){const m=manifest.routes.find(r=>r.id===data.routeId);loaded=addRouteIdentity(await loadRoute(m.file))}
  const importedDays=sanitizeDays(migrateDaysToNodeIds(data.days,loaded));
  if(days.some(d=>d.items.length)&&!confirm('匯入將取代目前行程，可以使用復原。確定？'))return;
  if(loaded){route=loaded;nodes=allNodes(route);$('routeMeta').textContent=route.route_id+'｜'+route.route_name+'｜'+route.status;$('routeSelect').value=data.routeId}
  else{setNoRoute();$('routeSelect').value=''}
  tripStartDate=data.tripStartDate||'';$('tripDate').value=tripStartDate;
  days=importedDays;$('dayCount').value=String(days.length);
  render();if(data.datasetVersion&&data.datasetVersion!==manifest.dataset_version)alert('資料庫版本不同；已保留檔案中的官方時間快照，請核對。');else toast('行程已匯入');
 }catch(err){alert('匯入失敗：'+err.message)}
}

function dayDate(index){
  if(!tripStartDate)return '';
  const d=new Date(tripStartDate+'T00:00:00');d.setDate(d.getDate()+index);
  return String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0');
}
function opts(){return (route?.nodes||[]).slice().sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant')).map(n=>'<option value="'+esc(n.id)+'">'+esc(n.name)+'</option>').join('')}
function render(persist=true){
  $('daysContainer').innerHTML=days.map(renderDay).join('');
  bindDays();
  if(persist){saveAutosave();checkpoint()}
}

function renderDay(d,i){
  const s=summarizeDay(d),collapsed=collapsedDays.has(d.id),f=first(d),l=last(d);
  const date=dayDate(i);
  const selector=route?'<select class="add-node"><option value="">選擇下一個行程點</option>'+opts()+'</select>':'<select class="add-node" disabled><option>請先選擇上河圖</option></select>';
  const summary=(f&&l?esc(f.name)+' → '+esc(l.name):'尚未建立行程')+' · '+(s.missing?'未完成':formatDuration(s.total));
  return '<article class="card day-card '+(collapsed?'collapsed':'')+'" data-day="'+i+'">'+
  '<div class="day-head"><button class="day-toggle" type="button" aria-label="'+(collapsed?'展開':'摺疊')+' Day '+(i+1)+'">'+(collapsed?'▶':'▼')+'</button><div class="day-title"><strong>Day '+(i+1)+'</strong>'+(date?'<span class="day-date">'+date+'</span>':'')+'<span class="collapsed-summary">'+summary+'</span></div>'+
  '<div class="day-control"><label>出發</label><input class="start-time" type="time" value="'+d.startTime+'"></div>'+
  '<div class="day-control coefficient"><label>預設係數</label><input class="day-coef" type="number" min="0.1" max="3" step="0.01" value="'+Number(d.coefficient).toFixed(2)+'"></div>'+
  '<div class="stats"><div class="stat"><span>行進</span><b>'+formatDuration(s.movement)+'</b></div><div class="stat"><span>休息</span><b>'+formatDuration(s.rest)+'</b></div><div class="stat"><span>總計</span><b>'+(s.missing?'未完成':formatDuration(s.total))+'</b></div><div class="stat coef"><span>平均</span><b>'+(s.coefficient??'—')+'</b></div></div>'+
  '<button class="clear-day">清除 Day '+(i+1)+'</button></div>'+
  '<div class="day-tools">'+(i?'<label class="link-wrap"><input class="link-start" type="checkbox" '+(d.linkedStart?'checked':'')+'>銜接前日</label>':'<span class="link-wrap">第一點即起點</span>')+
  '<div class="node-picker-controls"><input class="node-search-inline" type="search" placeholder="搜尋節點" aria-label="搜尋當日要加入的節點" autocomplete="off" '+(route?'':'disabled')+'>'+selector+'</div><div class="node-action-controls"><button class="add-dest" '+(route?'':'disabled')+'>加入</button><button class="manual-start secondary compact-day-action">＋手動起點</button><button class="manual-end secondary compact-day-action">＋手動終點</button></div></div>'+
  (s.missing?'<div class="missing-warning">尚有 '+s.missing+' 個手動路段未填時間；後續時間無法計算。</div>':'')+
  '<div class="timeline">'+renderTimeline(d)+'</div>'+
  '<div class="day-footer"><textarea class="day-note" placeholder="Day '+(i+1)+' 備註">'+esc(d.note||'')+'</textarea></div></article>';
}

function renderTimeline(d){
  const rows=buildTimeline(d).rows;
  if(!rows.length)return '<div class="empty">'+(route?'直接選擇第一個行程點；它就是當日的起點。':'請先選擇上河圖群組。')+'</div>';
  let html='<div class="drop-zone" data-drop="0"></div>';
  rows.forEach(r=>{
    const idx=d.items.findIndex(x=>x.id===r.id);
    if(r.type==='rest'){
      html+='<div class="it-row rest-row" data-index="'+idx+'">'+
      '<div class="place"><span class="drag-handle" draggable="true" data-index="'+idx+'">⋮⋮</span><span class="place-name">☕ 休息</span></div>'+
      '<div class="arrival">'+r.endTime+'</div>'+
      '<div class="route-info"><input class="rest-min minute-input" data-index="'+idx+'" type="number" min="0" value="'+r.minutes+'"><span>m</span></div><div></div>'+menuHtml(idx,true,false,true)+'</div>';
    }else{
      const e=r.incoming,a=e?edgeActual(e,d.coefficient):0,manual=r.type==='manual-location';
      let routeInfo='<span class="secondary-info">起點</span>';
      if(e?.kind==='official'){
        const k=e.officialMinutes?round2(a/e.officialMinutes):0;
        routeInfo='<input class="edge-time minute-input" data-index="'+idx+'" type="number" min="0" value="'+a+'"><span>m</span><span class="secondary-info">上河'+Math.round(Number(e.officialMinutes)||0)+'m · ×'+Number(k).toFixed(2)+'</span>';
      }else if(e?.kind==='manual'){
        routeInfo='<input class="edge-time minute-input" data-index="'+idx+'" type="number" min="0" placeholder="0" value="'+(e.actualMinutes??'')+'"><span>m</span><span class="manual-note">手動</span>';
      }
      const peak='<button class="icon-toggle peak '+(r.isPeak?'active':'')+'" data-index="'+idx+'" title="山頭">⛰</button>';
      const water='<button class="icon-toggle water '+(r.hasWater?'active':'')+'" data-index="'+idx+'" title="水源">💧</button>';
      const placeName=manual
        ?'<span class="drag-handle" draggable="true" data-index="'+idx+'">⋮⋮</span>'+peak+'<input class="manual-name" data-index="'+idx+'" value="'+esc(r.name)+'">'+water
        :peak+'<span class="place-name">'+esc(r.name)+'</span>'+water;
      html+='<div class="it-row" data-index="'+idx+'">'+
      '<div class="place">'+placeName+'</div>'+
      '<div class="arrival">'+r.arrival+'</div>'+
      '<div class="route-info">'+routeInfo+'</div>'+
      '<input class="note-input" data-index="'+idx+'" placeholder="備註" value="'+esc(r.note||'')+'">'+
      menuHtml(idx,false,!!r.incoming,canDeleteItem(d,idx))+'</div>';
    }
    html+='<div class="drop-zone" data-drop="'+(idx+1)+'"></div>';
  });
  return html;
}
function menuHtml(idx,isRest,canManual,canDelete){
  if(isRest)return '<details class="row-menu"><summary>⋯</summary><div class="menu-box"><button class="delete" data-action="delete" data-index="'+idx+'">刪除</button></div></details>';
  return '<details class="row-menu"><summary>⋯</summary><div class="menu-box"><button data-action="rest" data-index="'+idx+'">插入休息</button>'+(canManual?'<button data-action="manual" data-index="'+idx+'">在此段插入手動點</button>':'')+'<button data-action="split" data-index="'+idx+'">從此點開始下一天</button>'+(canDelete?'<button class="delete" data-action="delete" data-index="'+idx+'">刪除節點</button>':'')+'</div></details>';
}

function bindDays(){
  document.querySelectorAll('.row-menu').forEach(menu=>menu.addEventListener('toggle',()=>{
    if(menu.open)document.querySelectorAll('.row-menu[open]').forEach(other=>{if(other!==menu)other.open=false});
  }));
  document.querySelectorAll('.day-card').forEach(card=>{
    const i=+card.dataset.day,d=days[i];
    card.querySelector('.day-toggle').onclick=()=>{if(collapsedDays.has(d.id))collapsedDays.delete(d.id);else collapsedDays.add(d.id);try{localStorage.setItem(COLLAPSE_KEY,JSON.stringify([...collapsedDays]))}catch(e){}render(false)};
    card.querySelector('.start-time').onchange=e=>{d.startTime=e.target.value;render()};
    card.querySelector('.day-coef').onchange=e=>{d.coefficient=Math.max(.1,Number(e.target.value)||.8);render()};
    card.querySelector('.day-note').onchange=e=>{d.note=e.target.value;render()};
    card.querySelector('.clear-day').onclick=()=>{if(confirm('確定清除 Day '+(i+1)+' 的全部行程？')){if(locs(d).length)unlinkNextIfEndpointChanges(d);d.items=[];d.note='';d.linkedStart=false;render()}};
    const lk=card.querySelector('.link-start');if(lk)lk.onchange=e=>{
      if(e.target.checked)connectToPrevious(i);
      else{d.linkedStart=false;const f=first(d);if(f)f._linkedStart=false}
      render();
    };
    const search=card.querySelector('.node-search-inline');
    const nodeSelect=card.querySelector('.add-node');
    if(search&&nodeSelect)search.oninput=()=>{
      const previouslySelected=nodeSelect.value;
      const entries=filterLocations((route?.nodes||[]).map(n=>({id:n.id,name:n.name,route:route.route_name})),search.value,100,{includeRoute:false});
      nodeSelect.replaceChildren();
      const prompt=document.createElement('option');prompt.value='';
      prompt.textContent=entries.length?'選擇下一個行程點':'找不到符合的節點';
      nodeSelect.append(prompt);
      for(const entry of entries){
        const option=document.createElement('option');option.value=entry.id;option.textContent=entry.name;
        nodeSelect.append(option);
      }
      if(entries.some(n=>n.id===previouslySelected))nodeSelect.value=previouslySelected;
      else if(search.value.trim()&&entries.length===1)nodeSelect.value=entries[0].id;
    };
    const add=card.querySelector('.add-dest');if(add)add.onclick=()=>{const v=card.querySelector('.add-node').value;if(v){addNode(d,v);render()}};
    card.querySelector('.manual-start').onclick=()=>addManualStart(d);
    card.querySelector('.manual-end').onclick=()=>addManualEnd(d);

    card.querySelectorAll('[data-action]').forEach(b=>b.onclick=e=>{
      e.preventDefault();const idx=+b.dataset.index;
      if(b.dataset.action==='delete')removeItem(d,idx);
      if(b.dataset.action==='split')splitDay(i,idx);
      if(b.dataset.action==='rest')insertRest(d,idx);
      if(b.dataset.action==='manual')insertManualBefore(d,idx);
    });
    card.querySelectorAll('.edge-time').forEach(x=>x.onchange=()=>{const it=d.items[+x.dataset.index];if(it?.incoming)it.incoming.actualMinutes=x.value===''?null:clampMin(x.value);render()});
    card.querySelectorAll('.rest-min').forEach(x=>x.onchange=()=>{d.items[+x.dataset.index].minutes=clampMin(x.value);render()});
    card.querySelectorAll('.manual-name').forEach(x=>x.onchange=()=>{
      const it=d.items[+x.dataset.index];if(last(d)?.id===it.id)unlinkNextIfEndpointChanges(d);
      it.name=x.value.trim()||'手動節點';render();
    });
    card.querySelectorAll('.note-input').forEach(x=>x.onchange=()=>{d.items[+x.dataset.index].note=x.value;render()});
    card.querySelectorAll('.peak').forEach(b=>b.onclick=()=>{const it=d.items[+b.dataset.index];it.isPeak=!it.isPeak;render()});
    card.querySelectorAll('.water').forEach(b=>b.onclick=()=>{const it=d.items[+b.dataset.index];it.hasWater=!it.hasWater;render()});

    card.querySelectorAll('.drag-handle').forEach(h=>{
      h.ondragstart=e=>{drag={day:i,index:+h.dataset.index};e.stopPropagation();h.closest('.it-row')?.classList.add('dragging');e.dataTransfer.effectAllowed='move'};
      h.ondragend=()=>{h.closest('.it-row')?.classList.remove('dragging');document.querySelectorAll('.drop-zone').forEach(z=>z.classList.remove('active'))};
    });
    card.querySelectorAll('.drop-zone').forEach(z=>{
      z.ondragover=e=>{e.preventDefault();z.classList.add('active')};
      z.ondragleave=()=>z.classList.remove('active');
      z.ondrop=e=>{
        e.preventDefault();z.classList.remove('active');if(!drag||drag.day!==i)return;
        const from=drag.index,to=+z.dataset.drop;if(from<0||from>=d.items.length)return;
        const oldStart=first(d)?.id,oldEnd=last(d)?.id;
        const [mv]=d.items.splice(from,1);let insert=to;if(from<to)insert--;
        insert=Math.max(0,Math.min(insert,d.items.length));d.items.splice(insert,0,mv);
        normalizeDay(d,route);
        if(oldStart!==first(d)?.id)d.linkedStart=false;
        if(oldEnd!==last(d)?.id)unlinkNextIfEndpointChanges(d);
        drag=null;render();
      };
    });
  });
}

init().catch(e=>{console.error(e);document.body.insertAdjacentHTML('beforeend','<p style="padding:20px;color:#9b3f3f">載入失敗：'+esc(e.message)+'</p>')});
