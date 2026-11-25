import {attachedRoute,edgeCandidates} from './osm-attachment-routing.js';
import {meters} from './osm-pilot-router.js';
function networkProfile(coordinates){if(coordinates.some(p=>!Number.isFinite(p[2])))return null;let distance=0;return coordinates.map((p,i)=>{if(i)distance+=meters(coordinates[i-1],p);return [distance,p[2]];});}
export function intervalShape(intervals,controls){const shape=[];intervals.forEach((p,i)=>{p.coordinates.forEach((coordinate,j)=>{if(i&&j===0)return;shape.push({coordinate:[...coordinate],...(j===p.coordinates.length-1&&i<controls.length?{controlId:controls[i].id}:{})})});});if(shape.length>5000)throw Error('路徑超過 5,000 頂點，請分段規劃');return shape;}
function failureReason(graph,a,b){if(!graph)return '此位置尚無已載入的可尋路資料。';const start=edgeCandidates(graph,a).length,end=edgeCandidates(graph,b).length;if(!start||!end)return `${!start&&!end?'兩端':!start?'起點':'終點'}120 公尺內沒有可接入的路網；沒有強制吸附或跳接。`;return '兩端附近路段沒有方向連通的路徑；保留原線形。';}
export function rememberIntervals(edit){
 if(!edit.shape?.length)return;
 const points=edit.shape,ends=[0,...points.map((p,i)=>p.controlId?i:-1).filter(i=>i>0&&i<points.length-1),points.length-1];
 const previous=edit.intervals||[];edit.intervals=ends.slice(1).map((end,i)=>{const start=ends[i],x=points[start],y=points[end],key=(x.controlId||'start')+'>'+(y.controlId||'end'),mode=edit.intervalModes?.[key]||'auto',coordinates=points.slice(start,end+1).map(p=>[...p.coordinate]);const signature=JSON.stringify([x.coordinate,y.coordinate,mode]),cached=previous.find(p=>p.key===key&&p.signature===signature&&JSON.stringify(p.coordinates)===JSON.stringify(coordinates));if(cached)return cached;return {key,signature,mode,preserved:true,network:false,coordinates};});
}
// Stable boundary IDs let unchanged intervals retain their confirmed geometry.
export function routeIntervals(edit,a,b,graph,{recalculate=false}={}){
 const boundaries=[{id:'start',coordinate:a},...edit.controls,{id:'end',coordinate:b}],old=edit.intervals||[];
 const intervals=[],failures=[];
 for(let i=1;i<boundaries.length;i++){
  const x=boundaries[i-1],y=boundaries[i],key=x.id+'>'+y.id;
  const mode=edit.intervalModes?.[key]||'auto',signature=JSON.stringify([x.coordinate,y.coordinate,mode]);
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),unchangedStart=i===1&&same(edit.endpointCoordinates?.[0],a),unchangedEnd=i===boundaries.length-1&&same(edit.endpointCoordinates?.[1],b);
  const cached=old.find(p=>p.key===key&&p.mode===mode&&(p.signature===signature||((unchangedStart||same(p.coordinates[0],x.coordinate))&&(unchangedEnd||same(p.coordinates.at(-1),y.coordinate))))&&(p.preserved||p.network||mode==='straight'));
  if(cached&&!cached.retry&&(!recalculate||mode==='straight')){intervals.push(cached);continue;}
  const r=mode==='auto'&&graph?attachedRoute(graph,x.coordinate,y.coordinate):null;
  const reason=mode==='auto'&&!r?failureReason(graph,x.coordinate,y.coordinate):null;
  if(reason){failures.push(key);if(cached){intervals.push({...cached,retry:false,failureReason:reason});continue;}}
  intervals.push({key,signature,mode,network:!!r,preserved:true,coordinates:r?[x.coordinate,...r.coordinates.map(p=>p.slice(0,2)),y.coordinate]:[x.coordinate,y.coordinate],access:r?Math.max(r.start.distance,r.end.distance):null,...(r?{accessSegments:true,networkProfile:networkProfile(r.coordinates),sourceName:'OSM 路網規劃；DEM 原頂點估算；非已核實步道',sourceUrl:'https://www.openstreetmap.org/copyright',wayIds:[...new Set(r.wayIds)]}:{}),...(reason?{failureReason:reason}:{})});
 }
 const shape=intervalShape(intervals,edit.controls);
 return {intervals,shape,failures};
}
