import {loadManifest,loadRoute} from './data-loader.js';
import {allNodes,shortestPath,uid,round2,edgeActual,buildTimeline,summarizeDay,recalcConnections,formatDuration} from './planner.js';
import {exportExcel} from './exporter.js';

const $=id=>document.getElementById(id);
const STORAGE_KEY='mountain-planner.autosave.v1';
let manifest,route=null,nodes=[],days=[],drag=null,tripStartDate='';

const newDay=i=>({id:uid(),startTime:i?'05:30':'06:00',coefficient:.8,linkedStart:i>0,note:'',items:[]});
const locs=d=>d.items.filter(x=>x.type!=='rest');
const first=d=>locs(d)[0]||null;
const last=d=>{const a=locs(d);return a[a.length-1]||null};
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clampMin=v=>Math.max(0,Number(v)||0);

async function init(){
  manifest=await loadManifest();
  $('routeSelect').innerHTML='<option value="">請選擇上河圖</option>'+manifest.routes.map(r=>'<option value="'+r.id+'">'+r.id+'｜'+r.name+'</option>').join('');
  $('dayCount').innerHTML=Array.from({length:10},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+' 天</option>').join('');

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
  days=restored?.days?.length?sanitizeDays(restored.days):[newDay(0)];
  $('dayCount').value=String(days.length);
  bindGlobal();
  render(false);
}

async function loadGroup(id){
  const meta=manifest.routes.find(r=>r.id===id);
  if(!meta){setNoRoute();return}
  route=await loadRoute(meta.file);
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
  $('resetBtn').onclick=()=>{
    if(!confirm('確定清除全部行程？此操作無法復原。'))return;
    setNoRoute();$('routeSelect').value='';
    tripStartDate='';$('tripDate').value='';
    days=[newDay(0)];$('dayCount').value='1';
    clearAutosave();render();
  };
  $('exportBtn').onclick=async()=>{
    if(!route){alert('請先選擇上河圖');return}
    if(!days.some(d=>locs(d).length)){alert('請先建立行程');return}
    await exportExcel({route,days,datasetVersion:manifest.dataset_version,tripStartDate});
  };
  $('copyBtn').onclick=copyTextItinerary;
  $('saveBtn').onclick=downloadPlan;
  $('importBtn').onclick=()=>$('importFile').click();
  $('importFile').onchange=importPlan;
}

function addNode(day,name){
  if(!route){alert('請先選擇上河圖');return}
  const p=last(day);
  if(!p){
    day.items.push({id:uid(),type:'location',name,auto:false,waypoint:true,note:'',isPeak:false,hasWater:false,incoming:null});
    return;
  }
  if(p.type==='manual-location'){
    const id=uid();
    day.items.push({id,type:'location',name,auto:false,waypoint:true,note:'',isPeak:false,hasWater:false,incoming:{kind:'manual',fromId:p.id,toId:id,actualMinutes:null}});
    return;
  }
  const path=shortestPath(route,p.name,name);
  if(!path){alert('找不到 '+p.name+' → '+name+' 的上河路徑');return}
  path.segments.forEach((s,i)=>day.items.push({
    id:uid(),type:'location',name:s.to,auto:i<path.segments.length-1,waypoint:i===path.segments.length-1,
    note:'',isPeak:false,hasWater:false,
    incoming:{kind:'official',from:s.from,to:s.to,officialMinutes:s.minutes,actualMinutes:null,source:route.source.image_url}
  }));
}

function syncStarts(){
  for(let i=1;i<days.length;i++){
    const d=days[i],p=last(days[i-1]);if(!d.linkedStart||!p)continue;
    const f=first(d);
    if(!f){
      d.items.unshift({id:uid(),type:p.type,name:p.name,auto:false,waypoint:true,note:'',isPeak:!!p.isPeak,hasWater:!!p.hasWater,incoming:null,_linkedStart:true});
    }else if(f._linkedStart&&(f.name!==p.name||f.type!==p.type)){
      f.name=p.name;f.type=p.type;f.incoming=null;f.isPeak=!!p.isPeak;f.hasWater=!!p.hasWater;
      if(route)recalcConnections(d,route);
    }
  }
}

function forceSync(i){
  const p=last(days[i-1]);if(!p)return;
  const d=days[i],f=first(d);
  if(!f)d.items.unshift({id:uid(),type:p.type,name:p.name,auto:false,waypoint:true,note:'',isPeak:!!p.isPeak,hasWater:!!p.hasWater,incoming:null,_linkedStart:true});
  else{f.name=p.name;f.type=p.type;f._linkedStart=true;f.incoming=null;if(route)recalcConnections(d,route)}
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
  d.items.splice(idx,1);
  if(route)recalcConnections(d,route);
  render();
}

function copyTextItinerary(){
  const blocks=[];
  days.forEach((d,i)=>{
    const rows=buildTimeline(d).rows.filter(r=>r.type!=='rest');
    if(!rows.length)return;
    blocks.push('D'+(i+1)+'：'+rows.map(r=>r.arrival+' '+r.name+(r.isPeak?'⛰':'')+(r.hasWater?'💧':'')).join('→')+'。');
  });
  const text=blocks.join('\n\n');
  if(!text){alert('目前沒有可複製的行程');return}
  const done=()=>toast('已複製文字行程');
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done));else fallbackCopy(text,done);
}
function fallbackCopy(text,done){const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();done()}
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),1800)}

function downloadPlan(){
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
    const data=JSON.parse(await file.text());
    if(data.format!=='mountain-planner'||!Array.isArray(data.days))throw new Error('不是有效的 Mountain Planner 行程檔');
    if(data.routeId){
      if(!manifest.routes.some(r=>r.id===data.routeId))throw new Error('目前資料庫沒有此上河圖：'+data.routeId);
      await loadGroup(data.routeId);$('routeSelect').value=data.routeId;
    }else{setNoRoute();$('routeSelect').value=''}
    tripStartDate=data.tripStartDate||'';$('tripDate').value=tripStartDate;
    days=sanitizeDays(data.days.length?data.days:[newDay(0)]);
    $('dayCount').value=String(days.length);
    const changed=data.datasetVersion&&data.datasetVersion!==manifest.dataset_version;
    render();
    if(changed)alert('行程已匯入。\n\n注意：此檔案使用資料版本 '+data.datasetVersion+'，目前版本為 '+manifest.dataset_version+'。已保留行程檔中的官方時間快照與手動修改，建議再與目前上河資料核對。');
    else toast('行程已匯入');
  }catch(err){alert('匯入失敗：'+err.message)}
}

function dayDate(index){
  if(!tripStartDate)return '';
  const d=new Date(tripStartDate+'T00:00:00');d.setDate(d.getDate()+index);
  return String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0');
}
function opts(){return nodes.map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join('')}
function render(persist=true){
  syncStarts();
  $('daysContainer').innerHTML=days.map(renderDay).join('');
  bindDays();
  if(persist)saveAutosave();
}

function renderDay(d,i){
  const s=summarizeDay(d),p=i?last(days[i-1]):null,f=first(d),mis=i&&d.linkedStart&&p&&f&&(p.name!==f.name||p.type!==f.type);
  const date=dayDate(i);
  const selector=route?'<select class="add-node"><option value="">選擇下一個行程點</option>'+opts()+'</select>':'<select class="add-node" disabled><option>請先選擇上河圖</option></select>';
  return '<article class="card day-card" data-day="'+i+'">'+
  '<div class="day-head"><div class="day-title"><strong>Day '+(i+1)+'</strong>'+(date?'<span class="day-date">'+date+'</span>':'')+'</div>'+
  '<div class="day-control"><label>出發</label><input class="start-time" type="time" value="'+d.startTime+'"></div>'+
  '<div class="day-control coefficient"><label>預設係數</label><input class="day-coef" type="number" min="0.1" max="3" step="0.01" value="'+Number(d.coefficient).toFixed(2)+'"></div>'+
  '<div class="stats"><div class="stat"><span>行進</span><b>'+formatDuration(s.movement)+'</b></div><div class="stat"><span>休息</span><b>'+formatDuration(s.rest)+'</b></div><div class="stat"><span>總計</span><b>'+formatDuration(s.total)+'</b></div><div class="stat coef"><span>平均</span><b>'+(s.coefficient??'—')+'</b></div></div>'+
  '<button class="clear-day">清除 Day '+(i+1)+'</button></div>'+
  '<div class="day-tools">'+(i?'<label class="link-wrap"><input class="link-start" type="checkbox" '+(d.linkedStart?'checked':'')+'>銜接前日</label>':'<span class="link-wrap">第一點即起點</span>')+
  selector+'<button class="add-dest" '+(route?'':'disabled')+'>加入</button>'+(mis?'<button class="sync-start secondary">同步前日終點</button>':'')+'</div>'+
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
      '<div class="route-info"><input class="rest-min minute-input" data-index="'+idx+'" type="number" min="0" value="'+r.minutes+'"><span>m</span></div><div></div>'+menuHtml(idx,true,false)+'</div>';
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
        :peak+'<span class="place-name '+(r.auto?'auto-node':'')+'">'+esc(r.name)+'</span>'+water;
      html+='<div class="it-row" data-index="'+idx+'">'+
      '<div class="place">'+placeName+'</div>'+
      '<div class="arrival">'+r.arrival+'</div>'+
      '<div class="route-info">'+routeInfo+'</div>'+
      '<input class="note-input" data-index="'+idx+'" placeholder="備註" value="'+esc(r.note||'')+'">'+
      menuHtml(idx,false,!!r.incoming)+'</div>';
    }
    html+='<div class="drop-zone" data-drop="'+(idx+1)+'"></div>';
  });
  return html;
}
function menuHtml(idx,isRest,canManual){
  if(isRest)return '<details class="row-menu"><summary>⋯</summary><div class="menu-box"><button class="delete" data-action="delete" data-index="'+idx+'">刪除</button></div></details>';
  return '<details class="row-menu"><summary>⋯</summary><div class="menu-box"><button data-action="rest" data-index="'+idx+'">插入休息</button>'+(canManual?'<button data-action="manual" data-index="'+idx+'">在此段插入手動點</button>':'')+'<button class="delete" data-action="delete" data-index="'+idx+'">刪除節點</button></div></details>';
}

function bindDays(){
  document.querySelectorAll('.day-card').forEach(card=>{
    const i=+card.dataset.day,d=days[i];
    card.querySelector('.start-time').onchange=e=>{d.startTime=e.target.value;render()};
    card.querySelector('.day-coef').onchange=e=>{d.coefficient=Math.max(.1,Number(e.target.value)||.8);render()};
    card.querySelector('.day-note').onchange=e=>{d.note=e.target.value;saveAutosave()};
    card.querySelector('.clear-day').onclick=()=>{if(confirm('確定清除 Day '+(i+1)+' 的全部行程？')){d.items=[];d.note='';render()}};
    const lk=card.querySelector('.link-start');if(lk)lk.onchange=e=>{d.linkedStart=e.target.checked;render()};
    const add=card.querySelector('.add-dest');if(add)add.onclick=()=>{const v=card.querySelector('.add-node').value;if(v){addNode(d,v);render()}};
    const sy=card.querySelector('.sync-start');if(sy)sy.onclick=()=>forceSync(i);

    card.querySelectorAll('[data-action]').forEach(b=>b.onclick=e=>{
      e.preventDefault();const idx=+b.dataset.index;
      if(b.dataset.action==='delete')removeItem(d,idx);
      if(b.dataset.action==='rest')insertRest(d,idx);
      if(b.dataset.action==='manual')insertManualBefore(d,idx);
    });
    card.querySelectorAll('.edge-time').forEach(x=>x.onchange=()=>{const it=d.items[+x.dataset.index];if(it?.incoming)it.incoming.actualMinutes=x.value===''?null:clampMin(x.value);render()});
    card.querySelectorAll('.rest-min').forEach(x=>x.onchange=()=>{d.items[+x.dataset.index].minutes=clampMin(x.value);render()});
    card.querySelectorAll('.manual-name').forEach(x=>x.onchange=()=>{d.items[+x.dataset.index].name=x.value.trim()||'手動節點';render()});
    card.querySelectorAll('.note-input').forEach(x=>x.onchange=()=>{d.items[+x.dataset.index].note=x.value;saveAutosave()});
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
        const [mv]=d.items.splice(from,1);let insert=to;if(from<to)insert--;
        insert=Math.max(0,Math.min(insert,d.items.length));d.items.splice(insert,0,mv);
        if(route)recalcConnections(d,route);
        drag=null;render();
      };
    });
  });
}

init().catch(e=>{console.error(e);document.body.insertAdjacentHTML('beforeend','<p style="padding:20px;color:#9b3f3f">載入失敗：'+esc(e.message)+'</p>')});
