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
