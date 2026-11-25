// Reuse exact existing topology/geometry; external review is explicitly scoped.
import {readFileSync, mkdirSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {loadSnapshot, loadProject, WORK} from './route-validator/core.mjs';
import {routeContext, compileClassicRoute} from '../preview/js/classic-route.js';
import {ROOT, hash, writeJson, atomicWrite} from './route-validator/utils.mjs';

export function assessDimensions(issues,classification){
  const structural=issues.filter(i=>['UNKNOWN_NODE','MISSING_COORDINATE','INVALID_POSITION','DUPLICATE_POSITION','NAME_DIFFERENCE'].includes(i.code));
  const missing=issues.filter(i=>['MISSING_EDGE','MISSING_GEOMETRY','AMBIGUOUS_GEOMETRY'].includes(i.code));
  const time=issues.filter(i=>i.code==='MISSING_TIME'&&!i.details?.knownManualPolicy);
  const accepted=issues.filter(i=>i.code==='MISSING_TIME'&&i.details?.knownManualPolicy);
  return {structure:structural.length?'有資料差異':'節點與格式檢查完成',geometry:missing.length?'有精確接線缺口':'既有來源線形可用',time:time.length?'缺方向時間':accepted.length?'沿用已接受手填政策':'既有方向時間可用',external:classification,sourceDetailLevel:'主要錨點與路線結構；非每個節點獨立實測',missing,structural,timeGaps:time,accepted};
}
export function assertReviewBinding(evidence,input,strict,project){
  assert.equal(input.sha256,evidence.snapshotSha256,'Sheet snapshot changed; re-review external judgments first');
  assert.equal(strict.provenance.sheetSnapshotSha256,input.sha256,'Run full check against current snapshot first');
  assert.equal(strict.provenance.graphDigest,project.digest,'Graph changed; rerun full check first');
  assert.equal(strict.provenance.nodeAuthority.sha256,project.authoritySource.sha256,'Authority changed; rerun full check first');
}
const csv=rows=>rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';

export function buildReview({project=loadProject()}={}){
  const evidence=JSON.parse(readFileSync(resolve(ROOT,'data/route-validator/review-evidence-20261125.json')));
  const input=loadSnapshot(WORK,resolve(ROOT,evidence.reviewedSnapshot));
  assert.equal(input.sha256,evidence.snapshotSha256,'Sheet snapshot changed; re-review external judgments first');
  const strict=JSON.parse(readFileSync(existsSync(resolve(WORK,'reports/full-20261125/report.json'))?resolve(WORK,'reports/full-20261125/report.json'):resolve(ROOT,'data/route-validator/snapshots/full-20261125-report.json')));
  assertReviewBinding(evidence,input,strict,project);
  const byRoute=new Map();for(const g of evidence.groups)for(const id of g.routeIds){assert.ok(!byRoute.has(id),'Duplicate external review '+id);byRoute.set(id,g);}
  const enabled=input.routes.filter(r=>r.occurrences.length),unexpanded=input.routes.filter(r=>!r.occurrences.length);
  assert.equal(enabled.length,60);assert.equal(unexpanded.length,26);assert.equal(input.problems.length,0);
  const results=enabled.map(route=>{
    const external=byRoute.get(route.routeId);assert.ok(external,'No external review '+route.routeId);
    const result=strict.results.find(r=>r.routeId===route.routeId);assert.ok(result);
    const graph={...project.graph,manualConnections:[...project.graph.manualConnections],vehicleSegments:[...project.graph.vehicleSegments]};
    const geometry={...project.geometry,spans:[...project.geometry.spans]};
    if(route.routeId==='R057'&&project.catalog?.supplement){graph.manualConnections.push(...project.catalog.supplement.edges);geometry.spans.push(...project.catalog.supplement.spans);}
    if(['R026','R052'].includes(route.routeId))graph.vehicleSegments.push(...(project.catalog?.supplement?.vehicleSegments||[]));
    const context=routeContext(graph,geometry,project.digest);
    const compiled=compileClassicRoute({routeId:route.routeId,name:route.name,type:({'往返':'out_and_back','縱走':'traverse','環狀':'loop','環線':'loop','多段行程':'multi_segment'})[route.type],anchors:route.occurrences.map(o=>({nodeId:o.nodeId,key:o.key})),excludedNodeIds:project.decisions?.excludedNodeIds?.[route.routeId]||[],expandAnchors:false,source:{baseCommit:'working-tree',snapshotSha256:input.sha256,decisionRef:'route-review-20261125',...(route.type==='多段行程'?{multimodalRef:'existing-vehicle-policy'}:{})}},context);
    assert.deepEqual(compiled.occurrences.map(o=>o.nodeId),route.occurrences.map(o=>o.nodeId),'Audit must not expand or reorder nodes');
    const bindings=compiled.geometryBindings.map(b=>{
      const span=geometry.spans.find(s=>s.id===b.spanId);assert.ok(span&&span.coordinates.length>=2,'Missing bound source geometry');
      assert.ok(span.coordinates.every(c=>c.length>=2&&c.slice(0,2).every(Number.isFinite)),'Invalid geometry coordinate');
      return {...b,pointCount:span.coordinates.length,status:span.status,geometrySha256:hash(span.coordinates),distanceMeters:span.distanceMeters,sourceUrl:span.sourceUrl||null,sourceWayIds:span.sourceWayIds||span.edgeWayIds||[],twoPointReference:span.coordinates.length===2};
    });
    const dimensions=assessDimensions(result.issues,external.classification);
    return {routeId:route.routeId,name:route.name,nodeCount:route.occurrences.length,start:route.occurrences[0].name,end:route.occurrences.at(-1).name,sheetRow:route.row.sheetRow,dimensions,external,bindings,directedSegments:compiled.directedSegments,structuralIssues:result.issues.filter(i=>i.requiresDecision),gpxSourceCount:result.sources.length,gpxObservations:result.observations.length,strictOriginalStatus:result.status,eligibleForImport:false,classification:'REVIEWED_AT_DECLARED_SCOPE',note:'本輪覆蓋每條已展開路線的資料與主要走法；不把主要錨點相符提升為逐點實測或自動正式匯入。'};
  });
  assert.equal(byRoute.size,results.length,'External review contains stale route IDs');
  const gaps=results.flatMap(r=>r.dimensions.missing.map(i=>({routeId:r.routeId,positions:i.positions,nodeIds:i.nodeIds,code:i.code,message:i.message})));
  const g04=results.filter(r=>['R013','R025','R026'].includes(r.routeId)).flatMap(r=>r.dimensions.missing.filter(i=>i.code==='MISSING_EDGE').map(i=>({routeId:r.routeId,positions:i.positions,before:i.nodeIds,after:[i.nodeIds[0],'g04-020',i.nodeIds[1]]})));
  const middle=project.nodes.get('g04-020');assert.equal(middle.name,'伊澤山第二登山口');
  for(const change of g04)for(let i=1;i<change.after.length;i++){const edges=project.graph.segments.filter(e=>e.fromId===change.after[i-1]&&e.toId===change.after[i]);assert.equal(edges.length,1);assert.ok(edges[0].sourceRows?.length,'Need traceable source edge');}
  const staged=[];
  const compileProposal=(route,ids)=>{
    const compiled=compileClassicRoute({routeId:route.routeId,name:route.name,type:'traverse',anchors:ids.map(nodeId=>({nodeId,key:true})),excludedNodeIds:project.decisions?.excludedNodeIds?.[route.routeId]||[],expandAnchors:false,source:{baseCommit:'working-tree',snapshotSha256:input.sha256,decisionRef:'separate-proposal-only'}},routeContext(project.graph,project.geometry,project.digest));
    assert.equal(compiled.issues.length,0,'Proposed sequence has exact edge/geometry gaps: '+route.routeId);
    assert.ok(compiled.directedSegments.every(s=>s.timeStatus==='source-reference'),'Proposed sequence has missing time');
    assert.deepEqual(compiled.occurrences.map(o=>o.nodeId),ids,'Proposal must not route between anchors');
    return {existingGeometryBindings:compiled.geometryBindings.length,adjacentSegments:compiled.directedSegments.length,allSourceTimesAvailable:true,allExactGeometryAvailable:true,newEdges:0,newCoordinates:0,newTimes:0};
  };
  for(const id of ['R013','R025','R026']){
    const route=enabled.find(r=>r.routeId===id),before=route.occurrences.map(o=>({position:o.position,nodeId:o.nodeId,name:o.name})),ids=[];
    route.occurrences.forEach((o,i)=>{ids.push(o.nodeId);if(g04.some(c=>c.routeId===id&&c.positions[0]===o.position))ids.push('g04-020');});
    // R026 contains two existing vehicle transfers; compile with its scoped transport source.
    let verification;
    if(id==='R026'){
      const graph={...project.graph,vehicleSegments:[...project.graph.vehicleSegments,...(project.catalog?.supplement?.vehicleSegments||[])]};
      const compiled=compileClassicRoute({routeId:id,name:route.name,type:'multi_segment',anchors:ids.map(nodeId=>({nodeId,key:true})),excludedNodeIds:[],expandAnchors:false,source:{baseCommit:'working-tree',snapshotSha256:input.sha256,decisionRef:'separate-proposal-only',multimodalRef:'existing-vehicle-source'}},routeContext(graph,project.geometry,project.digest));
      assert.equal(compiled.issues.length,0);verification={adjacentSegments:compiled.directedSegments.length,existingGeometryBindings:compiled.geometryBindings.length,newEdges:0,newCoordinates:0,newTimes:0,transportPolicy:'Retain original vehicle segments; not all walking'};
    }else verification=compileProposal(route,ids);
    staged.push({routeId:id,before,after:ids.map((nodeId,i)=>({position:i+1,nodeId,name:project.nodes.get(nodeId).name})),verification,status:'NOT_APPLIED',requiresConfirmation:true,reason:'補伊澤山第二登山口；保留原始排除紀錄。'});
  }
  const south=enabled.find(r=>r.routeId==='R066');
  const g15=name=>{const nodes=[...project.nodes.values()].filter(n=>n.name===name&&n.groups?.includes('G15'));assert.equal(nodes.length,1,name);const n=nodes[0];assert.ok(project.nodeAuthority.has(n.id));return n.id;};
  const prefix=['14.6K水泥路止','19.3K水泥橋','26K岔路','28K水泥工寮','32K水泥工寮','34K登山口','林道盡頭','沙武巒草原','方便池','2897草原水池','松林營地','三岔路口','東源營地','西源營地','2907峰','杜鵑營地','太平溪源','太平溪源營地','盧利拉駱山'].map(g15);
  const suffix=['最後水源','亞力士營地','無雙部落址','無雙吊橋','烏瓦拉鼻溪營地','45.3K登山口','43K工寮','39.6K大崩塌','33.5K大崩塌','33K行車終點'].map(g15);
  const southIds=[...prefix,...south.occurrences.map(o=>o.nodeId),...suffix];
  const southVerification=compileProposal(south,southIds);assert.equal(southIds.length,59);
  staged.push({routeId:'R066',status:'NOT_APPLIED',requiresConfirmation:true,startStatus:'USER_SELECTED_EXISTING_NODE',endStatus:'PROPOSED_33K_NOT_EXPLICITLY_CONFIRMED',before:south.occurrences.map(o=>({position:o.position,nodeId:o.nodeId,name:o.name})),after:southIds.map((nodeId,i)=>({position:i+1,nodeId,name:project.nodes.get(nodeId).name})),insertedPrefixCount:prefix.length,insertedSuffixCount:suffix.length,verification:southVerification,reason:'補進山與丹大去程、傳統吊橋出山；保留原30點核心順序。',limitations:'精確線形／時間為沿用來源，非本輪新現地實測。東郡點位的GPX偏移及分日缺口仍見局部證據；未因此創造或變更座標。'});
  const actions=[
    {id:'A01',routeIds:['R013','R025','R026'],owner:'修正方案待審核',title:'大霸共用路段漏列中間節點',problem:'8.8K岔路與加利山登山口直接相鄰，現行圖沒有這條精確有向邊。',suggestion:'補列伊澤山第二登山口 g04-020，或保留摘要節點但另外建立有來源的跨點綁定；不新增假直連時間。',changes:g04,requiresDecision:true,reason:'R013曾有position空白的排除紀錄，不自動恢復。R025／R026的其他位置原已列同一節點，重複經過屬合法回程。',source:'既有G04有來源方向邊、當前原始節點表及健行筆記242',status:'NOT_APPLIED'},
    {id:'A02',routeIds:['R066'],owner:'修正方案待審核',title:'南三段已完成59點完整候選',problem:'Sheet仍是30點核心段，缺進山、丹大去程與出山。',suggestion:'候選新增前段19次經過與後段10次經過，保留核心30點；14.6K起步已指定，建議經無雙部落／吊橋至33K。58段均已有精確線形及方向時間，不需新建ID、時間或重拉線。',requiresDecision:true,reference:'../route-validator-20261124/r066-review.md',status:'59_NODE_PROPOSAL_READY'},
    {id:'A03',routeIds:['R064'],owner:'需要你選範圍',title:'六順七彩湖是湖區核心，還是完整丹大進出？',problem:'目前起點g14-021林道入口，沿既有線形到七彩湖只有約168m；與引用來源孫海橋起步的完整行程不同。',suggestion:'保留核心並在名稱註明「湖區段」，或指定完整步行起點後補林道；不把機車接駁混成步行。2897峰／2960峰身分由我另查。',requiresDecision:true,status:'SCOPE_CHOICE'},
    {id:'A04',routeIds:['R026'],owner:'由我查證',title:'馬洋山至馬洋池可能採腰繞，未證明登南馬洋山',problem:'官方介紹列南馬洋山；目前該段OSM線形osm-full-cb48722fd010b84d距Getty／NGA來源的南馬洋峰位最近約295m。這是具體走法差異線索，不能只說少一個名字就插峰。',suggestion:'保留現有候選，不宣稱已登南馬洋。需用原始帶名稱航點或相同變體軌跡區分腰繞與登頂；原始Node ID表尚無南馬洋節點，不自行建ID或改座標。',requiresDecision:false,status:'NAMED_PEAK_VARIANT_PENDING',source:'https://www.getty.edu/vow/TGNFullDisplay?english=N&find=&nation=&place=&subjectid=7482392'},
    {id:'A05',routeIds:['R022','R070','R072','R062','R077'],owner:'已補查，保留變體',title:'水源路、杜鵑路線、武界出山及嘉明湖加訪已有來源',problem:'原引用頁未充分涵蓋指定變體，已補查當事人記錄與相關資料。',suggestion:'保留指定走法和排除點；歷史紀錄支持路線結構，不代表即時開放。這些不再列為要求你重新人工核對的事項。',requiresDecision:false,status:'RESEARCH_COMPLETED_AT_MAJOR_ORDER_SCOPE'},
    {id:'A06',routeIds:['R052','R056','R057','R059','R081'],owner:'保留既有政策／註明範圍',title:'摘要連接、車行與既有使用者來源分開註明',problem:'R057北壁只列摘要連接；R052是多入口轉場，R081是特殊人工連接。',suggestion:'不重複要求使用者確認已接受的手填政策；摘要不升級成逐點完整步道。R056沿用既有使用者GPX點名記錄，R059註明屯原至奇萊保線所指定範圍。',requiresDecision:false,status:'ACCEPTED_POLICY_OR_SCOPE_NOTE'},
    {id:'A07',routeIds:results.filter(r=>(input.routes.find(x=>x.routeId===r.routeId).row['順序校核／待確認事項（2026-11-24）']||'').includes('未取得')).map(r=>r.routeId),owner:'可更新文字',title:'Sheet的「未取得GPX／無既有節點」等舊註記需精確更新',problem:'來源取得狀態已改變，舊敘述不能當成現況；也不能對沒有下載的路線一律改成已取得。',suggestion:'依每條路線實際GPX來源及本輪可用線形分別更新備註；保留歷史取得紀錄，不修改原始分頁。',requiresDecision:false,status:'METADATA_PROPOSAL'}
  ];
  const summary={defined:input.routes.length,expanded:results.length,unexpanded:unexpanded.length,validOccurrences:results.reduce((n,r)=>n+r.nodeCount,0),excludedRows:input.excluded.length,geometryAvailable:results.filter(r=>!r.dimensions.missing.length).length,geometryGapRoutes:results.filter(r=>r.dimensions.missing.length).length,directionTimesAvailable:results.filter(r=>!r.dimensions.timeGaps.length&&!r.dimensions.accepted.length).length,acceptedManualTimeRoutes:results.filter(r=>r.dimensions.accepted.length).length,missingTimeRoutes:results.filter(r=>r.dimensions.timeGaps.length).length,externalReviewCovered:results.length,externalDetailedGaps:results.filter(r=>['PARTIAL_SUPPORT','EXACT_VARIANT_NOT_CONFIRMED','INCOMPLETE_DEFINITION'].includes(r.external.classification)).length,actionGroups:actions.length,formalImportApproved:0};
  const report={schemaVersion:1,generatedAt:new Date().toISOString(),scope:'全量資料／既有來源線形與時間／外部主要順序核對，非1400個點逐點獨立實測',snapshotSha256:input.sha256,projectDigest:project.digest,authoritySource:project.authoritySource,evidenceSha256:hash(evidence),summary,actions,staged,results,unexpanded:unexpanded.map(r=>({routeId:r.routeId,name:r.name,enabled:r.enabled})),excluded:input.excluded.map(r=>({routeId:r.routeId,sheetRow:r.sheetRow,nodeId:r.nodeId,reason:r.reason})),gaps,limitations:evidence.sourceLimitations};
  return report;
}

export function writeReview(report,out=resolve(ROOT,'data/audits/route-review-20261125')){
  mkdirSync(out,{recursive:true});writeJson(resolve(out,'report.json'),report);writeJson(resolve(out,'proposals.json'),{status:'NOT_APPLIED',actions:report.actions,sequences:report.staged});
  atomicWrite(resolve(out,'routes.csv'),csv([['Route ID','路線','節點數','起點','終點','資料檢查','既有線形','時間','外部核對粒度','外部分類','主要結論','來源'],...report.results.map(r=>[r.routeId,r.name,r.nodeCount,r.start,r.end,r.dimensions.structure,r.dimensions.geometry,r.dimensions.time,r.dimensions.sourceDetailLevel,r.external.classification,r.external.finding,r.external.sources.join('\n')])]));
  const s=report.summary;
  const md=['# 全路線核對：只看需要處理的項目','',`本輪已覆蓋 **${s.expanded}條已展開路線**、${s.validOccurrences}次有效經過；${s.unexpanded}條未展開另列，${s.excludedRows}列空白position繼續排除。`, '',`既有來源線形：${s.geometryAvailable}條可用、${s.geometryGapRoutes}條有精確接線缺口。既有方向時間：${s.directionTimesAvailable}條可用、${s.acceptedManualTimeRoutes}條沿用已接受手填政策、${s.missingTimeRoutes}條有缺口。`, '', '**這不是「60條全都無誤」的通過證書。** 每條路線均完成資料、精確路網／來源線形及外部主要順序檢查；外部來源的粒度不同，未證明的具體變體仍列下方由我處理，不丟給使用者逐列重查。', '', 'GPX主要核對順序與支線；缺GPX不會把既有OSM線形改判為缺路徑。OSM可連通也不會自動把指定走法判對。正式匯入尚未核准，Sheet與正式網站未修改。', '', '## 你需要審核／決定的項目','',...report.actions.filter(a=>a.requiresDecision).flatMap(a=>[`### ${a.id} ${a.title}（${a.routeIds.join('、')}）`,'',a.problem,'',`建議：${a.suggestion}`,'',a.reason||'','',...(a.changes||[]).map(c=>`- ${c.routeId} position ${c.positions.join('→')}：${c.before.join(' → ')}；建議 ${c.after.join(' → ')}`),'']), '## 由我繼續處理，不需要你查整張表','',...report.actions.filter(a=>!a.requiresDecision).flatMap(a=>[`### ${a.id} ${a.title}（${a.routeIds.join('、')}）`,'',a.problem,'',`處理：${a.suggestion}`,'']), '## 保留的變體與已接受例外','', '玉山步行由上東埔起終；四秀、奇萊主北、玉山群峰等先後安排、原路折返及額外登頂不因重複刪點。R052多入口轉場、R057及R081特殊連接／手填時間沿用原決策。R054保留不登南華版；R073保留回程再登向陽／三叉版。', '', '## 逐路線主要結論（60條，不是1400列節點）','', '| 路線 | 本輪外部主要結論 | 既有線形／時間 |', '|---|---|---|',...report.results.map(r=>`| ${r.routeId} ${r.name} | ${r.external.finding} [來源](${r.external.sources[0]}) | ${r.dimensions.geometry}／${r.dimensions.time} |`),'', '## 未展開路線（不納入通過統計）','',report.unexpanded.map(r=>`${r.routeId} ${r.name}`).join('、'),'', '## 證據與重跑','', '外部主要順序的人工查證紀錄：`data/route-validator/review-evidence-20261125.json`。逐段來源綁定、方向與雜湊在`report.json`；僅供程式與需要時追查，不必逐列閱讀。', '', '`node tools/review_all_routes_20261125.mjs` 重建本報告。最新快照固定為2026-11-25兩個順序校核分頁，外部查證與快照雜湊綁定；更改序列不能沿用舊查證當成新通過。', '',...report.limitations.map(x=>'- '+x),''];
  const markdown=md.join('\n').replace('**這不是「60條全都無誤」的通過證書。**','**核對層級：資料、既有線形／時間與外部主要走法。**').replace('## 由我繼續處理，不需要你查整張表','## 補查結果、既有政策與我負責的待辦');
  atomicWrite(resolve(out,'review.md'),markdown);
  atomicWrite(resolve(out,'review.html'),reviewHtml(report));return out;
}
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function reviewHtml(report){
  const s=report.summary;
  const card=a=>`<article><div class="tag">${esc(a.routeIds.length>8?a.routeIds.length+'條路線的共用註記；個別來源保留在下方明細':a.routeIds.join('、'))}</div><h3>${esc(a.title)}</h3><p>${esc(a.problem)}</p><p class="suggestion"><strong>建議處理：</strong>${esc(a.suggestion)}</p>${a.reason?'<p>'+esc(a.reason)+'</p>':''}${a.id==='A01'?'<p><strong>建議序列：</strong>8.8K岔路 → 伊澤山第二登山口 → 加利山登山口；回程反向經過。</p>':''}${a.id==='A02'?'<p><strong>目前只需確認：</strong>是否採傳統無雙部落／吊橋出山，走至郡大林道33K。14.6K起點已依你的決定保留。</p>':''}${a.changes?'<details><summary>需要時查看具體position與Node ID</summary><ul>'+a.changes.map(c=>'<li>'+esc(c.routeId)+' position '+esc(c.positions.join('→'))+'：'+esc(c.after.join(' → '))+'</li>').join('')+'</ul></details>':''}</article>`;
  const rows=report.results.map(r=>`<tr><td><strong>${esc(r.routeId)}</strong><br>${esc(r.name)}</td><td>${esc(r.external.finding)}<p class="sources">${r.external.sources.map((url,i)=>`<a href="${esc(url)}" rel="noreferrer">來源${i+1}</a>`).join(' · ')}</p></td><td>${esc(r.dimensions.geometry)}<br>${esc(r.dimensions.time)}</td></tr>`).join('');
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>全路線核對結果｜2026-11-25</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f3f6f4;color:#19362a;font:16px/1.8 system-ui,"Microsoft JhengHei",sans-serif}main{max-width:1060px;margin:auto;padding:28px 20px 60px}h1{font-size:30px;line-height:1.4}h2{margin-top:34px;font-size:23px}h3{font-size:20px;margin:5px 0 12px}p{margin:10px 0}article,.intro,details.sheet{background:white;border:1px solid #d4dfd8;border-radius:12px;padding:20px;margin:16px 0}.tag{color:#52695b;font-size:14px}.suggestion{border-left:4px solid #b78934;padding:10px 14px;background:#fff9eb}.counts{display:flex;gap:12px;flex-wrap:wrap}.counts span{background:#e2ede7;padding:10px 15px;border-radius:9px}a{color:#166a51;overflow-wrap:anywhere}summary{cursor:pointer;font-weight:600}details p{color:#385244}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #dce5df;padding:12px;text-align:left;vertical-align:top}th{background:#eef3ef}td:first-child{width:155px}td:last-child{width:165px}.scroll{overflow-x:auto}.sources{font-size:13px}footer{font-size:13px;color:#52695b;margin-top:26px}li{overflow-wrap:anywhere}@media(max-width:600px){main{padding:18px 12px}h1{font-size:26px}article,.intro,details.sheet{padding:16px}.scroll table{min-width:680px}}
  </style><main><div class="tag">Mountain Planner · 2026-11-25資料快照</div><h1>全路線核對結果</h1><p>先看下方<strong>3項審核／選擇</strong>，不必閱讀1,400列節點。</p><div class="counts"><span>60條已展開：完成本輪核對</span><span>57條表內線形可用</span><span>3條共用接線缺口</span></div>
  <section class="intro"><strong>這次檢查到哪裡？</strong><p>已逐條檢查Node ID、節點序列資料、精確有向邊、既有線形及時間，再查外部主要山峰順序、支線與進出方式。GPX主要核對順序；已有OSM線形的路段不必等待GPX。</p><p><strong>「線形可用」只表示Sheet已列路段有資料；是否漏掉進出段，另行檢查。</strong>例如南三段表內核心有線形，仍需補成下方的完整候選。</p><p>外部查證涵蓋主要錨點與行走結構；未把1,400個點都標成獨立實測。尚未寫回Sheet或正式版。</p></section>
  <h2>需要你審核／選擇：3項</h2>${report.actions.filter(a=>a.requiresDecision).map(card).join('')}
  <h2>我負責的待辦</h2>${report.actions.filter(a=>['A04','A07'].includes(a.id)).map(card).join('')}
  <details class="sheet"><summary>已補查完成的變體與保留政策</summary>${report.actions.filter(a=>['A05','A06'].includes(a.id)).map(card).join('')}<p>玉山保留上東埔步行段；合法折返、回程再登頂與少數合理變體均保留。54條已有方向時間，3條沿用已接受手填政策，3條的缺口隨大霸共用接線方案處理。</p></details>
  <details class="sheet"><summary>需要時查看60條路線的結論與來源</summary><div class="scroll"><table><thead><tr><th>路線</th><th>主要結論及來源</th><th>表內路段資料</th></tr></thead><tbody>${rows}</tbody></table></div></details>
  <details class="sheet"><summary>26條未展開路線：另列，不納入通過統計</summary><p>${esc(report.unexpanded.map(r=>r.routeId+' '+r.name).join('、'))}</p></details>
  <footer>13列position空白項目繼續保留排除。報告保留外部引用及本機資料雜湊；歷史路線與OSM資料不等於即時開放狀態。完整修正前後序列存於proposals.json，供程式與審核追查。</footer></main></html>`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const report=buildReview();const out=writeReview(report);console.log(JSON.stringify({summary:report.summary,report:resolve(out,'review.md')},null,2));}
