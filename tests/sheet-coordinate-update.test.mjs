import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {mergeReviewedRoutes} from '../js/global-route.js';
import {directionalQuickAdd,quickAddEstimatedMinutes} from '../js/quick-add.js';
import {buildQuickTopology,layoutQuickTopology,renderQuickTopologySvg} from '../js/quick-topology.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const load=p=>JSON.parse(read(p));
const imported=load('data/geometry/sources/sheet-coordinate-import-20261107.json');
const data=load('preview/data/geometry/planner-terrain-v1.json');
const application=load('data/geometry/sources/node-review-application-20261111.json');
const by=new Map(data.nodes.map(n=>[n.nodeId,n]));

test('all 17 explicit Sheet coordinates reach the shared map, GPX and profile dataset',()=>{
 assert.equal(imported.decisions.length,17);
 assert.equal(imported.decisions.filter(n=>n.changed).length,16);
 // Explicit publication authorization now promotes the complete source-rebuilt dataset.
 assert.deepEqual(load('data/geometry/planner-terrain-v1.json'),data);
 for(const decision of imported.decisions){
  const node=by.get(decision.nodeId);assert.deepEqual(node.coordinate,decision.coordinate,node.name);
  assert.equal(node.coordinatePolicy,'active');assert.ok(Number.isFinite(node.elevationMeters));
  if(decision.changed){assert.equal(node.coordinateSource.url,imported.sourceUrl);assert.equal(node.coordinateSource.row,decision.row)}
  for(const span of data.spans)assert.ok(!(span.intermediateCoordinatesUnknown&&span.viaNodeIds.includes(node.nodeId)),node.name+' must no longer be an unlocated interior label');
 }
});

test('Sheet rename retains identity and old alias; mini maps consume all newly available coordinates',()=>{
 const manifest=load('data/unified-editor-manifest.json');
 const routes=manifest.routes.map(r=>load(r.file.split('?')[0]));
 const graph=mergeReviewedRoutes(routes);
 const renamed=graph.nodes.find(n=>n.id==='node:9a67a747c35d44edc6e7');
 assert.equal(renamed.name,'特生中心');assert.ok(renamed.aliases.includes('石山林道登山口'));
 for(const decision of imported.decisions.filter(n=>n.changed)){
  const node=graph.nodes.find(n=>n.id===decision.nodeId);
  const choices=directionalQuickAdd(graph,{items:[{type:'location',nodeId:node.id}],coefficient:1});
  const topology=buildQuickTopology(choices,node.id,node.name);
  const layout=layoutQuickTopology(topology,data);
  assert.ok(layout.knownCount>=2,node.name);
  assert.ok(!layout.estimatedIds.has(node.id),node.name);
  assert.match(renderQuickTopologySvg(choices,node.id,node.name,1,quickAddEstimatedMinutes,data),/目前位置/);
 }
 // Reconstruct historical IDs only for routes containing an explicitly merged old node.
 // Every original directional record/time must still reproduce the archived signature.
 const historical=structuredClone(routes);
 const g04followup=load('data/geometry/sources/g04-owner-followup-20261112.json');
 const g04=historical.find(r=>r.route_id==='G04');
 g04.segments=g04.segments.filter(e=>e.verificationBasis!=='owner_explicit_chat_20261112');
 g04followup.oldSegmentIndices.forEach((index,i)=>g04.segments.splice(index,0,g04followup.oldDirectedEdges[i]));
 const nov12=load('data/geometry/sources/sheet-review-application-20261112.json');
 const retired=nov12.retirement;
 const changed=historical.find(r=>r.route_id==='G13');
 changed.nodes.splice(retired.nodeIndex,0,retired.node);
 retired.segmentIndices.forEach((index,i)=>changed.segments.splice(index,0,retired.originalSegments[i]));
 for(const c of nov12.vehicleCorrections){
  const route=historical.find(r=>r.route_id==='G18');
  const index=route.segments.findIndex(s=>s.fromId===c.original.fromId&&s.toId===c.original.toId);route.segments[index]=c.original;
 }
 const signature=historical.map(r=>{
  const path=manifest.routes.find(m=>m.id===r.route_id).file.split('?')[0];
  const changed=application.changedRoutes.find(x=>x.file===path);
  const inverse=new Map(application.merges.filter(m=>changed?.previousNodes.some(n=>n.id===m.oldId)).map(m=>[m.canonicalId,m.oldId]));
  const id=n=>inverse.get(n)||n;
  const edge=({from,to,...s})=>({...s,fromId:id(s.fromId),toId:id(s.toId)});
  return {id:r.route_id,nodes:r.nodes.map(n=>id(n.id)),segments:r.segments.map(edge),manualConnections:(r.manualConnections||[]).map(edge)};
 });
 assert.equal(createHash('sha256').update(JSON.stringify(signature)).digest('hex'),imported.topologyTimeSha256);
});
