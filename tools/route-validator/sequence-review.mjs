import {lineIndex,candidates} from './match.mjs';
import {routeContext,compileClassicRoute} from '../../preview/js/classic-route.js';

export const ACCESS_RULES=[{id:'xiangyang-west-only',nodeId:'shared:cw-v07-027',allowedNeighbor:'shared:cw-v07-070',reason:'2026-11-25使用者指定：向陽山只能由西側登山口原路往返，三岔路口登頂線不通。'},{id:'ize-8k-only',nodeId:'g04-019',allowedNeighbor:'g04-002',reason:'2026-11-25使用者指定：伊澤山由8.8K岔路原路往返，不使用第二登山口直連山頂。'}];
export function accessIssues(ids,rules=ACCESS_RULES){
 const out=[];for(const rule of rules)ids.forEach((id,i)=>{if(id!==rule.nodeId)return;for(const j of [i-1,i+1])if(j>=0&&j<ids.length&&ids[j]!==rule.allowedNeighbor)out.push({code:'BLOCKED_APPROACH',position:i+1,neighborPosition:j+1,nodeId:id,neighbor:ids[j],rule:rule.id,reason:rule.reason});});return out;
}
export function importantNode(node,rowType=''){
 const text=[node?.name,rowType].filter(Boolean).join(' ');
 // These classify existing named source nodes; they never create identities or summit visits.
 if(/山屋|山莊|營地|獵寮|工寮/.test(text))return true;
 if(/登山口|岔路|叉路|岔口|三岔|三叉|四岔|鞍部|山下|峰下|山前|峰前|林道|路口|指標|保線所|基地|入口|舊址|遺址/.test(node?.name||''))return /山峰|山頭|峰頂|百岳/.test(rowType);
 return /(?:山|峰|尖|稜角)$/.test(node?.name||'')||/山峰|山頭|峰頂|百岳/.test(rowType);
}
export function corridorCandidates(span,fromId,toId,project,nearMeters=30){
 if(!span||span.coordinates.length<3)return [];
 const coords=span.fromId===fromId?span.coordinates:[...span.coordinates].reverse();
 const index=lineIndex([coords],{nearMeters,reviewMeters:nearMeters,maxGapMeters:500});
 const events=[];for(const [id,node]of project.nodes){if([fromId,toId].includes(id)||!project.nodeAuthority.has(id))continue;
  const coordinate=project.coordinates.get(id)?.coordinate;if(!coordinate)continue;
  const hits=candidates(coordinate,index).values.filter(c=>c.along>30&&c.along<index.length-30);
  if(hits.length===1)events.push({nodeId:id,name:node.name,alongMeters:hits[0].along,offsetMeters:hits[0].offset,important:importantNode(node)});
 }
 return events.sort((a,b)=>a.alongMeters-b.alongMeters);
}
export function scanSequence(route,project){
 const ids=route.occurrences.map(o=>o.nodeId),issues=accessIssues(ids),g={...project.graph,manualConnections:[...project.graph.manualConnections],vehicleSegments:[...project.graph.vehicleSegments]};
 const geometry={...project.geometry,spans:[...project.geometry.spans]};
 if(route.routeId==='R057'&&project.catalog?.supplement){g.manualConnections.push(...project.catalog.supplement.edges);geometry.spans.push(...project.catalog.supplement.spans);}
 if(['R026','R052'].includes(route.routeId))g.vehicleSegments.push(...(project.catalog?.supplement?.vehicleSegments||[]));
 const c=compileClassicRoute({routeId:route.routeId,name:route.name,type:route.type==='多段行程'?'multi_segment':'traverse',anchors:ids.map(nodeId=>({nodeId,key:true})),excludedNodeIds:project.decisions?.excludedNodeIds?.[route.routeId]||[],expandAnchors:false,source:{baseCommit:'working-tree',snapshotSha256:'research',decisionRef:'round2',...(route.type==='多段行程'?{multimodalRef:'existing-policy'}:{})}},routeContext(g,geometry,project.digest));
 const spans=new Map(geometry.spans.map(s=>[s.id,s])),omissions=[];
 for(let i=1;i<ids.length;i++){
  const direct=geometry.spans.filter(s=>s.fromId===ids[i-1]&&s.toId===ids[i]||s.reversible&&s.toId===ids[i-1]&&s.fromId===ids[i]);
  for(const span of direct){const events=corridorCandidates(span,ids[i-1],ids[i],project);if(events.length)omissions.push({positions:[i,i+1],fromId:ids[i-1],toId:ids[i],spanId:span.id,sourceUrl:span.sourceUrl||null,sourceWayIds:span.sourceWayIds||span.edgeWayIds||[],events,notice:'幾何走廊待交叉核對；距離接近不證明經過，不自動插入。'});}
 }
 return {routeId:route.routeId,name:route.name,issues,compileIssues:c.issues,omissions,missingImportance:route.occurrences.filter(o=>importantNode(project.nodes.get(o.nodeId),o.source['點位類型'])&&!o.key).map(o=>({position:o.position,nodeId:o.nodeId,name:o.name})),eligibleForImport:false};
}
