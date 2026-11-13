import {shortestPath} from './planner.js?v=segments1';
// Local geometric attachment, only applied after an explicit user choice.
export function closestProjection(point,span){
 const coords=span.coordinates;let best=null;
 for(let i=1;i<coords.length;i++){
  const a=coords[i-1],b=coords[i],scale=Math.cos(point[1]*Math.PI/180),dx=(b[0]-a[0])*scale,dy=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*scale*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy||1))),p=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],distance=Math.hypot((p[0]-point[0])*scale,p[1]-point[1])*111195;
  if(!best||distance<best.distance)best={i,p,distance,t};
 }
 return best;
}
export function attachmentPath(point,span,nodeId){
 const coords=span.coordinates,best=closestProjection(point,span);
 if(!best||![span.fromId,span.toId].includes(nodeId))throw Error('連接來源已不存在，請重新確認路段');
 return {distance:best.distance,coordinates:[point,best.p,...(nodeId===span.fromId?coords.slice(0,best.i).reverse():coords.slice(best.i))]};
}
// Offer a single-span candidate only where the directed graph itself contains
// that exact edge. A nearby line alone is never sufficient evidence.
export function directSpanCandidates(a,b,data,route,maxMeters=15){
 if(!a?.coordinate||!b?.coordinate)return [];
 const out=[];
 for(const span of data.spans){
  if(span.aggregate||span.viaNodeIds?.length)continue;
  const x=closestProjection(a.coordinate,span),y=closestProjection(b.coordinate,span);if(!x||!y||x.distance>maxMeters||y.distance>maxMeters)continue;
  const reverse=x.i+x.t>y.i+y.t;if(reverse&&!span.reversible)continue;
  const from=reverse?span.toId:span.fromId,to=reverse?span.fromId:span.toId,path=shortestPath(route,from,to);
  if(!path||path.segments.length!==1||path.segments[0].fromId!==from||path.segments[0].toId!==to)continue;
  const middle=reverse?span.coordinates.slice(y.i,x.i).reverse():span.coordinates.slice(x.i,y.i);
  const coordinates=[a.coordinate,x.p,...middle,y.p,b.coordinate].filter((p,i,all)=>i===0||p[0]!==all[i-1][0]||p[1]!==all[i-1][1]);
  out.push({spanId:span.id,from,to,coordinates,distanceA:x.distance,distanceB:y.distance,sourceName:span.sourceName||'參考線形',sourceUrl:span.sourceUrl||data.source?.url||''});
 }
 return out;
}
// Refit only to the exact span the user has already confirmed. Control
// coordinates stay untouched. A failed fit leaves the edited geometry intact.
export function refitConfirmedSpan(edit,from,to,data,route){
 if(!edit?.autoReference||!edit.candidateSource?.spanId||edit.mode!=='straight'||!from?.coordinate||!to?.coordinate)return false;
 const points=[{coordinate:from.coordinate},...edit.controls,{coordinate:to.coordinate}],shape=[];
 for(let i=1;i<points.length;i++){
  const candidate=directSpanCandidates(points[i-1],points[i],data,route).find(c=>c.spanId===edit.candidateSource.spanId);if(!candidate)return false;
  const vertices=candidate.coordinates.slice(i===1?0:1).map(coordinate=>({coordinate:[...coordinate]}));
  if(i<points.length-1){if(!vertices.length)return false;vertices.at(-1).controlId=points[i].id}
  shape.push(...vertices);if(shape.length>5000)return false;
 }
 edit.shape=shape;return true;
}
export function attachmentCandidates(item,data){
 if(!item.coordinate)return [];
 return data.spans.filter(s=>!s.aggregate).flatMap(s=>[s.fromId,s.toId].map(nodeId=>({spanId:s.id,nodeId,...attachmentPath(item.coordinate,s,nodeId),label:(data.nodes.find(n=>n.nodeId===s.fromId)?.name||s.fromId)+' → '+(data.nodes.find(n=>n.nodeId===s.toId)?.name||s.toId)+'；連接端 '+(data.nodes.find(n=>n.nodeId===nodeId)?.name||nodeId)}))).sort((a,b)=>a.distance-b.distance).slice(0,8);
}
