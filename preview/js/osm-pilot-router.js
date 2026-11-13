// Independent distance-weighted trial graph. Never creates Shanghe minutes.
export function meters(a,b){const r=Math.PI/180,h=Math.sin((b[1]-a[1])*r/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin((b[0]-a[0])*r/2)**2;return 12742000*Math.asin(Math.min(1,Math.sqrt(h)))}
export function buildGraph(data){
 const adjacency=new Map(),blocked=new Set((data.blockedNodeIds||[]).map(String));
 const add=(a,b,way)=>{if(!adjacency.has(a))adjacency.set(a,[]);if(!adjacency.has(b))adjacency.set(b,[]);adjacency.get(a).push({to:b,way,meters:meters(data.nodes[a],data.nodes[b])})};
 for(const w of data.ways){const t=w.tags;if(['no','private'].includes(t.foot)||(['no','private'].includes(t.access)&&!['yes','designated','permissive'].includes(t.foot))||t.construction||t.proposed||t.motorroad==='yes')continue;const refs=w.refs.map(String),foot=t['oneway:foot'];for(let i=1;i<refs.length;i++){const a=refs[i-1],b=refs[i];if(a===b||blocked.has(a)||blocked.has(b)||!data.nodes[a]||!data.nodes[b])continue;if(foot!=='-1')add(a,b,w.id);if(!['yes','1','true'].includes(foot))add(b,a,w.id)}}
 return {nodes:data.nodes,adjacency};
}
export function nearestVertex(graph,p,maxMeters=200){let best=null;for(const id of graph.adjacency.keys()){const d=meters(p,graph.nodes[id]);if(d<=maxMeters&&(!best||d<best.meters))best={id,meters:d,coordinate:graph.nodes[id]}}return best}
export function distanceRoute(graph,start,end){
 if(!graph.nodes[start]||!graph.nodes[end])return null;
 const heap=[],dist=new Map([[start,0]]),prev=new Map();
 const push=(id,cost)=>{heap.push({id,cost});let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].cost<=heap[i].cost)break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p}};
 const pop=()=>{const out=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;while(true){let c=i*2+1;if(c>=heap.length)break;if(c+1<heap.length&&heap[c+1].cost<heap[c].cost)c++;if(heap[i].cost<=heap[c].cost)break;[heap[i],heap[c]]=[heap[c],heap[i]];i=c}}return out};
 push(start,0);
 while(heap.length){const {id,cost}=pop();if(cost!==dist.get(id))continue;if(id===end){const ids=[id],wayIds=[];let x=id;while(x!==start){const edge=prev.get(x);wayIds.unshift(edge.way);x=edge.from;ids.unshift(x)}return {ids,wayIds,coordinates:ids.map(n=>graph.nodes[n]),distanceMeters:cost}}
  for(const edge of graph.adjacency.get(id)||[]){const next=cost+edge.meters;if(next<(dist.get(edge.to)??Infinity)){dist.set(edge.to,next);prev.set(edge.to,{from:id,way:edge.way});push(edge.to,next)}}
 }
 return null;
}
