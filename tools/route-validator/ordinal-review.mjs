import {lineIndex,candidates} from './match.mjs';
import {evidenceGroups,loadSnapshot,loadProject,loadLibrary} from './core.mjs';
import {evidenceAge} from './evidence-age.mjs';
import {meters,writeJson,hash} from './utils.mjs';
import fs from 'node:fs';

// Independent of shape/time PASS: records observed order on continuous shared
// subsections. A recording can support one subsection without covering a route.
export function subsectionObservations(route,matches,index,events){
 const byPosition=new Map(matches.map(m=>[m.position,m]));
 return route.occurrences.slice(1).map((to,i)=>{
  const from=route.occurrences[i],a=byPosition.get(from.position),b=byPosition.get(to.position);
  if(!a||!b||a.component!==b.component||b.alongMeters<=a.alongMeters)return null;
  const between=events.filter(e=>e.component===a.component&&e.along>a.alongMeters+20&&e.along<b.alongMeters-20&&![from.nodeId,to.nodeId].includes(e.nodeId));
  const edges=index.edges.filter(e=>e.component===a.component&&e.along+e.length>a.alongMeters&&e.along<b.alongMeters);
  const speedSuspects=edges.filter(e=>{const pa=e.recordA,pb=e.recordB;if(pa?.time==null||pb?.time==null)return false;const dt=Math.abs(pb.time-pa.time)/1000;return e.length>50&&(dt===0||e.length/dt>5);}).length;
  return {positions:[from.position,to.position],nodeIds:[from.nodeId,to.nodeId],offsetMeters:[a.offsetMeters,b.offsetMeters],observedDistanceMeters:Math.round(b.alongMeters-a.alongMeters),speedSuspects,events:between,status:speedSuspects?'LOCAL_SPEED_SUSPECT':'SHARED_SUBSECTION_OBSERVED',notice:'只有相鄰點的順序觀察；額外事件尚未判定為必經點，不自動插入或刪除。'};
 }).filter(Boolean);
}

export function ordinalReview(snapshot,project,library,cross){
 if(cross.snapshotSha256!==snapshot.sha256)throw Error('GPX comparison snapshot is stale');
 const groups=evidenceGroups(library.entries),sourceEvents=new Map();
 const output=[];
 for(const route of snapshot.routes.filter(r=>r.occurrences.length)){
  const comparisons=cross.results.find(r=>r.routeId===route.routeId)?.sources||[],sources=[];
  for(const observation of comparisons){
   const entry=library.entries.find(e=>e.id===observation.sourceId);if(!entry)continue;
   const cacheKey=entry.id+':'+observation.direction;
   if(!sourceEvents.has(cacheKey)){
    const components=observation.direction==='reverse'?entry.parsed.components.slice().reverse().map(c=>c.slice().reverse()):entry.parsed.components;
    const index=lineIndex(components,{nearMeters:30,reviewMeters:100}),events=[];
    for(const edge of index.edges){const c=components[edge.component];edge.recordA=c[edge.index];edge.recordB=c[edge.index+1];}
    for(const [nodeId,node]of project.nodes){if(!project.nodeAuthority.has(nodeId))continue;const point=project.coordinates.get(nodeId)?.coordinate;if(!point)continue;
     for(const hit of candidates(point,index).values)events.push({nodeId,name:node.name,along:hit.along,offset:hit.offset,component:hit.component});
    }
    sourceEvents.set(cacheKey,{index,events:events.sort((a,b)=>a.along-b.along)});
   }
   const {index,events}=sourceEvents.get(cacheKey),subsections=subsectionObservations(route,observation.matches,index,events);
   sources.push({sourceId:entry.id,url:entry.sourceUrl,author:entry.author,sourceRecords:entry.sourceRecords,sha256:entry.sha256,group:groups.find(g=>g.sourceId===entry.id),recency:evidenceAge(entry),direction:observation.direction,subsections});
  }
  const sections=route.occurrences.slice(1).map((to,i)=>{
   const from=route.occurrences[i],observed=sources.flatMap(s=>s.subsections.filter(o=>o.positions[0]===from.position).map(o=>({sourceId:s.sourceId,group:s.group.group,recent:s.recency.eligible,independent:s.group.eligible,url:s.url,author:s.author,...o}))),recent=new Set(observed.filter(o=>o.recent&&o.independent&&!o.speedSuspects).map(o=>o.group));
   return {positions:[from.position,to.position],nodeIds:[from.nodeId,to.nodeId],names:[from.name,to.name],recentIndependentObserved:recent.size,observations:observed};
  });
  output.push({routeId:route.routeId,name:route.name,sections,status:'ORDER_EVIDENCE_COLLECTION_NOT_COMPLETION'});
 }
 return {schemaVersion:1,generatedAt:new Date().toISOString(),snapshotSha256:snapshot.sha256,graphDigest:project.digest,librarySha256:hash(library.entries.map(({id,sha256})=>({id,sha256}))),results:output};
}
if(process.argv[1]?.endsWith('ordinal-review.mjs')){
 const s=loadSnapshot(),p=loadProject(),l=loadLibrary(),cross=JSON.parse(fs.readFileSync('.route-validator/research/round2-cross-gpx.json'));
 const report=ordinalReview(s,p,l,cross);writeJson('.route-validator/research/ordinal-subsections.json',report);
 const rows=report.results.flatMap(r=>r.sections.map(s=>({routeId:r.routeId,...s}))),extra=rows.filter(s=>s.observations.some(o=>o.events.length));
 console.log(JSON.stringify({routes:report.results.length,sections:rows.length,withRecentEvidence:rows.filter(s=>s.recentIndependentObserved>0).length,withThreeRecent:rows.filter(s=>s.recentIndependentObserved>=3).length,extraEventSections:extra.length}));
}
