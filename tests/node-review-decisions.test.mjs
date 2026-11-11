import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {mergeReviewedRoutes} from '../js/global-route.js';
import {canonicalReviewedId,migrateDaysToNodeIds} from '../js/node-identity.js';
import {migrateLegacyPlanDays} from '../js/legacy-plan-migration.js';
const load=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const manifest=load('data/unified-editor-manifest.json');
const graph=mergeReviewedRoutes(manifest.routes.map(r=>load(r.file.split('?')[0])));
const report=load('data/geometry/sources/node-review-application-20261111.json');

test('three explicit owner merges retain every source directional time and do not merge G15 same-name camp',()=>{
 assert.equal(report.merges.length,3);
 assert.equal(report.timeSignatureBefore,report.timeSignatureAfter);
 assert.equal(graph.nodes.length,721);
 assert.ok(graph.nodes.some(n=>n.id==='node:fac669a79a9a25b63056'&&n.name==='杜鵑營地'));
 for(const m of report.merges){
  assert.ok(!graph.nodes.some(n=>n.id===m.oldId));
  const n=graph.nodes.find(n=>n.id===m.canonicalId);assert.ok(n);
  assert.ok(n.name===m.oldNode.name||n.aliases.includes(m.oldNode.name));
  assert.equal(canonicalReviewedId(m.oldId,m.oldNode.name),m.canonicalId);
  assert.equal(canonicalReviewedId(m.oldId,'unrelated label'),m.oldId);
 }
});

test('published terrain matches Preview and historical owner decisions remain traceable after round two',()=>{
 const runtime=load('preview/data/geometry/planner-terrain-v1.json');
 assert.deepEqual(load('data/geometry/planner-terrain-v1.json'),runtime);
 const latest=load('data/geometry/sources/owner-coordinate-round2-application-20261111.json');
 const superseded=new Map(latest.coordinates.map(n=>[n.nodeId,n]));
 const review=load('data/geometry/sources/owner-coordinate-overrides.json');
 const by=new Map(runtime.nodes.map(n=>[n.nodeId,n]));
 for(const n of report.coordinates){
  assert.deepEqual(by.get(n.nodeId).coordinate,superseded.get(n.nodeId)?.coordinate||n.coordinate);
  assert.ok(Number.isFinite(by.get(n.nodeId).elevationMeters));
  if(superseded.has(n.nodeId))assert.ok(review.nodes.find(x=>x.nodeId===n.nodeId).previousDecisions.some(x=>JSON.stringify(x.coordinate)===JSON.stringify(n.coordinate)));
 }
 assert.ok(load('data/geometry/sources/owner-coordinate-round2-terrain-20261111.json').unchangedSpanCount>=614);
});

test('merged IDs migrate saved global items and endpoints without changing user time snapshots',()=>{
 for(const m of report.merges){
  const days=[{id:'d',startTime:'06:00',coefficient:.7,note:'keep day',items:[
   {id:'i',type:'location',nodeId:m.oldId,name:m.oldNode.name,note:'keep note',incoming:{kind:'official',from:m.oldNode.name,to:m.oldNode.name,fromNodeId:m.oldId,toNodeId:m.oldId,officialMinutes:91,actualMinutes:117}}]}];
  const migrated=migrateDaysToNodeIds(days,graph);
  assert.equal(migrated[0].items[0].nodeId,m.canonicalId);
  assert.equal(migrated[0].items[0].incoming.actualMinutes,117);
  assert.equal(migrated[0].items[0].incoming.officialMinutes,91);
  assert.equal(migrated[0].items[0].incoming.fromNodeId,m.canonicalId);
  assert.equal(migrated[0].items[0].note,'keep note');
  assert.equal(days[0].items[0].nodeId,m.oldId);
 }
});

test('renamed nodes retain old aliases and exact explicit coordinate decisions include the corrected Y',()=>{
 const review=load('data/geometry/sources/owner-coordinate-overrides.json');
 assert.equal(report.coordinates.length,19);
 for(const r of report.renames)assert.ok(graph.nodes.find(n=>n.id===r.nodeId).aliases.includes(r.oldName));
 const bridge=review.nodes.find(n=>n.nodeId==='node:cc65a12ba6bd7fa8e91b');
 assert.equal(bridge.originalCoordinate.y,2590697);
 assert.ok(bridge.source.ownerAmended);
});

test('old chart imports resolve explicit redirects and keep historical directional snapshots',()=>{
 for(const m of report.merges){
  const legacy={route_id:'LEGACY-REVIEW',nodes:[m.oldNode],segments:[]};
  const input=[{items:[{type:'location',nodeId:m.oldId,name:m.oldNode.name,note:'keep',incoming:{kind:'official',from:m.oldNode.name,to:m.oldNode.name,fromNodeId:m.oldId,toNodeId:m.oldId,officialMinutes:72,actualMinutes:95}}]}];
  const result=migrateLegacyPlanDays(input,legacy,graph)[0].items[0];
  assert.equal(result.nodeId,m.canonicalId);assert.equal(result.incoming.toNodeId,m.canonicalId);
  assert.equal(result.incoming.officialMinutes,72);assert.equal(result.incoming.actualMinutes,95);
  assert.equal(result.note,'keep');
 }
});
