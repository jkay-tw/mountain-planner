import {moveDetour,applyDetour} from './local-detour.js';
import {rememberIntervals} from './control-routing.js';
import {seedRouteEdit} from './route-edit-operations.js';
import {meters} from './osm-pilot-router.js';
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
  if(e.detour){e.intervalModes={...(e.intervalModes||{}),[e.detour.pId+'>'+e.detour.id]:'straight',[e.detour.id+'>'+e.detour.qId]:'straight'};delete e.detour;}
  const shape=e.shape||shapeFromGeometry(geometry,e.controls);
  e.shape=shape;rememberIntervals(e);
  if(shape.length>=5000)throw Error('路段線形已達上限，無法再插入控制點。');
  const index=nearestShapeLeg(shape,at);const left=shape.slice(0,index+1).filter(p=>p.controlId).at(-1)?.controlId||'start',right=shape.slice(index+1).find(p=>p.controlId)?.controlId||'end';const inherited=e.intervalModes?.[left+'>'+right];if(inherited){e.intervalModes[left+'>'+id]=inherited;e.intervalModes[id+'>'+right]=inherited;}shape.splice(index+1,0,{coordinate:[...coordinate],controlId:id});
  e.shape=shape;e.controls=shape.filter(p=>p.controlId).map(p=>({id:p.controlId,coordinate:[...p.coordinate]}));e.mode='straight';delete e.networkNodeIds;if(at[0]!==coordinate[0]||at[1]!==coordinate[1])rebuildControlNeighborhood(e,id);else rememberIntervals(e);
 });
 return id;
}
export function updateShapeControl(edit,index,coordinate){
 rememberIntervals(edit);
 const control=edit.controls[index];if(!control)throw Error('找不到控制點');
 if(edit.detour&&[edit.detour.id,edit.detour.pId,edit.detour.qId].includes(control.id)){moveDetour(edit.detour,control.id,coordinate);applyDetour(edit,edit.detour);return;}
 control.coordinate=[...coordinate];const point=edit.shape?.find(p=>p.controlId===control.id);if(point)point.coordinate=[...coordinate];rebuildControlNeighborhood(edit,control.id);
}
export function deleteShapeControl(edit,index){
 rememberIntervals(edit);
 const control=edit.controls[index];if(!control)throw Error('找不到控制點');
 if(edit.detour){if(control.id===edit.detour.id){edit.shape=structuredClone(edit.detour.base);edit.controls=edit.shape.filter(p=>p.controlId).map(p=>({id:p.controlId,coordinate:[...p.coordinate]}));delete edit.detour;return;}if([edit.detour.pId,edit.detour.qId].includes(control.id))throw Error('請拖動 P／Q 調整接入；刪除 B 可取消整個繞行。');}
 rebuildControlNeighborhood(edit,control.id);edit.controls.splice(index,1);if(edit.shape)edit.shape=edit.shape.filter(p=>p.controlId!==control.id);
}
const shapeLength=coordinates=>coordinates.slice(1).reduce((sum,p,i)=>sum+meters(coordinates[i],p),0);
function inheritSplitIntervals(edit,original,offset){
 if(!original?.intervals?.length)return;
 if(JSON.stringify(original.intervals.flatMap((p,i)=>p.coordinates.slice(i?1:0)))!==JSON.stringify(original.shape?.map(p=>p.coordinate)))return;
 rememberIntervals(edit);edit.intervalModes={};let walked=offset;
 const ranges=[];let sourceOffset=0;for(const part of original.intervals){const length=shapeLength(part.coordinates);ranges.push({part,start:sourceOffset,end:sourceOffset+length});sourceOffset+=length;}
 edit.intervals=edit.intervals.map(part=>{const length=shapeLength(part.coordinates),middle=walked+length/2,source=ranges.find(r=>middle>=r.start-.001&&middle<=r.end+.001);const start=walked;walked+=length;if(!source)return part;const old=source.part,same=JSON.stringify(part.coordinates)===JSON.stringify(old.coordinates),next={...old,...part,mode:old.mode,network:old.network,signature:JSON.stringify([part.coordinates[0],part.coordinates.at(-1),old.mode])};edit.intervalModes[part.key]=old.mode;delete next.retry;
  if(!same){delete next.failureReason;delete next.networkProfile;const first=old.accessSegments!==false&&old.network?meters(old.coordinates[0],old.coordinates[1]):0,last=old.accessSegments!==false&&old.network?meters(old.coordinates.at(-2),old.coordinates.at(-1)):0;next.startAccess=old.startAccess!==false&&start<source.start+first-.001;next.endAccess=old.endAccess!==false&&walked>source.end-last+.001;}
  return next;});
}
export function splitManualShape(day,toId,geometry,at,name='手動節點',newId=uid(),along=null,context=null){
 const items=day.items.filter(i=>i.type!=='rest'),index=items.findIndex(i=>i.id===toId),to=items[index],from=items[index-1];
 if(!from||!to||!validCoordinate(at)||!Array.isArray(geometry)||geometry.length<2||!geometry.every(validCoordinate))throw Error('路段線形不完整，無法插入行程節點。');
 const old=structuredClone(to.incoming);let edit=to.pathEdit?.fromItemId===from.id?to.pathEdit:null;
 if(context){edit=structuredClone(edit||{fromItemId:from.id,mode:'auto',controls:[]});seedRouteEdit(edit,geometry,context);}
 const shape=edit?.shape?structuredClone(edit.shape):shapeFromGeometry(geometry,edit?.controls);
 let leg=nearestShapeLeg(shape,at);if(Number.isFinite(along)){let walked=0;for(let i=1;i<shape.length;i++){walked+=meters(shape[i-1].coordinate,shape[i].coordinate);if(walked>=along-.001){leg=i-1;break;}}}
 const boundary={coordinate:[...at]},left=[...shape.slice(0,leg+1),boundary],right=[boundary,...shape.slice(leg+1)];
 if(left.length>5000||right.length>5000)throw Error('路段線形已達上限，無法拆分。');
 const shapeEdit=(start,points)=>({fromItemId:start,mode:'straight',shape:points,controls:points.filter(p=>p.controlId).map(p=>({...edit?.controls.find(c=>c.id===p.controlId),id:p.controlId,coordinate:[...p.coordinate]})),...(edit?.candidateSource?{candidateSource:structuredClone(edit.candidateSource)}:{})});
 const manual={id:newId,type:'manual-location',name:name.trim()||'手動節點',coordinate:[...at],showInTable:true,note:'',isPeak:false,hasWater:false,incoming:{kind:'manual',fromId:from.id,toId:newId,actualMinutes:null},pathEdit:shapeEdit(from.id,left)};
 const endpoints=edit?.endpointCoordinates||context?.endpointCoordinates||[shape[0].coordinate,shape.at(-1).coordinate];manual.pathEdit.endpointCoordinates=[[...endpoints[0]],[...at]];
 const splitDistance=shapeLength(left.map(p=>p.coordinate));inheritSplitIntervals(manual.pathEdit,edit,0);
 // Preserve the original full-leg source and estimate without distributing it.
 if(to.splitOriginalIncoming){to.splitHistory=[...(to.splitHistory||[]),{incoming:structuredClone(to.splitOriginalIncoming),...(to.splitOriginalPathIncoming?{sourceIncoming:structuredClone(to.splitOriginalPathIncoming)}:{})}];}
 to.splitOriginalIncoming=old;if(to.pathOriginalIncoming)to.splitOriginalPathIncoming=structuredClone(to.pathOriginalIncoming);else delete to.splitOriginalPathIncoming;to.incoming={kind:'manual',fromId:newId,toId:to.id,actualMinutes:null};to.pathEdit=shapeEdit(newId,right);
 inheritSplitIntervals(to.pathEdit,edit,splitDistance);
 to.pathEdit.endpointCoordinates=[[...at],[...endpoints[1]]];
 delete to.pathOriginalIncoming;day.items.splice(day.items.indexOf(to),0,manual);return manual;
}
export function promoteShapeControl(day,toId,controlId,name='手動節點'){
 const to=day.items.find(i=>i.id===toId),edit=to?.pathEdit,control=edit?.controls.find(c=>c.id===controlId),index=edit?.shape?.findIndex(p=>p.controlId===controlId);
 if(!control||index<=0||index>=edit.shape.length-1)throw Error('找不到可轉換的控制點');
 const coordinate=[...control.coordinate];
 // Split at the exact stored vertex, including self-crossing routes.
 const originalEdit=structuredClone(edit),original=structuredClone(edit.shape),clean=structuredClone(original);delete clean[index].controlId;
 const savedShape=edit.shape;edit.shape=clean;
 try{
  const splitDistance=shapeLength(clean.slice(0,index+1).map(p=>p.coordinate));const item=splitManualShape(day,toId,clean.map(p=>p.coordinate),coordinate,name,uid(),splitDistance);
  item.pathEdit.shape=clean.slice(0,index+1);to.pathEdit.shape=clean.slice(index);
  for(const part of [item.pathEdit,to.pathEdit]){part.controls=part.shape.filter(p=>p.controlId).map(p=>({...originalEdit.controls.find(c=>c.id===p.controlId),id:p.controlId,coordinate:[...p.coordinate]}));rememberIntervals(part);}
  inheritSplitIntervals(item.pathEdit,originalEdit,0);inheritSplitIntervals(to.pathEdit,originalEdit,splitDistance);
  return item;
 }catch(error){edit.shape=savedShape;throw error;}
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
 const points=day.items.filter(item=>item.type!=='rest'),boundaryIds=new Set([points[0]?.id,points.at(-1)?.id]);
 let pending=[];
 return rows.flatMap(r=>{
  if(r.type==='rest')return [r];
  if(r.incoming)pending.push(r);
  if(r.showInTable===false&&!boundaryIds.has(r.id))return [];
  const parts=pending;pending=[];
  if(parts.length<2)return [r];
  const values=parts.map(x=>edgeActual(x.incoming,day.coefficient));
  return [{...r,aggregate:true,incoming:{kind:'manual',actualMinutes:values.includes(null)?null:values.reduce((a,b)=>a+b,0)},aggregateItemIds:parts.map(x=>x.id),aggregateOfficialMinutes:parts.filter(x=>x.incoming.kind==='official').reduce((n,x)=>n+referenceMinutes(x.incoming),0),aggregateHasManual:parts.some(x=>x.incoming.kind==='manual')}];
 });
}
export function aggregateTerrain(features,ids){
 const chosen=features.filter(f=>ids.includes(f.toItemId));
 if(!chosen.length)return null;
 const metric=sign=>chosen.some(f=>!f.profile||f.profile.some(p=>!Number.isFinite(p[1])))?null:chosen.reduce((n,f)=>n+f.profile.slice(1).reduce((a,p,i)=>a+Math.max(0,sign*(p[1]-f.profile[i][1])),0),0);
 return {features:chosen,distanceMeters:chosen.reduce((n,f)=>n+f.distanceMeters,0),ascentMeters:metric(1),descentMeters:metric(-1)};
}
