// Focused, repeatable R066 evidence extraction. Never edits Sheets or route data.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {parseGpx} from './route-validator/gpx.mjs';
import {project, sequenceMatch} from './route-validator/match.mjs';
import {ROOT, hash, meters, writeJson} from './route-validator/utils.mjs';

const read = file => JSON.parse(readFileSync(resolve(ROOT,file),'utf8'));
const live=read('data/audits/route-validator-20261124/r066-sheet-readback.json');
const authorityFile='data/route-validator/snapshots/node-authority-20261124.json';
const authority=read(authorityFile), nodes=authority.rows.slice(1).filter(r=>r[1]?.includes('G15')&&r[4]&&r[5]).map(r=>({nodeId:r[0],name:r[2],coordinate:[Number(r[4]),Number(r[5])],adjacentIds:String(r[12]||'').split('；').filter(Boolean)}));
const byName=name=>{const matches=nodes.filter(n=>n.name===name);assert.equal(matches.length,1,name);return matches[0];};
const decision=read('data/audits/route-validator-20261124/r066-scope-decision.json');
assert.equal(decision.start.nodeId,byName(decision.start.name).nodeId);
const authorityLive=read('data/audits/route-validator-20261124/r066-authority-readback.json');
for(const n of nodes){const row=authorityLive.values.find(r=>r[0]===n.nodeId);assert.ok(row,'Authority row missing: '+n.nodeId);assert.equal(row[2],n.name);assert.deepEqual(row.slice(4,6).map(Number),n.coordinate,'Authority coordinates changed: '+n.nodeId);}
const current=live.reads[1].values;
assert.equal(current.length,30);assert.ok(current.every((r,i)=>r[0]==='R066'&&Number(r[2])===i+1));
const branches={
  selectedStartExtension:['14.6K水泥路止','19.3K水泥橋'],
  ingressTraditional:['19.3K水泥橋','28K水泥工寮','32K水泥工寮','34K登山口','沙武巒草原','東源營地','西源營地','杜鵑營地','太平溪源','太平溪源營地'],
  dandaReturn:['太平溪源營地','盧利拉駱山','丹大山','盧利拉駱山','太平溪源營地'],
  eastFirst:['東北鞍營地','東鑾/烏達佩岔路','東巒大山','東鑾/烏達佩岔路','東北鞍營地','東郡大山','東北鞍營地'],
  dongFirst:['東北鞍營地','東郡大山','東鑾/烏達佩岔路','東巒大山','東鑾/烏達佩岔路','東北鞍營地'],
  egressTraditional:['無雙山基點峰','最後水源','亞力士營地','無雙部落址','無雙吊橋','烏瓦拉鼻溪營地','45.3K登山口','43K工寮','33K行車終點'],
};
// Geometry availability and GPX sequence evidence are separate assessments.
// Reuse only this exact existing pair; never invoke shortest-path routing here.
const terrain=read('preview/data/geometry/planner-terrain-v1.json');
const start=byName(decision.start.name),bridge=byName('19.3K水泥橋');
const spanCandidates=terrain.spans.filter(s=>(s.fromId===start.nodeId&&s.toId===bridge.nodeId)||(s.reversible&&s.toId===start.nodeId&&s.fromId===bridge.nodeId));
assert.equal(spanCandidates.length,1,'Need one exact existing reversible start span');
const startSpan=spanCandidates[0];
const startCoordinates=startSpan.fromId===start.nodeId?startSpan.coordinates:[...startSpan.coordinates].reverse();
assert.ok(startCoordinates.length>2&&startCoordinates.every(c=>c.length>=2&&c.slice(0,2).every(Number.isFinite)));
const endpointOffsets=[meters(start.coordinate,startCoordinates[0]),meters(bridge.coordinate,startCoordinates.at(-1))];
assert.ok(endpointOffsets.every(d=>d<30),'Existing geometry endpoints no longer match authority nodes');
const routeData=read('data/routes/owner-reviewed/G15.json');
const directionalTimes=routeData.segments.filter(s=>(s.fromId===start.nodeId&&s.toId===bridge.nodeId)||(s.fromId===bridge.nodeId&&s.toId===start.nodeId)).map(s=>({fromId:s.fromId,toId:s.toId,minutes:s.minutes,source:s.source,sourceRows:s.sourceRows,evidenceRows:s.evidenceRows,verificationBasis:s.verificationBasis}));
assert.equal(directionalTimes.length,2);
const existingStartSegment={fromId:start.nodeId,toId:bridge.nodeId,geometryStatus:'EXISTING_OSM_GEOMETRY_AVAILABLE',sequenceEvidenceStatus:'GPX_NOT_COVERED_NOT_A_GEOMETRY_BLOCKER',spanId:startSpan.id,geometryFile:'preview/data/geometry/planner-terrain-v1.json',geometryHash:hash(startSpan.coordinates),pointCount:startCoordinates.length,distanceMeters:startSpan.distanceMeters,endpointOffsetsMeters:endpointOffsets.map(d=>Number(d.toFixed(2))),usedReverse:startSpan.fromId!==start.nodeId,sourceWayIds:startSpan.sourceWayIds,source:terrain.ownerUpdateRoutingSource,directionalTimes,noNewRouting:true,noGeometryWritten:true,meaning:'Reuse existing OSM planning geometry and existing source times; not a new field survey or independently verified official map transcription.'};
const library=read('.route-validator/sources.json');
const sources=library.sources.filter(s=>s.routeIds.includes('R066')).map(s=>{
  const bytes=readFileSync(resolve(ROOT,'.route-validator',s.file));assert.equal(hash(bytes),s.sha256);
  const p=parseGpx(bytes);
  const measurements=nodes.map(node=>{
    let best=null,along=0;const visits=[];
    p.components.forEach((c,ci)=>{
      let visit=null;
      for(let i=1;i<c.length;i++){
        const a=c[i-1],b=c[i],length=meters(a.coordinate,b.coordinate),q=project(node.coordinate,a.coordinate,b.coordinate);
        const hit={offsetMeters:Number(q.offset.toFixed(1)),component:ci+1,edge:i,recordedAlongMeters:Number((along+q.fraction*length).toFixed(1)),time:a.time===null||b.time===null?null:new Date(a.time+(b.time-a.time)*q.fraction).toISOString()};
        if(!best||q.offset<best.exactOffset)best={...hit,exactOffset:q.offset};
        if(q.offset<=100){if(!visit){visit={...hit};visits.push(visit);}else if(hit.offsetMeters<visit.offsetMeters)Object.assign(visit,hit);}else visit=null;
        along+=length;
      }
    });
    if(best)delete best.exactOffset;
    return {nodeId:node.nodeId,name:node.name,inCurrentSheet:current.some(r=>r[3]===node.nodeId),nearest:best,visitsWithin100m:visits};
  });
  const branchMatches=Object.fromEntries(Object.entries(branches).map(([key,names])=>{
    const result=sequenceMatch(names.map(name=>byName(name)),p.components,{nearMeters:30,reviewMeters:30,maxCandidates:2048});
    return [key,{template:names,radiusMeters:30,matched:result.matches.filter(Boolean).length,total:names.length,truncated:result.truncated,matches:result.matches.map((m,i)=>m?{name:names[i],component:m.component+1,alongMeters:Math.round(m.along),offsetMeters:Number(m.offset.toFixed(1))}:null),meaning:'Within-radius sequence candidates only; not proof of physical node identity, continuous geometry, or variant equivalence.'}];
  }));
  const gaps=p.components.slice(1).map((c,i)=>({afterComponent:i+1,meters:Number(meters(p.components[i].at(-1).coordinate,c[0].coordinate).toFixed(1))}));
  return {sourceId:s.id,sourceUrl:s.sourceUrl,author:s.author,sha256:s.sha256,recordingId:s.recordingId,summary:p.summary,warnings:p.warnings,componentGaps:gaps,branchMatches,measurements};
});
assert.equal(sources.length,3);
const result={schemaVersion:1,routeId:'R066',generatedAt:new Date().toISOString(),sheetReadAt:live.capturedAt,authority:{path:authorityFile,sha256:hash(readFileSync(resolve(ROOT,authorityFile))),capturedAt:authority.capturedAt,liveComparisonAt:authorityLive.capturedAt,liveRange:authorityLive.range},method:'Project to existing GPX edges only; components and jumps remain separate. Along-distance excludes missing links. Per-node proximity is diagnostic, never an identity or route correctness decision. Geometry availability is assessed independently using exact existing OSM spans.',existingStartSegment,currentSequence:current.map(r=>({position:Number(r[2]),nodeId:r[3],name:r[4]})),branches,sources};
writeJson(resolve(ROOT,'data/audits/route-validator-20261124/r066-gpx-evidence.json'),result);
const block=(id,positions,names,reason,sourceIds)=>({id,oldPositions:positions,suggestedAnchors:names.map(name=>{const n=byName(name);return {nodeId:n.nodeId,name:n.name,identityStatus:'original-registry-record; physical correspondence and exact span still require source review'};}),reason,sourceIds,completeNodeSequence:false,geometryVerified:false,directionalTimeVerified:false});
const proposal={schemaVersion:1,routeId:'R066',status:'REVIEWABLE_PROPOSAL_NOT_APPLIED',eligibleForImport:false,requiresConfirmation:true,sourceSheetRanges:live.reads.map(r=>r.range),before:result.currentSequence,after:null,whyNoCompleteAfter:'步行起終點與出山變體尚未選定；以下僅為修改區塊，不是可匯入完整序列。',recommendedOption:'A',options:[{id:'A',startCandidate:byName('19.3K水泥橋').nodeId,endCandidate:byName('33K行車終點').nodeId,exit:'無雙部落／無雙吊橋',boundaryIdentityPending:true},{id:'B',startCandidate:byName('14.6K水泥路止').nodeId,endCandidate:byName('33K行車終點').nodeId,exit:'無雙部落／無雙吊橋',additionalEvidenceNeeded:'14.6K至既有GPX起點之步行段'},{id:'C',startCandidate:null,endCandidate:null,exit:'無雙溫泉／郡大林道／望鄉山／開高山／東埔',note:'17.8K起點及新增出山變體，部分節點待查證；不自動新增ID'}],changes:[
  block('ingress',[1,1],branches.ingressTraditional,'A方案進山錨點草案；不是逐段接線完成，不能借舊鐵線斷崖線或最短路徑補齊。',['229060','6204736']),
  block('danda-return',[1,3],branches.dandaReturn,'補齊登頂去程；回到太平溪源營地後接目前position4。重複節點屬合法支線往返。',['229060','6204736']),
  block('egress',[30,30],branches.egressTraditional,'A/B傳統出山錨點草案；需查核林道崩塌／高繞線形，不代表已完整可用。',['229060']),
  block('optional-tiannankelan',[14,15],['天南可蘭/望崖岔路','天南可蘭山','天南可蘭/望崖岔路'],'可選登頂支線，保留現有Sheet選峰意圖，不默認新增。',['6204736','6099041']),
  block('optional-wudapei',[19,21],['東鑾/烏達佩岔路','烏達佩山','東鑾/烏達佩岔路'],'可選登頂支線，實際插入去程或回程依變體決定，不同時自動插兩次。',['6204736','6099041'])
],retain:[{oldPositions:[4,6],reason:'內嶺爾支線往返，保留重複三岔路口。'},{oldPositions:[18,24],reason:'保留先東巒的候選意圖；另有先東郡走法，不憑多數決覆寫。'}],metadataProposal:{range:'Routes_順序校核!Z67',reason:'既有無節點與未取得GPX敘述已過時。',suggested:'已取得三份GPX並進行局部投影與順序查證；原始節點表已有多個進出段節點。現為丹大山至無雙山核心片段，待選定步行起終點／出山變體，逐段核對線形與方向時間後補齊；尚非完整已驗證路線。'},needsNewNodes:'不先建立。既有ID優先；17.8K／溫泉等點待來源與身分核對。'};
proposal.scopeDecision=decision;
proposal.recommendedOption=null;
proposal.selectedStartOption='B';
proposal.whyNoCompleteAfter='14.6K起點已指定，首段已有既有OSM線形與方向時間可重用，無須等待GPX。全線尚待整合逐段來源與順序，出山方案未明確確認。';
proposal.changes[0]=block('ingress',[1,1],[decision.start.name,...branches.ingressTraditional],'使用者指定14.6K起步；14.6K至19.3K直接重用精確對應的既有OSM線形與方向時間，GPX未覆蓋不構成此段線形缺漏。',['229060','6204736']);
proposal.changes[0].availableSubsections=[existingStartSegment];
proposal.metadataProposal.suggested='使用者已指定14.6K水泥路止為步行起點。14.6K至19.3K已有OSM線形及方向時間可用；GPX主要核對行走順序，不因缺GPX視為缺線形。已取得三份GPX並進行局部查證，原始節點表已有進出段候選。Sheet目前仍為核心片段，完整序列與出山方案尚待整合。';
writeJson(resolve(ROOT,'data/audits/route-validator-20261124/r066-proposal.json'),proposal);
console.log(JSON.stringify(sources.map(s=>({id:s.recordingId,points:s.summary.points,components:s.summary.components,warnings:s.warnings,branches:Object.fromEntries(Object.entries(s.branchMatches).map(([k,v])=>[k,v.matched+'/'+v.total]))})),null,2));
