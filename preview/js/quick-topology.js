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
 // All located points use one constant planar scale: their relative x/y,
 // bearings and distance ratios remain intact. Only text labels may move.
 const width=390,height=360;
 const pad={left:35,right:35,top:45,bottom:43};
 const knownPoints=topology.nodes.filter(n=>known.has(n.id)).map(n=>raw.get(n.id));
 const xs=knownPoints.map(p=>p.x),ys=knownPoints.map(p=>p.y);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 const dx=maxX-minX,dy=maxY-minY;
 const availableX=width-pad.left-pad.right,availableY=height-pad.top-pad.bottom;
 const scale=Math.min(dx>0?availableX/dx:Infinity,dy>0?availableY/dy:Infinity);
 if(!Number.isFinite(scale)||scale<=0)return fallback();
 const midX=(maxX+minX)/2,midY=(maxY+minY)/2;
 const centerX=(pad.left+width-pad.right)/2,centerY=(pad.top+height-pad.bottom)/2;
 const positions=new Map();
 for(const node of topology.nodes){
  const p=raw.get(node.id);
  const x=centerX+(p.x-midX)*scale;
  const y=centerY-(p.y-midY)*scale;
  // Missing coordinates are schematic only and must not alter the scale or
  // coordinates of real positions.
  positions.set(node.id,known.has(node.id)?{x,y}:{
   x:clamp(x,pad.left,width-pad.right),
   y:clamp(y,pad.top,height-pad.bottom)
  });
 }
 return {width,height,positions,mode:'geographic',estimatedIds,
         knownCount:known.size,scale};
}

// Label layout never mutates geographic point coordinates. Greedy placement
// uses text-only offsets and leader lines when the label is displaced.
// Only LABELS move. Actual coordinate dots and straight route edges are
// immutable. The current position gets a stable, close side label; all other
// labels prefer the geographic side outward from the current route point.
// Geographic dots are immutable. Keep every visible label close to its own
// dot; omit a crowded secondary label rather than move it to a distant slot.
// Names of omitted nodes remain available in the quick-add chips and SVG title.
export function layoutQuickTopologyLabels(topology,layout){
 const labels=new Map(),used=[],center=layout.positions.get(topology.startId);
 const box=node=>{
  const back=topology.first.some(b=>b.id===node.id&&b.returning);
  const name=(back?'↩ ':'')+(layout.estimatedIds.has(node.id)?'◌ ':'')+node.name;
  const lines=textLines(name);
  return {w:clamp(Math.max(...lines.map(t=>Array.from(t).length))*12+16,90,146),
          h:40+(lines.length-1)*13};
 };
 const rect=(x,y,w,h)=>({x,y,l:x-w/2,r:x+w/2,t:y,b:y+h,w,h,hidden:false});
 const distanceToRect=(p,b)=>Math.hypot(Math.max(b.l-p.x,0,p.x-b.r),
                                       Math.max(b.t-p.y,0,p.y-b.b));
 const nodes=[...topology.nodes].sort((a,b)=>Number(b.id===topology.startId)-Number(a.id===topology.startId)||
  a.level-b.level||a.name.localeCompare(b.name,'zh-Hant')||a.id.localeCompare(b.id));
 for(const n of nodes){
  const p=layout.positions.get(n.id);if(!p)continue;
  const {w,h}=box(n),current=n.id===topology.startId;
  const right=[p.x+15+w/2,p.y-h/2],left=[p.x-15-w/2,p.y-h/2];
  const dx=p.x-(center?.x??layout.width/2),dy=p.y-(center?.y??layout.height/2);
  const sx=dx>=0?1:-1,sy=dy>=0?1:-1;
  const R=[p.x+13+w/2,p.y-h/2],L=[p.x-13-w/2,p.y-h/2];
  const U=[p.x,p.y-h-10],D=[p.x,p.y+10];
  const UR=[p.x+10+w/2,p.y-h-7],UL=[p.x-10-w/2,p.y-h-7];
  const DR=[p.x+10+w/2,p.y+7],DL=[p.x-10-w/2,p.y+7];
  const outwardH=sx>0?[R,UR,DR,U,D,L,UL,DL]:[L,UL,DL,U,D,R,UR,DR];
  const outwardV=sy>0?[D,DR,DL,R,L,U,UR,UL]:[U,UR,UL,R,L,D,DR,DL];
  const diagonal=sx>0?(sy>0?[DR,R,D,UR,U,L,DL,UL]:[UR,R,U,DR,D,L,UL,DL])
                        :(sy>0?[DL,L,D,UL,U,R,DR,UR]:[UL,L,U,DL,D,R,UR,DR]);
  const standard=current?(right[0]+w/2<=layout.width-5?[right,left]:[left,right]):
    Math.abs(dx)>Math.abs(dy)*1.4?outwardH:
    Math.abs(dy)>Math.abs(dx)*1.4?outwardV:diagonal;
  // Small shifts are fine for label readability, but never move far away.
  const choices=current?standard:standard.flatMap(([x,y])=>[[x,y],[x,y-12],[x,y+12]]);
  let best=null,bestCost=Infinity;
  for(let idx=0;idx<choices.length;idx++){
   const [wantedX,wantedY]=choices[idx];
   const x=clamp(wantedX,w/2+5,layout.width-w/2-5);
   const y=clamp(wantedY,6,layout.height-h-5);
   const b=rect(x,y,w,h),dist=distanceToRect(p,b);
   if(!current&&(dist>48||Math.abs(x-wantedX)>60||Math.abs(y-wantedY)>42))continue;
   if(!current&&used.some(u=>Math.min(b.r,u.r)>Math.max(b.l,u.l)&&
                                  Math.min(b.b,u.b)>Math.max(b.t,u.t)))continue;
   if(!current&&topology.nodes.some(other=>{
    if(other.id===n.id)return false;
    const point=layout.positions.get(other.id);
    return point&&point.x>b.l-8&&point.x<b.r+8&&point.y>b.t-8&&point.y<b.b+8;
   }))continue;
   let cost=idx*(current?.05:1.8)+dist*.55+
     Math.hypot(x-wantedX,y-wantedY)*2;
   if(current){
    for(const u of used){
     const overlapX=Math.max(0,Math.min(b.r,u.r)-Math.max(b.l,u.l));
     const overlapY=Math.max(0,Math.min(b.b,u.b)-Math.max(b.t,u.t));
     cost+=overlapX*overlapY*20;
    }
   }
   if(cost<bestCost){best=b;bestCost=cost}
  }
  if(!best)best={...rect(p.x,p.y,w,h),hidden:true};
  labels.set(n.id,best);
  if(!best.hidden)used.push(best);
 }
 return labels;
}

export function renderQuickTopologySvg(candidates,startId,startName,coefficient,estimate,geometryData=null){
 const topology=buildQuickTopology(candidates,startId,startName);
 const layout=layoutQuickTopology(topology,geometryData);
 const {positions}=layout;
 const labels=layoutQuickTopologyLabels(topology,layout);
 const edgeHtml=topology.edges.map(e=>{
  const a=positions.get(e.from),b=positions.get(e.to);if(!a||!b)return '';
  // A straight schematic connection preserves the actual two-endpoint
  // bearing; it does not claim to reproduce a hiking trail.
  const path='M '+a.x+' '+a.y+' L '+b.x+' '+b.y;
  const tone=e.returning?'#A37D52':'#8EA59A';
  const title=topology.nodes.find(n=>n.id===e.from)?.name+' → '+topology.nodes.find(n=>n.id===e.to)?.name;
  return '<path class="topo-route-edge" d="'+path+'" stroke="'+tone+'" stroke-width="2.5" '+(e.returning?'stroke-dasharray="4 4" ':'')+'fill="none"><title>'+xml(title)+'</title></path>';
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
  const label=labels.get(n.id)||{x:p.x,y:p.y+20,hidden:false};
  if(label.hidden){
   return '<g class="topo-node topo-label-omitted" data-node-id="'+xml(n.id)+'"><title>'+xml(n.name+'（名稱因位置密集暫不顯示，請參考快速加入按鈕）')+'</title><circle cx="'+p.x+'" cy="'+p.y+'" r="7" fill="'+(back?'#ead9bd':'#e4efe9')+'" stroke="'+(back?'#947041':'#557464')+'" stroke-width="2"'+(estimated?' stroke-dasharray="3 2"':'')+'/></g>';
  }
  const nameY=label.y+12;
  const nameSvg='<text class="topo-node-name" text-anchor="middle" x="'+label.x+'" y="'+nameY+'">'+text.map((line,i)=>'<tspan x="'+label.x+'" dy="'+(i?13:0)+'">'+xml(line)+'</tspan>').join('')+'</text>';
  const metaY=nameY+(text.length-1)*13+14;
  const metaSvg=current
    ?'<g class="topo-current-badge"><rect x="'+(label.x-38)+'" y="'+(metaY-12)+'" width="76" height="18" rx="8" fill="#315d42"/><text class="topo-current-badge-text" x="'+label.x+'" y="'+(metaY+1)+'" text-anchor="middle" fill="#fff">目前位置</text></g>'
    :'<text class="topo-node-meta'+(routeKey?' quick-route-duration':'')+'" text-anchor="middle" x="'+label.x+'" y="'+metaY+'"'+(routeKey?' data-route-key="'+xml(routeKey)+'"':'')+'>'+xml(meta)+'</text>';
  // Leader lines connect the label's nearest boundary to the unchanged dot.
  const targetX=clamp(p.x,label.l,label.r),targetY=clamp(p.y,label.t,label.b);
  const distance=Math.hypot(targetX-p.x,targetY-p.y);
  const leader=distance>(current?8:16)?'<path class="topo-label-leader" d="M '+p.x+' '+p.y+' L '+targetX+' '+targetY+'" fill="none" stroke="'+(current?'#315d42':'#9aaa9f')+'" stroke-width="'+(current?'1.5':'1')+'" stroke-dasharray="'+(current?'none':'2 3')+'"/>':'';
  const halo=current?'<circle class="topo-current-halo" cx="'+p.x+'" cy="'+p.y+'" r="13" fill="#d5ece0" opacity=".82"/>':'';
  return '<g class="topo-node'+(current?' topo-current':back?' topo-back':'')+(estimated?' topo-estimated':'')+'"><title>'+xml(n.name+(current?'（目前位置）':back?'（原路返回）':'')+(estimated?'，座標未取得，位置為示意':''))+'</title>'+leader+halo+'<circle cx="'+p.x+'" cy="'+p.y+'" r="'+(current?10:7)+'" fill="'+(current?'#315d42':back?'#ead9bd':'#e4efe9')+'" stroke="'+(current?'#315d42':back?'#947041':'#557464')+'" stroke-width="2"'+(estimated?' stroke-dasharray="3 2"':'')+'/>'+nameSvg+metaSvg+'</g>';
 }).join('');
 const omitted=[...labels.values()].filter(l=>l?.hidden).length;
 const hiddenHint=omitted?'<text class="topo-fallback-label" x="10" y="'+(layout.height-5)+'">部分密集節點名稱請參考快速加入按鈕</text>':'';
 const compass=layout.mode==='geographic'
  ?'<g class="topo-compass"><path d="M 355 39 V 18 M 355 18 L 351 24 M 355 18 L 359 24" stroke="#587263" stroke-width="1.5" fill="none"/><text x="355" y="13" text-anchor="middle">北</text></g>'
  :'<text class="topo-fallback-label" x="10" y="15">座標不足，採純拓樸示意</text>';
 return '<svg class="quick-topology-svg" xmlns="http://www.w3.org/2000/svg" data-layout-mode="'+layout.mode+'" data-known-nodes="'+layout.knownCount+'" viewBox="0 0 '+layout.width+' '+layout.height+'" role="img" aria-label="'+xml('從'+startName+'出發的局部路網示意圖')+'">'+edgeHtml+nodeHtml+compass+hiddenHint+'</svg>';
}
