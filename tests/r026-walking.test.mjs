import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSnapshot} from '../tools/route-validator/core.mjs';
import {chartStartNodes} from '../preview/js/chart-starts.js';
import {mergeReviewedRoutes} from '../preview/js/global-route.js';
import {withClassicSources} from '../preview/js/classic-route-source.js';
import {routeContext} from '../preview/js/classic-route.js';
import {prepareClassicDay} from '../preview/js/classic-route-apply.js';
import {resolveItineraryGeometry} from '../preview/js/itinerary-geometry.js';
import {validatePlan} from '../preview/js/validation.js';
import {directionalQuickAdd} from '../preview/js/quick-add.js';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url)));
const old=normalizeSnapshot(read('data/route-validator/snapshots/sheet-20261125-order-complete.json')),input=normalizeSnapshot(read('data/route-validator/snapshots/sheet-20261125-r026-walking.json'));
const catalog=read('data/staging/idea002/classic-routes.candidate.json'),manifest=read('preview/data/unified-editor-manifest.json'),graph=mergeReviewedRoutes(manifest.routes.map(m=>read('preview/'+m.file.split('?')[0])));
const augmented=withClassicSources(graph,read('preview/data/geometry/planner-terrain-v1.json'),catalog.supplement),context=routeContext(augmented.graph,augmented.geometry,catalog.graphDigest);
test('R026 alone changes: remove terminal driving occurrences, retain all inner order, flags and excluded history',()=>{
 const before=old.routes.find(r=>r.routeId==='R026'),after=input.routes.find(r=>r.routeId==='R026');
 assert.equal(after.occurrences.length,33);assert.deepEqual(after.occurrences.map(n=>({nodeId:n.nodeId,key:n.key})),before.occurrences.slice(1,-1).map(n=>({nodeId:n.nodeId,key:n.key})));
 assert.deepEqual(after.occurrences.map(n=>n.position),Array.from({length:33},(_,i)=>i+1));
 assert.equal(after.row['規劃起點'],'神木區登山口');assert.equal(after.row['終點／折返點'],'神木區登山口');assert.equal(after.row['實際有效節點數'],33);assert.ok(after.row['規劃備註'].includes('車行'));
 assert.equal(input.excluded.filter(n=>n.routeId==='R026'&&n.nodeId==='g04-062').length,2);
 assert.deepEqual(input.excluded.filter(n=>n.nodeId==='g04-fork-zhenxibao'),old.excluded.filter(n=>n.nodeId==='g04-fork-zhenxibao'));
 for(const r of input.routes.filter(r=>r.routeId!=='R026'))assert.deepEqual(r,old.routes.find(p=>p.routeId===r.routeId));
});
test('G04 starts contain connected Shenmu trailhead and do not offer vehicle-only Zhenxibao',()=>{
 const ids=chartStartNodes(graph,catalog,manifest,'G04').map(n=>n.id);assert.ok(ids.includes('g04-033'));assert.ok(!ids.includes('g04-062'));
 const choices=directionalQuickAdd(graph,{items:[{id:'start',type:'location',nodeId:'g04-033',name:'神木區登山口',incoming:null}]});assert.ok(choices.length>0);
 assert.ok(graph.segments.some(s=>s.fromId==='g04-033'&&s.toId==='g04-065'&&s.travelMode==='walking'));
});
test('R026 applies 33 walking occurrences in either direction without transport time or geometry gaps',async()=>{
 let id=0;
 for(const direction of ['forward','reverse']){
  const definition=catalog.routes.find(r=>r.routeId==='R026')[direction];assert.deepEqual(definition.issues,[]);assert.ok(definition.directedSegments.every(s=>s.edgeRef.kind==='walking'));
  const day=await prepareClassicDay(definition,context,augmented.geometry,{id:'day',startTime:'06:00',coefficient:.8,items:[],linkedStart:false,note:''},()=>String(++id),catalog.spanDigests);
  assert.equal(day.items.length,33);assert.equal(day.items[0].nodeId,'g04-033');assert.equal(day.items.at(-1).nodeId,'g04-033');assert.ok(day.items.every(i=>i.nodeId!=='g04-062'&&i.incoming?.travelMode!=='vehicle'));
  validatePlan({format:'mountain-planner',schemaVersion:1,routeId:'GLOBAL-PREVIEW',days:[day]},['GLOBAL-PREVIEW']);assert.equal(resolveItineraryGeometry([day],augmented.geometry).gaps.length,0);
 }
});
