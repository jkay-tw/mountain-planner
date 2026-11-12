// SVG-only schematic for locally reachable verified walking topology.
// x/y reflect only a legible layout, never real bearing, distance or geometry.
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const textLines=(name,limit=8)=>{
 const cps=Array.from(String(name??''));
 if(!cps.length)return [''];
 const lines=[];
 for(let i=0;i<cps.length;i+=limit)lines.push(cps.slice(i,i+limit).join(''));
 return lines;
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

// Expand crowded dots in the available map area; place each label near its
// own final dot in any direction. Coordinates are never written back to data.
export function layoutQuickTopologyCallouts(topology,layout){
 const width=390, nodes=topology.nodes;
 const initialHeight=Math.max(400,Math.ceil(nodes.length*26));
 const ordered=[...nodes].sort((a,b)=>Number(b.id===topology.startId)-Number(a.id===topology.startId)||a.level-b.level||a.id.localeCompare(b.id));
 const box=node=>{
  const back=topology.first.some(b=>b.id===node.id&&b.returning);
  const lines=textLines((back?'↩ ':'')+(layout.estimatedIds.has(node.id)?'◌ ':'')+node.name);
  return {w:clamp(Math.max(...lines.map(t=>Array.from(t).length))*12+16,86,116),h:40+(lines.length-1)*13};
 };
 for(let extra=0;extra<=1200;extra+=120){
  const height=initialHeight+extra;
  // Keep the original geographic scale as large as practical. Additional
  // height increases the space around the graph, rather than shrinking it.
  const scale=Math.min(270/layout.width,300/layout.height);
  const anchors=new Map([...layout.positions].map(([id,p])=>[id,{x:width/2+(p.x-layout.width/2)*scale,y:height/2+(p.y-layout.height/2)*scale}]));
  const positions=new Map([...anchors].map(([id,p])=>[id,{...p}]));
  // Relax overlapping dots with a weak pull to their original bearing.
  for(let pass=0;pass<160;pass++){
   for(const n of nodes){const p=positions.get(n.id),a=anchors.get(n.id);p.x+=(a.x-p.x)*.025;p.y+=(a.y-p.y)*.025;}
   for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){
    const a=positions.get(ordered[i].id),b=positions.get(ordered[j].id);
    let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
    if(d<.01){const angle=(i*13+j*7)*2.399963;dx=Math.cos(angle);dy=Math.sin(angle);d=1;}
    if(d<32){const move=(32-d)*.51;dx/=d;dy/=d;a.x-=dx*move;a.y-=dy*move;b.x+=dx*move;b.y+=dy*move;}
   }
   for(const p of positions.values()){p.x=clamp(p.x,24,width-24);p.y=clamp(p.y,55,height-24);}
  }
  const labels=new Map(), placed=[];
  const overlap=(a,b)=>a.l<b.r+3&&a.r>b.l-3&&a.t<b.b+3&&a.b>b.t-3;
  const distance=(p,b)=>Math.hypot(Math.max(b.l-p.x,0,p.x-b.r),Math.max(b.t-p.y,0,p.y-b.b));
  const target=(p,b)=>({x:clamp(p.x,b.l,b.r),y:clamp(p.y,b.t,b.b)});
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const intersects=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;
  for(const n of ordered){
   const p=positions.get(n.id),{w,h}=box(n);let best=null,bestCost=Infinity;
   // Fine grid includes all four sides and diagonals, not fixed columns.
   for(let y=38;y<=height-h-5;y+=8)for(let x=w/2+5;x<=width-w/2-5;x+=8){
    const b={x,y,l:x-w/2,r:x+w/2,t:y,b:y+h,w,h,hidden:false};
    if(placed.some(other=>overlap(b,other)))continue;
    if([...positions.values()].some(q=>q.x>b.l-12&&q.x<b.r+12&&q.y>b.t-12&&q.y<b.b+12))continue;
    const d=distance(p,b);
    let cost=d+Math.hypot(x-p.x,y+h/2-p.y)*.12;
    // Prefer outward or nearby placement and avoid covering route edges.
    const center=positions.get(topology.startId),vx=p.x-center.x,vy=p.y-center.y;
    if(n.id!==topology.startId&&((x-p.x)*vx+(y+h/2-p.y)*vy)<0)cost+=18;
    for(const [otherId,other] of labels){
     const q=positions.get(otherId);
     if((x-p.x)*(other.x-q.x)>0&&Math.abs(p.y-q.y)>8&&
        (p.y-q.y)*(y+h/2-(other.y+other.h/2))<0)cost+=80;
     if(intersects(p,target(p,b),q,target(q,other)))cost+=70;
    }
    if(cost>=bestCost)continue;
    for(const edge of topology.edges){const a=positions.get(edge.from),c=positions.get(edge.to);if(!a||!c)continue;
     for(let k=1;k<10;k++){const t=k/10,ex=a.x+(c.x-a.x)*t,ey=a.y+(c.y-a.y)*t;if(ex>b.l&&ex<b.r&&ey>b.t&&ey<b.b){cost+=90;break;}}
    }
    if(cost<bestCost){best=b;bestCost=cost;}
   }
   if(!best)break;
   labels.set(n.id,best);placed.push(best);
  }
  if(labels.size===nodes.length){
   const displaced=[...positions].some(([id,p])=>Math.hypot(p.x-anchors.get(id).x,p.y-anchors.get(id).y)>1);
   return {layout:{...layout,width,height,positions,displaced,scale:layout.scale?layout.scale*scale:layout.scale},labels};
  }
 }
 throw new Error('Unable to lay out quick topology labels');
}

// Text is centred inside a wider collision box. Anchor leaders to the visible
// text or current-position badge instead of that invisible box's edge.
export function quickLabelInkBounds(label,lines,meta,current){
 const textWidth=(text,size)=>Array.from(text).reduce((sum,c)=>sum+(/[\x00-\xff]/.test(c)?size*.6:size),0);
 const bounds=lines.map((line,i)=>{const w=Math.max(4,textWidth(line,12));
  return {l:label.x-w/2,r:label.x+w/2,t:label.y+1+i*13,b:label.y+14+i*13};});
 const metaY=label.y+12+(lines.length-1)*13+14;
 const w=current?76:Math.max(4,textWidth(meta,10.5));
 bounds.push({l:label.x-w/2,r:label.x+w/2,t:metaY-12,b:metaY+(current?6:3)});
 return bounds;
}

export function quickLabelLeader(node,point,ink,layout,labels,topology){
 const nearest=box=>({x:clamp(point.x,box.l,box.r),y:clamp(point.y,box.t,box.b)});
 const anchor=ink.map(nearest).sort((a,b)=>Math.hypot(a.x-point.x,a.y-point.y)-Math.hypot(b.x-point.x,b.y-point.y))[0];
 const dx=point.x-anchor.x,dy=point.y-anchor.y,len=Math.hypot(dx,dy)||1;
 const end={x:anchor.x+dx/len*3,y:anchor.y+dy/len*3};
 const routes=[[point,end],[point,{x:point.x,y:end.y},end],[point,{x:end.x,y:point.y},end]];
 const boxes=[...labels.entries()].filter(([id])=>id!==node.id).map(([,b])=>b);
 const others=[...layout.positions.entries()].filter(([id])=>id!==node.id).map(([,p])=>p);
 const edges=topology.edges.map(e=>[layout.positions.get(e.from),layout.positions.get(e.to)]).filter(([a,b])=>a&&b);
 const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
 const intersects=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;
 const score=route=>{
  let cost=(route.length-2)*9;
  for(let i=1;i<route.length;i++){
   const a=route[i-1],b=route[i],length=Math.hypot(a.x-b.x,a.y-b.y);cost+=length;
   const steps=Math.max(1,Math.ceil(length/4));
   for(let j=1;j<=steps;j++){
    const t=j/steps,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
    if(others.some(p=>Math.hypot(p.x-x,p.y-y)<11))cost+=200;
    if(boxes.some(r=>x>r.l-3&&x<r.r+3&&y>r.t-3&&y<r.b+3))cost+=200;
   }
   for(const [c,d] of edges)if(intersects(a,b,c,d))cost+=45;
  }
  return cost;
 };
 return routes.sort((a,b)=>score(a)-score(b))[0];
}

export function renderQuickTopologySvg(candidates,startId,startName,coefficient,estimate,geometryData=null){
 const topology=buildQuickTopology(candidates,startId,startName);
 let layout=layoutQuickTopology(topology,geometryData);
 let labels=layoutQuickTopologyLabels(topology,layout);
 const points=[...layout.positions.values()];
 const crowded=points.some((p,i)=>points.slice(i+1).some(q=>Math.hypot(p.x-q.x,p.y-q.y)<24));
 const callouts=crowded||[...labels.values()].some(label=>label.hidden);
 if(callouts)({layout,labels}=layoutQuickTopologyCallouts(topology,layout));
 const {positions}=layout;
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
  const ink=quickLabelInkBounds(label,text,meta,current);
  const line=quickLabelLeader(n,p,ink,layout,labels,topology);
  const linePath=line.map((v,i)=>(i?'L ':'M ')+v.x+' '+v.y).join(' ');
  const leader='<path class="topo-label-leader" data-node-id="'+xml(n.id)+'" d="'+linePath+'" fill="none" stroke="'+(current?'#315d42':'#82988a')+'" stroke-width="'+(current?'1.5':'1.2')+'" stroke-dasharray="'+(current?'none':'3 2')+'"/>';
  const halo=current?'<circle class="topo-current-halo" cx="'+p.x+'" cy="'+p.y+'" r="13" fill="#d5ece0" opacity=".82"/>':'';
  return '<g class="topo-node'+(current?' topo-current':back?' topo-back':'')+(estimated?' topo-estimated':'')+'" data-node-id="'+xml(n.id)+'"><title>'+xml(n.name+(current?'（目前位置）':back?'（原路返回）':'')+(estimated?'，座標未取得，位置為示意':''))+'</title>'+leader+halo+'<circle cx="'+p.x+'" cy="'+p.y+'" r="'+(current?10:7)+'" fill="'+(current?'#315d42':back?'#ead9bd':'#e4efe9')+'" stroke="'+(current?'#315d42':back?'#947041':'#557464')+'" stroke-width="2"'+(estimated?' stroke-dasharray="3 2"':'')+'/>'+nameSvg+metaSvg+'</g>';
 }).join('');
 const omitted=[...labels.values()].filter(l=>l?.hidden).length;
 const hiddenHint=omitted?'<text class="topo-fallback-label" x="10" y="'+(layout.height-5)+'">部分密集節點名稱請參考快速加入按鈕</text>':'';
 const compassX=355;
 const compass=layout.mode==='geographic'
  ?'<g class="topo-compass" transform="translate('+(compassX-355)+' 0)"><path d="M 355 39 V 18 M 355 18 L 351 24 M 355 18 L 359 24" stroke="#587263" stroke-width="1.5" fill="none"/><text x="355" y="13" text-anchor="middle">北</text></g>'
  :'<text class="topo-fallback-label" x="10" y="15">座標不足，採純拓樸示意</text>';
 return '<svg class="quick-topology-svg" xmlns="http://www.w3.org/2000/svg" data-layout-mode="'+layout.mode+'" data-displaced="'+Boolean(layout.displaced)+'" data-known-nodes="'+layout.knownCount+'" viewBox="0 0 '+layout.width+' '+layout.height+'" role="img" aria-label="'+xml('從'+startName+'出發的局部路網示意圖')+'">'+edgeHtml+nodeHtml+compass+hiddenHint+'</svg>';
}
