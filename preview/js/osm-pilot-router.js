// Independent distance-weighted trial graph. Never creates Shanghe minutes.
export function meters(a,b){const r=Math.PI/180,h=Math.sin((b[1]-a[1])*r/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin((b[0]-a[0])*r/2)**2;return 12742000*Math.asin(Math.min(1,Math.sqrt(h)))}
export function buildGraph(data){
 const adjacency=new Map(),blocked=new Set((data.blockedNodeIds||[]).map(String)),junctions=data.junctionIds?new Set(data.junctionIds.map(String)):null;
 const add=(refs,way)=>{const a=refs[0],b=refs.at(-1);if(!adjacency.has(a))adjacency.set(a,[]);if(!adjacency.has(b))adjacency.set(b,[]);let length=0;for(let i=1;i<refs.length;i++)length+=meters(data.nodes[refs[i-1]],data.nodes[refs[i]]);adjacency.get(a).push({to:b,way,meters:length,...(junctions?{refs}:{} )})};
 for(const w of data.ways){const t=w.tags;if(['no','private'].includes(t.foot)||(['no','private'].includes(t.access)&&!['yes','designated','permissive'].includes(t.foot))||t.construction||t.proposed||t.motorroad==='yes')continue;
  const refs=w.refs.map(String),foot=t['oneway:foot'];let chain=[];
  const flush=()=>{if(chain.length>1){if(foot!=='-1')add([...chain],w.id);if(!['yes','1','true'].includes(foot))add([...chain].reverse(),w.id)}chain=chain.length?[chain.at(-1)]:[];};
  for(const id of refs){if(blocked.has(id)||!data.nodes[id]){flush();chain=[];continue;}if(chain.at(-1)===id){flush();continue;}chain.push(id);if(!junctions||junctions.has(id))flush();}flush();
 }
 return {nodes:data.nodes,adjacency,compressed:!!junctions};
}
export function nearestVertex(graph,p,maxMeters=200){let best=null;for(const id of graph.adjacency.keys()){const d=meters(p,graph.nodes[id]);if(d<=maxMeters&&(!best||d<best.meters))best={id,meters:d,coordinate:graph.nodes[id]}}return best}
export function distanceRoute(graph,start,end){
 if(!graph.nodes[start]||!graph.nodes[end])return null;
 const heap=[],dist=new Map([[start,0]]),prev=new Map();
 const push=(id,cost)=>{heap.push({id,cost});let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].cost<=heap[i].cost)break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p}};
 const pop=()=>{const out=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;while(true){let c=i*2+1;if(c>=heap.length)break;if(c+1<heap.length&&heap[c+1].cost<heap[c].cost)c++;if(heap[i].cost<=heap[c].cost)break;[heap[i],heap[c]]=[heap[c],heap[i]];i=c}}return out};
 push(start,0);
 while(heap.length){const {id,cost}=pop();if(cost!==dist.get(id))continue;if(id===end){const ids=[id],wayIds=[];let x=id;while(x!==start){const edge=prev.get(x),refs=edge.refs||[edge.from,x];wayIds.unshift(...refs.slice(1).map(()=>edge.way));ids.unshift(...refs.slice(0,-1));x=edge.from;}return {ids,wayIds,coordinates:ids.map(n=>graph.nodes[n]),distanceMeters:cost}}
  for(const edge of graph.adjacency.get(id)||[]){const next=cost+edge.meters;if(next<(dist.get(edge.to)??Infinity)){dist.set(edge.to,next);prev.set(edge.to,{from:id,way:edge.way,refs:edge.refs});push(edge.to,next)}}
 }
 return null;
}
