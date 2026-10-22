import {loadManifest, loadRoute} from './data-loader.js';
import {allNodes, shortestPath, uid, round2, edgeActual, buildTimeline, summarizeDay, recalcConnections} from './planner.js';
import {exportExcel} from './exporter.js';

const $=id=>document.getElementById(id);
let manifest,route,nodes=[],days=[],coef=.8,drag=null;
const newDay=i=>({id:uid(),startTime:i?'05:30':'06:00',linkedStart:i>0,items:[]});
const locs=d=>d.items.filter(x=>x.type!=='rest');
const first=d=>locs(d)[0]||null;
const last=d=>{const a=locs(d);return a[a.length-1]||null};
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fm=n=>Number.isInteger(Number(n))?String(Number(n)):String(round2(n));

async function init(){
  manifest=await loadManifest();
  $('routeSelect').innerHTML=manifest.routes.map(r=>'<option value="'+r.id+'">'+r.id+'｜'+r.name+'</option>').join('');
  $('dayCount').innerHTML=Array.from({length:10},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+' 天</option>').join('');
  $('dayCount').value='2';
  await loadGroup(manifest.routes[0].id);
  days=[newDay(0),newDay(1)];
  bindGlobal();render();
}
async function loadGroup(id){
  const m=manifest.routes.find(r=>r.id===id);
  route=await loadRoute(m.file);nodes=allNodes(route);
  $('routeMeta').textContent=route.route_id+'｜'+route.route_name+'｜'+route.status;
}
function bindGlobal(){
  $('routeSelect').onchange=async e=>{
    if(days.some(d=>d.items.length)&&!confirm('切換上河圖會清空目前行程，確定切換？')){e.target.value=route.route_id;return}
    await loadGroup(e.target.value);days=days.map((_,i)=>newDay(i));render();
  };
  $('coefficient').oninput=e=>{coef=Number(e.target.value)||1;render()};
  $('dayCount').onchange=e=>{const n=+e.target.value;while(days.length<n)days.push(newDay(days.length));days=days.slice(0,n);render()};
  $('resetBtn').onclick=()=>{if(confirm('清空所有行程？')){days=days.map((_,i)=>newDay(i));render()}};
  $('exportBtn').onclick=async()=>{if(!days.some(d=>locs(d).length)){alert('請先建立行程');return}await exportExcel({route,days,defaultCoefficient:coef,datasetVersion:manifest.dataset_version})};
}
function addStart(day,name,linked=false){
  day.items=[{id:uid(),type:'location',name,auto:false,waypoint:true,incoming:null,_linkedStart:linked}];
}
function appendNode(day,name){
  const p=last(day);
  if(!p){addStart(day,name);return}
  if(p.type==='manual-location'){
    const id=uid();day.items.push({id,type:'location',name,auto:false,waypoint:true,incoming:{kind:'manual',fromId:p.id,toId:id,actualMinutes:null}});return
  }
  const path=shortestPath(route,p.name,name);
  if(!path){alert('找不到 '+p.name+' → '+name+' 的上河路徑');return}
  path.segments.forEach((s,i)=>day.items.push({id:uid(),type:'location',name:s.to,auto:i<path.segments.length-1,waypoint:i===path.segments.length-1,incoming:{kind:'official',from:s.from,to:s.to,officialMinutes:s.minutes,actualMinutes:null,source:route.source.image_url}}));
}
function setStart(day,name){
  if(!locs(day).length){addStart(day,name);return}
  const old=first(day), next=day.items.slice(day.items.indexOf(old)+1).find(x=>x.type==='manual-location'||(x.type==='location'&&x.waypoint));
  if(!next){day.items=[{id:uid(),type:'location',name,auto:false,waypoint:true,incoming:null,_linkedStart:false},...day.items.filter(x=>x.type==='rest')];recalcConnections(day,route);return}
  const tail=day.items.slice(day.items.indexOf(next)), rests=day.items.slice(day.items.indexOf(old)+1,day.items.indexOf(next)).filter(x=>x.type==='rest');
  const st={id:uid(),type:'location',name,auto:false,waypoint:true,incoming:null,_linkedStart:false};
  let bridge=[];
  if(next.type==='location'){
    const path=shortestPath(route,name,next.name);if(!path){alert('新起點到下一個指定節點找不到路徑');return}
    bridge=path.segments.slice(0,-1).map(s=>({id:uid(),type:'location',name:s.to,auto:true,waypoint:false,incoming:{kind:'official',from:s.from,to:s.to,officialMinutes:s.minutes,actualMinutes:null,source:route.source.image_url}}));
    if(path.segments.length){const s=path.segments[path.segments.length-1];next.incoming={kind:'official',from:s.from,to:s.to,officialMinutes:s.minutes,actualMinutes:null,source:route.source.image_url}}
  }else next.incoming={kind:'manual',fromId:st.id,toId:next.id,actualMinutes:null};
  day.items=[st,...rests,...bridge,...tail];recalcConnections(day,route);
}
function syncStarts(){
  for(let i=1;i<days.length;i++){
    const d=days[i],p=last(days[i-1]);if(!d.linkedStart||!p)continue;
    const f=first(d);
    if(!f)d.items.unshift({id:uid(),type:p.type,name:p.name,auto:false,waypoint:true,incoming:null,_linkedStart:true});
    else if(f._linkedStart&&(f.name!==p.name||f.type!==p.type)){f.name=p.name;f.type=p.type;f.incoming=null;recalcConnections(d,route)}
  }
}
function forceSync(i){
  const p=last(days[i-1]);if(!p)return;const d=days[i],f=first(d);
  if(!f)d.items.unshift({id:uid(),type:p.type,name:p.name,auto:false,waypoint:true,incoming:null,_linkedStart:true});
  else{f.name=p.name;f.type=p.type;f._linkedStart=true;f.incoming=null;recalcConnections(d,route)}
  render();
}
function addRest(d,idx){d.items.splice(idx+1,0,{id:uid(),type:'rest',minutes:15});render()}
function addManual(d,destIdx){
  const dest=d.items[destIdx],prev=[...d.items.slice(0,destIdx)].reverse().find(x=>x.type!=='rest');if(!dest||!prev)return;
  const name=prompt('手動節點名稱：','水源');if(!name)return;
  const a=Number(prompt(prev.name+' → '+name+'（分鐘）：',''));
  const b=Number(prompt(name+' → '+dest.name+'（分鐘）：',''));
  if(!Number.isFinite(a)||!Number.isFinite(b)){alert('請輸入兩段有效時間');return}
  const m={id:uid(),type:'manual-location',name,auto:false,waypoint:true,incoming:{kind:'manual',fromId:prev.id,toId:null,actualMinutes:a}};
  m.incoming.toId=m.id;dest.incoming={kind:'manual',fromId:m.id,toId:dest.id,actualMinutes:b};d.items.splice(destIdx,0,m);render();
}
function removeItem(d,idx){d.items.splice(idx,1);recalcConnections(d,route);render()}
function render(){
  syncStarts();$('daysContainer').innerHTML=days.map(renderDay).join('');bindDays();
}
function opts(){return nodes.map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join('')}
function renderDay(d,i){
  const tl=buildTimeline(d,coef),s=summarizeDay(d,coef),p=i?last(days[i-1]):null,f=first(d),mis=i&&d.linkedStart&&p&&f&&(p.name!==f.name||p.type!==f.type);
  return '<article class="card day-card" data-day="'+i+'">'+
    '<div class="day-head"><div class="day-title"><strong>Day '+(i+1)+'</strong>'+(mis?'<span class="tag manual">起點未同步</span>':'')+'</div>'+
    '<div class="day-start"><label>出發</label><input class="start-time" type="time" value="'+d.startTime+'"></div>'+
    '<div class="stats"><div class="stat"><span>行進</span><b>'+fm(s.movement)+'m</b></div><div class="stat"><span>休息</span><b>'+fm(s.rest)+'m</b></div><div class="stat"><span>總計</span><b>'+fm(s.total)+'m</b></div><div class="stat coef"><span>係數</span><b>'+(s.coefficient??'—')+'</b></div></div></div>'+
    '<div class="day-tools">'+(i?'<label class="link-wrap"><input class="link-start" type="checkbox" '+(d.linkedStart?'checked':'')+'>銜接前日</label>':'<span class="link-wrap">起點</span>')+
    '<select class="start-node wide"><option value="">選起點／更換起點</option>'+opts()+'</select><button class="set-start secondary">設定起點</button>'+
    '<select class="add-node"><option value="">選下一重要節點</option>'+opts()+'</select><button class="add-dest">加入</button>'+(mis?'<button class="sync-start secondary">同步起點</button>':'')+'</div>'+
    '<div class="timeline">'+renderTimeline(d,tl.rows)+'</div></article>';
}
function renderTimeline(d,rows){
  if(!rows.length)return '<div class="empty">設定起點後，直接選下一個重要節點；中間節點會依上河總時間最短路徑自動補入。</div>';
  return rows.map(r=>{
    const idx=d.items.findIndex(x=>x.id===r.id);
    if(r.type==='rest')return '<div class="row rest-row draggable" draggable="true" data-index="'+idx+'"><div class="time">'+r.startTime+'</div><div class="marker">☕</div><div class="name"><span class="drag">⋮⋮</span> 休息</div><div class="meta"><input class="rest-min" data-index="'+idx+'" type="number" min="0" value="'+r.minutes+'"> 分　休息至 <b>'+r.endTime+'</b></div><div class="actions"><button class="ghost danger remove-item" data-index="'+idx+'">×</button></div></div>';
    let seg='';
    if(r.incoming){
      const e=r.incoming,a=edgeActual(e,coef);
      if(e.kind==='official'){
        const c=e.officialMinutes?round2(a/e.officialMinutes):0;
        seg='<div class="row segment-row"><div></div><div class="marker">│</div><div class="name">'+esc(e.from)+' → '+esc(e.to)+'</div><div class="meta"><input class="edge-time" data-index="'+idx+'" type="number" min="0" step="0.01" value="'+a+'"> 分 <span class="official">上河 '+e.officialMinutes+'</span><span class="coef">×'+Number(c).toFixed(2)+'</span></div><div class="actions"><button class="ghost tiny insert-manual" data-index="'+idx+'">＋手動點</button></div></div>';
      }else seg='<div class="row segment-row manual-seg"><div></div><div class="marker">│</div><div class="name">手動路段</div><div class="meta"><input class="edge-time" data-index="'+idx+'" type="number" min="0" step="0.01" placeholder="需輸入" value="'+(e.actualMinutes??'')+'"> 分 <span class="manual-note">手動設定・不計上河係數</span></div><div></div></div>';
    }
    const m=r.type==='manual-location';
    return seg+'<div class="row location-row '+(m?'draggable':'')+'" '+(m?'draggable="true"':'')+' data-index="'+idx+'"><div class="time">'+r.arrival+'</div><div class="marker">'+(m?'◇':'●')+'</div><div class="name">'+(m?'<span class="drag">⋮⋮</span> ':'')+esc(r.name)+' '+(m?'<span class="tag manual">手動</span>':r.auto?'<span class="tag">自動</span>':'')+'</div><div class="meta">'+(m?'手動節點':'上河節點')+(r._linkedStart?' ・前日銜接':'')+'</div><div class="actions"><button class="ghost tiny add-rest" data-index="'+idx+'">＋休息</button>'+(m?'<button class="ghost danger remove-item" data-index="'+idx+'">×</button>':'')+'</div></div>';
  }).join('');
}
function bindDays(){
  document.querySelectorAll('.day-card').forEach(card=>{
    const i=+card.dataset.day,d=days[i];
    card.querySelector('.start-time').onchange=e=>{d.startTime=e.target.value;render()};
    const lk=card.querySelector('.link-start');if(lk)lk.onchange=e=>{d.linkedStart=e.target.checked;render()};
    card.querySelector('.set-start').onclick=()=>{const v=card.querySelector('.start-node').value;if(v){setStart(d,v);render()}};
    card.querySelector('.add-dest').onclick=()=>{const v=card.querySelector('.add-node').value;if(v){appendNode(d,v);render()}};
    const sy=card.querySelector('.sync-start');if(sy)sy.onclick=()=>forceSync(i);
    card.querySelectorAll('.add-rest').forEach(b=>b.onclick=()=>addRest(d,+b.dataset.index));
    card.querySelectorAll('.insert-manual').forEach(b=>b.onclick=()=>addManual(d,+b.dataset.index));
    card.querySelectorAll('.remove-item').forEach(b=>b.onclick=()=>removeItem(d,+b.dataset.index));
    card.querySelectorAll('.edge-time').forEach(x=>x.onchange=()=>{const it=d.items[+x.dataset.index];if(it?.incoming)it.incoming.actualMinutes=Number(x.value);render()});
    card.querySelectorAll('.rest-min').forEach(x=>x.onchange=()=>{d.items[+x.dataset.index].minutes=Math.max(0,Number(x.value)||0);render()});
    card.querySelectorAll('.draggable').forEach(row=>{
      row.ondragstart=e=>{drag={day:i,index:+row.dataset.index};row.classList.add('dragging');e.dataTransfer.effectAllowed='move'};
      row.ondragend=()=>{row.classList.remove('dragging');document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'))};
      row.ondragover=e=>{e.preventDefault();row.classList.add('drop-target')};
      row.ondragleave=()=>row.classList.remove('drop-target');
      row.ondrop=e=>{e.preventDefault();if(!drag||drag.day!==i)return;const to=+row.dataset.index,from=drag.index;if(from===to)return;const [mv]=d.items.splice(from,1);d.items.splice(from<to?to-1:to,0,mv);recalcConnections(d,route);drag=null;render()};
    });
  });
}
init().catch(e=>{console.error(e);document.body.insertAdjacentHTML('beforeend','<p style="padding:20px;color:#9b3f3f">載入失敗：'+esc(e.message)+'</p>')});
