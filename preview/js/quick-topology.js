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
 const height=clamp(295+Math.max(0,n-5)*48,295,1000);
 const center={x:width/2,y:height/2};
 const positions=new Map(),anchors=new Map();
 for(const node of topology.nodes){
  const p=raw.get(node.id);
  let next;
  if(node.id===topology.startId)next={...center};
  else{
   const distance=Math.hypot(p.x,p.y);
   const r=distance<.0001?42:clamp(45+60*Math.log1p(distance),48,200);
   const a=Math.atan2(p.y,p.x);
   next={x:center.x+clamp(Math.cos(a)*r,-134,134),
         y:center.y-clamp(Math.sin(a)*r,-height*.43,height*.43)};
  }
  positions.set(node.id,next);anchors.set(node.id,{...next});
 }
 // Resolve near-overlapping node labels, with the current point anchored and
 // a spring keeping each other node near its source-bearing position.
 const nodes=topology.nodes.map(n=>({...n,box:labelBounds(n)}));
 for(let iteration=0;iteration<120;iteration++){
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
   const a=nodes[i],b=nodes[j],pa=positions.get(a.id),pb=positions.get(b.id);
   const minX=(a.box.w+b.box.w)/2+9;
   const minY=(a.box.h+b.box.h)/2+13;
   const dx=pb.x-pa.x,dy=pb.y-pa.y;
   if(Math.abs(dx)>=minX||Math.abs(dy)>=minY)continue;
   const xGap=minX-Math.abs(dx),yGap=minY-Math.abs(dy);
   // Prefer the smaller push, but switch axes when a clamped border
   // makes that push impossible. Otherwise several west/east labels pile up.
   const aFixed=a.id===topology.startId,bFixed=b.id===topology.startId;
   const room=(axis,sign,min,max)=>{
    const av=axis==='x'?pa.x:pa.y,bv=axis==='x'?pb.x:pb.y;
    return (aFixed?0:sign>0?av-min:max-av)+
           (bFixed?0:sign>0?max-bv:bv-min);
   };
   const xRoom=room('x',dx>=0?1:-1,67,width-67);
   const yRoom=room('y',dy>=0?1:-1,31,height-69);
   let onX=xGap/minX<=yGap/minY;
   if(onX&&xRoom<xGap*.9&&yRoom>1)onX=false;
   else if(!onX&&yRoom<yGap*.9&&xRoom>1)onX=true;
   const push=clamp((onX?xGap:yGap)*.55,0,9);
   const delta=onX?(dx>=0?push:-push):(dy>=0?push:-push);
   const aFactor=aFixed?0:bFixed?2:1;
   const bFactor=bFixed?0:aFixed?2:1;
   if(onX){pa.x-=delta*aFactor;pb.x+=delta*bFactor}
   else{pa.y-=delta*aFactor;pb.y+=delta*bFactor}
  }
  for(const node of nodes){
   if(node.id===topology.startId)continue;
   const p=positions.get(node.id),a=anchors.get(node.id);
   p.x+=(a.x-p.x)*.016;p.y+=(a.y-p.y)*.016;
   p.x=clamp(p.x,67,width-67);
   p.y=clamp(p.y,31,height-69);
   // Maintain the broad east/west and north/south quadrant when known.
   if(!estimatedIds.has(node.id)&&known.has(topology.startId)){
    if(a.x>center.x+24)p.x=Math.max(p.x,center.x+7);
    if(a.x<center.x-24)p.x=Math.min(p.x,center.x-7);
    if(a.y>center.y+24)p.y=Math.max(p.y,center.y+7);
    if(a.y<center.y-24)p.y=Math.min(p.y,center.y-7);
   }
  }
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
