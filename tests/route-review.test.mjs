import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {assessDimensions,assertReviewBinding,buildReview} from '../tools/review_all_routes_20261125.mjs';
import {ROOT,hash} from '../tools/route-validator/utils.mjs';
import {loadProject} from '../tools/route-validator/core.mjs';
import {buildLegacyCatalog} from '../tools/compile_classic_routes.mjs';

test('GPX不足不會把既有線形判為缺漏；外部來源仍保留查證粒度',()=>{
  const d=assessDimensions([{code:'INSUFFICIENT_GPX',details:{supporting:0}}],'PARTIAL_SUPPORT');
  assert.equal(d.geometry,'既有來源線形可用');assert.equal(d.external,'PARTIAL_SUPPORT');assert.equal(d.time,'既有方向時間可用');
});
test('外部主要順序有支持時仍保留精確有向接線與時間缺口',()=>{
  const d=assessDimensions([{code:'MISSING_EDGE',positions:[15,16]},{code:'MISSING_TIME',details:{}}],'MAJOR_ORDER_SUPPORTED');
  assert.equal(d.geometry,'有精確接線缺口');assert.equal(d.time,'缺方向時間');assert.equal(d.missing.length,1);
});
test('已接受手填時間與真正缺時間分開',()=>{
  const d=assessDimensions([{code:'MISSING_TIME',details:{knownManualPolicy:true}}],'ACCEPTED_SUMMARY_CONNECTION');
  assert.equal(d.time,'沿用已接受手填政策');assert.equal(d.timeGaps.length,0);assert.equal(d.accepted.length,1);
});
test('任何快照、路網、權威表過期都阻止沿用舊報告',()=>{
  const evidence={snapshotSha256:'sheet'},input={sha256:'sheet'},strict={provenance:{sheetSnapshotSha256:'sheet',graphDigest:'graph',nodeAuthority:{sha256:'authority'}}},project={digest:'graph',authoritySource:{sha256:'authority'}};
  assert.doesNotThrow(()=>assertReviewBinding(evidence,input,strict,project));
  for(const mutation of [x=>x.provenance.sheetSnapshotSha256='old',x=>x.provenance.graphDigest='old',x=>x.provenance.nodeAuthority.sha256='old',x=>delete x.provenance.sheetSnapshotSha256]){
    const changed=structuredClone(strict);mutation(changed);assert.throws(()=>assertReviewBinding(evidence,input,changed,project));
  }
});
test('歷史60條核對以當時候選版本重現；現行版本不能沿用舊報告',()=>{
  const project=loadProject(),legacy=buildLegacyCatalog();
  assert.throws(()=>buildReview({project}),/Graph changed/);
  const legacySha256=hash(JSON.stringify(legacy,null,2)+'\n');
  assert.equal(legacySha256,JSON.parse(readFileSync(resolve(ROOT,'data/staging/idea002/classic-sources-20261125.json'))).sourceCatalogSha256);
  // Recreate the exact historical catalog input, leaving current data untouched.
  project.catalog=legacy;project.inputs=project.inputs.map(i=>i.path==='data/staging/idea002/classic-routes.candidate.json'?{...i,sha256:legacySha256}:i);project.digest=hash(project.inputs);
  const r=buildReview({project}),snapshot=JSON.parse(readFileSync(resolve(ROOT,'data/route-validator/snapshots/sheet-20261125.json')));
  assert.equal(r.results.length,60);assert.equal(new Set(r.results.map(r=>r.routeId)).size,60);
  assert.equal(r.summary.validOccurrences,1400);assert.equal(r.unexpanded.length,26);assert.equal(r.excluded.length,13);
  assert.equal(r.summary.geometryAvailable,57);assert.equal(r.summary.geometryGapRoutes,3);
  assert.equal(r.summary.directionTimesAvailable+r.summary.acceptedManualTimeRoutes+r.summary.missingTimeRoutes,60);
  assert.ok(r.results.every(x=>x.external.sources.length&&x.external.finding&&x.eligibleForImport===false));
  for(const proposal of r.staged){
    const before=snapshot.sheets.RouteNodes_順序校核.rows.filter(row=>row[0]===proposal.routeId&&String(row[2]??'').trim()).map(row=>row[3]);
    assert.deepEqual(proposal.before.map(o=>o.nodeId),before);assert.equal(proposal.status,'NOT_APPLIED');
    let i=0;for(const node of proposal.after)if(node.nodeId===before[i])i++;assert.equal(i,before.length,'No original occurrence may be dropped/reordered');
    assert.equal(proposal.verification.newEdges,0);assert.equal(proposal.verification.newTimes,0);assert.equal(proposal.verification.newCoordinates,0);
  }
  const south=r.staged.find(p=>p.routeId==='R066');assert.equal(south.after.length,59);assert.equal(south.after[0].nodeId,'node:ef56761122345906961b');
  assert.equal(south.after.filter(n=>n.name==='盧利拉駱山').length,2);assert.equal(south.verification.adjacentSegments,58);assert.equal(south.verification.existingGeometryBindings,58);
  assert.equal(south.startStatus,'USER_SELECTED_EXISTING_NODE');assert.equal(south.endStatus,'PROPOSED_33K_NOT_EXPLICITLY_CONFIRMED');
  const g04=r.actions.find(a=>a.id==='A01');assert.equal(g04.changes.length,4);assert.ok(g04.changes.every(c=>c.after[1]==='g04-020'));assert.ok(g04.requiresDecision);
});
