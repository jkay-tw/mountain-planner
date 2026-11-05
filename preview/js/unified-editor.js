import {captureScrollAnchor,restoreScrollAnchor} from './scroll-anchor.js?v=v088';
import {bindMobileTouchSort,insertionIndex} from './mobile-touch-sort.js?v=issue10b';
import {normalizeTimeInput} from './time-input.js?v=mobile1';
import {syncLinkedDays} from './day-link.js?v=segments1';
import {chooseSaveTarget,writeDownload,reportSaveError} from './save-file.js?v=v086';
import {bindProfileExports} from './profile-export.js?v=v084';
import {makeDemoDays} from './demo-itinerary.js?v=segments1';
import {directionalQuickAdd,appendQuickPath,quickAddEstimatedMinutes} from './quick-add.js?v=relations1';
import {renderQuickTopologySvg} from './quick-topology.js?v=topo1';
import {dayTerrain,formatTerrain,renderTerrainProfile} from './itinerary-geometry.js?v=layout2';
import {createTabAutosave} from './tab-autosave.js?v=v0725';
import {loadManifest,loadRoute} from './data-loader.js';
import {allNodes,shortestPath,uid,round2,edgeActual,referenceMinutes,setEdgeCoefficient,selectEdgeReference,adoptLegacyCoefficients,buildTimeline,summarizeDay,recalcConnections,formatDuration,missingSegments,canDeleteItem,normalizeDay,retargetSplitIncoming,ownerTimedConnection,incomingForSegment} from './planner.js?v=segments1';
import {validatePlan} from './validation.js?v=segments1';
import {addRouteIdentity,migrateDaysToNodeIds,findNodeById} from './node-identity.js?v=v084';
import {migrateLegacyPlanDays} from './legacy-plan-migration.js?v=v084';
import {exportExcel} from './exporter.js?v=segments1';
import {filterLocations} from './node-browser.js?v=v074';
import {mergeReviewedRoutes,nodesInScope,appendDisconnectedNode} from './global-route.js?v=v084';

const $=id=>document.getElementById(id);
const IS_PRODUCTION=document.body.dataset.mode==='production';
const IS_DEMO=!IS_PRODUCTION&&new URLSearchParams(location.search).get('demo')==='xueshan';
const STORAGE_KEY=IS_PRODUCTION?'mountain-planner.global-autosave.v1':'mountain-planner.unified-preview-autosave.v0711';
const APP_VERSION=IS_PRODUCTION?'v0.7.25':'v0.8.8 Mobile Drag Preview #10';
const COLLAPSE_KEY=IS_PRODUCTION?'mountain-planner.collapsed-days.v1':'mountain-planner.unified-preview-collapsed.v0711';
let collapsedDays=new Set();
let manifest,route=null,nodes=[],days=[],drag=null,tripStartDate='',scope='';
let itineraryMap=null,terrainData=null;
const openProfiles=new Set();
let snapshots=[],at=-1,restoring=false;
function checkpoint(){if(restoring)return;const state=JSON.stringify({routeId:route?.route_id||null,scope,tripStartDate,days});if(state===snapshots[at])return;snapshots=snapshots.slice(0,at+1);snapshots.push(state);if(snapshots.length>50)snapshots.shift();at=snapshots.length-1;buttons()}
function buttons(){
  ['undoBtn','floatUndoBtn'].forEach(id=>{if($(id))$(id).disabled=at<1});
  ['redoBtn','floatRedoBtn'].forEach(id=>{if($(id))$(id).disabled=at>=snapshots.length-1});
}
async function restore(i){if(i<0||i>=snapshots.length)return;const x=JSON.parse(snapshots[i]);restoring=true;try{scope=x.scope||'all';$('routeSelect').value=scope;tripStartDate=x.tripStartDate;$('tripDate').value=tripStartDate;days=sanitizeDays(migrateDaysToNodeIds(x.days,route));$('dayCount').value=String(days.length);at=i;render(false);saveAutosave();buttons()}finally{restoring=false}}
const checkMissing=()=>{const n=days.reduce((sum,d)=>sum+missingSegments(d),0);return n===0||confirm('有 '+n+' 個路段未填時間，匯出結果含未完成時間。仍繼續？')};


const newDay=i=>({id:uid(),startTime:i?'05:30':'06:00',coefficient:.8,linkedStart:i>0,note:'',items:[]});
const locs=d=>d.items.filter(x=>x.type!=='rest');
const first=d=>locs(d)[0]||null;
const last=d=>{const a=locs(d);return a[a.length-1]||null};
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clampMin=v=>Math.max(0,Number(v)||0);

async function init(){
  manifest=await (await fetch('data/unified-editor-manifest.json',{cache:'no-store'})).json();
  await loadGlobalGraph();
  if($('appVersion'))$('appVersion').textContent=APP_VERSION;
  $('routeSelect').innerHTML='<option value="all">全部已收錄節點</option>'+manifest.routes.map(r=>'<option value="'+r.id+'">'+r.name+'</option>').join('');
  $('dayCount').innerHTML=Array.from({length:10},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+' 天</option>').join('');

  try{collapsedDays=new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY)||'[]'))}catch(e){collapsedDays=new Set()}

  const restored=loadAutosave();
  scope=restored?.scope||'all';
  if(!['all',...manifest.routes.map(r=>r.id)].includes(scope))scope='all';
  $('routeSelect').value=scope;

  tripStartDate=restored?.tripStartDate||'';
  $('tripDate').value=tripStartDate;
  let restoredDays=restored?.days;
  if(restoredDays?.length&&restored.routeId&&restored.routeId!=='GLOBAL-PREVIEW'){
    const sourceMeta=[...(manifest.legacyRoutes||[]),...manifest.routes].find(m=>m.id===restored.routeId);
    if(!sourceMeta)throw new Error('找不到舊行程來源；原始暫存未更動');
    restoredDays=migrateLegacyPlanDays(restoredDays,addRouteIdentity(await loadRoute(sourceMeta.file)),route);
  }
  days=restoredDays?.length?sanitizeDays(migrateDaysToNodeIds(restoredDays,route)):[newDay(0)];
  if(IS_DEMO){days=makeDemoDays(route,uid);scope='G04';$('routeSelect').value=scope;const banner=document.createElement('div');banner.className='notice';banner.textContent='範例模式：可以試用快速加入與編輯，這個頁面不讀寫原行程暫存。';$('daysContainer').before(banner)}
  $('dayCount').value=String(days.length);
  if(!IS_PRODUCTION)try{const response=await fetch('data/geometry/planner-terrain-v1.json?v=v084');if(!response.ok)throw Error();terrainData=await response.json()}catch(error){console.warn('節點座標與地形資料未載入')}
  bindGlobal();
  render(false);saveAutosave(false);checkpoint();
  if(!IS_PRODUCTION&&$('itineraryGeometry'))import('./itinerary-map.js?v=v087')
    .then(({createItineraryMap})=>{itineraryMap=createItineraryMap({host:$('itineraryGeometry'),getDays:()=>days,initialData:terrainData})})
    .catch(error=>{$('itineraryGeometry').textContent='地圖載入失敗：'+error.message});
}

async function loadGlobalGraph(){
  const datasets=await Promise.all(manifest.routes.map(async m=>{
    const dataset=addRouteIdentity(await loadRoute(m.file));
    if(m.routingEnabled===false)dataset.routingEnabled=false;
    return dataset;
  }));
  route=mergeReviewedRoutes(datasets);
  nodes=allNodes(route);
  $('routeMeta').textContent='全域路網｜'+datasets.length+' 個路線資料集｜僅已核對的步行路段';
}
function setNoRoute(){
  // Explicit reset does not discard the catalog, only resets browser scope.
  scope='all';$('routeSelect').value='all';
}

function sanitizeDays(rawDays){
  return rawDays.slice(0,10).map((original,i)=>{const d=adoptLegacyCoefficients(original);return ({
    id:d.id||uid(),
    startTime:d.startTime||(i?'05:30':'06:00'),
    coefficient:Number(d.coefficient)||.8,
    linkedStart:i>0?!!d.linkedStart:false,
    note:d.note||'',
    items:Array.isArray(d.items)?d.items.map(x=>({...x,id:x.id||uid()})):[]
  })});
}

const tabAutosave=createTabAutosave({
  local:{getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v)},
  session:{getItem:k=>sessionStorage.getItem(k),setItem:(k,v)=>sessionStorage.setItem(k,v)},
  key:STORAGE_KEY,legacyKey:IS_PRODUCTION?'mountain-planner.autosave.v1':null
});
function saveAutosave(shared=true){
  if(IS_DEMO)return;
  tabAutosave.save({format:'mountain-planner',schemaVersion:1,routeId:route?.route_id||null,
    scope,datasetVersion:manifest.dataset_version,tripStartDate,days},{shared});
}
function loadAutosave(){return IS_DEMO?null:tabAutosave.load()}

function bindGlobal(){
  bindProfileExports();
  $('routeSelect').onchange=e=>{
    scope=e.target.value||'all';
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
  const floatMenu=document.querySelector('.float-more');
  for(const [from,to] of Object.entries({floatCopy:'copyBtn',floatExcel:'exportBtn',floatSave:'saveBtn',floatImport:'importBtn'}))$(from).onclick=()=>{floatMenu.open=false;$(to).click()};
  $('floatTop').onclick=()=>{floatMenu.open=false;window.scrollTo({top:0,behavior:'smooth'})};
  const floatHistory=$('floatingHistory'),syncFloating=()=>{if(floatHistory){const visible=window.scrollY>240;floatHistory.classList.toggle('visible',visible);if(!visible)floatMenu.open=false}};
  window.addEventListener('scroll',syncFloating,{passive:true});syncFloating();
  document.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey))return;const a=document.activeElement;if(['INPUT','TEXTAREA','SELECT'].includes(a?.tagName))return;const k=e.key.toLowerCase();if(k==='z'||k==='y'){e.preventDefault();restore(at+(k==='y'||e.shiftKey?1:-1))}});
  // Close popovers when interacting elsewhere. Keep the clicked menu open
  // and allow native <details>/<summary> to handle its own toggle.
  const menus='.row-menu[open],.header-more[open],.global-menu[open],.float-more[open]';
  document.addEventListener('click',e=>{
    document.querySelectorAll(menus).forEach(menu=>{
      if(!menu.contains(e.target))menu.open=false;
    });
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape')document.querySelectorAll(menus).forEach(menu=>menu.open=false);
  });
  $('resetBtn').onclick=()=>{
    if(!confirm('確定清除全部行程？可使用復原還原。'))return;
    setNoRoute();
    tripStartDate='';$('tripDate').value='';
    days=[newDay(0)];$('dayCount').value='1';
    render();
  };
  $('exportBtn').onclick=async()=>{
    if(!days.some(d=>locs(d).length)){alert('請先建立行程');return}
    if(!checkMissing())return;
    const name=route.route_id+'_'+route.route_name+'_行程.xlsx';
    try{const handle=await chooseSaveTarget(name,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','xlsx');await exportExcel({route,days,datasetVersion:manifest.dataset_version,tripStartDate,terrainData,handle})}catch(error){reportSaveError(error)}
  };
  $('copyBtn').onclick=copyTextItinerary;
  $('saveBtn').onclick=downloadPlan;
  $('importBtn').onclick=()=>$('importFile').click();
  $('importFile').onchange=importPlan;
}

function unlinkNextIfEndpointChanges(day){
  // The next linked day follows the endpoint when render() synchronizes it.
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
  const manual=ownerTimedConnection(route,p.nodeId,nodeId);
  const path=manual?{segments:[manual]}:shortestPath(route,p.nodeId,nodeId);
  if(!path){appendDisconnectedNode(day,selected,uid);toast('已加入節點；前一段尚未連通，請手動填入時間');return}
  path.segments.forEach(s=>{const previous=last(day),id=uid();day.items.push({
    id,type:'location',name:s.to,nodeId:s.toId,note:'',isPeak:false,hasWater:false,
    incoming:incomingForSegment(s,previous.id,id,route.source.image_url,day.coefficient)
  })});
}

function connectToPrevious(i){
 if(i<1)return;
 days[i].linkedStart=true;
 syncLinkedDays(days,route,uid);
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

function insertRest(d,afterIdx){d.items.splice(afterIdx+1,0,{id:uid(),type:'rest',minutes:15,note:''});render()}
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
    blocks.push('D'+(i+1)+'：'+rows.map(r=>(r.arrival&&r.arrival!=='—'?r.arrival+' ':'')+r.name+(r.isPeak?'⛰':'')+(r.hasWater?'💧':'')).join('→')+'。');
  });
  const text=blocks.join('\n\n');if(!checkMissing())return;
  if(!text){alert('目前沒有可複製的行程');return}
  const done=()=>toast('已複製文字行程');
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done));else fallbackCopy(text,done);
}
function fallbackCopy(text,done){const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();done()}
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),1800)}

async function downloadPlan(){
  if(!checkMissing())return;
  if(!route&&!days.some(d=>d.items.length)){alert('目前沒有可匯出的行程');return}
  const payload={format:'mountain-planner',schemaVersion:1,savedAt:new Date().toISOString(),routeId:route?.route_id||null,scope,datasetVersion:manifest.dataset_version,tripStartDate,days};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const name=(route?route.route_id+'_'+route.route_name:'mountain-planner')+'.mplan.json';
  try{const handle=await chooseSaveTarget(name,'application/json','json');await writeDownload(blob,name,handle)}catch(error){reportSaveError(error)}
}
async function importPlan(e){
 const file=e.target.files?.[0];e.target.value='';if(!file)return;
 try{
  const importRoutes=[...(manifest.legacyRoutes||[]),...manifest.routes];
  const data=validatePlan(JSON.parse(await file.text()),['GLOBAL-PREVIEW',...importRoutes.map(r=>r.id)]);
  const sourceMeta=importRoutes.find(x=>x.id===data.routeId);
  const importedRoute=sourceMeta?addRouteIdentity(await loadRoute(sourceMeta.file)):null;
  const migrated=data.routeId&&data.routeId!=='GLOBAL-PREVIEW'
    ?migrateLegacyPlanDays(data.days,importedRoute,route)
    :migrateDaysToNodeIds(data.days,route);
  const importedDays=sanitizeDays(migrated);
  if(days.some(d=>d.items.length)&&!confirm('匯入將取代目前行程，可以使用復原。確定？'))return;
  scope=data.scope&&['all',...manifest.routes.map(m=>m.id)].includes(data.scope)?data.scope:'all';
  $('routeSelect').value=scope;
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
function scopedNodes(){return nodesInScope(route,scope)}
function nodeOptionLabel(n,list){
  const duplicates=list.filter(x=>x.name===n.name);
  if(duplicates.length<2)return n.name;
  const groups=(n.groups||[]).join(' / ');
  const shortId=String(n.id).split(':').pop().slice(-12);
  return n.name+'｜'+(groups||'同名節點')+' · '+shortId;
}
function opts(){
  const list=scopedNodes().slice().sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant')||String(a.id).localeCompare(String(b.id)));
  return list.map(n=>'<option value="'+esc(n.id)+'">'+esc(nodeOptionLabel(n,list))+'</option>').join('')
}
let scrollRestoreToken=0;
function render(persist=true){
  syncLinkedDays(days,route,uid);
  const container=$('daysContainer');
  const anchor=container.querySelector('.day-card')?captureScrollAnchor(container):null;
  const token=++scrollRestoreToken;
  container.innerHTML=days.map(renderDay).join('');
  bindDays();
  itineraryMap?.update();
  if(anchor){
    restoreScrollAnchor(anchor,container);
    // iOS WebKit can adjust scrolling again after layout/focus settles.
    requestAnimationFrame(()=>{if(token===scrollRestoreToken)restoreScrollAnchor(anchor,container)});
  }
  if(persist){saveAutosave();checkpoint()}
}

function renderQuickAdd(d){
 const p=last(d);if(p?.type!=='location')return '<div class="quick-add empty">選擇起點後顯示快速加入；手動點請用節點選單銜接。</div>';
 const dayIndex=days.indexOf(d),prior=dayIndex>0&&d.linkedStart?locs(days[dayIndex-1]).at(-2)?.nodeId:null;
 const candidates=directionalQuickAdd(route,d,prior);
 const button=c=>'<button type="button" class="quick-node secondary" data-quick-key="'+esc(c.key)+'" title="'+esc(c.direction<0?'先返回上一點的方向':c.via?'經 '+c.via:'直接相鄰')+'">'+(c.direction<0?'↩ ':'＋ ')+esc(c.name)+(c.via?'<small class="quick-via">經 '+esc(c.via)+'</small>':'')+'</button>';
 if(!candidates.length)return '<div class="quick-add"><strong>⚡ 快速加入</strong><div class="quick-chips"><span>沒有已收錄的相鄰步行節點</span></div></div>';
 const svg=renderQuickTopologySvg(candidates,p.nodeId,p.name,d.coefficient,quickAddEstimatedMinutes);
 const panel='<details class="quick-relations"><summary aria-label="查看從'+esc(p.name)+'出發的路網拓樸示意圖">路網小地圖</summary><div class="quick-route-panel"><div class="quick-route-current">目前位置：'+esc(p.name)+'</div><div class="quick-topology-canvas">'+svg+'</div><p class="quick-route-hint">僅示意路網拓樸，不代表實際方位、路徑形狀或距離。</p><p class="quick-route-hint">時間依當日預設係數估算，不含休息與條件式時間；「多條路線」請依上方快速加入的經由節點辨別。</p></div></details>';
 return '<div class="quick-add"><strong>⚡ 快速加入</strong><div class="quick-chips">'+candidates.map(button).join('')+panel+'</div></div>';
}
// The day coefficient can change without a full render (for a stable input
// focus). Update any existing relationship-panel estimates in place.
function refreshQuickRelationTimes(card,d){
 const dayIndex=days.indexOf(d),prior=dayIndex>0&&d.linkedStart?locs(days[dayIndex-1]).at(-2)?.nodeId:null;
 const choices=new Map(directionalQuickAdd(route,d,prior).map(c=>[c.key,c]));
 card.querySelectorAll('.quick-route-duration[data-route-key]').forEach(label=>{
  const candidate=choices.get(label.dataset.routeKey);
  const m=candidate?quickAddEstimatedMinutes(candidate,d.coefficient):null;
  label.textContent=m===null?'時間待填':'約 '+m+' 分';
 });
}
function renderDay(d,i){
  const s=summarizeDay(d),collapsed=collapsedDays.has(d.id),f=first(d),l=last(d);
  const date=dayDate(i);
  const terrain=dayTerrain(d,terrainData);if(terrain)terrain.dayIndex=i;
  const selector=route?'<select class="add-node"><option value="">選擇下一個行程點</option>'+opts()+'</select>':'<select class="add-node" disabled><option>請先選擇上河圖</option></select>';
  const summary=(f&&l?esc(f.name)+' → '+esc(l.name):'尚未建立行程')+' · '+(s.missing?'未完成':formatDuration(s.total));
  return '<article class="card day-card '+(collapsed?'collapsed':'')+'" data-day="'+i+'" data-day-id="'+esc(d.id)+'">'+
  '<div class="day-head"><button class="day-toggle" type="button" aria-label="'+(collapsed?'展開':'摺疊')+' Day '+(i+1)+'">'+(collapsed?'▶':'▼')+'</button><div class="day-title"><strong>Day '+(i+1)+'</strong>'+(date?'<span class="day-date">'+date+'</span>':'')+'<span class="collapsed-summary">'+summary+'</span></div>'+
  '<div class="day-control start-control"><label>出發</label><input class="start-time" type="time" value="'+esc(d.startTime)+'"><span class="mobile-time-controls"><input class="start-time-text" type="text" inputmode="numeric" maxlength="5" autocomplete="off" spellcheck="false" aria-label="出發時間，可輸入 0630 或 06:30" value="'+esc(d.startTime)+'"><span class="time-picker-trigger" title="使用手機系統時間選擇器"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg><input class="start-time-picker" type="time" aria-label="開啟系統時間選擇器" value="'+esc(d.startTime)+'"></span></span></div>'+
  '<div class="day-control coefficient"><label>預設係數</label><input class="day-coef" type="number" min="0.1" max="3" step="0.1" value="'+Number(d.coefficient).toFixed(2)+'"></div>'+
  '<div class="stats"><div class="stat"><span>行進</span><b>'+formatDuration(s.movement)+'</b></div><div class="stat"><span>休息</span><b>'+formatDuration(s.rest)+'</b></div><div class="stat"><span>總計</span><b>'+(s.missing?'未完成':formatDuration(s.total))+'</b></div><div class="stat coef"><span>平均</span><b>'+(s.coefficient??'—')+'</b></div></div>'+
  '<button class="clear-day">清除 Day '+(i+1)+'</button></div>'+
  '<div class="day-tools">'+(i?'<label class="link-wrap"><input class="link-start" type="checkbox" '+(d.linkedStart?'checked':'')+'>銜接前日</label>':'<span class="link-wrap">第一點即起點</span>')+
  '<div class="node-picker-controls"><input class="node-search-inline" type="search" placeholder="搜尋節點" aria-label="搜尋當日要加入的節點" autocomplete="off" '+(route?'':'disabled')+'>'+selector+'</div><div class="node-action-controls"><button class="add-dest" '+(route?'':'disabled')+'>加入</button><button class="manual-start secondary compact-day-action">＋手動起點</button><button class="manual-end secondary compact-day-action">＋手動終點</button></div></div>'+
  (!IS_PRODUCTION?renderQuickAdd(d):'')+
  (s.missing?'<div class="missing-warning">尚有 '+s.missing+' 個手動路段未填時間；後續時間無法計算。</div>':'')+
  '<div class="timeline">'+renderTimeline(d)+'</div>'+
  '<div class="day-footer">'+(!IS_PRODUCTION?'<div class="terrain-daily"><p class="terrain-summary">'+esc(formatTerrain(terrain,{partial:!!terrain?.gaps.length}))+'</p><button class="show-profile secondary" type="button" aria-expanded="'+openProfiles.has(d.id)+'">'+(openProfiles.has(d.id)?'收合高度剖面':'查看高度剖面')+'</button></div>'+(openProfiles.has(d.id)?'<div class="day-profile">'+(terrain?renderTerrainProfile(terrain):'<p>地形資料未載入。</p>')+'</div>':''):'')+'<textarea class="day-note" placeholder="Day '+(i+1)+' 備註">'+esc(d.note||'')+'</textarea></div></article>';
}

// Both native desktop drag/drop and touch gestures use the same safe reorder.
function moveTimelineItem(d, from, slot) {
  const insert = insertionIndex(from, slot, d.items.length);
  if (insert === null || insert === from) return false;
  const oldStart = first(d)?.id, oldEnd = last(d)?.id;
  const [item] = d.items.splice(from, 1);
  d.items.splice(insert, 0, item);
  normalizeDay(d, route);
  if (oldStart !== first(d)?.id) d.linkedStart = false;
  if (oldEnd !== last(d)?.id) unlinkNextIfEndpointChanges(d);
  render();
  return true;
}

// Keep distance/ascent/descent intact when a narrow screen needs to wrap.
function terrainSegmentHtml(feature,bridged=false){
  if(bridged)return '<span class="terrain-status">路徑連續・分段待定位</span>';
  const context=feature?.intermediateCoordinatesUnknown?'<span class="terrain-context">跨未定位點合計：</span>':'';
  const parts=formatTerrain(feature).replace('上升 ','↗ ').replace('下降 ','↘ ').split(' · ');
  return context+parts.map(part=>'<span class="terrain-metric">'+esc(part)+'</span>').join(' ');
}
// Keep the water toggle immediately after the location's last characters,
// including when the location wraps to a second line.
function renderPlaceLabel(name){
  // The adjacent water button is a separate flex item; both icons center
  // beside the full, naturally wrapping location-name block.
  return '<span class="place-name">'+esc(name)+'</span>';
}
function renderTimeline(d){
  const rows=buildTimeline(d).rows;
  const terrain=dayTerrain(d,terrainData),terrainByItem=new Map((terrain?.features||[]).map(f=>[f.toItemId,f]));
  const bridgedItems=new Set((terrain?.features||[]).filter(f=>f.intermediateCoordinatesUnknown).flatMap(f=>f.viaItemIds));
  if(!rows.length)return '<div class="empty">'+(route?'直接選擇第一個行程點；它就是當日的起點。':'請先選擇上河圖群組。')+'</div>';
  let html=(!IS_PRODUCTION?'<div class="itinerary-head"><span class="head-identity"><span>地點</span><span>抵達</span></span><span>規劃時間</span><span>距離／升降</span><span>備註</span><span></span></div>':'')+'<div class="drop-zone" data-drop="0"></div>';
  rows.forEach(r=>{
    const idx=d.items.findIndex(x=>x.id===r.id);
    if(r.type==='rest'){
      html+='<div class="it-row rest-row" data-index="'+idx+'">'+
      '<div class="row-identity"><div class="place"><span class="drag-handle" draggable="true" data-index="'+idx+'">⋮⋮</span><span class="place-name">☕ 休息</span></div>'+
      '<div class="arrival">'+r.endTime+'</div></div>'+
      '<div class="row-metrics"><div class="route-info"><input class="rest-min minute-input" data-index="'+idx+'" type="number" min="0" value="'+r.minutes+'"><span>m</span></div>'+(!IS_PRODUCTION?'<div class="terrain-cell">—</div>':'')+'</div><input class="note-input" data-index="'+idx+'" placeholder="備註" value="'+esc(r.note||'')+'">'+menuHtml(idx,true,false,true)+'</div>';
    }else{
      const e=r.incoming,a=e?edgeActual(e,d.coefficient):0,manual=r.type==='manual-location';
      let routeInfo='<span class="secondary-info">起點</span>';
      if(e?.kind==='official'){
        const k=e.coefficient??(referenceMinutes(e)?round2(a/referenceMinutes(e)):d.coefficient);
        const alternatives=Array.isArray(e.timeAlternatives)?e.timeAlternatives.filter(t=>Number.isFinite(t.minutes)&&t.minutes>0&&['slow','heavy_pack'].includes(t.kind)):[];
        const labels={slow:'慢速',heavy_pack:'重裝'};
        const altHtml=alternatives.length?'<span class="reference-options">'+[{kind:'regular',minutes:e.officialMinutes,label:'一般'},...alternatives.map(t=>({...t,label:labels[t.kind]}))].map(t=>'<button type="button" class="alternate-time '+((e.referenceKind||'regular')===t.kind?'selected':'')+'" data-index="'+idx+'" data-kind="'+t.kind+'" title="切換至'+t.label+'參考時間 '+t.minutes+' 分鐘">'+t.label+' '+t.minutes+'m</button>').join('')+'</span>':'';
        routeInfo='<span class="time-pair"><span class="calculated-time">'+a+'m</span><span class="secondary-info">上河'+Math.round(Number(referenceMinutes(e))||0)+'m</span></span><label class="edge-coef-label">×<input class="edge-coef" aria-label="'+esc(r.name)+' 路段上河係數" data-index="'+idx+'" type="number" min="0.1" max="3" step="0.1" value="'+Number(k).toFixed(2)+'"></label>'+altHtml;
      }else if(e?.kind==='manual'){
        routeInfo='<input class="edge-time minute-input" data-index="'+idx+'" type="number" min="0" placeholder="時間未填" value="'+(e.actualMinutes??'')+'"><span>m</span><span class="manual-note">'+(e.connectionStatus==='owner-confirmed'?'上河時間未提供・自行填時間':e.connectionStatus==='unverified'?'未連通・手動估時':'手動')+'</span>';
      }
      const peak='<button class="icon-toggle peak '+(r.isPeak?'active':'')+'" data-index="'+idx+'" title="山頭">⛰</button>';
      const water='<button class="icon-toggle water '+(r.hasWater?'active':'')+'" data-index="'+idx+'" title="水源">💧</button>';
      const placeName=manual
        ?'<span class="drag-handle" draggable="true" data-index="'+idx+'">⋮⋮</span>'+peak+'<input class="manual-name" data-index="'+idx+'" value="'+esc(r.name)+'">'+water
        :peak+renderPlaceLabel(r.name)+water;
      html+='<div class="it-row" data-index="'+idx+'">'+
      '<div class="row-identity"><div class="place '+(manual?'':'place-inline')+'">'+placeName+'</div>'+
      '<div class="arrival">'+r.arrival+'</div></div>'+
      '<div class="row-metrics"><div class="route-info">'+routeInfo+'</div>'+
      (!IS_PRODUCTION?'<div class="terrain-cell" title="沿山徑距離、累積上升與累積下降（估算）">'+(e?terrainSegmentHtml(terrainByItem.get(r.id),bridgedItems.has(r.id)):'—')+'</div>':'')+'</div>'+
      '<div class="terrain-note"><input class="note-input" data-index="'+idx+'" placeholder="備註" value="'+esc(r.note||'')+'">'+'</div>'+
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

function syncArrivalTimes(){
  document.querySelectorAll('.day-card').forEach((card,index)=>{
    const day=days[index];
    if(!day)return;
    const rows=buildTimeline(day).rows;
    card.querySelectorAll('.it-row .arrival').forEach((cell,rowIndex)=>{
      const row=rows[rowIndex];
      if(row)cell.textContent=row.type==='rest'?row.endTime:row.arrival;
    });
  });
}
function commitStartTime(day,card,value,source=null){
  const time=normalizeTimeInput(value);
  if(!time)return false;
  const changed=day.startTime!==time;
  day.startTime=time;
  // Assigning the active native input's value can dismiss the iOS picker.
  for(const input of card.querySelectorAll('.start-time, .start-time-text, .start-time-picker')){
    if(input!==source||source?.type!=='time')input.value=time;
  }
  if(changed){
    // Keep the native iOS picker / mobile keyboard mounted and focused.
    // Only the arrival labels change when the departure time changes.
    syncArrivalTimes();
    saveAutosave();
    checkpoint();
  }
  return true;
}
function bindDays(){
  document.querySelectorAll('.row-menu').forEach(menu=>menu.addEventListener('toggle',()=>{
    if(menu.open)document.querySelectorAll('.row-menu[open]').forEach(other=>{if(other!==menu)other.open=false});
  }));
  document.querySelectorAll('.day-card').forEach(card=>{
    const i=+card.dataset.day,d=days[i];
    card.querySelector('.day-toggle').onclick=()=>{if(collapsedDays.has(d.id))collapsedDays.delete(d.id);else collapsedDays.add(d.id);try{if(!IS_DEMO)localStorage.setItem(COLLAPSE_KEY,JSON.stringify([...collapsedDays]))}catch(e){}render(false)};
    const desktopTime=card.querySelector('.start-time');
    const mobileTime=card.querySelector('.start-time-text');
    const nativePicker=card.querySelector('.start-time-picker');
    const acceptTime=input=>{
      if(!commitStartTime(d,card,input.value,input)){
        input.value=d.startTime;
        if(input===mobileTime)toast('請輸入有效的 24 小時時間，例如 0630 或 06:30');
      }
    };
    desktopTime.onchange=()=>acceptTime(desktopTime);
    mobileTime.onfocus=()=>mobileTime.select();
    mobileTime.onchange=()=>acceptTime(mobileTime);
    mobileTime.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();mobileTime.blur()}};
    // iOS can emit "change" before the user taps Done.
    // Never call render() here: it would remove the still-open native picker.
    nativePicker.onchange=()=>acceptTime(nativePicker);
    const dayCoef=card.querySelector('.day-coef');
    const updateDayCoef=value=>{
      if(!Number.isFinite(value)||value<.1||value>3){dayCoef.value=d.coefficient.toFixed(2);return}
      const next=round2(value);dayCoef.value=next.toFixed(2);
      if(d.coefficient!==next){d.coefficient=next;refreshQuickRelationTimes(card,d);saveAutosave();checkpoint()}
    };
    dayCoef.onchange=()=>updateDayCoef(Number(dayCoef.value));
    dayCoef.onkeydown=e=>{if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;e.preventDefault();updateDayCoef(round2(Number(dayCoef.value)+(e.key==='ArrowUp'?.1:-.1)))};
    card.querySelector('.day-note').onchange=e=>{d.note=e.target.value;render()};
    card.querySelector('.clear-day').onclick=()=>{if(confirm('確定清除 Day '+(i+1)+' 的全部行程？')){if(locs(d).length)unlinkNextIfEndpointChanges(d);d.items=[];d.note='';d.linkedStart=false;render()}};
    const lk=card.querySelector('.link-start');if(lk)lk.onchange=e=>{
      if(e.target.checked)connectToPrevious(i);
      else{d.linkedStart=false;const f=first(d);if(f)f._linkedStart=false}
      render();
    };
    const profileButton=card.querySelector('.show-profile');if(profileButton)profileButton.onclick=()=>{if(openProfiles.has(d.id))openProfiles.delete(d.id);else openProfiles.add(d.id);render(false)};
    card.querySelectorAll('[data-quick-key]').forEach(button=>button.onclick=()=>{if(appendQuickPath(d,route,button.dataset.quickKey,uid)){unlinkNextIfEndpointChanges(d);render()}});
    const search=card.querySelector('.node-search-inline');
    const nodeSelect=card.querySelector('.add-node');
    if(search&&nodeSelect)search.oninput=()=>{
      const previouslySelected=nodeSelect.value;
      const entries=filterLocations(scopedNodes().map(n=>({id:n.id,name:n.name,route:(n.groups||[]).join(' / ')})),search.value,100,{includeRoute:false});
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
    card.querySelectorAll('.edge-coef').forEach(x=>{
      const commit=value=>{const it=d.items[+x.dataset.index];if(!it?.incoming||!setEdgeCoefficient(it.incoming,value)){x.value=Number(it?.incoming?.coefficient??d.coefficient).toFixed(2);return}const index=x.dataset.index;render();const replacement=document.querySelector('.day-card[data-day="'+i+'"] .edge-coef[data-index="'+index+'"]');replacement?.focus()};
      x.onchange=()=>commit(Number(x.value));
      x.onkeydown=e=>{if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;e.preventDefault();const value=Number(x.value);if(Number.isFinite(value))commit(round2(value+(e.key==='ArrowUp'?.1:-.1)))};
    });
    card.querySelectorAll('.alternate-time').forEach(btn=>btn.onclick=()=>{const it=d.items[+btn.dataset.index];if(it?.incoming&&selectEdgeReference(it.incoming,btn.dataset.kind))render()});
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
        const {index:from}=drag;drag=null;
        moveTimelineItem(d,from,+z.dataset.drop);
      };
    });
    bindMobileTouchSort(card,i,(dayIndex,from,slot)=>{
      if (days[dayIndex]) moveTimelineItem(days[dayIndex],from,slot);
    });
  });
}

init().catch(e=>{console.error(e);document.body.insertAdjacentHTML('beforeend','<p style="padding:20px;color:#9b3f3f">載入失敗：'+esc(e.message)+'</p>')});
