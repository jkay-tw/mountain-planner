import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeReviewedRoutes} from '../js/global-route.js';
import {migrateDaysToNodeIds} from '../js/node-identity.js';
import {migrateLegacyPlanDays} from '../js/legacy-plan-migration.js';
import {toTwd97} from '../js/twd97.js';
const load=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const report=load('data/geometry/sources/sheet-review-application-20261112.json');
const manifest=load('data/unified-editor-manifest.json');
const graph=mergeReviewedRoutes(manifest.routes.map(r=>load(r.file.split('?')[0])));
const terrain=load('preview/data/geometry/planner-terrain-v1.json');

test('ten owner coordinates reach DEM runtime and no identity is merged',()=>{
 assert.equal(report.coordinates.length,10);assert.equal(report.merges.length,0);
 assert.equal(graph.nodes.length,720);assert.equal(graph.segments.length,1398);
 assert.equal(report.directionalSignatureBefore,report.directionalSignatureAfter);
 for(const r of report.coordinates){const n=terrain.nodes.find(n=>n.nodeId===r.nodeId);assert.deepEqual(n.coordinate,r.coordinate);assert.deepEqual(toTwd97(n.coordinate),r.twd97);assert.ok(Number.isFinite(n.elevationMeters));}
});

test('retired terminal camp preserves both historical 35 minute directions and saved itinerary snapshots',()=>{
 const r=report.retirement,n=r.node;
 assert.equal(r.originalSegments.length,2);assert.ok(r.originalSegments.every(e=>e.minutes===35));
 assert.ok(!graph.nodes.some(x=>x.id===n.id));assert.ok(!terrain.nodes.some(x=>x.nodeId===n.id));
 const days=[{items:[{type:'location',nodeId:n.id,name:n.name,note:'saved',incoming:{kind:'official',officialMinutes:35,actualMinutes:51}}]}];
 for(const migrated of [migrateDaysToNodeIds(days,graph),migrateLegacyPlanDays(days,{route_id:'G13',nodes:[n],segments:[]},graph)]){
  const item=migrated[0].items[0];assert.equal(item.catalogStatus,'retired');assert.equal(item.note,'saved');assert.equal(item.incoming.actualMinutes,51);assert.equal(item.incoming.officialMinutes,35);
 }
 assert.equal(days[0].items[0].catalogStatus,undefined);
});

test('both 20 minute transport references preserve source evidence and cannot enter walking geometry',()=>{
 const transport=load('data/transport-owner-reviewed.json');
 for(const c of report.vehicleCorrections){
  const old=c.original,e=transport.segments.find(s=>s.fromId===old.fromId&&s.toId===old.toId);
  assert.equal(e.minutes,old.minutes);assert.equal(e.minutes,20);assert.equal(e.travelMode,'vehicle');assert.equal(e.routingEnabled,false);
  for(const key of Object.keys(old).filter(k=>!['travelMode','routingEnabled'].includes(k)))assert.deepEqual(e[key],old[key]);
  assert.ok(!graph.segments.some(s=>s.fromId===e.fromId&&s.toId===e.toId));
  assert.ok(!terrain.coverage.unrepresentedPairs.some(s=>new Set([s.fromId,s.toId]).size===2&&[s.fromId,s.toId].every(id=>[e.fromId,e.toId].includes(id))));
 }
 assert.equal(terrain.nodes.find(n=>n.nodeId==='node:bca4509332fbaaf5f94e').coordinatePolicy,'vehicle-only');
});
