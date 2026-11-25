import {readFileSync,existsSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {ROOT,VERSION,hash,readJson,writeJson,readCache,writeCache,atomicWrite,table,parseCsv,coordinateValid,meters,round,inside} from './utils.mjs';
import {parseGpx,sampleComponents} from './gpx.mjs';
import {DEFAULTS,matchBothDirections,compareGeometry,uniqueObservedOrder} from './match.mjs';
import {publicDownload} from './network.mjs';
import {accessIssues,importantNode} from './sequence-review.mjs';
import {evidenceAge,DEFAULT_MAX_EVIDENCE_AGE_DAYS} from './evidence-age.mjs';
import {routeContext,compileClassicRoute,reverseClassicRoute} from '../../preview/js/classic-route.js';

export const BASE=resolve(ROOT,'data/route-validator');
export const WORK=resolve(ROOT,'.route-validator');
export const PILOTS=['R001','R015','R030','R066','R077','R031'];
const snapshotDefault=resolve(BASE,'snapshots/sheet-20261125-r026-walking.json');
const nonempty=v=>String(v??'').trim();
export function configAt(work=WORK) {
  const cfg={...DEFAULTS,maxEvidenceAgeDays:DEFAULT_MAX_EVIDENCE_AGE_DAYS,assessmentDate:new Date().toISOString().slice(0,10),...readJson(resolve(BASE,'config.json')),...(existsSync(resolve(work,'settings.json'))?readJson(resolve(work,'settings.json')):{})};
  evidenceAge({parsed:{date:cfg.assessmentDate}},cfg);
  for(const key of Object.keys(DEFAULTS))if(!Number.isFinite(cfg[key])||cfg[key]<=0)throw Error('設定不合法：'+key);
  for(const key of ['minIndependent','maxCandidates','maxChecks'])if(!Number.isInteger(cfg[key]))throw Error('設定必須為整數：'+key);
  if(cfg.nearMeters>cfg.reviewMeters||cfg.minIndependent<3)throw Error('近距離門檻不可大於待確認門檻；獨立證據至少三份');
  return cfg;
}
export function normalizeSnapshot(snapshot) {
  if(snapshot.schemaVersion!==1)throw Error('不支援的 Sheet 快照版本');
  const r=table(snapshot.sheets?.Routes_順序校核?.rows,['Route ID','經典登山路線名稱','使用該路線','類型']);
  const n=table(snapshot.sheets?.RouteNodes_順序校核?.rows,['Route ID','position','Node ID','節點名稱']);
  const routes=[],excluded=[],problems=[];const ids=new Set();
  for(const row of r) {
    const id=nonempty(row['Route ID']);if(!id)continue;
    if(!/^R\d{3}$/.test(id)){problems.push({code:'INVALID_ROUTE_ID',sheet:'Routes_順序校核',row:row.sheetRow,id});continue;}
    if(ids.has(id)){problems.push({code:'DUPLICATE_ROUTE_ID',routeId:id,row:row.sheetRow});continue;}ids.add(id);
    const enabled=nonempty(row['使用該路線']).toUpperCase();
    if(!['TRUE','FALSE'].includes(enabled))problems.push({code:'INVALID_ENABLED',routeId:id,row:row.sheetRow});
    const sourceNodes=n.filter(x=>nonempty(x['Route ID'])===id),occurrences=[];
    for(const item of sourceNodes) {
      const p=nonempty(item.position);
      if(!p){excluded.push({routeId:id,sheetRow:item.sheetRow,nodeId:nonempty(item['Node ID']),name:item['節點名稱'],reason:'position 空白；保留歷史，不納入序列',source:item});continue;}
      const position=Number(p);
      occurrences.push({position,nodeId:nonempty(item['Node ID']),name:nonempty(item['節點名稱']),key:['TRUE','是'].includes(nonempty(item['重要節點候選']).toUpperCase()),sheetRow:item.sheetRow,source:item});
    }
    occurrences.sort((a,b)=>a.position-b.position||a.sheetRow-b.sheetRow);
    routes.push({routeId:id,name:nonempty(row['經典登山路線名稱']),enabled:enabled==='TRUE',type:nonempty(row['類型']),row,occurrences});
  }
  for(const row of n)if(nonempty(row['Route ID'])&&!ids.has(nonempty(row['Route ID'])))problems.push({code:'ORPHAN_NODE_ROW',routeId:nonempty(row['Route ID']),row:row.sheetRow,nodeId:row['Node ID']});
  return {routes,excluded,problems};
}
export function loadSnapshot(work=WORK,path=null) {
  const file=path|| (existsSync(resolve(work,'snapshot.json'))?resolve(work,'snapshot.json'):snapshotDefault);
  const raw=readFileSync(file); const snapshot=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));
  return {snapshot,path:file,sha256:hash(raw),...normalizeSnapshot(snapshot)};
}
export function importCsv(routesCsv,nodesCsv,work=WORK) {
  const snapshot={schemaVersion:1,capturedAt:new Date().toISOString(),source:'使用者匯入兩份順序校核 CSV；不修改線上表',sheets:{Routes_順序校核:{rows:parseCsv(routesCsv)},RouteNodes_順序校核:{rows:parseCsv(nodesCsv)}}};
  table(snapshot.sheets.Routes_順序校核.rows,['順序校核狀態']);table(snapshot.sheets.RouteNodes_順序校核.rows,['路線名稱']);
  normalizeSnapshot(snapshot);writeJson(resolve(work,'snapshots/'+hash(snapshot)+'.json'),snapshot);writeJson(resolve(work,'snapshot.json'),snapshot);return snapshot;
}
export async function syncSheet(work=WORK) {
  const settings=readJson(resolve(BASE,'config.json')),sheets={};
  for(const [name,gid] of Object.entries(settings.sheetIds)) {
    const url=`https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/export?format=csv&gid=${gid}`;
    const response=await publicDownload(url,{maxBytes:8*1024*1024});
    const text=response.bytes.toString('utf8');if(/<html|<!doctype/i.test(text.slice(0,1000)))throw Error('Google Sheet 未提供公開 CSV，請使用兩份 CSV 匯入；原快照未變更');
    sheets[name]={sheetId:gid,sourceUrl:url,sha256:hash(response.bytes),rows:parseCsv(text)};
  }
  const snapshot={schemaVersion:1,capturedAt:new Date().toISOString(),spreadsheetId:settings.spreadsheetId,source:'公開 CSV 唯讀更新',sheets};
  normalizeSnapshot(snapshot);writeJson(resolve(work,'snapshots/'+hash(snapshot)+'.json'),snapshot);writeJson(resolve(work,'snapshot.json'),snapshot);return snapshot;
}
export function loadProject(root=ROOT,work=WORK) {
  const manifestPath=resolve(root,'preview/data/unified-editor-manifest.json'),manifest=readJson(manifestPath),inputs=[];
  const read=path=>{const b=readFileSync(path);inputs.push({path:relative(root,path).replaceAll('\\','/'),sha256:hash(b)});return JSON.parse(b);};
  const datasets=manifest.routes.map(m=>read(inside(resolve(root,'preview'),m.file.split('?')[0])));
  const geometry=read(resolve(root,'preview/data/geometry/planner-terrain-v1.json'));
  const catalogPath=resolve(root,'data/staging/idea002/classic-routes.candidate.json');
  const catalog=existsSync(catalogPath)?read(catalogPath):null;
  const decisionsPath=resolve(root,'data/staging/idea002/decisions-20261120.json'),decisions=existsSync(decisionsPath)?read(decisionsPath):null;
  const graph={nodes:[...new Map(datasets.flatMap(d=>d.nodes.map(n=>[n.id,n]))).values()],segments:datasets.filter(d=>d.routingEnabled!==false).flatMap(d=>d.segments),manualConnections:datasets.filter(d=>d.routingEnabled!==false).flatMap(d=>d.manualConnections||[])};
  const transport=read(resolve(root,'data/transport-owner-reviewed.json'));
  const authorityPath=existsSync(resolve(work,'node-authority.json'))?resolve(work,'node-authority.json'):resolve(root,'data/route-validator/snapshots/node-authority-order-20261125.json');
  const authority=read(authorityPath),authorityRows=table(authority.rows,['Node ID','節點名','相鄰 Node ID','來源 ID']);
  const nodeAuthority=new Map();
  for(const row of authorityRows){const id=nonempty(row['Node ID']);if(!id)continue;if(nodeAuthority.has(id))throw Error('原始節點表有重複 Node ID：'+id);nodeAuthority.set(id,{nodeId:id,name:row['節點名'],aliases:String(row['別名／其他圖名稱']||'').split(/[；;]/).filter(Boolean),neighborIds:String(row['相鄰 Node ID']||'').split(/[；;]/).filter(Boolean),sourceIds:String(row['來源 ID']||'').split(/[；;]/).filter(Boolean),fingerprint:row['基底指紋'],sheetRow:row.sheetRow});}
  graph.vehicleSegments=transport.segments.filter(s=>s.travelMode==='vehicle'&&s.verificationStatus==='verified');
  inputs.push({path:relative(root,manifestPath).replaceAll('\\','/'),sha256:hash(readFileSync(manifestPath))});
  const nodes=new Map(graph.nodes.map(n=>[n.id,n])),coordinates=new Map(geometry.nodes.map(n=>[n.nodeId,n]));
  return {graph,geometry,catalog,decisions,nodes,coordinates,nodeAuthority,authoritySource:{spreadsheetId:authority.spreadsheetId,sheetId:authority.sheetId,sheet:authority.sheet,path:relative(root,authorityPath).replaceAll('\\','/'),sha256:hash(readFileSync(authorityPath))},inputs,digest:hash(inputs),source:'Node ID 以使用者指定原始節點總表為基準；路網採目前 Preview 工作樹，逐檔雜湊鎖定，非新增官方核實'};
}
function contextFor(route,project) {
  const graph={...project.graph,manualConnections:[...project.graph.manualConnections],vehicleSegments:[...project.graph.vehicleSegments]};
  const geometry={...project.geometry,spans:[...project.geometry.spans]};
  // Only route-scoped, previously documented supplements. Never apply to all routes.
  if(route.routeId==='R057'&&project.catalog?.supplement){graph.manualConnections.push(...project.catalog.supplement.edges);geometry.spans.push(...project.catalog.supplement.spans);}
  if(route.routeId==='R069'&&project.catalog?.supplement){graph.segments=[...graph.segments,...(project.catalog.supplement.walkingSegments||[])];geometry.spans.push(...project.catalog.supplement.spans.filter(s=>s.id.startsWith('classic-R069-')));}
  if(['R026','R052'].includes(route.routeId)&&project.catalog?.supplement?.vehicleSegments)graph.vehicleSegments.push(...project.catalog.supplement.vehicleSegments);
  const context=routeContext(graph,geometry,project.digest);context.excludedNodeIds=project.decisions?.excludedNodeIds?.[route.routeId]||[];
  return {context,geometry};
}
export function collectReferences(normalized) {
  const byUrl=new Map();
  for(const r of normalized.routes)for(const url of String(r.row['外部行程／GPX 參考']||'').match(/https?:\/\/[^\s<>"']+/g)||[]) {
    const prior=byUrl.get(url)||{url,routeIds:[],role:/gpx_detail/.test(url)?'gpx-page':'web-reference',retrievalStatus:'not-downloaded',notice:'Sheet 提供的研究線索；網頁文字不算軌跡驗證'};
    if(!prior.routeIds.includes(r.routeId))prior.routeIds.push(r.routeId);byUrl.set(url,prior);
  }
  return [...byUrl.values()];
}
export function libraryIndex(work=WORK) {
  const seed=existsSync(resolve(BASE,'sources.json'))?readJson(resolve(BASE,'sources.json')):{sources:[]};
  const own=existsSync(resolve(work,'sources.json'))?readJson(resolve(work,'sources.json')):{sources:[]};
  return {schemaVersion:1,sources:[...seed.sources,...own.sources]};
}
export function registerGpx(bytes,metadata={},work=WORK) {
  const parsed=parseGpx(bytes),id='gpx-'+parsed.sha256.slice(0,16),indexPath=resolve(work,'sources.json');
  const index=existsSync(indexPath)?readJson(indexPath):{schemaVersion:1,sources:[]};
  const existing=index.sources.find(s=>s.sha256===parsed.sha256);
  const sourceRecords=[...(existing?.sourceRecords||[])];
  for(const record of [existing,metadata])if(record?.sourceUrl){
    const provenance={sourceUrl:record.sourceUrl,author:record.author||'',authorProfile:record.authorProfile||'',recordingId:record.recordingId||''};
    if(!sourceRecords.some(r=>r.sourceUrl===provenance.sourceUrl&&r.authorProfile===provenance.authorProfile))sourceRecords.push(provenance);
  }
  const routeIds=[...new Set([...(existing?.routeIds||[]),...(metadata.routeIds||[])])];
  if(routeIds.some(id=>!/^R\d{3}$/.test(id)))throw Error('路線編號格式應為 R001');
  const entry={...existing,...metadata,id,routeIds,sourceRecords,file:'gpx/'+parsed.sha256+'.gpx',sha256:parsed.sha256,
    author:nonempty(metadata.author||existing?.author),sourceUrl:nonempty(metadata.sourceUrl||existing?.sourceUrl),
    variant:nonempty(metadata.variant||existing?.variant)||'unclassified',scope:metadata.scope||existing?.scope||'unknown',travelMode:metadata.travelMode||existing?.travelMode||'unknown',
    acquiredAt:existing?.acquiredAt||new Date().toISOString(),usage:metadata.usage||existing?.usage||'來源使用限制待確認；不公開散布',observedDate:parsed.date,label:parsed.label};
  const file=inside(work,entry.file);if(!existsSync(file))atomicWrite(file,bytes);
  const at=index.sources.findIndex(s=>s.id===id);if(at<0)index.sources.push(entry);else index.sources[at]=entry;
  writeJson(indexPath,index);return {...entry,summary:parsed.summary,warnings:parsed.warnings};
}
export async function downloadGpx(url,metadata={},work=WORK) {
  let downloadUrl=url;const u=new URL(url);
  if(['hiking.biji.co','www.hiking.biji.co','tw.hiking.biji.co'].includes(u.hostname)&&u.searchParams.get('act')==='gpx_detail') {u.searchParams.set('act','download_gpx');downloadUrl=u.href;}
  const response=await publicDownload(downloadUrl);
  return registerGpx(response.bytes,{...metadata,sourceUrl:metadata.sourceUrl||url,downloadUrl,downloadFinalUrl:response.url},work);
}
export function loadLibrary(work=WORK,cfg=DEFAULTS) {
  const entries=[],errors=[];
  for(const source of libraryIndex(work).sources) {
    try {
      const file=source.projectFile?inside(ROOT,source.projectFile):inside(work,source.file);
      const bytes=readFileSync(file),sha=hash(bytes);
      if(source.sha256&&source.sha256!==sha)throw Error('GPX 雜湊與來源索引不同，必須重新確認檔案版本');
      const cache=resolve(work,'cache/gpx/'+sha+'-'+hash({parser:hash(readFileSync(resolve(ROOT,'tools/route-validator/gpx.mjs'))),maxGap:cfg.maxGapMeters}).slice(0,16)+'.json');
      const cached=readCache(cache),parsed=cached?.sha256===sha?cached:parseGpx(bytes,{maxGapMeters:cfg.maxGapMeters});
      if(parsed!==cached)writeCache(cache,parsed);
      entries.push({...source,sha256:sha,parsed});
    }catch(error){errors.push({sourceId:source.id,routeIds:source.routeIds||[],code:'INVALID_GPX_SOURCE',message:error.message});}
  }
  return {entries,errors};
}
export function evidenceGroups(entries) {
  const parent=entries.map((_,i)=>i),find=i=>parent[i]===i?i:parent[i]=find(parent[i]);
  const uncertain=new Set();
  const identities=entry=>new Set([entry,...(entry.sourceRecords||[])].flatMap(record=>[
    nonempty(record.author)?'author:'+nonempty(record.author).toLowerCase():null,
    record.authorProfile?'profile:'+record.authorProfile:null,
    record.recordingId?'recording:'+record.recordingId:null,
    record.tripId?'trip:'+record.tripId:null,
  ]).filter(Boolean));
  const identitySets=entries.map(identities);
  for(let i=0;i<entries.length;i++)for(let j=0;j<i;j++) {
    const a=entries[i],b=entries[j],sameAuthor=[...identitySets[i]].some(key=>identitySets[j].has(key));
    const sourceId=s=>{try {const u=new URL(s.sourceUrl);return u.hostname.replace(/^(www|tw)\./,'')==='hiking.biji.co'&&u.searchParams.get('id')?'biji:'+u.searchParams.get('id'):s.sourceUrl;}catch{return null;}};
    let same= a.sha256===b.sha256||a.parsed.shapeHash===b.parsed.shapeHash||sameAuthor||a.recordingId&&a.recordingId===b.recordingId||sourceId(a)&&sourceId(a)===sourceId(b);
    // Conservative near-copy detection; same path is not proof of independence.
    if(!same&&Math.abs(a.parsed.summary.distanceMeters-b.parsed.summary.distanceMeters)<Math.max(20,a.parsed.summary.distanceMeters*.01)) {
      try{const ac=sampleComponents(a.parsed.components,200),bc=sampleComponents(b.parsed.components,200);
        const flatA=ac.flat(),flatB=bc.flat();
        if(flatA.length===flatB.length&&flatA.every((p,k)=>meters(p,flatB[k])<=8)||flatA.length===flatB.length&&flatA.every((p,k)=>meters(p,flatB.at(-k-1))<=8))same=true;
      }catch{uncertain.add(i);uncertain.add(j);}
    }
    if(same)parent[find(i)]=find(j);
  }
  return entries.map((s,i)=>{let validUrl=false;try{const u=new URL(s.sourceUrl);validUrl=u.protocol==='https:'&&!u.username&&!u.password&&u.hostname!=='localhost';}catch{}const author=nonempty(s.author),identified=!!author&&!/^(unknown|未知|不明|不知道|匿名)$/i.test(author);return {sourceId:s.id,group:'evidence-'+find(i),eligible:identified&&validUrl&&!uncertain.has(i),eligibilityReason:uncertain.has(i)?'來源獨立性檢查超出計算上限':!identified||!validUrl?'缺少可識別作者或 HTTPS 來源':''};});
}

const labels={MISSING_EDGE:'缺少精確方向路段',MISSING_TIME:'缺少方向時間',MISSING_GEOMETRY:'缺少來源線形',AMBIGUOUS_GEOMETRY:'來源線形有多個選項',UNKNOWN_NODE:'Node ID 不在目前路網',MISSING_COORDINATE:'節點缺少座標',SUSPECT_SEQUENCE:'疑似順序差異',SUSPECT_GEOMETRY:'軌跡與來源線形不同',INCOMPLETE_ROUTE:'路線或軌跡不完整',INSUFFICIENT_GPX:'獨立 GPX 證據不足',MANUAL_REVIEW:'需要補充來源或決策',VALID_VARIANT:'可能為合理變體',SOURCE_DIFFERENCE:'最新 Sheet 與本機候選不同',INVALID_POSITION:'position 格式錯誤',DUPLICATE_POSITION:'position 重複',NAME_DIFFERENCE:'名稱與 Node ID 對照有差異',UNEXPANDED:'尚未展開',INVALID_GPX_SOURCE:'GPX 檔案或來源有問題'};
export function makeIssue(route,code,detail={},severity='review') {
  const ids=detail.nodeIds||detail.occurrences?.map(o=>o.nodeId)||[];
  return {id:'RV-'+hash([route.routeId,code,detail.positions||[],ids,detail.sourceId||'',detail.message||'']).slice(0,12),routeId:route.routeId,routeName:route.name,code,title:labels[code]||code,severity,
    message:detail.message||'',positions:detail.positions||[],nodeIds:ids,details:detail,
    suggestion:detail.suggestion||'保留候選資料；補足對應來源後重跑，不自動補線或修改 Node ID。',
    options:detail.options||['保留目前候選，補充證據','依有來源的修正方案另行確認'],requiresDecision:severity==='review'||severity==='error'};
}
function sourceLineage(entry,geometry) {
  return geometry.spans.some(s=>entry.sha256&&(s.sourceFileSha256===entry.sha256||s.sourceFileHash===entry.sha256)||entry.sourceUrl&&s.sourceUrl===entry.sourceUrl);
}
function sliceTrack(components,start,end) {
  if(start.component!==end.component)return [];
  const s=components[start.component];if(!s)return [];
  const points=[{coordinate:start.coordinate},...s.slice(start.edge+1,end.edge+1),{coordinate:end.coordinate}];
  return [points];
}
function expectedGeometry(route,context,geometry) {
  const input={routeId:route.routeId,name:route.name,type:({'往返':'out_and_back','縱走':'traverse','環狀':'loop','環線':'loop','多段行程':'multi_segment'})[route.type]||'traverse',anchors:route.occurrences.map(o=>({nodeId:o.nodeId,key:o.key})),excludedNodeIds:context.excludedNodeIds||[],expandAnchors:false,source:{baseCommit:'working-tree',snapshotSha256:'audit-only',decisionRef:'latest-order-review-sheet',...(route.type==='多段行程'?{multimodalRef:'audit-mixed-mode'}:{})}};
  const compiled=compileClassicRoute(input,context),spans=new Map(geometry.spans.map(s=>[s.id,s]));
  return {compiled,bindings:compiled.geometryBindings.map(b=>({...b,span:spans.get(b.spanId)}))};
}
export function auditRoute(route,project,library,cfg=DEFAULTS) {
  const issues=[],add=(code,detail,severity)=>issues.push(makeIssue(route,code,detail,severity));
  const observations=[],observe=(code,detail)=>observations.push(makeIssue(route,code,detail,'evidence'));
  const occurrences=route.occurrences.map(o=>({...o,coordinate:project.coordinates.get(o.nodeId)?.coordinate||null}));
  const result={routeId:route.routeId,name:route.name,enabled:route.enabled,type:route.type,validNodes:occurrences.length,issues,observations,sequenceStatus:'NOT_CHECKED',geometryStatus:'NOT_CHECKED',timeStatus:'NOT_CHECKED',evidenceStatus:'INSUFFICIENT_GPX',sources:[],variants:[],independentSupporting:0,independentOpposing:0,matchedNodes:0,eligibleForImport:false,formalImportStatus:'未執行正式匯入；候選不自動升級 verified',proposal:{before:occurrences.map(o=>({position:o.position,nodeId:o.nodeId})),after:null,changes:[],requiresConfirmation:true}};
  if(!occurrences.length){add('UNEXPANDED',{message:route.enabled?'此路線已選用但尚無有效節點；不自動生成。':'未選用且無有效節點，獨立列出，不列通過統計。'},route.enabled?'review':'info');return {...result,status:'UNEXPANDED',evidenceStatus:'NOT_APPLICABLE'};}
  for(const issue of accessIssues(occurrences.map(o=>o.nodeId)))add('SUSPECT_SEQUENCE',{positions:[issue.position,issue.neighborPosition],nodeIds:[issue.nodeId,issue.neighbor],message:issue.reason,rule:issue.rule,suggestion:'依已確認的登頂口往返；不能因目前圖上仍有連線而通過。'},'error');
  const missingImportant=occurrences.filter(o=>!o.key&&importantNode(project.nodes.get(o.nodeId),o.source?.['點位類型']));
  if(missingImportant.length)add('MISSING_IMPORTANCE',{positions:missingImportant.map(o=>o.position),nodeIds:missingImportant.map(o=>o.nodeId),message:'已行經的山頭、山屋或營地未標為重要節點；不增加未選登支線。',suggestion:'將這些有效列的「重要節點候選」設為 TRUE，主要山峰欄仍只記山峰。'},'data');
  const validPositions=occurrences.every(o=>Number.isInteger(o.position)&&o.position>=1);
  const validType=['往返','縱走','環狀','環線','多段行程'].includes(route.type);
  if(!validType)add('MANUAL_REVIEW',{message:'不支援或缺少路線類型：'+route.type+'；不自行假定為縱走。'},'error');
  if(!validPositions)add('INVALID_POSITION',{message:'position 必須為正整數。',positions:occurrences.filter(o=>!Number.isInteger(o.position)||o.position<1).map(o=>o.position)},'error');
  const counts=new Map();for(const o of occurrences)counts.set(o.position,(counts.get(o.position)||0)+1);
  const dup=[...counts].filter(([,n])=>n>1).map(([p])=>p);if(dup.length)add('DUPLICATE_POSITION',{positions:dup,message:'不自行選取重複 position 的其中一列。'},'error');
  for(const o of occurrences) {
    const authority=project.nodeAuthority?.get(o.nodeId);
    if(project.nodeAuthority&&!authority)add('MANUAL_REVIEW',{positions:[o.position],nodeIds:[o.nodeId],message:'此 Node ID 不在使用者指定的原始節點表；不得依同名自動改配，請補原始對照。'},'error');
    else if(authority&&project.nodes.has(o.nodeId)){
      const local=project.nodes.get(o.nodeId);
      if(local.name!==authority.name&&!authority.aliases.includes(local.name)&&!local.aliases?.includes(authority.name))add('MANUAL_REVIEW',{positions:[o.position],nodeIds:[o.nodeId],message:`原始節點表 ${authority.name} 與本機主名 ${local.name} 有衝突，保留差異，不擅自重編 ID。`,authorityRow:authority.sheetRow,authoritySource:project.authoritySource},'error');
    }
    if(!project.nodes.has(o.nodeId))add('UNKNOWN_NODE',{positions:[o.position],nodeIds:[o.nodeId],message:`${o.name}：保留來源 ID，不依同名或鄰近座標改配。`},'error');
    else {
      const n=project.nodes.get(o.nodeId),knownNames=[n.name,...(n.aliases||[]),...(n.legacyAliases||[])];
      if(o.name&&!knownNames.includes(o.name)){
        const candidates=[...project.nodes.values()].filter(v=>[v.name,...(v.aliases||[])].includes(o.name)).map(v=>({nodeId:v.id,name:v.name,coordinate:project.coordinates.get(v.id)?.coordinate||null,identityStatus:'僅同名候選；未依來源確認同一實體'}));
        add('NAME_DIFFERENCE',{positions:[o.position],nodeIds:[o.nodeId],message:`Sheet：${o.name}；目前 Node ID 主名：${n.name}。名稱差異不表示實體已核實或可合併。`,candidates,suggestion:candidates.length?'可核對的既有候選：'+candidates.map(v=>v.nodeId+' '+v.name).join('、')+'；需核對來源角色及相鄰路段，不能只靠同名替換。':'核對來源 Node ID 與實體角色；不依名稱推定或建立新 ID。'});
        result.proposal.changes.push({type:'NODE_ID_CANDIDATES',position:o.position,beforeNodeId:o.nodeId,candidates,reason:'Sheet 名稱與本機 ID 的主名及別名不符',requiresConfirmation:true});
      }
      if(!coordinateValid(o.coordinate)&&project.coordinates.get(o.nodeId)?.coordinatePolicy!=='vehicle-only')add('MISSING_COORDINATE',{positions:[o.position],nodeIds:[o.nodeId],message:o.name});
    }
  }
  if(occurrences.length<2)add('INCOMPLETE_ROUTE',{message:'有效節點少於兩個，不能進行路線驗證。'},'error');
  const completenessNotes=Object.values(route.row).filter(v=>typeof v==='string'&&/目前僅核心片段|僅核心片段|起終點不完整|缺少進出段/.test(v));
  if(completenessNotes.length)add('INCOMPLETE_ROUTE',{message:'Sheet 已明列完整性缺口：'+completenessNotes.join('；'),source:'Routes_順序校核 第 '+route.row.sheetRow+' 列',suggestion:'先保留核心片段；補齊有來源的步行進出段後，才評估完整路線通過。'});
  const expectedCount=Number(route.row['實際有效節點數']);if(nonempty(route.row['實際有效節點數'])&&expectedCount!==occurrences.length)add('MANUAL_REVIEW',{message:`Routes 記載 ${route.row['實際有效節點數']} 個有效節點，實際讀得 ${occurrences.length} 個。`});
  const catalog=project.catalog?.routes.find(r=>r.routeId===route.routeId)?.forward;
  const priorRoute=project.catalog?.routes.find(r=>r.routeId===route.routeId);
  const knownManualPairs=new Set([priorRoute?.forward,priorRoute?.reverse].filter(Boolean).flatMap(r=>r.directedSegments.filter(s=>s.timeStatus==='manual-required'&&['vehicle','owner-manual'].includes(s.edgeRef.kind)).map(s=>JSON.stringify([s.edgeRef.fromId,s.edgeRef.toId,s.edgeRef.kind]))));
  if(!catalog||JSON.stringify(catalog.occurrences.map(o=>o.nodeId))!==JSON.stringify(occurrences.map(o=>o.nodeId)))add('SOURCE_DIFFERENCE',{message:catalog?`本機候選 ${catalog.occurrences.length} 次經過；最新 Sheet ${occurrences.length} 次。尚未同步，不代表 Sheet 有錯。`:'最新路線尚未存在於本機候選。',beforeNodeIds:catalog?.occurrences.map(o=>o.nodeId)||[],afterNodeIds:occurrences.map(o=>o.nodeId)},'info');
  if(route.routeId==='R001'&&[occurrences[0],occurrences.at(-1)].some(o=>o.nodeId!=='g02-004'))add('INCOMPLETE_ROUTE',{message:'使用者指定上東埔停車場 g02-004 為步行起終點；不以接駁軌跡刪除步行段。'},'error');
  const excludedByDecision=project.decisions?.excludedNodeIds?.[route.routeId]||[];
  for(const o of occurrences)if(excludedByDecision.includes(o.nodeId))add('MANUAL_REVIEW',{positions:[o.position],nodeIds:[o.nodeId],message:'最新 Sheet 與既有使用者明確排除決策有衝突；保留來源差異，未自行改序列或重新帶入線形。',decisionRef:'data/staging/idea002/decisions-20261120.json'},'error');
  const adjacent=occurrences.flatMap((o,i)=>i&&o.nodeId===occurrences[i-1].nodeId?[i]:[]);
  for(const i of adjacent)add('MANUAL_REVIEW',{positions:[occurrences[i-1].position,occurrences[i].position],nodeIds:[occurrences[i].nodeId],message:'相鄰兩列為相同 Node ID；如為實際小環線，需明確路段／線形，不能以重複點代替。'},'error');
  const structuralFatal=!validType||!validPositions||dup.length||adjacent.length||occurrences.length<2||occurrences.some(o=>!project.nodes.has(o.nodeId));
  let expected=null,context=null,geometry=project.geometry;
  if(!structuralFatal) {
    try {
      ({context,geometry}=contextFor(route,project));expected=expectedGeometry(route,context,geometry);
      for(const issue of expected.compiled.issues) {
        const from=issue.fromPosition??issue.fromAnchor,to=issue.toPosition??issue.toAnchor;
        const code=['MISSING_DIRECTION','NO_CONSTRAINED_PATH'].includes(issue.code)?'MISSING_EDGE':issue.code==='MISSING_GEOMETRY'?'MISSING_GEOMETRY':issue.code==='AMBIGUOUS_GEOMETRY'?'AMBIGUOUS_GEOMETRY':'MANUAL_REVIEW';
        if(issues.some(i=>i.code===code&&i.positions[0]===occurrences[from]?.position))continue;
        add(code,{positions:[occurrences[from]?.position,occurrences[to]?.position].filter(v=>v!==undefined),nodeIds:[occurrences[from]?.nodeId,occurrences[to]?.nodeId].filter(Boolean),message:`${occurrences[from]?.name||''} → ${occurrences[to]?.name||''}：${issue.code}；未改走最短路或直線。`,sourceCode:issue.code});
      }
      expected.compiled.directedSegments.forEach((s,i)=>{
        const known=knownManualPairs.has(JSON.stringify([s.edgeRef.fromId,s.edgeRef.toId,s.edgeRef.kind]));
        if(s.timeStatus!=='source-reference')add('MISSING_TIME',{positions:[occurrences[i].position,occurrences[i+1].position],nodeIds:[occurrences[i].nodeId,occurrences[i+1].nodeId],knownManualPolicy:known,message:`${occurrences[i].name} → ${occurrences[i+1].name}：${known?'沿用已確認手填時間政策；':'來源分鐘缺漏；'}分鐘保留未知，不借反向或 GPX 時間。`},known?'data':'review');
      });
      const conflicts=[];
      if(['縱走','環狀','環線'].includes(route.type)){
        const reverse=reverseClassicRoute(expected.compiled,context);
        reverse.directedSegments.forEach((s,i)=>{if(s.timeStatus!=='source-reference'){
          const from=occurrences[occurrences.length-1-i],to=occurrences[occurrences.length-2-i];
          const known=knownManualPairs.has(JSON.stringify([s.edgeRef.fromId,s.edgeRef.toId,s.edgeRef.kind]));
          add('MISSING_TIME',{positions:[from.position,to.position],nodeIds:[from.nodeId,to.nodeId],direction:'reverse',knownManualPolicy:known,message:`反向 ${from.name} → ${to.name}：${known?'沿用已確認手填時間政策，仍無來源分鐘':'缺少來源分鐘'}，不借順向時間。`},known?'data':'review');
        }});
        for(const issue of reverse.issues.filter(i=>['MISSING_GEOMETRY','AMBIGUOUS_GEOMETRY','REVERSE_GEOMETRY_REVIEW_REQUIRED'].includes(i.code))){
          const a=occurrences[occurrences.length-1-issue.fromPosition],b=occurrences[occurrences.length-1-issue.toPosition];
          add(issue.code==='MISSING_GEOMETRY'?'MISSING_GEOMETRY':'AMBIGUOUS_GEOMETRY',{positions:[a?.position,b?.position],nodeIds:[a?.nodeId,b?.nodeId],direction:'reverse',message:`反向線形：${a?.name} → ${b?.name}；${issue.code}。`});
        }
      }
      for(let i=1;i<occurrences.length;i++){
        const a=occurrences[i-1],b=occurrences[i];
        const edge=project.graph.segments.filter(e=>e.fromId===a.nodeId&&e.toId===b.nodeId&&e.routingEnabled!==false&&e.travelMode==='walking');
        if(new Set(edge.map(e=>e.minutes)).size>1)conflicts.push([a.position,b.position]);
      }
      if(conflicts.length)add('MANUAL_REVIEW',{message:'同一有向路段有不同來源分鐘，未自動選一筆。',conflicts});
      result.timeStatus=issues.some(i=>['MISSING_TIME','MISSING_EDGE'].includes(i.code))?'MISSING_TIME':'SOURCE_REFERENCE_COMPLETE';
    }catch(error){add('MANUAL_REVIEW',{message:'既有路網契約阻擋：'+error.message},'error');}
  }
  const entries=library.entries.filter(s=>s.routeIds?.includes(route.routeId)),groups=evidenceGroups(entries),support=new Set(),oppose=new Set(),geometrySupport=new Set();
  for(const error of library.errors.filter(e=>e.routeIds.includes(route.routeId)))add('INVALID_GPX_SOURCE',{...error,message:error.message},'error');
  for(const entry of entries) {
    const group=groups.find(g=>g.sourceId===entry.id),source={id:entry.id,url:entry.sourceUrl,author:entry.author||'',group:group.group,scope:entry.scope,variant:entry.variant,summary:entry.parsed.summary,warnings:entry.parsed.warnings,sha256:entry.sha256,qualityReasons:[]};
    source.recency=evidenceAge(entry,cfg);if(!source.recency.eligible)source.qualityReasons.push(source.recency.reason);
    result.sources.push(source);
    if(!group.eligible)source.qualityReasons.push(group.eligibilityReason+'；不計獨立證據');
    if(entry.scope!=='complete')source.qualityReasons.push('未確認完整路線覆蓋');
    if(entry.variant!=='defined-route')source.qualityReasons.push('尚未歸入指定走法；保留變體');
    if(entry.travelMode!=='walking')source.qualityReasons.push('尚未確認為步行軌跡');
    if(entry.parsed.warnings.length)source.qualityReasons.push('軌跡有中斷／時間／速度疑點');
    if(sourceLineage(entry,geometry))source.qualityReasons.push('同一 GPX 已用於路網線形；不能作為獨立外部核對');
    if(structuralFatal)continue;
    try {
      const matched=matchBothDirections(occurrences,entry.parsed.components,cfg);source.match=matched;result.matchedNodes=Math.max(result.matchedNodes,matched.matched);
      if(matched.truncated)source.qualityReasons.push('候選位置超出上限；未完整探索');
      if(matched.ambiguousPositions.length)source.qualityReasons.push('存在多個符合順序的位置，無法唯一定位經過里程');
      if(occurrences.some((o,i)=>i&&o.nodeId!==occurrences[i-1].nodeId&&coordinateValid(o.coordinate)&&coordinateValid(occurrences[i-1].coordinate)&&meters(o.coordinate,occurrences[i-1].coordinate)<cfg.nearMeters*2))source.qualityReasons.push('相鄰不同節點的容差範圍重疊，距離不足以唯一證明先後');
      if(matched.segmentCrossings)source.qualityReasons.push('匹配跨越分離軌跡；未補線');
      if(!matched.endpointComplete)source.qualityReasons.push('未涵蓋指定步行首尾，或有額外進出段');
      if(matched.maxOffsetMeters>cfg.nearMeters)source.qualityReasons.push('部分節點只在待確認距離帶');
      if(matched.directionAmbiguous&&['縱走','環狀','環線'].includes(route.type))source.qualityReasons.push('順逆方向無法唯一判定');
      const complete=matched.matched===matched.total;
      const qualified=source.qualityReasons.length===0;
      if(complete&&qualified)support.add(group.group);
      if(!complete&&source.recency.eligible&&group.eligible&&entry.scope==='complete'&&entry.variant==='defined-route'&&entry.travelMode==='walking'&&!entry.parsed.warnings.length)oppose.add(group.group);
      if(entry.variant&&entry.variant!=='defined-route')result.variants.push({sourceId:entry.id,variant:entry.variant,status:'MANUAL_REVIEW',reason:'先保留不同走法，未自動視為錯誤'});
      if(entry.scope==='complete'&&entry.variant==='defined-route'&&matched.unmatchedButNearby.length)observe('SUSPECT_SEQUENCE',{sourceId:entry.id,sourceUrl:entry.sourceUrl,positions:matched.unmatchedButNearby.map(i=>occurrences[i].position),nodeIds:matched.unmatchedButNearby.map(i=>occurrences[i].nodeId),message:'節點在軌跡附近，但無法全部依目前順序匹配；可能是錯序、折返差異或不同變體。',matchingPositions:matched.matches.map((p,i)=>p?{position:occurrences[i].position,alongMeters:round(p.along)}:null).filter(Boolean)});
      else if(entry.scope==='complete'&&entry.variant==='defined-route'&&matched.missing.length)observe('MANUAL_REVIEW',{sourceId:entry.id,sourceUrl:entry.sourceUrl,positions:matched.missing.map(i=>occurrences[i].position),nodeIds:matched.missing.map(i=>occurrences[i].nodeId),message:'此來源未匹配部分節點；不直接判為多餘節點，需區分缺軌、座標或變體。'});
      const oriented=matched.direction==='reverse'?entry.parsed.components.slice().reverse().map(s=>s.slice().reverse()):entry.parsed.components;
      const shapeResults=[];
      for(const binding of expected?.bindings||[]) {
        const start=matched.matches[binding.fromPosition],end=matched.matches[binding.toPosition];if(!start||!end)continue;
        const part=sliceTrack(oriented,start,end);if(!part.length)continue;
        const coords=binding.reverse?binding.span.coordinates.slice().reverse():binding.span.coordinates;
        const check=compareGeometry(coords,part,cfg);
        shapeResults.push({fromPosition:occurrences[binding.fromPosition].position,toPosition:occurrences[binding.toPosition].position,spanId:binding.spanId,...check});
        if(!check.withinTolerance)observe('SUSPECT_GEOMETRY',{sourceId:entry.id,sourceUrl:entry.sourceUrl,positions:[occurrences[binding.fromPosition].position,occurrences[binding.toPosition].position],nodeIds:[occurrences[binding.fromPosition].nodeId,occurrences[binding.toPosition].nodeId],message:`${occurrences[binding.fromPosition].name} → ${occurrences[binding.toPosition].name}：線形偏差或行走長度差異超出門檻；可能包含變體、額外折返、標示端點偏移或錯線。`,spanId:binding.spanId,comparison:check});
      }
      source.geometry=shapeResults;
      if(complete&&qualified&&expected&&shapeResults.length===expected.bindings.length&&shapeResults.length&&shapeResults.every(r=>r.withinTolerance)&&!issues.some(i=>['MISSING_GEOMETRY','AMBIGUOUS_GEOMETRY'].includes(i.code)))geometrySupport.add(group.group);
      source.status=complete&&qualified?'SUPPORTS_SEQUENCE':complete?'MATCHED_WITH_LIMITATIONS':'DIFFERENCE';
    }catch(error){source.qualityReasons.push(error.message);add('MANUAL_REVIEW',{sourceId:entry.id,message:'匹配未完成：'+error.message});}
  }
  // A noisy recording or another variant must not flood the action list.
  // Promote only corroborated differences from independent, same-variant,
  // complete records without spatial/vehicle/discontinuity quality warnings.
  const differences=new Map();
  for(const observation of observations){
    const entry=entries.find(s=>s.id===observation.details.sourceId),s=result.sources.find(s=>s.id===observation.details.sourceId),group=groups.find(g=>g.sourceId===entry?.id);
    if(!entry||!group?.eligible||!s.recency?.eligible||entry.scope!=='complete'||entry.variant!=='defined-route'||entry.travelMode!=='walking'||entry.parsed.warnings.length||!s.match?.endpointComplete||s.match?.truncated||s.match?.segmentCrossings)continue;
    const key=hash([observation.code,observation.nodeIds]);if(!differences.has(key))differences.set(key,[]);differences.get(key).push({observation,group:group.group});
  }
  for(const values of differences.values())if(new Set(values.map(v=>v.group)).size>=2){const first=values[0].observation;add(first.code,{...first.details,message:first.message+' 至少兩組獨立同走法來源有相同差異；仍須區分座標與路線意圖。',independentSources:new Set(values.map(v=>v.group)).size,evidenceSourceIds:[...new Set(values.map(v=>v.observation.details.sourceId))]});}
  result.sourceDifferenceCount=observations.length;
  const completeSources=result.sources.filter(s=>s.scope==='complete'&&s.match&&s.recency?.eligible),completeGroups=new Set(completeSources.map(s=>s.group));
  result.commonUnmatched=completeGroups.size<3?[]:occurrences.flatMap((o,i)=>{
    const absent=completeSources.filter(s=>!s.match.matches[i]),groupsMissing=new Set(absent.map(s=>s.group));
    if(groupsMissing.size!==completeGroups.size)return [];
    return [{position:o.position,nodeId:o.nodeId,name:o.name,independentSourceGroups:groupsMissing.size,sourceIds:absent.map(s=>s.id),kind:i===0||i===occurrences.length-1?'reference-endpoint-gap':'common-unmatched-interior',meaning:'多來源未匹配的具體位置；可能是進出方式、變體、座標／角色或軌跡缺漏，不自動刪點。'}];
  });
  if(observations.length)add('MANUAL_REVIEW',{message:`${result.sources.length} 份來源共有 ${observations.length} 個局部差異訊號，保存在證據明細；不足以直接判定候選走法錯誤，未逐項要求人工修改。`,observationCount:observations.length},'data');
  const unresolvedSameVariantDifferences=[...differences.values()].some(values=>values.length);
  const reorderOptions=new Map();
  if(context&&!structuralFatal&&new Set(occurrences.map(o=>o.nodeId)).size===occurrences.length)for(const entry of entries){
    const group=groups.find(g=>g.sourceId===entry.id),s=result.sources.find(s=>s.id===entry.id);
    if(!group?.eligible||!s.recency?.eligible||entry.scope!=='complete'||entry.variant!=='defined-route'||entry.travelMode!=='walking'||entry.parsed.warnings.length||sourceLineage(entry,geometry)||!s.match?.endpointComplete)continue;
    try {
      const oriented=s.match.direction==='reverse'?entry.parsed.components.slice().reverse().map(p=>p.slice().reverse()):entry.parsed.components;
      const order=uniqueObservedOrder(occurrences,oriented,cfg);if(!order||order.every((id,i)=>id===occurrences[i].nodeId))continue;
      const proposed={...route,occurrences:order.map((id,i)=>({...occurrences.find(o=>o.nodeId===id),position:i+1}))};
      const checked=expectedGeometry(proposed,context,geometry);if(checked.compiled.issues.length||checked.compiled.directedSegments.some(e=>e.timeStatus!=='source-reference'))continue;
      const matches=matchBothDirections(proposed.occurrences,oriented,cfg);
      if(matches.matched!==order.length||matches.direction!=='forward'||matches.ambiguousPositions.length||matches.segmentCrossings||!matches.endpointComplete||matches.maxOffsetMeters>cfg.nearMeters)continue;
      if(!checked.bindings.every(b=>{const a=matches.matches[b.fromPosition],z=matches.matches[b.toPosition],track=sliceTrack(oriented,a,z);return track.length&&compareGeometry(b.reverse?b.span.coordinates.slice().reverse():b.span.coordinates,track,cfg).withinTolerance;}))continue;
      const key=hash(order);if(!reorderOptions.has(key))reorderOptions.set(key,{order,sourceIds:[],groups:new Set()});const option=reorderOptions.get(key);option.sourceIds.push(entry.id);option.groups.add(group.group);
    }catch{/* Incomplete evidence never produces a guessed correction. */}
  }
  const qualifiedReorders=[...reorderOptions.values()].filter(o=>o.groups.size>=cfg.minIndependent);
  if(qualifiedReorders.length===1){
    const option=qualifiedReorders[0];result.proposal.after=option.order.map((nodeId,i)=>({position:i+1,nodeId}));
    result.proposal.changes.push({type:'REORDER',before:occurrences.map(o=>o.nodeId),after:option.order,reason:'至少三組獨立同走法完整 GPX 支持相同唯一順序，首尾不變；建議序列亦有現行方向邊、來源時間與線形支持。',sourceIds:option.sourceIds,independentGroups:option.groups.size,requiresConfirmation:true});
    add('SUSPECT_SEQUENCE',{message:'已產生具交叉證據的重排建議；未自動套用，原始序列仍保留。',nodeIds:occurrences.map(o=>o.nodeId),positions:occurrences.map(o=>o.position),sourceIds:option.sourceIds,suggestion:'查看 proposals.json 的 before／after 及來源，確認後才進行候選匯入。',options:['保留目前序列並補充反證','採用已列出的重排候選（另行確認套用）']});
  }
  // A correlated group supporting AND opposing cannot vote for automatic pass.
  for(const group of support)if(oppose.has(group))support.delete(group);
  for(const group of geometrySupport)if(!support.has(group))geometrySupport.delete(group);
  result.independentSupporting=support.size;result.independentOpposing=oppose.size;
  result.sequenceStatus=support.size>=cfg.minIndependent&&!oppose.size?'EVIDENCE_SUPPORTED':issues.some(i=>i.code==='SUSPECT_SEQUENCE')?'SUSPECT_SEQUENCE':'INSUFFICIENT_GPX';
  result.geometryStatus=geometrySupport.size>=cfg.minIndependent?'EVIDENCE_SUPPORTED':issues.some(i=>i.code==='SUSPECT_GEOMETRY')?'SUSPECT_GEOMETRY':issues.some(i=>i.code==='MISSING_GEOMETRY')?'MISSING_GEOMETRY':'INSUFFICIENT_GPX';
  if(support.size<cfg.minIndependent)add('INSUFFICIENT_GPX',{message:`已收錄 ${entries.length} 份，符合指定走法／完整性／品質的獨立支持組 ${support.size} 組；門檻 ${cfg.minIndependent} 組。`,sourceCount:entries.length,independentGroups:new Set(groups.filter(g=>g.eligible).map(g=>g.group)).size,supporting:support.size,required:cfg.minIndependent},'data');
  result.evidenceStatus=support.size>=cfg.minIndependent?'SUFFICIENT':'INSUFFICIENT_GPX';
  result.autoChecksPassed=result.sequenceStatus==='EVIDENCE_SUPPORTED'&&result.geometryStatus==='EVIDENCE_SUPPORTED'&&result.timeStatus==='SOURCE_REFERENCE_COMPLETE'&&!unresolvedSameVariantDifferences&&!issues.some(i=>['review','error'].includes(i.severity));
  const needsReview=unresolvedSameVariantDifferences&&support.size>=cfg.minIndependent||issues.some(i=>['review','error'].includes(i.severity));
  result.status=result.autoChecksPassed?'PASS':structuralFatal?'INVALID_DATA':needsReview?'MANUAL_REVIEW':'INSUFFICIENT_GPX';
  result.evidenceMeaning='PASS 僅指此資料版本符合指定走法與程式門檻；不代表即時開放、現地通行或新取得官方核實。';
  return result;
}
export function runAudit({work=WORK,snapshotPath=null,routeIds=null,project=null,noCache=false}={}) {
  const cfg=configAt(work),input=loadSnapshot(work,snapshotPath),data=project||loadProject(ROOT,work),library=loadLibrary(work,cfg);
  const engineDigest=hash(['utils.mjs','gpx.mjs','match.mjs','core.mjs','sequence-review.mjs','evidence-age.mjs'].map(f=>readFileSync(resolve(ROOT,'tools/route-validator',f),'utf8')).concat(readFileSync(resolve(ROOT,'preview/js/classic-route.js'),'utf8')));
  const selected=input.routes.filter(r=>!routeIds||routeIds.includes(r.routeId)),results=[];let reused=0;
  for(const route of selected) {
    const sources=library.entries.filter(s=>s.routeIds?.includes(route.routeId));
    const key=hash({engineDigest,route,data:data.digest,cfg,sources:sources.map(({parsed,...s})=>s),errors:library.errors.filter(e=>e.routeIds.includes(route.routeId))});
    const cache=resolve(work,'cache/routes/'+route.routeId+'-'+key+'.json');
    const cached=noCache?null:readCache(cache);
    let result;if(cached?.inputDigest===key&&cached.result?.routeId===route.routeId){result=cached.result;reused++;}else {result=auditRoute(route,data,library,cfg);writeCache(cache,{inputDigest:key,result});}
    results.push(result);
  }
  if(routeIds)for(const id of routeIds)if(!selected.some(r=>r.routeId===id))throw Error('Sheet 不存在路線：'+id);
  const references=collectReferences(input),notes=existsSync(resolve(BASE,'source-notes.json'))?readJson(resolve(BASE,'source-notes.json')):[];
  for(const note of notes)if(!references.some(r=>r.url===note.url))references.push({...note,retrievalStatus:'not-downloaded'});
  const retrievals=existsSync(resolve(work,'retrieval-log.json'))?readJson(resolve(work,'retrieval-log.json')):[];
  for(const reference of references){const log=retrievals.find(r=>r.url===reference.url);if(log){reference.retrievalStatus=log.status;reference.retrievalReason=log.reason||'';reference.retrievedAt=log.at;}}
  const sourceKey=url=>{try{const u=new URL(url);if(u.hostname.endsWith('hiking.biji.co')&&u.searchParams.get('act')==='gpx_detail')return 'biji:'+u.searchParams.get('id');u.searchParams.sort();return u.href;}catch{return url;}};
  for(const reference of references){const source=library.entries.find(s=>s.sourceUrl&&sourceKey(s.sourceUrl)===sourceKey(reference.url));if(source){reference.retrievalStatus='downloaded';reference.sha256=source.sha256;reference.sourceId=source.id;reference.retrievalReason='已保存 GPX；既有未登入失敗紀錄只作歷史，不代表目前缺檔。';}}
  const report={schemaVersion:1,toolVersion:VERSION,engineDigest,generatedAt:new Date().toISOString(),scope:routeIds||'all-sheet-routes',
    provenance:{sheetSnapshotSha256:input.sha256,snapshotPath:relative(ROOT,input.path).replaceAll('\\','/'),capturedAt:input.snapshot.capturedAt,spreadsheetId:input.snapshot.spreadsheetId,nodeAuthority:data.authoritySource,correctionRef:input.snapshot.correctionRef||null,graphDigest:data.digest,graphInputs:data.inputs,source:data.source,config:cfg},
    counts:{routes:results.length,enabled:results.filter(r=>r.enabled).length,validOccurrences:selected.reduce((n,r)=>n+r.occurrences.length,0),excludedRows:input.excluded.length,pass:results.filter(r=>r.status==='PASS').length,review:results.filter(r=>r.status==='MANUAL_REVIEW'||r.status==='INVALID_DATA').length,evidenceInsufficient:results.filter(r=>r.evidenceStatus==='INSUFFICIENT_GPX').length,unexpanded:results.filter(r=>r.status==='UNEXPANDED').length,cachedRoutes:reused},
    inputProblems:input.problems,excludedRows:input.excluded,libraryProblems:library.errors,references,retrievals,results,
    limitations:['未自動覆寫 Google Sheets、候選編譯檔、全域 Node ID、時間、座標或正式版。','公開網頁的文字及 GPX 連結不等於已下載並匹配的軌跡。','只比較精確有向邊與來源 span；不靠最短路徑或直線補缺口。','有效獨立證據採保守去重；同作者、同來源、同形狀或近乎相同軌跡合併。','工具未替未觀測到的地點自動建立新 Node；缺少必要節點仍須有來源的路線定義支持。','本輪所有路線執行資料結構檢查；實際 GPX 驗證未達門檻者不得納入通過統計。']};
  // Global input ambiguity blocks all positive conclusions, not merely a footer.
  if(input.problems.length||library.errors.some(e=>!e.routeIds.length))for(const r of results){r.autoChecksPassed=false;r.eligibleForImport=false;if(r.status==='PASS')r.status='MANUAL_REVIEW';}
  report.counts.pass=results.filter(r=>r.status==='PASS').length;
  return report;
}
