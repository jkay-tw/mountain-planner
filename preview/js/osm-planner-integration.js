import {resolveItineraryGeometry} from './itinerary-geometry.js?v=idea002p2';
import {joinLegCoordinates} from './dem-profile.js';
import {MainlandWorkerClient} from './mainland-worker-client.js?v=compactedit1123';
import {captureRoutingRequest,resolveRoutingRequest} from './routing-request.js';
import {coordinateOf,editSegment} from './path-editor.js';
export async function requestWithManualCore(worker,kind,details,ask=message=>confirm(message)){
 let response=await worker.request(kind,details);
 if(response.manualRequired&&ask('搜尋範圍包含台北核心路網資料（約 0.94 MiB），下載後可擴大搜尋。是否下載並重新搜尋？')){
  await worker.request('manual');
  response=await worker.request(kind,details);
 }
 return response;
}
export function attachOsmPlanner({host,getDays,data,onChange,onStatus=()=>{}}){
 const worker=new MainlandWorkerClient(),requests=new Map();
 const routeRequest=(kind,details)=>requestWithManualCore(worker,kind,details);
 function storeFailure(day,toId,message){editSegment(day,toId,next=>{next.routingError=String(message).slice(0,1000);for(const part of next.intervals||[])if(part.retry){part.failureReason=next.routingError;part.retry=false;}});}
 const demButton=document.createElement('button');demButton.textContent='更新行程 DEM 估算';demButton.dataset.updateDem='';host.querySelector('.geometry-actions').append(demButton);const demStatus=host.querySelector('[data-dem-status]');demButton.onclick=async()=>{demButton.disabled=true;demStatus.hidden=false;demStatus.dataset.busy='true';try{const updates=[];for(const day of getDays()){const resolved=resolveItineraryGeometry([day],data).days[0];for(const item of day.items){const points=joinLegCoordinates(resolved.features.filter(f=>f.toItemId===item.id));if(points.length<2)continue;demStatus.textContent='按目前線形取樣 DEM…';const response=await worker.request('dem',{points});updates.push({day,item,points,snapshot:response.result});}}
  const valid=updates.filter(({day,item,points})=>getDays().includes(day)&&day.items.includes(item)&&JSON.stringify(joinLegCoordinates(resolveItineraryGeometry([day],data).days[0].features.filter(f=>f.toItemId===item.id)))===JSON.stringify(points));for(const update of valid)update.item.demSnapshot=update.snapshot;onChange();delete demStatus.dataset.transient;demStatus.textContent=`已更新 ${valid.length} 路段 DEM 估算；缺值保持未知，新幾何不套舊快照。DEM下載 ${((updates.at(-1)?.snapshot.downloadBytes||0)/1048576).toFixed(2)} MiB、快取 ${((updates.at(-1)?.snapshot.cacheBytes||0)/1048576).toFixed(2)} MiB。請查看上方每日剖面。`;}
  catch(error){demStatus.textContent='DEM 更新未套用：'+error.message;}finally{demButton.disabled=false;delete demStatus.dataset.busy;}};

 const api={refit(day,toId,force=false,ready=false){
  const items=day.items.filter(i=>i.type!=='rest'),to=items.find(i=>i.id===toId),from=items[items.indexOf(to)-1];if(!from||!to)return null;
  const e=to.pathEdit;if(!force&&!e?.osmRouting&&!e?.controls?.length)return null;
  if(e?.intervals?.length&&e.intervals.every(p=>(e.intervalModes?.[p.key]||p.mode)==='straight'||(!force&&!p.retry)))return '已更新路徑。';
  const a=coordinateOf(from,data),b=coordinateOf(to,data);if(!a||!b)return null;
  if(!ready){const request=captureRoutingRequest(day,toId,data),key=day.id+'>'+toId,token={};requests.set(key,token);Promise.resolve().then(()=>{if(requests.get(key)!==token)return;const current=resolveRoutingRequest(getDays(),request,data);if(current){const message=api.refit(current.day,toId,force,true);onChange();onStatus(message);}else onStatus('路徑位置或控制點已變更，已取消舊的重算請求。');}).catch(error=>{if(requests.get(key)!==token)return;const current=resolveRoutingRequest(getDays(),request,data);if(current){storeFailure(current.day,toId,error.message);onChange();}onStatus('未能連接，已保留原路徑。')});return '正在更新路徑…';}

  const request=captureRoutingRequest(day,toId,data),key=day.id+'>'+toId,token={};requests.set(key,token);
  routeRequest('intervals',{key,points:[a,...(e?.controls||[]).map(c=>c.coordinate),b],edit:structuredClone(e||{controls:[]}),force}).then(response=>{
   if(requests.get(key)!==token)return;const current=resolveRoutingRequest(getDays(),request,data);if(!current){onStatus('路徑已變更，已取消舊的重算請求。');return;}
   const result=response.result;if(result.shape?.length>5000)throw Error('完整路徑超過單一路段5,000頂點上限，請增加行程點分段。');if(result.failures.length&&!result.shape)throw Error('附近未找到方向連通路網。');
   editSegment(current.day,toId,next=>{next.mode='straight';next.osmRouting=true;next.intervals=result.intervals;next.shape=result.shape;delete next.routingError;delete next.osmSnapshot;delete next.autoReference;delete next.networkNodeIds;});
   onChange();const message=(result.failures.length?'無連通路網的區間保留原線形。':'已更新路徑。')+`已載入 ${response.stats.tiles} 區；下載 ${(response.stats.downloadBytes/1048576).toFixed(2)} MiB、快取 ${(response.stats.cacheBytes/1048576).toFixed(2)} MiB；背景處理 ${Math.round(response.elapsedMs)} ms。`;onStatus(message);
  }).catch(error=>{if(requests.get(key)!==token)return;const current=resolveRoutingRequest(getDays(),request,data);if(current){storeFailure(current.day,toId,error.message);onChange();}onStatus('未能連接，已保留原路徑。'+error.message);});return '正在背景更新路徑…';

 }};return api;

}
