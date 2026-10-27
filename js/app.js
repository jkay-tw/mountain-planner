import {loadManifest,loadRoute} from './data-loader.js';
import {allNodes,shortestPath,uid,round2,edgeActual,buildTimeline,summarizeDay,recalcConnections,formatDuration} from './planner.js';
import {exportExcel} from './exporter.js';

const $=id=>document.getElementById(id);
let manifest,route,nodes=[],days=[],drag=null;
const newDay=i=>({id:uid(),startTime:i?'05:30':'06:00',coefficient:.8,linkedStart:i>0,note:'',items:[]});
const locs=d=>d.items.filter(x=>x.type!=='rest');
const first=d=>locs(d)[0]||null;
const last=d=>{const a=locs(d);return a[a.length-1]||null};
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function init(){
  manifest=await loadManifest();
  $('routeSelect').innerHTML=manifest.routes.map(r=>'<option value="'+r.id+'">'+r.id+'｜'+r.name+'</option>').join('');
  $('dayCount').innerHTML=Array.from({length:10},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+' 天</option>').join('');
  $('dayCount').value='2';await loadGroup(manifest.routes[0].id);days=[newDay(0),newDay(1)];bindGlobal();render();
}
async function loadGroup(id){
  const m=manifest.routes.find(r=>r.id===id);route=await loadRoute(m.file);nodes=allNodes(route);$('routeMeta').textContent=route.route_id+'｜'+route.route_name+'｜'+route.status;
}
function bindGlobal(){
  $('routeSelect').onchange=async e=>{
    if(days.some(d=>d.items.length)&&!confirm('切換上河圖會清空目前行程，確定切換？')){e.target.value=route.route_id;return}
    await loadGroup(e.target.value);days=days.map((_,i)=>newDay(i));render();
  };
  $('dayCount').onchange=e=>{const n=+e.target.value;while(days.length<n)days.push(newDay(days.length));days=days.slice(0,n);render()};
  $('resetBtn').onclick=()=>{if(confirm('清空所有行程？')){days=days.map((_,i)=>newDay(i));render()}};
  $('exportBtn').onclick=async()=>{if(!days.some(d=>locs(d).length)){alert('請先建立行程');return}await exportExcel({route,days,datasetVersion:manifest.dataset_version})};
  $('copyBtn').onclick=copyTextItinerary;
}
function addNode(day,name){
  const p=last(day);
  if(!p){day.items.push({id:uid(),type:'location',name,auto:false,waypoint:true,note:'',isPeak:false,hasWater:false,incoming:null});return}
  if(p.type==='manual-location'){
    const id=uid();day.items.push({id,type:'location',name,auto:false,waypoint:true,note:'',isPeak:false,hasWater:false,incoming:{kind:'manual',fromId:p.id,toId:id,actualMinutes:null}});return
  }
  const path=shortestPath(route,p.name,name);if(!path){alert('找不到 '+p.name+' → '+name+' 的上河路徑');return}
  path.segments.forEach((s,i)=>day.items.push({id:uid(),type:'location',name:s.to,auto:i<path.segments.length-1,waypoint:i===path.segments.length-1,note:'',isPeak:false,hasWater:false,incoming:{kind:'official',from:s.from,to:s.to,officialMinutes:s.minutes,actualMinutes:null,source:route.source.image_url}}));
}
function syncStarts(){
  for(let i=1;i<days.length;i++){
    const d=days[i],p=last(days[i-1]);if(!d.linkedStart||!p)continue;
    const f=first(d);
    if(!f)d.items.unshift({id:uid(),type:p.type,name:p.name,auto:false,waypoint:true,note:'',isPeak:p.isPeak||false,hasWater:p.hasWater||false,incoming:null,_linkedStart:true});
    else if(f._linkedStart&&(f.name!==p.name||f.type!==p.type)){f.name=p.name;f.type=p.type;f.incoming=null;f.isPeak=p.isPeak||false;f.hasWater=p.hasWater||false;recalcConnections(d,route)}
  }
}
function forceSync(i){
  const p=last(days[i-1]);if(!p)return;const d=days[i],f=first(d);
  if(!f)d.items.unshift({id:uid(),type:p.type,name:p.name,auto:false,waypoint:true,note:'',isPeak:p.isPeak||false,hasWater:p.hasWater||false,incoming:null,_linkedStart:true});
  else{f.name=p.name;f.type=p.type;f._linkedStart=true;f.incoming=null;recalcConnections(d,route)}render();
}
function insertRest(d,idx){d.items.splice(idx+1,0,{id:uid(),type:'rest',minutes:15});render()}
function insertManual(d,destIdx){
  const dest=d.items[destIdx],prev=[...d.items.slice(0,destIdx)].reverse().find(x=>x.type!=='rest');if(!dest||!prev)return;
  const m={id:uid(),type:'manual-location',name:'手動節點',auto:false,waypoint:true,note:'',isPeak:false,hasWater:false,incoming:{kind:'manual',fromId:prev.id,toId:null,actualMinutes:null}};
  m.incoming.toId=m.id;dest.incoming={kind:'manual',fromId:m.id,toId:dest.id,actualMinutes:null};d.items.splice(destIdx,0,m);render();
}
function removeItem(d,idx){
  d.items.splice(idx,1);recalcConnections(d,route);render();
}
function copyTextItinerary(){
  const blocks=[];
  days.forEach((d,i)=>{
    const rows=buildTimeline(d).rows.filter(r=>r.type!=='rest');
    if(!rows.length)return;
    const text=rows.map(r=>r.arrival+' '+r.name+(r.isPeak?'⛰':'')+(r.hasWater?'💧':'')).join('→');
    blocks.push('D'+(i+1)+'：'+text+'。');
  });
  const text=blocks.join('\n\n');
  if(!text){alert('目前沒有可複製的行程');return}
  const done=()=>toast('已複製文字行程');
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done));
  else fallbackCopy(text,done);
}
function fallbackCopy(text,done){
  const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();done();
}
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),1800)}
function opts(){return nodes.map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join('')}
function render(){
  syncStarts();$('daysContainer').innerHTML=days.map(renderDay).join('');bindDays();
}
function renderDay(d,i){
  const tl=buildTimeline(d),s=summarizeDay(d),p=i?last(days[i-1]):null,f=first(d),mis=i&&d.linkedStart&&p&&f&&(p.name!==f.name||p.type!==f.type);
  return '<article class="card day-card" data-day="'+i+'">'+
  '<div class="day-head"><div class="day-title"><strong>Day '+(i+1)+'</strong>'+(mis?'<span class="manual-note">起點未同步</span>':'')+'</div>'+
  '<div class="day-control"><label>出發</label><input class="start-time" type="time" value="'+d.startTime+'"></div>'+
  '<div class="day-control coefficient"><label>預設係數</label><input class="day-coef" type="number" min="0.1" max="3" step="0.01" value="'+Number(d.coefficient).toFixed(2)+'"></div>'+
  '<div class="stats"><div class="stat"><span>行進</span><b>'+formatDuration(s.movement)+'</b></div><div class="stat"><span>休息</span><b>'+formatDuration(s.rest)+'</b></div><div class="stat"><span>總計</span><b>'+formatDuration(s.total)+'</b></div><div class="stat coef"><span>平均</span><b>'+(s.coefficient??'—')+'</b></div></div></div>'+
  '<div class="day-tools">'+(i?'<label class="link-wrap"><input class="link-start" type="checkbox" '+(d.linkedStart?'checked':'')+'>銜接前日</label>':'<span class="link-wrap">第一點即起點</span>')+
  '<select class="add-node"><option value="">選擇下一個行程點</option>'+opts()+'</select><button class="add-dest">加入</button>'+(mis?'<button class="sync-start secondary">同步前日終點</button>':'')+'</div>'+
  '<div class="timeline">'+renderTimeline(d,tl.rows)+'</div>'+
  '<div class="day-footer"><textarea class="day-note" placeholder="Day '+(i+1)+' 備註">'+esc(d.note||'')+'</textarea></div></article>';
}
function renderTimeline(d,rows){
  if(!rows.length)return '<div class="empty">直接選擇第一個行程點；它就是當日的起點。之後選重要節點，中間路徑會自動補入。</div>';
  return rows.map(r=>{
    const idx=d.items.findIndex(x=>x.id===r.id);
    if(r.type==='rest')return '<div class="row rest-row draggable" draggable="true" data-index="'+idx+'"><div class="time">'+r.endTime+'</div><div class="marker">☕</div><div class="name"><span class="drag">⋮⋮</span> 休息</div><div class="meta"><input class="rest-min" data-index="'+idx+'" type="number" min="0" value="'+r.minutes+'"> 分</div><div></div><div class="actions"><button class="ghost danger remove-item" data-index="'+idx+'">×</button></div></div>';
    let seg='';
    if(r.incoming){
      const e=r.incoming,a=edgeActual(e,d.coefficient);
      if(e.kind==='official'){
        const k=e.officialMinutes?round2(a/e.officialMinutes):0;
        seg='<div class="row segment-row"><div></div><div class="marker">│</div><div class="name">'+esc(e.from)+' → '+esc(e.to)+'</div><div class="meta"><input class="edge-time" data-index="'+idx+'" type="number" min="0" step="0.01" value="'+a+'"> 分 <span class="official">上河 '+formatDuration(e.officialMinutes)+'</span><span class="coef">×'+Number(k).toFixed(2)+'</span></div><div></div><div class="actions"><button class="ghost tiny insert-manual" data-index="'+idx+'">＋手動點</button></div></div>';
      }else seg='<div class="row segment-row manual-seg"><div></div><div class="marker">│</div><div class="name">手動路段</div><div class="meta"><input class="edge-time" data-index="'+idx+'" type="number" min="0" step="0.01" placeholder="時間" value="'+(e.actualMinutes??'')+'"> 分 <span class="manual-note">不計係數</span></div><div></div><div></div></div>';
    }
    const manual=r.type==='manual-location';
    const nameHtml=manual?'<input class="manual-name" data-index="'+idx+'" value="'+esc(r.name)+'">':'<span class="'+(r.auto?'auto-node':'')+'">'+esc(r.name)+'</span>';
    return seg+'<div class="row location-row '+(manual?'draggable':'')+'" '+(manual?'draggable="true"':'')+' data-index="'+idx+'"><div class="time">'+r.arrival+'</div><div class="marker">'+(manual?'◇':'●')+'</div><div class="name">'+(manual?'<span class="drag">⋮⋮</span> ':'')+nameHtml+'</div><div class="meta"><button class="icon-toggle peak '+(r.isPeak?'active':'')+'" data-index="'+idx+'" title="山頭">⛰</button><button class="icon-toggle water '+(r.hasWater?'active':'')+'" data-index="'+idx+'" title="水源">💧</button></div><div><input class="note-input" data-index="'+idx+'" placeholder="備註" value="'+esc(r.note||'')+'"></div><div class="actions"><button class="ghost tiny add-rest" data-index="'+idx+'">＋休息</button><button class="ghost danger remove-item" data-index="'+idx+'">×</button></div></div>';
  }).join('');
}
function bindDays(){
  document.querySelectorAll('.day-card').forEach(card=>{
    const i=+card.dataset.day,d=days[i];
    card.querySelector('.start-time').onchange=e=>{d.startTime=e.target.value;render()};
    card.querySelector('.day-coef').onchange=e=>{d.coefficient=Math.max(.1,Number(e.target.value)||.8);render()};
    card.querySelector('.day-note').onchange=e=>{d.note=e.target.value};
    const lk=card.querySelector('.link-start');if(lk)lk.onchange=e=>{d.linkedStart=e.target.checked;render()};
    card.querySelector('.add-dest').onclick=()=>{const v=card.querySelector('.add-node').value;if(v){addNode(d,v);render()}};
    const sy=card.querySelector('.sync-start');if(sy)sy.onclick=()=>forceSync(i);
    card.querySelectorAll('.add-rest').forEach(b=>b.onclick=()=>insertRest(d,+b.dataset.index));
    card.querySelectorAll('.insert-manual').forEach(b=>b.onclick=()=>insertManual(d,+b.dataset.index));
    card.querySelectorAll('.remove-item').forEach(b=>b.onclick=()=>removeItem(d,+b.dataset.index));
    card.querySelectorAll('.edge-time').forEach(x=>x.onchange=()=>{const it=d.items[+x.dataset.index];if(it?.incoming)it.incoming.actualMinutes=x.value===''?null:Number(x.value);render()});
    card.querySelectorAll('.rest-min').forEach(x=>x.onchange=()=>{d.items[+x.dataset.index].minutes=Math.max(0,Number(x.value)||0);render()});
    card.querySelectorAll('.manual-name').forEach(x=>x.onchange=()=>{d.items[+x.dataset.index].name=x.value.trim()||'手動節點';render()});
    card.querySelectorAll('.note-input').forEach(x=>x.onchange=()=>{d.items[+x.dataset.index].note=x.value});
    card.querySelectorAll('.peak').forEach(b=>b.onclick=()=>{const it=d.items[+b.dataset.index];it.isPeak=!it.isPeak;render()});
    card.querySelectorAll('.water').forEach(b=>b.onclick=()=>{const it=d.items[+b.dataset.index];it.hasWater=!it.hasWater;render()});
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
