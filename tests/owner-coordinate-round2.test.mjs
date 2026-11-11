import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeReviewedRoutes} from '../js/global-route.js';
import {migrateDaysToNodeIds} from '../js/node-identity.js';
import {toTwd97} from '../js/twd97.js';
const load=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const application=load('data/geometry/sources/owner-coordinate-round2-application-20261111.json');
const terrain=load('preview/data/geometry/planner-terrain-v1.json');
const owner=load('data/geometry/sources/owner-coordinate-overrides.json');
const manifest=load('data/unified-editor-manifest.json');
const graph=mergeReviewedRoutes(manifest.routes.map(r=>load(r.file.split('?')[0])));

test('56 owner coordinates round-trip in TWD97; all walking points have DEM without changing display policy',()=>{
 assert.equal(application.coordinates.length,56);
 assert.equal(application.timeSignatureBefore,application.timeSignatureAfter);
 assert.equal(application.merges.length,0);
 for(const c of application.coordinates){
  const r=owner.nodes.find(n=>n.nodeId===c.nodeId),n=terrain.nodes.find(n=>n.nodeId===c.nodeId);
  assert.deepEqual(r.originalCoordinate,{format:'TWD97',x:c.twd97[0],y:c.twd97[1]});
  const xy=toTwd97(r.coordinate);assert.ok(xy.every((v,i)=>Math.abs(v-c.twd97[i])<1));
  if(n.coordinatePolicy==='active'){assert.deepEqual(n.coordinate,c.coordinate);assert.ok(Number.isFinite(n.elevationMeters));}
  else assert.equal(n.coordinate,null);
 }
 assert.equal(terrain.counts.located,674);
 assert.ok(terrain.nodes.every(n=>n.coordinatePolicy!=='active'||n.coordinate));
 assert.deepEqual(load('data/geometry/planner-terrain-v1.json'),terrain);
});

test('explicit names preserve IDs, old itinerary labels and owner alias without merging nearby places',()=>{
 assert.equal(graph.nodes.length,720);
 assert.equal(application.renames.length,2);
 for(const r of application.renames){
  const n=graph.nodes.find(n=>n.id===r.nodeId);assert.equal(n.name,r.name);assert.ok(n.aliases.includes(r.oldName));
  const days=[{items:[{type:'location',nodeId:r.nodeId,name:r.oldName,note:'retain'}]}];
  const migrated=migrateDaysToNodeIds(days,graph);assert.equal(migrated[0].items[0].nodeId,r.nodeId);assert.equal(migrated[0].items[0].note,'retain');
 }
 assert.ok(graph.nodes.find(n=>n.id==='g14-026').aliases.includes('關門大營地'));
 const retained=terrain.nodes.find(n=>n.nodeId==='node:c25918006df5f04534c8');
 assert.deepEqual(toTwd97(retained.coordinate),[268658,2608675]);
});
