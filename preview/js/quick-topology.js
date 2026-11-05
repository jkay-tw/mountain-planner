// SVG-only schematic for locally reachable verified walking topology.
// x/y reflect only a legible layout, never real bearing, distance or geometry.
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const textLines=(name,limit=8)=>{
 const cps=Array.from(String(name??''));
 if(cps.length<=limit)return [cps.join('')];
 const a=cps.slice(0,limit).join('');
 const rest=cps.slice(limit);
 return [a,rest.length<=limit?rest.join(''):rest.slice(0,limit-1).join('')+'…'];
};
const fmt=m=>m===null?'時間待填':'約 '+m+' 分';
export function buildQuickTopology(candidates,startId,startName){
 const branches=new Map(), pathsById=new Map(), nodes=new Map();
 nodes.set(startId,{id:startId,name:startName,level:0});
 for(const candidate of candidates||[]){
  if(!candidate?.segments?.length)continue;
  const a=candidate.segments[0], id=a.toId;
  if(!branches.has(id))branches.set(id,{id,name:a.to,returning:candidate.direction<0});
  if(!nodes.has(id))nodes.set(id,{id,name:a.to,level:1});
  for(const seg of candidate.segments){
   if(!nodes.has(seg.toId))nodes.set(seg.toId,{id:seg.toId,name:seg.to,level:seg.toId===startId?0:2});
  }
  const arr=pathsById.get(candidate.nodeId)||[];
  arr.push(candidate);pathsById.set(candidate.nodeId,arr);
 }
 const first=[...branches.values()].sort((a,b)=>Number(a.returning)-Number(b.returning)||a.name.localeCompare(b.name,'zh-Hant')||a.id.localeCompare(b.id));
 const edges=new Map();
 for(const candidate of candidates||[])for(const seg of candidate.segments||[]){
  if(!nodes.has(seg.fromId)||!nodes.has(seg.toId)||seg.fromId===seg.toId)continue;
  const key=seg.fromId+'>'+seg.toId;
  if(!edges.has(key))edges.set(key,{from:seg.fromId,to:seg.toId,returning:seg.fromId===startId&&first.some(b=>b.id===seg.toId&&b.returning)});
 }
 return {startId,startName,nodes:[...nodes.values()],first,edges:[...edges.values()],pathsById};
}
function layoutAbstractTopology(topology){
 const width=340,positions=new Map(),step=90;
 const first=topology.first;
 const firstY=first.map((_,i)=>44+i*step);
 const rootY=firstY.length?(firstY[0]+firstY.at(-1))/2:44;
 positions.set(topology.startId,{x:43,y:rootY});
 first.forEach((b,i)=>positions.set(b.id,{x:162,y:firstY[i]}));
 const firstId=new Set(first.map(b=>b.id));
 const second=topology.nodes.filter(n=>n.level===2&&!firstId.has(n.id)&&n.id!==topology.startId)
  .map(n=>{
   const parentY=topology.edges.filter(e=>e.to===n.id&&positions.has(e.from)).map(e=>positions.get(e.from).y);
   const ideal=parentY.length?parentY.reduce((a,b)=>a+b,0)/parentY.length:rootY;
   return {node:n,ideal};
  }).sort((a,b)=>a.ideal-b.ideal||a.node.name.localeCompare(b.node.name,'zh-Hant')||a.node.id.localeCompare(b.node.id));
 let last=-Infinity;
 for(const item of second){
  const y=Math.max(44,item.ideal,last+76);
  positions.set(item.node.id,{x:284,y});last=y;
 }
 const maxY=Math.max(rootY,...firstY,...second.map(i=>positions.get(i.node.id).y),44);
 return {width,height:Math.max(132,maxY+69),positions};
}
// Screen positions reflect broad coordinate bearings, not a to-scale map.
// A missing coordinate is estimated only in this transient view, never saved.
const validCoordinate=p=>Array.isArray(p)&&p.length>=2&&
 Number.isFinite(p[0])&&Number.isFinite(p[1])&&
 Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
const clamp=(n,low,high)=>Math.max(low,Math.min(high,n));
const labelBounds=node=>{
 const lines=textLines(node.name);
 return {w:clamp(Math.max(...lines.map(line=>Array.from(line).length))*12+18,86,125),
         h:60+(lines.length-1)*13};
};
export function layoutQuickTopology(topology,geometryData=null){
 const fallback=()=>{
  const result=layoutAbstractTopology(topology);
  return {...result,mode:'topology',estimatedIds:new Set(),knownCount:0};
 };
 if(!Array.isArray(geometryData?.nodes)||!topology.nodes.length)return fallback();
 const allowed=new Set(topology.nodes.map(n=>n.id));
 const known=new Map();
 for(const node of geometryData.nodes){
  if(allowed.has(node.nodeId)&&validCoordinate(node.coordinate)&&
     !['ignored','vehicle-only'].includes(node.coordinatePolicy)){
   known.set(node.nodeId,node.coordinate);
  }
 }
 if(known.size<2)return fallback();
 const unique=new Set([...known.values()].map(p=>p.join(',')));
 if(unique.size<2)return fallback();
 const adjacent=new Map(topology.nodes.map(n=>[n.id,new Set()]));
 for(const edge of topology.edges){
  adjacent.get(edge.from)?.add(edge.to);
  adjacent.get(edge.to)?.add(edge.from);
 }
 // If the itinerary point itself has no coordinate, the nearest known
 // neighbours define a schematic centre, clearly marked as estimated.
 const origin=known.get(topology.startId)||(()=>{
  const local=[...(adjacent.get(topology.startId)||[])].map(id=>known.get(id)).filter(Boolean);
  const selected=local.length?local:[...known.values()];
  return [selected.reduce((n,p)=>n+p[0],0)/selected.length,
          selected.reduce((n,p)=>n+p[1],0)/selected.length];
 })();
 const cos=Math.max(.1,Math.cos(origin[1]*Math.PI/180));
 const kilometres=p=>({x:(p[0]-origin[0])*111.32*cos,y:(p[1]-origin[1])*111.32});
 const raw=new Map([...known].map(([id,p])=>[id,kilometres(p)]));
 raw.set(topology.startId,{x:0,y:0});
 const estimatedIds=new Set(topology.nodes.filter(n=>!known.has(n.id)).map(n=>n.id));
 // Interpolate isolated missing midpoints from real adjacent coordinates.
 // Otherwise extend a known neighbour's local vector or use an arbitrary
 // schematic direction. All such locations keep an estimated marker.
 for(let pass=0;pass<3;pass++){
  let advanced=false;
  for(const node of topology.nodes){
   if(raw.has(node.id))continue;
   const neighbours=[...(adjacent.get(node.id)||[])].filter(id=>raw.has(id));
   if(!neighbours.length)continue;
   if(neighbours.length>=2){
    const a=neighbours.map(id=>raw.get(id));
    raw.set(node.id,{x:a.reduce((sum,p)=>sum+p.x,0)/a.length,
                     y:a.reduce((sum,p)=>sum+p.y,0)/a.length});
   }else{
    const first=raw.get(neighbours[0]);
    const others=[...(adjacent.get(neighbours[0])||[])].filter(id=>id!==node.id&&raw.has(id));
    const parent=others.map(id=>raw.get(id)).find(p=>Math.hypot(first.x-p.x,first.y-p.y)>.02);
    let dx=parent?first.x-parent.x:first.x;
    let dy=parent?first.y-parent.y:first.y;
    if(Math.hypot(dx,dy)<.02){
     const idx=topology.nodes.findIndex(n=>n.id===node.id);
     const angle=-Math.PI/2+(idx*2.39996323);
     dx=Math.cos(angle);dy=Math.sin(angle);
    }
    const length=Math.hypot(dx,dy);
    raw.set(node.id,{x:first.x+.45*dx/length,y:first.y+.45*dy/length});
   }
   advanced=true;
  }
  if(!advanced)break;
 }
 for(const [index,node] of topology.nodes.entries())if(!raw.has(node.id)){
  const angle=-Math.PI/2+index*2.39996323;
  raw.set(node.id,{x:.55*Math.cos(angle),y:.55*Math.sin(angle)});
 }
 const width=390,n=topology.nodes.length;
 const height=clamp(295+Math.max(0,n-5)*54,295,1100);
 const center={x:width/2,y:height/2};
 const positions=new Map([[topology.startId,{...center}]]);
 // A compact compass-sector placement is more readable than pixel-perfect
 // scaling: keep each bearing within about 55 degrees but distribute nearby
 // labels into free radial slots. This never represents actual map distance.
 const nodes=topology.nodes.filter(n=>n.id!==topology.startId);
 const boxes=new Map(topology.nodes.map(n=>[n.id,labelBounds(n)]));
 const offsets=[0,.20,-.20,.40,-.40,.64,-.64,.88,-.88,1.05,-1.05];
 const radii=[110,148,186,224,262,300,338,380];
 const proposals=new Map();
 for(const node of nodes){
  const p=raw.get(node.id),distance=Math.hypot(p.x,p.y);
  const angle=distance>.001?Math.atan2(p.y,p.x):
   -Math.PI/2+topology.nodes.findIndex(n=>n.id===node.id)*2.39996323;
  const idealR=clamp(90+50*Math.log1p(distance),110,230);
  const candidates=[],seen=new Set();
  for(const offset of offsets)for(const r of radii){
   const theta=angle+offset;
   const x=clamp(center.x+Math.cos(theta)*r,67,width-67);
   const y=clamp(center.y-Math.sin(theta)*r,31,height-69);
   if(known.has(topology.startId)&&!estimatedIds.has(node.id)){
    const x0=Math.cos(angle),y0=Math.sin(angle);
    if(Math.abs(x0)>.65&&Math.sign(x-center.x)!==Math.sign(x0))continue;
    if(Math.abs(y0)>.65&&Math.sign(center.y-y)!==Math.sign(y0))continue;
   }
   const key=Math.round(x)+','+Math.round(y);
   if(seen.has(key))continue;seen.add(key);
   candidates.push({x,y,offset,r,idealR});
  }
  proposals.set(node.id,candidates);
 }
 const score=(node,proposal)=>{
  let cost=Math.abs(proposal.offset)*65+Math.abs(proposal.r-proposal.idealR)*.4;
  if(proposal.x>300&&proposal.y<68)cost+=250;
  const box=boxes.get(node.id);
  for(const [otherId,p] of positions){
   if(node.id===otherId)continue;
   const b=boxes.get(otherId);
   const minX=(box.w+b.w)/2+12,minY=(box.h+b.h)/2+15;
   const overlapX=Math.max(0,minX-Math.abs(proposal.x-p.x));
   const overlapY=Math.max(0,minY-Math.abs(proposal.y-p.y));
   if(overlapX&&overlapY)cost+=overlapX*overlapY*100;
  }
  return cost;
 };
 const select=(node)=>{
  const options=proposals.get(node.id)||[];
  let best=null,bestScore=Infinity;
  for(const candidate of options){
   const value=score(node,candidate);
   if(value<bestScore){bestScore=value;best=candidate}
  }
  if(best)positions.set(node.id,{x:best.x,y:best.y});
 };
 for(const node of nodes)select(node);
 // Recheck after every node has been placed; this resolves conflicts caused
 // by the initial ordering without changing geographical data or route edges.
 for(let pass=0;pass<3;pass++)for(const node of nodes){
  positions.delete(node.id);select(node);
 }
 return {width,height,positions,mode:'geographic',estimatedIds,
         knownCount:known.size};
}

export function renderQuickTopologySvg(candidates,startId,startName,coefficient,estimate,geometryData=null){
 const topology=buildQuickTopology(candidates,startId,startName);
 const layout=layoutQuickTopology(topology,geometryData);
 const {positions}=layout;
 const edgeHtml=topology.edges.map(e=>{
  const a=positions.get(e.from),b=positions.get(e.to);if(!a||!b)return '';
  const radius=8;
  let path;
  if(Math.abs(b.x-a.x)<2){
   const x=a.x+9;path='M '+x+' '+a.y+' C '+(x+48)+' '+a.y+' '+(x+48)+' '+b.y+' '+x+' '+b.y;
  }else{
   const sign=Math.sign(b.x-a.x),sx=a.x+sign*radius,ex=b.x-sign*radius,dx=(ex-sx)*.47;
   path='M '+sx+' '+a.y+' C '+(sx+dx)+' '+a.y+' '+(ex-dx)+' '+b.y+' '+ex+' '+b.y;
  }
  const tone=e.returning?'#A37D52':'#8EA59A';
  const title=topology.nodes.find(n=>n.id===e.from)?.name+' → '+topology.nodes.find(n=>n.id===e.to)?.name;
  return '<path d="'+path+'" stroke="'+tone+'" stroke-width="2.5" '+(e.returning?'stroke-dasharray="4 4" ':'')+'fill="none"><title>'+xml(title)+'</title></path>';
 }).join('');
 const nodeHtml=topology.nodes.map(n=>{
  const p=positions.get(n.id);if(!p)return '';
  const current=n.id===startId,back=topology.first.some(b=>b.id===n.id&&b.returning);
  const estimated=layout.estimatedIds.has(n.id);
  const nodePaths=topology.pathsById.get(n.id)||[];
  const minutes=nodePaths.length===1?estimate(nodePaths[0],coefficient):null;
  const meta=current?'目前位置':nodePaths.length>1?'多條路線':fmt(minutes);
  const routeKey=nodePaths.length===1?nodePaths[0].key:null;
  const text=textLines((back?'↩ ':'')+(estimated?'◌ ':'')+n.name);
  const nameY=p.y+23;
  const nameSvg='<text class="topo-node-name" text-anchor="middle" x="'+p.x+'" y="'+nameY+'">'+text.map((line,i)=>'<tspan x="'+p.x+'" dy="'+(i?13:0)+'">'+xml(line)+'</tspan>').join('')+'</text>';
  const metaY=nameY+(text.length-1)*13+14;
  const metaSvg='<text class="topo-node-meta'+(routeKey?' quick-route-duration':'')+'" text-anchor="middle" x="'+p.x+'" y="'+metaY+'"'+(routeKey?' data-route-key="'+xml(routeKey)+'"':'')+'>'+xml(meta)+'</text>';
  return '<g class="topo-node'+(current?' topo-current':back?' topo-back':'')+(estimated?' topo-estimated':'')+'"><title>'+xml(n.name+(current?'（目前位置）':back?'（原路返回）':'')+(estimated?'，座標未取得，位置為示意':''))+'</title><circle cx="'+p.x+'" cy="'+p.y+'" r="'+(current?10:7)+'" fill="'+(current?'#315d42':back?'#ead9bd':'#e4efe9')+'" stroke="'+(current?'#315d42':back?'#947041':'#557464')+'" stroke-width="2"'+(estimated?' stroke-dasharray="3 2"':'')+'/>'+nameSvg+metaSvg+'</g>';
 }).join('');
 const compass=layout.mode==='geographic'
  ?'<g class="topo-compass"><path d="M 355 39 V 18 M 355 18 L 351 24 M 355 18 L 359 24" stroke="#587263" stroke-width="1.5" fill="none"/><text x="355" y="13" text-anchor="middle">北</text></g>'
  :'<text class="topo-fallback-label" x="10" y="15">座標不足，採純拓樸示意</text>';
 return '<svg class="quick-topology-svg" xmlns="http://www.w3.org/2000/svg" data-layout-mode="'+layout.mode+'" data-known-nodes="'+layout.knownCount+'" viewBox="0 0 '+layout.width+' '+layout.height+'" role="img" aria-label="'+xml('從'+startName+'出發的局部路網示意圖')+'">'+edgeHtml+nodeHtml+compass+'</svg>';
}
