// Local geometric attachment, only applied after an explicit user choice.
export function attachmentPath(point,span,nodeId){
 const coords=span.coordinates;let best=null;
 for(let i=1;i<coords.length;i++){
  const a=coords[i-1],b=coords[i],scale=Math.cos(point[1]*Math.PI/180),dx=(b[0]-a[0])*scale,dy=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*scale*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy||1))),p=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],distance=Math.hypot((p[0]-point[0])*scale,p[1]-point[1])*111195;
  if(!best||distance<best.distance)best={i,p,distance};
 }
 if(!best||![span.fromId,span.toId].includes(nodeId))throw Error('連接來源已不存在，請重新確認路段');
 return {distance:best.distance,coordinates:[point,best.p,...(nodeId===span.fromId?coords.slice(0,best.i).reverse():coords.slice(best.i))]};
}
export function attachmentCandidates(item,data){
 if(!item.coordinate)return [];
 return data.spans.filter(s=>!s.aggregate).flatMap(s=>[s.fromId,s.toId].map(nodeId=>({spanId:s.id,nodeId,...attachmentPath(item.coordinate,s,nodeId),label:(data.nodes.find(n=>n.nodeId===s.fromId)?.name||s.fromId)+' → '+(data.nodes.find(n=>n.nodeId===s.toId)?.name||s.toId)+'；連接端 '+(data.nodes.find(n=>n.nodeId===nodeId)?.name||nodeId)}))).sort((a,b)=>a.distance-b.distance).slice(0,8);
}
