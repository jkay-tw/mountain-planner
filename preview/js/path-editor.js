import {edgeActual,referenceMinutes,shortestPath,incomingForSegment,uid} from './planner.js?v=segments1';
export const manualWarning='手動幾何連接：水平直線距離，不代表實際步道、合法或安全可通行；高程無資料。';
export const validCoordinate=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
export function coordinateOf(item,data){return item.type==='manual-location'?item.coordinate:data.nodes.find(n=>n.nodeId===item.nodeId)?.coordinate;}
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
 if(edit?.mode==='straight'||edit?.controls.length){editSegment(day,toId,()=>{});return;}
 if(from.type!=='location'||to.type!=='location')return;
 const path=shortestPath(route,from.nodeId,to.nodeId);
 if(!path?.segments.length)return;
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
