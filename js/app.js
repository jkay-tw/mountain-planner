import {loadManifest, loadRoute} from './data-loader.js';
import {outgoing, buildRows, summarize} from './planner.js';
import {exportExcel} from './exporter.js';

const el = id => document.getElementById(id);
let manifest, route, items=[];

async function init(){
  manifest = await loadManifest();
  el('routeSelect').innerHTML = manifest.routes.map(r=>`<option value="${r.id}">${r.id}｜${r.name}</option>`).join('');
  await selectRoute(manifest.routes[0].id);
  wire(); render();
}
async function selectRoute(id){
  const meta = manifest.routes.find(r=>r.id===id);
  route = await loadRoute(meta.file);
  items=[];
  const nodes=[...new Set(route.segments.map(s=>s.from))];
  el('fromSelect').innerHTML = nodes.map(n=>`<option>${n}</option>`).join('');
  el('routeMeta').textContent = `${route.route_id}｜${route.route_name}｜資料狀態：${route.status}`;
  refreshTo();
}
function refreshTo(){
  const from=el('fromSelect').value;
  const segs=outgoing(route,from);
  el('toSelect').innerHTML=segs.map(s=>`<option value="${s.to}">${s.to}</option>`).join('');
  const seg=segs[0];
  el('segmentInfo').textContent=seg?`${from} → ${seg.to}：上河 ${seg.minutes} 分鐘｜${seg.status}`:'此點沒有可用的下一路段';
}
function selectedSegment(){ return route.segments.find(s=>s.from===el('fromSelect').value && s.to===el('toSelect').value); }
function render(){
  const rows=buildRows(items, el('startTime').value);
  const summary=summarize(items);
  el('sumSunriver').textContent=`${summary.sunriver} 分`;
  el('sumAdjusted').textContent=`${summary.adjusted} 分`;
  el('sumRest').textContent=`${summary.rest} 分`;
  el('sumTotal').textContent=`${summary.total} 分`;
  el('itineraryBody').innerHTML=rows.map((r,i)=>`<tr><td>${r.index}</td><td>${r.arrive}</td><td>${r.to}</td><td>${r.minutes}</td><td>${r.coefficient}</td><td>${r.walk}</td><td>${r.rest}</td><td>${r.depart}</td><td class="source-cell"><a href="${route.source.image_url}" target="_blank">${route.route_id}</a></td><td><button class="remove" data-i="${i}">刪除</button></td></tr>`).join('');
  document.querySelectorAll('.remove').forEach(b=>b.onclick=()=>{items.splice(Number(b.dataset.i),1);render();});
}
function wire(){
  el('routeSelect').onchange=async e=>{await selectRoute(e.target.value);render();};
  el('fromSelect').onchange=refreshTo;
  el('toSelect').onchange=()=>{const s=selectedSegment();el('segmentInfo').textContent=s?`${s.from} → ${s.to}：上河 ${s.minutes} 分鐘｜${s.status}`:'';};
  el('coefficient').oninput=render; el('startTime').oninput=render;
  el('addBtn').onclick=()=>{
    const s=selectedSegment(); if(!s) return;
    items.push({...s, coefficient:Number(el('coefficient').value)||1, rest:Number(el('restMinutes').value)||0});
    el('fromSelect').value=s.to; refreshTo(); el('restMinutes').value=0; render();
  };
  el('resetBtn').onclick=()=>{items=[];render();};
  el('exportBtn').onclick=async()=>{
    if(!items.length){alert('請先加入至少一個路段');return;}
    const rows=buildRows(items,el('startTime').value), summary=summarize(items);
    await exportExcel({route,items,rows,startTime:el('startTime').value,summary,datasetVersion:manifest.dataset_version});
  };
}
init().catch(err=>{console.error(err);document.body.insertAdjacentHTML('beforeend',`<p style="padding:20px;color:#9b3f3f">載入失敗：${err.message}。請透過本機伺服器或 GitHub Pages 開啟，而不是直接雙擊 file://。</p>`);});
