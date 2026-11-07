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
const data=load('data/geometry/planner-terrain-v1.json');
const by=new Map(data.nodes.map(n=>[n.nodeId,n]));

test('all 17 explicit Sheet coordinates reach the shared map, GPX and profile dataset',()=>{
 assert.equal(imported.decisions.length,17);
 assert.equal(imported.decisions.filter(n=>n.changed).length,16);
 assert.equal(read('data/geometry/planner-terrain-v1.json'),read('preview/data/geometry/planner-terrain-v1.json'));
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
 const signature=routes.map(r=>({id:r.route_id,nodes:r.nodes.map(n=>n.id),segments:r.segments.map(({from,to,...s})=>s),manualConnections:(r.manualConnections||[]).map(({from,to,...s})=>s)}));
 assert.equal(createHash('sha256').update(JSON.stringify(signature)).digest('hex'),imported.topologyTimeSha256);
});
