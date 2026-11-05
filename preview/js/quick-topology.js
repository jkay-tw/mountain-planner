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
export function layoutQuickTopology(topology){
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
export function renderQuickTopologySvg(candidates,startId,startName,coefficient,estimate){
 const topology=buildQuickTopology(candidates,startId,startName);
 const layout=layoutQuickTopology(topology);
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
  const nodePaths=topology.pathsById.get(n.id)||[];
  const minutes=nodePaths.length===1?estimate(nodePaths[0],coefficient):null;
  const meta=current?'目前位置':back?'↩ '+(nodePaths.length>1?'多條路線':fmt(minutes)):(nodePaths.length>1?'多條路線':fmt(minutes));
  const routeKey=nodePaths.length===1?nodePaths[0].key:null;
  const text=textLines(n.name);
  const nameY=p.y+23;
  const nameSvg='<text class="topo-node-name" text-anchor="middle" x="'+p.x+'" y="'+nameY+'">'+text.map((line,i)=>'<tspan x="'+p.x+'" dy="'+(i?13:0)+'">'+xml(line)+'</tspan>').join('')+'</text>';
  const metaY=nameY+(text.length-1)*13+14;
  const metaSvg='<text class="topo-node-meta'+(routeKey?' quick-route-duration':'')+'" text-anchor="middle" x="'+p.x+'" y="'+metaY+'"'+(routeKey?' data-route-key="'+xml(routeKey)+'"':'')+'>'+xml(meta)+'</text>';
  return '<g class="topo-node'+(current?' topo-current':back?' topo-back':'')+'"><title>'+xml(n.name+(current?'（目前位置）':back?'（原路返回）':''))+'</title><circle cx="'+p.x+'" cy="'+p.y+'" r="'+(current?10:7)+'" fill="'+(current?'#315d42':back?'#ead9bd':'#e4efe9')+'" stroke="'+(current?'#315d42':back?'#947041':'#557464')+'" stroke-width="2"/>'+nameSvg+metaSvg+'</g>';
 }).join('');
 return '<svg class="quick-topology-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+layout.width+' '+layout.height+'" role="img" aria-label="'+xml('從'+startName+'出發的兩段內路網拓樸示意圖')+'">'+edgeHtml+nodeHtml+'</svg>';
}
