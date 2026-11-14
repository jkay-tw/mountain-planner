import {edgeActual,referenceMinutes,shortestPath,incomingForSegment,uid} from './planner.js?v=segments1';
export const manualWarning='手動幾何連接：水平直線距離，不代表實際步道、合法或安全可通行；高程無資料。';
export const validCoordinate=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
export function coordinateOf(item,data){return item.type==='manual-location'?item.coordinate:data.nodes.find(n=>n.nodeId===item.nodeId)?.coordinate;}
// The geometry snapshot retains the route's existing vertices; control IDs identify
// only the vertices the user can drag or delete.
export function nearestShapeLeg(shape,point){
 let best={index:0,distance:Infinity};const scale=Math.cos(point[1]*Math.PI/180);
 for(let i=0;i<shape.length-1;i++){
  const a=shape[i].coordinate,b=shape[i+1].coordinate,dx=(b[0]-a[0])*scale,dy=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*scale*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
  const distance=Math.hypot((point[0]-a[0])*scale-t*dx,point[1]-a[1]-t*dy);if(distance<best.distance)best={index:i,distance};
 }
 return best.index;
}
function shapeFromGeometry(geometry,controls=[]){
 const unused=[...controls];return geometry.map(coordinate=>{const index=unused.findIndex(c=>c.coordinate[0]===coordinate[0]&&c.coordinate[1]===coordinate[1]);return {coordinate:[...coordinate],...(index<0?{}:{controlId:unused.splice(index,1)[0].id})}});
}
function rebuildControlNeighborhood(edit,id){
 const shape=edit.shape;if(!shape)return;const index=shape.findIndex(p=>p.controlId===id);if(index<0)return;
 let a=index-1,b=index+1;while(a>0&&!shape[a].controlId)a--;while(b<shape.length-1&&!shape[b].controlId)b++;
 edit.shape=[...shape.slice(0,a+1),shape[index],...shape.slice(b)];delete edit.osmSnapshot;
}
export function insertShapeControl(day,toId,geometry,at,coordinate,id=uid()){
 if(!validCoordinate(at)||!validCoordinate(coordinate)||!Array.isArray(geometry)||geometry.length<2||geometry.length>5000||!geometry.every(validCoordinate))throw Error('路段線形不完整，無法在此插入控制點。');
 editSegment(day,toId,e=>{
  const shape=e.shape||shapeFromGeometry(geometry,e.controls);
  if(shape.length>=5000)throw Error('路段線形已達上限，無法再插入控制點。');
  const index=nearestShapeLeg(shape,at);shape.splice(index+1,0,{coordinate:[...coordinate],controlId:id});
  e.shape=shape;e.controls=shape.filter(p=>p.controlId).map(p=>({id:p.controlId,coordinate:[...p.coordinate]}));e.mode='straight';delete e.networkNodeIds;if(at[0]!==coordinate[0]||at[1]!==coordinate[1])rebuildControlNeighborhood(e,id);
 });
 return id;
}
export function updateShapeControl(edit,index,coordinate){
 const control=edit.controls[index];if(!control)throw Error('找不到控制點');
 control.coordinate=[...coordinate];const point=edit.shape?.find(p=>p.controlId===control.id);if(point)point.coordinate=[...coordinate];rebuildControlNeighborhood(edit,control.id);
}
export function deleteShapeControl(edit,index){
 const control=edit.controls[index];if(!control)throw Error('找不到控制點');
 rebuildControlNeighborhood(edit,control.id);edit.controls.splice(index,1);if(edit.shape)edit.shape=edit.shape.filter(p=>p.controlId!==control.id);
}
export function splitManualShape(day,toId,geometry,at,name='手動節點',newId=uid()){
 const items=day.items.filter(i=>i.type!=='rest'),index=items.findIndex(i=>i.id===toId),to=items[index],from=items[index-1];
 if(!from||!to||!validCoordinate(at)||!Array.isArray(geometry)||geometry.length<2||!geometry.every(validCoordinate))throw Error('路段線形不完整，無法插入行程節點。');
 const old=structuredClone(to.incoming),edit=to.pathEdit?.fromItemId===from.id?to.pathEdit:null;
 const shape=edit?.shape?structuredClone(edit.shape):shapeFromGeometry(geometry,edit?.controls);
 const leg=nearestShapeLeg(shape,at),boundary={coordinate:[...at]},left=[...shape.slice(0,leg+1),boundary],right=[boundary,...shape.slice(leg+1)];
 if(left.length>5000||right.length>5000)throw Error('路段線形已達上限，無法拆分。');
 const shapeEdit=(start,points)=>({fromItemId:start,mode:'straight',shape:points,controls:points.filter(p=>p.controlId).map(p=>({id:p.controlId,coordinate:[...p.coordinate]})),...(edit?.candidateSource?{candidateSource:structuredClone(edit.candidateSource)}:{})});
 const manual={id:newId,type:'manual-location',name:name.trim()||'手動節點',coordinate:[...at],showInTable:true,note:'',isPeak:false,hasWater:false,incoming:{kind:'manual',fromId:from.id,toId:newId,actualMinutes:null},pathEdit:shapeEdit(from.id,left)};
 // Preserve the original full-leg source and estimate without distributing it.
 if(to.splitOriginalIncoming){to.splitHistory=[...(to.splitHistory||[]),{incoming:structuredClone(to.splitOriginalIncoming),...(to.splitOriginalPathIncoming?{sourceIncoming:structuredClone(to.splitOriginalPathIncoming)}:{})}];}
 to.splitOriginalIncoming=old;if(to.pathOriginalIncoming)to.splitOriginalPathIncoming=structuredClone(to.pathOriginalIncoming);else delete to.splitOriginalPathIncoming;to.incoming={kind:'manual',fromId:newId,toId:to.id,actualMinutes:null};to.pathEdit=shapeEdit(newId,right);
 delete to.pathOriginalIncoming;day.items.splice(day.items.indexOf(to),0,manual);return manual;
}
export function editSegment(day,toId,change){
 const items=day.items.filter(i=>i.type!=='rest'),index=items.findIndex(i=>i.id===toId),to=items[index],from=items[index-1];
 if(!from||!to?.incoming)throw Error('請先選擇有效路段');
 const prior=to.pathEdit?.fromItemId===from.id?to.pathEdit:{fromItemId:from.id,mode:'auto',controls:[]};
 const next=structuredClone(prior);change(next);
 if(!['auto','straight'].includes(next.mode)||next.controls.length>200||next.controls.some(c=>!validCoordinate(c.coordinate)))throw Error('路徑編輯資料無效');
 if(next.mode==='straight'||next.controls.length){
  if(!to.pathOriginalIncoming&&to.incoming.kind==='official')to.pathOriginalIncoming=structuredClone(to.incoming);
  if(to.incoming.kind!=='manual')to.incoming={kind:'manual',fromId:from.id,toId:to.id,actualMinutes:to.pathManualMinutes??null};
 }else if(to.pathOriginalIncoming){to.pathManualMinutes=to.incoming.actualMinutes;to.incoming=to.pathOriginalIncoming;delete to.pathOriginalIncoming;}
 to.pathEdit=next;
}
export function recalculateSegment(day,toId,route){
 const items=day.items.filter(i=>i.type!=='rest'),index=items.findIndex(i=>i.id===toId),to=items[index],from=items[index-1];
 if(!from||!to)throw Error('請選擇有效路段');
 const edit=to.pathEdit?.fromItemId===from.id?to.pathEdit:null;
 if(edit?.mode==='straight'||edit?.controls.length){editSegment(day,toId,()=>{});return '已更新指定折線與距離；控制點保留，手動路段尚無高程。';}
 const fromNode=from.type==='location'?from.nodeId:from.networkConnection?.nodeId,toNode=to.type==='location'?to.nodeId:to.networkConnection?.nodeId;
 if(!fromNode||!toNode)return '尚未確認路網連接，保留直線。請展開「連接路網」選擇來源路段。';
 if(from.type!=='location'||to.type!=='location'){
 const path=fromNode===toNode?{segments:[]}:shortestPath(route,fromNode,toNode);
 if(!path)return '指定路網端點不連通，保留直線；未跳接其他路網。';
 if(to.incoming?.kind==='official'){to.pathOriginalIncoming=structuredClone(to.incoming);to.incoming={kind:'manual',fromId:from.id,toId:to.id,actualMinutes:to.pathManualMinutes??null};}
 to.pathEdit={fromItemId:from.id,mode:'auto',controls:[],networkNodeIds:[fromNode,...path.segments.map(s=>s.toId)]};
 return '已沿確認的路段與連通路網重算；手動接入部分的時間與高程仍未知。';
 }
 const path=shortestPath(route,from.nodeId,to.nodeId);
 if(!path?.segments.length)return '既有路網無可用路徑，原路段保持不變。';
 let previous=from;const inserted=[];
 for(const [i,s] of path.segments.entries()){
  const target=i===path.segments.length-1?to:{id:uid(),type:'location',nodeId:s.toId,name:s.to,note:'',auto:true,waypoint:false,showInTable:false,isPeak:false,hasWater:false};
  const old=target.incoming;
  target.incoming=old?.kind==='official'&&old.fromNodeId===s.fromId&&old.toNodeId===s.toId?{...old,fromId:previous.id,toId:target.id}:incomingForSegment(s,previous.id,target.id,route.source?.image_url,day.coefficient);
  if(target!==to)inserted.push(target);
  previous=target;
 }
 delete to.pathEdit;
 day.items.splice(day.items.indexOf(to),0,...inserted);
 return '已沿既有連通路網重算選定路段。';
}
export function visibleTimelineRows(rows,day){
 let pending=[];
 return rows.flatMap(r=>{
  if(r.type==='rest')return [r];
  if(r.incoming)pending.push(r);
  if(r.showInTable===false)return [];
  const parts=pending;pending=[];
  if(parts.length<2)return [r];
  const values=parts.map(x=>edgeActual(x.incoming,day.coefficient));
  return [{...r,aggregate:true,incoming:{kind:'manual',actualMinutes:values.includes(null)?null:values.reduce((a,b)=>a+b,0)},aggregateItemIds:parts.map(x=>x.id),aggregateOfficialMinutes:parts.filter(x=>x.incoming.kind==='official').reduce((n,x)=>n+referenceMinutes(x.incoming),0),aggregateHasManual:parts.some(x=>x.incoming.kind==='manual')}];
 });
}
export function aggregateTerrain(features,ids){
 const chosen=features.filter(f=>ids.includes(f.toItemId));
 if(!chosen.length)return null;
 const metric=sign=>chosen.some(f=>!f.profile)?null:chosen.reduce((n,f)=>n+f.profile.slice(1).reduce((a,p,i)=>a+Math.max(0,sign*(p[1]-f.profile[i][1])),0),0);
 return {features:chosen,distanceMeters:chosen.reduce((n,f)=>n+f.distanceMeters,0),ascentMeters:metric(1),descentMeters:metric(-1)};
}
