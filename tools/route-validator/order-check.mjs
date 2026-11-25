import {hash} from './utils.mjs';
import {accessIssues} from './sequence-review.mjs';

export const intentFingerprint=(route,excluded=[])=>hash({name:route.name,type:route.type,nodes:route.occurrences.map(o=>({nodeId:o.nodeId,name:o.name})),excluded:excluded.filter(e=>e.routeId===route.routeId).map(e=>e.nodeId)});
export function orderDependencies(route,project){
 const groups=new Set(route.occurrences.flatMap(o=>project.nodes.get(o.nodeId)?.groups||[]));
 const nodes=[...project.nodes.values()].filter(n=>n.groups.some(g=>groups.has(g))).sort((a,b)=>a.id.localeCompare(b.id));
 const ids=new Set(nodes.map(n=>n.id));
 return hash({nodes:nodes.map(n=>({id:n.id,name:n.name,aliases:n.aliases,groups:n.groups,authority:project.nodeAuthority.get(n.id)})),edges:project.graph.segments.filter(e=>ids.has(e.fromId)&&ids.has(e.toId)).map(e=>[e.fromId,e.toId,e.travelMode]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
}
export function checkNodeOrder(snapshot,project,review){
 const results=snapshot.routes.map(route=>{
  if(!route.occurrences.length)return {routeId:route.routeId,name:route.name,status:'UNEXPANDED',nodeCount:0};
  const record=review.results.find(r=>r.routeId===route.routeId),errors=[];
  if(snapshot.problems.length)errors.push('輸入資料有結構問題，請先修正：'+snapshot.problems.map(p=>p.code).join('、'));
  if(!record)errors.push('尚未完成此路線的來源順序核對');
  else{
   if(record.intentSha256!==intentFingerprint(route,snapshot.excluded))errors.push('選峰、節點、順序或排除項目已變更，需要針對變更重查');
   if(record.dependenciesSha256!==orderDependencies(route,project))errors.push('相關圖組的節點／連接已變更，需要核對受影響路段');
  }
  for(let i=0;i<route.occurrences.length;i++){const o=route.occurrences[i];if(o.position!==i+1)errors.push('position不連續：'+o.position);if(!project.nodeAuthority.has(o.nodeId))errors.push('原始Node ID表沒有：'+o.nodeId);}
  errors.push(...accessIssues(route.occurrences.map(o=>o.nodeId)).map(e=>e.reason));
  return {routeId:route.routeId,name:route.name,status:errors.length?'ORDER_RECHECK_REQUIRED':'NODE_ORDER_CHECKED',nodeCount:route.occurrences.length,errors,references:record?.references||[],geometryAndTime:'獨立檢查；本狀態僅代表現有上河節點指定走法之順序核對',formalImportApproved:false};
 });
 return {schemaVersion:1,profile:'EXISTING_SHANGHE_NODE_ORDER',snapshotSha256:snapshot.sha256,reviewedAt:review.reviewedAt,generatedAt:new Date().toISOString(),summary:{expanded:results.filter(r=>r.nodeCount).length,checked:results.filter(r=>r.status==='NODE_ORDER_CHECKED').length,recheckRequired:results.filter(r=>r.status==='ORDER_RECHECK_REQUIRED').length,unexpanded:results.filter(r=>r.status==='UNEXPANDED').length,activeNodes:results.reduce((n,r)=>n+r.nodeCount,0)},results,notice:'以已完成且保留來源紀錄的節點順序核對為基準，重跑只追蹤變更；不把完整GPX／精確線形認證混為節點順序，也不宣稱即時通行狀態。'};
}
