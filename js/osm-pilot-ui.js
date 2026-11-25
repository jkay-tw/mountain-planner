import {addFreeImagery} from './free-imagery.js';
import {buildGraph,nearestVertex,distanceRoute} from './osm-pilot-router.js';
import {pilotGpx} from './osm-pilot-gpx.js';
const status=document.querySelector('#status'),select=document.querySelector('#sample'),map=L.map('map').setView([24,121],8),geometry=L.featureGroup().addTo(map),plan=L.featureGroup().addTo(map);
const base=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map),traces=L.tileLayer('https://tile.happyman.idv.tw/mp/service?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=happyman&STYLE=default&TILEMATRIXSET=gm_grid&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fpng',{minZoom:7,maxZoom:19,opacity:.7,attribution:'Happyman／山友行跡參考'});const layers=L.control.layers({'OSM':base},{'Happyman 行跡（只顯示）':traces}).addTo(map);
addFreeImagery({L,map,layers,onError:message=>{status.textContent=message}});
let graph=null,chosen=[],loading=0,lastRoute=null,pending=null;const download=document.querySelector('#gpx'),candidate=document.querySelector('#candidate'),pick=L.featureGroup().addTo(map);
function cancel(){pending=null;candidate.hidden=true;pick.clearLayers()}
document.querySelector('#cancel').onclick=cancel;
document.querySelector('#reset').onclick=()=>{cancel();chosen=[];lastRoute=null;download.disabled=true;plan.clearLayers();status.textContent='請點起點與終點，並確認接入位置。'};
async function load(){const version=++loading;cancel();graph=null;chosen=[];lastRoute=null;download.disabled=true;plan.clearLayers();geometry.clearLayers();status.textContent='讀取區塊中…';try{const start=performance.now(),res=await fetch('data/osm-pilot/'+select.value);if(!res.ok)throw Error('區塊無法載入');if(typeof DecompressionStream==='undefined')throw Error('此瀏覽器不支援 gzip 解碼，請使用新版瀏覽器。');const data=await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).json();if(version!==loading)return;graph=buildGraph(data);document.dispatchEvent(new CustomEvent('pilot-data',{detail:{nodes:data.nodes,file:select.value,map}}));for(const w of data.ways)L.polyline(w.refs.map(id=>data.nodes[id]).filter(Boolean).map(p=>[p[1],p[0]]),{weight:2,color:'#738477'}).addTo(geometry);if(geometry.getBounds().isValid())map.fitBounds(geometry.getBounds());status.textContent=`${data.ways.length} 條來源線形、${Object.keys(data.nodes).length} 個幾何點；本機載入與建圖 ${(performance.now()-start).toFixed(0)} ms。請選起點與終點。`}catch(e){status.textContent=e.message}}
select.onchange=load;
map.on('click',e=>{
 if(!graph)return;
 cancel();
 const p=[e.latlng.lng,e.latlng.lat],near=nearestVertex(graph,p);
 L.circleMarker(e.latlng,{radius:6,color:'#216fa4'}).addTo(pick);
 if(!near){status.textContent=geometry.getBounds().contains(e.latlng)?'已載入線形範圍內，但 200 公尺內沒有可接入節點。':'目前點位超出已載入線形包圍範圍，請切換區域。';return}
 pending={...near,point:p};candidate.hidden=false;
 document.querySelector('#candidate-label').textContent=`距指定位置約 ${near.meters.toFixed(0)} 公尺的 OSM 節點；虛線不是已核實步道。`;
 L.circleMarker([near.coordinate[1],near.coordinate[0]],{radius:4,color:'#ba5426'}).addTo(pick);
 L.polyline([e.latlng,[near.coordinate[1],near.coordinate[0]]],{dashArray:'5 5',color:'#ba5426'}).addTo(pick);
});
 document.querySelector('#accept').onclick=()=>{if(!pending)return;const near=pending,p=near.point;cancel();if(chosen.length===2){chosen=[];lastRoute=null;download.disabled=true;plan.clearLayers()}chosen.push({...near,point:p});L.circleMarker([p[1],p[0]],{radius:6}).addTo(plan);L.polyline([[p[1],p[0]],[near.coordinate[1],near.coordinate[0]]],{dashArray:'5 5',color:'#ba5426'}).addTo(plan);if(chosen.length<2){status.textContent='起點已選，請點終點。';return}const t=performance.now(),route=distanceRoute(graph,chosen[0].id,chosen[1].id);if(!route){status.textContent='本區塊未找到方向可通的路徑；可能是資料範圍或來源路網缺漏。';return}lastRoute=route;document.dispatchEvent(new CustomEvent('pilot-route',{detail:route.coordinates}));download.disabled=false;L.polyline(route.coordinates.map(p=>[p[1],p[0]]),{weight:5,color:'#ba5426'}).addTo(plan);let up=0,down=0;const known=route.coordinates.every(p=>Number.isFinite(p[2]));if(known)for(let i=1;i<route.coordinates.length;i++){const dz=route.coordinates[i][2]-route.coordinates[i-1][2];up+=Math.max(0,dz);down+=Math.max(0,-dz)}status.textContent=`來源線形距離 ${(route.distanceMeters/1000).toFixed(2)} km；不含接入線。\n節點 DEM 抽樣升降：${known?'↑ '+Math.round(up)+' m／↓ '+Math.round(down)+' m':'無資料'}。時間未知。\n本機尋路 ${(performance.now()-t).toFixed(0)} ms；不是手機效能保證。`};
try{const r=await fetch('data/osm-pilot/samples.json');if(!r.ok)throw Error('檢查樣本尚未建置');const items=await r.json();for(const item of items)select.append(new Option(item.name,item.file));await load()}catch(e){status.textContent=e.message}

download.onclick=()=>{
 if(!lastRoute)return;
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([pilotGpx(lastRoute,chosen)],{type:'application/gpx+xml'}));
 a.href=url;a.download='osm-pilot.gpx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
