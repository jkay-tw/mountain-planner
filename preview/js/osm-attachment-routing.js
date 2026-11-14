import {meters,distanceRoute} from './osm-pilot-router.js';
// Project onto actual directed graph edges, without merging nearby identities.
export function edgeCandidates(graph,p,radius=120,limit=3){
 const seen=new Set(),out=[];
 for(const [a,edges] of graph.adjacency)for(const edge of edges){const b=edge.to,key=[a,b].sort().join('|');if(seen.has(key))continue;seen.add(key);
  const x=graph.nodes[a],y=graph.nodes[b],scale=Math.cos(p[1]*Math.PI/180),dx=(y[0]-x[0])*scale,dy=y[1]-x[1],t=Math.max(0,Math.min(1,((p[0]-x[0])*scale*dx+(p[1]-x[1])*dy)/(dx*dx+dy*dy||1))),point=[x[0]+t*(y[0]-x[0]),x[1]+t*(y[1]-x[1]),Number.isFinite(x[2])&&Number.isFinite(y[2])?x[2]+t*(y[2]-x[2]):null],distance=meters(p,point);
  if(distance<=radius)out.push({a,b,t,point,distance,key});
 }
 return out.sort((a,b)=>a.distance-b.distance).slice(0,limit);
}
function between(graph,x,y){
 const nodes=Object.create(graph.nodes),adjacency=new Map(graph.adjacency),groups=new Map();
 for(const [id,c] of [['@start',x],['@end',y]]){nodes[id]=c.point;const g=groups.get(c.key)||{a:c.a,b:c.b,points:[]};g.points.push({id,t:c.a===g.a?c.t:1-c.t});groups.set(c.key,g);}
 for(const g of groups.values()){
  const chain=[{id:g.a,t:0},...g.points.sort((a,b)=>a.t-b.t),{id:g.b,t:1}];
  for(const id of [g.a,g.b])adjacency.set(id,(adjacency.get(id)||[]).filter(e=>e.to!==(id===g.a?g.b:g.a)));
  for(const p of g.points)adjacency.set(p.id,[]);
  const add=(a,b,way)=>{adjacency.get(a).push({to:b,way,meters:meters(nodes[a],nodes[b])})};
  for(const e of graph.adjacency.get(g.a)||[])if(e.to===g.b)for(let i=1;i<chain.length;i++)add(chain[i-1].id,chain[i].id,e.way);
  for(const e of graph.adjacency.get(g.b)||[])if(e.to===g.a)for(let i=chain.length-1;i>0;i--)add(chain[i].id,chain[i-1].id,e.way);
 }
 return distanceRoute({nodes,adjacency},'@start','@end');
}
export function attachedRoute(graph,a,b){
 let best=null;
 for(const x of edgeCandidates(graph,a))for(const y of edgeCandidates(graph,b)){const r=between(graph,x,y);if(!r)continue;const score=x.distance+y.distance+r.distanceMeters;if(!best||score<best.score)best={...r,score,start:x,end:y};}
 return best;
}
export function routeVia(graph,points){
 const coordinates=[],controlIndices=[],wayIds=[];let distanceMeters=0,maxAccess=0;
 for(let i=1;i<points.length;i++){
  const r=attachedRoute(graph,points[i-1],points[i]);if(!r)return null;
  if(i===1)coordinates.push([...points[0],null]);
  coordinates.push(...r.coordinates.map(p=>[...p]),[...points[i],null]);controlIndices.push(coordinates.length-1);wayIds.push(...r.wayIds);distanceMeters+=r.score;maxAccess=Math.max(maxAccess,r.start.distance,r.end.distance);
 }
 return {coordinates,controlIndices,wayIds,distanceMeters,maxAccess};
}
