import fs from 'node:fs';
import {resolve} from 'node:path';
import {loadSnapshot,loadProject,loadLibrary} from './core.mjs';
import {lineIndex,candidates,matchBothDirections} from './match.mjs';
import {evidenceAge} from './evidence-age.mjs';
// Reuse every cached GPX for shared subsections without pretending it covers a whole route.
export function crossReference(input,project,library){
 const coverage=new Map();
 for(const entry of library.entries){const index=lineIndex(entry.parsed.components,{nearMeters:30,reviewMeters:100}),ids=new Set();
  for(const [nodeId]of project.nodeAuthority){const point=project.coordinates.get(nodeId)?.coordinate;if(point&&candidates(point,index).values.length)ids.add(nodeId);}
  coverage.set(entry.id,ids);
 }
 const results=[];
 for(const r of input.routes.filter(r=>r.occurrences.length)){
  const occurrences=r.occurrences.map(o=>({...o,coordinate:project.coordinates.get(o.nodeId)?.coordinate})),sources=[];
  for(const entry of library.entries){const common=new Set(occurrences.filter(o=>coverage.get(entry.id).has(o.nodeId)).map(o=>o.nodeId));if(common.size<3&&!entry.routeIds?.includes(r.routeId))continue;
   const m=matchBothDirections(occurrences,entry.parsed.components);sources.push({sourceId:entry.id,sourceUrl:entry.sourceUrl,author:entry.author||'',sha256:entry.sha256,recency:evidenceAge(entry),direction:m.direction,matched:m.matched,total:m.total,endpointComplete:m.endpointComplete,missing:m.missing.map(i=>({position:occurrences[i].position,nodeId:occurrences[i].nodeId,name:occurrences[i].name})),matches:m.matches.map((x,i)=>x?{position:occurrences[i].position,nodeId:occurrences[i].nodeId,alongMeters:Math.round(x.along),offsetMeters:Math.round(x.offset),component:x.component}:null).filter(Boolean),ambiguities:m.ambiguousPositions,segmentCrossings:m.segmentCrossings,warnings:entry.parsed.warnings,status:'SUBSECTION_OBSERVATION_NOT_ROUTE_PASS'});
  }
  results.push({routeId:r.routeId,name:r.name,sources,notice:'單調序列匹配涵蓋所有相關已下載GPX；不以單份最多匹配數宣告正確，不把片段／不同變體算全程支持。'});
 }
 return {snapshotSha256:input.sha256,graphDigest:project.digest,availableGpx:library.entries.length,invalidSources:library.errors,results};
}
if(process.argv[1]?.endsWith('cross-reference.mjs')){
 const input=loadSnapshot(undefined,process.argv[2]||null),p=loadProject(),out=crossReference(input,p,loadLibrary());
 const path=resolve('.route-validator/research/round2-cross-gpx.json');fs.writeFileSync(path,JSON.stringify(out,null,2));console.log(JSON.stringify({availableGpx:out.availableGpx,routes:out.results.length,routesWithRelevantGpx:out.results.filter(r=>r.sources.length).length,sourceComparisons:out.results.reduce((n,r)=>n+r.sources.length,0),output:path}));
}
