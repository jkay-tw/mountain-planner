import {validateClassicRoute} from './classic-route.js?v=owner1123';
import {incomingForSegment} from './planner.js?v=segments1';
const clone=value=>structuredClone(value);
export const hasRouteDirection=definition=>['loop','traverse'].includes(definition?.type);
export function classicRoutePreview(definition,context,geometry){
 const spans=new Map(geometry.spans.map(s=>[s.id,s]));
 return {names:definition.occurrences.map(o=>({name:context.nodes.get(o.nodeId).name,key:o.key})),lines:definition.geometryBindings.map(b=>{const s=spans.get(b.spanId);return b.reverse?[...s.coordinates].reverse():s.coordinates;}),manualSegments:definition.directedSegments.filter(s=>s.timeStatus==='manual-required').length};
}
export async function sha256(value){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function routePickerNodes(definition,graph){
 const seen=new Set();return definition.occurrences.flatMap(o=>{if(seen.has(o.nodeId))return [];seen.add(o.nodeId);const n=graph.nodes.find(n=>n.id===o.nodeId);return n?[n]:[];});
}
export function searchClassicRoutes(entries,query){
 const q=query.trim().toLocaleLowerCase();return entries.filter(e=>[e.routeId,e.forward.name,...(e.forward.aliases||[])].some(s=>s.toLocaleLowerCase().includes(q)));
}
export async function prepareClassicDay(definition,context,geometry,day,uid,spanDigests){
 if(day.items.length)throw Error('請選擇空白 DAY，既有行程不會被取代。');
 validateClassicRoute(definition,context);
 if(definition.applicationStatus!=='candidate-review')throw Error('此方向仍有路段或線形缺口，尚不能整條套用。');
 const spans=new Map(geometry.spans.map(s=>[s.id,s]));
 for(const binding of definition.geometryBindings){
  const span=spans.get(binding.spanId);
  if(!span||await sha256(JSON.stringify(span))!==spanDigests[binding.spanId])throw Error('路段資料版本已變更，請重新核對候選路線。');
 }
 const batchId=uid(),items=definition.occurrences.map((o,i)=>({id:uid(),type:'location',nodeId:o.nodeId,name:context.nodes.get(o.nodeId).name,note:'',isPeak:false,hasWater:false,showInTable:o.key||i===0||i===definition.occurrences.length-1,waypoint:o.key,classicRoute:{routeId:definition.routeId,version:definition.version,direction:definition.direction,position:o.position,key:o.key,batchId,verification:definition.verification,baseCommit:definition.source.baseCommit},incoming:null}));
 if(new Set(items.map(i=>i.id)).size!==items.length)throw Error('行程位置 ID 重複，未套用。');
 for(let i=1;i<items.length;i++){
  const ref=definition.directedSegments[i-1].edgeRef,key=JSON.stringify([ref.fromId,ref.toId]);
  const segment=context.edges.get(key)||context.manuals.get(key)||context.vehicles.get(key);
  if(!segment)throw Error('指定方向路段不存在，未套用。');
  items[i].incoming=ref.kind==='vehicle'?{kind:'manual',travelMode:'vehicle',connectionStatus:'owner-confirmed',sourceMinutes:segment.minutes,actualMinutes:segment.minutes,fromId:items[i-1].id,toId:items[i].id,fromNodeId:segment.fromId,toNodeId:segment.toId,source:segment.source}:{...incomingForSegment(segment,items[i-1].id,items[i].id,segment.source,day.coefficient),fromId:items[i-1].id,toId:items[i].id};
 }
 for(const binding of definition.geometryBindings){
  const span=spans.get(binding.spanId),slice=items.slice(binding.fromPosition,binding.toPosition+1);
  const coordinates=clone(span.coordinates);if(binding.reverse)coordinates.reverse();
  const profile=span.profile?clone(span.profile):null;
  if(binding.reverse&&profile){for(const p of profile)p[0]=span.distanceMeters-p[0];profile.reverse();}
  slice[0].classicGeometry={spanId:span.id,reverse:binding.reverse,batchId,nodeIds:slice.map(i=>i.nodeId),positions:slice.map(i=>i.classicRoute.position),coordinates,profile,sourceName:span.sourceName||'OpenStreetMap',sourceUrl:span.sourceUrl||geometry.source.url,intermediateCoordinatesUnknown:!!span.intermediateCoordinatesUnknown};
  for(const item of slice.slice(0,-1))item.classicRoute.geometrySpanId=span.id;
 }
 return {...clone(day),displayMode:'important',linkedStart:false,items};
}
