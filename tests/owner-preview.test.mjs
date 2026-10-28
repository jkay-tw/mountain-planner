import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addRouteIdentity,migrateDaysToNodeIds} from '../js/node-identity.js';
import {mergeReviewedRoutes,nodesInScope} from '../js/global-route.js';
import {shortestPath,normalizeDay} from '../js/planner.js';
const load=p=>JSON.parse(readFileSync(new URL('../'+p.split('?')[0],import.meta.url),'utf8'));
const manifest=load('data/unified-editor-manifest.json');
const routes=manifest.routes.map(m=>addRouteIdentity(load(m.file)));
const graph=mergeReviewedRoutes(routes);
test('owner full preview shares reviewed physical nodes and keeps original chart IDs for imported plans',()=>{
 assert.equal(routes.length,24);assert.equal(graph.nodes.length,731);assert.equal(graph.segments.length,1426);
 assert.equal(new Set(routes.flatMap(r=>r.sourceChartIds)).size,19);
 for(const r of load('data/owner-review-base-catalog.json').routes){
  for(const n of load(r.file).nodes){const current=graph.nodes.find(x=>x.id===n.id);assert.ok(current,n.id);assert.equal(current.name,n.name);}
  assert.ok(manifest.legacyRoutes.some(m=>m.id===r.id));
 }
 const n=graph.nodes.find(n=>n.id==='shared:owner-v0724-xiangyang-junction');
 assert.ok(n.groups.includes('G17')&&n.groups.includes('G18'));
 const g15=routes.find(r=>r.route_id==='G15');
 const junction=g15.nodes.filter(n=>n.name==='東鑾/烏達佩岔路');assert.equal(junction.length,1);
 assert.ok(g15.segments.some(e=>e.fromId===junction[0].id&&e.to==='東北鞍營地'));
});
test('full preview reconciles time overrides and condition-specific directional references',()=>{
 const e=graph.segments.find(e=>e.from==='觀高坪'&&e.to==='對觀');assert.equal(e.minutes,110);assert.ok(e.sources.length>=2);
 const summit=graph.segments.find(e=>e.from==='秀姑巒山'&&e.to==='秀姑巒山南登山口');
 assert.equal(summit.minutes,30);assert.ok(summit.timeAlternatives.some(a=>a.kind==='heavy_pack'&&a.minutes===60));
 const volcanic=graph.nodes.find(n=>n.name==='火山');assert.ok(volcanic.aliases.includes('萬里山西峰'));
 for(const e of graph.segments){assert.equal(e.travelMode,'walking');assert.equal(e.verificationStatus,'verified');assert.ok(e.sources.every(s=>s.minutes===e.minutes));}
});
test('transport-only nodes remain addable but road legs never form walking shortcuts',()=>{
 const t=load('data/transport-owner-reviewed.json');assert.equal(t.segments.length,130);
 const g20=routes.find(r=>r.route_id==='G20');
 const a=g20.nodes.find(n=>n.name==='泰武'),b=g20.nodes.find(n=>n.name==='新登山口');
 assert.ok(nodesInScope(graph,'G20').some(n=>n.id===a.id));assert.equal(shortestPath(graph,a.id,b.id),null);
 assert.ok(!routes.find(r=>r.route_id==='G07').nodes.some(n=>n.name==='黑水塘'));
 for(const r of routes){assert.ok(r.segments.every(e=>e.source===r.source.image_url));}
});
test('data updates preserve manual estimates and official snapshots even when new routing exists',()=>{
 const r={nodes:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],segments:[
 {from:'A',to:'B',fromId:'a',toId:'b',minutes:1},{from:'B',to:'C',fromId:'b',toId:'c',minutes:1}]};
 for(const incoming of [
  {kind:'manual',fromId:'i1',toId:'i2',actualMinutes:95,connectionStatus:'unverified'},
  {kind:'manual',fromId:'i1',toId:'i2',actualMinutes:null,connectionStatus:'unverified'},
  {kind:'official',from:'A',to:'C',fromNodeId:'a',toNodeId:'c',officialMinutes:120,actualMinutes:87,source:'saved-source'}
 ]){
  const day={startTime:'06:00',coefficient:.8,note:'keep',items:[{id:'i1',type:'location',nodeId:'a',name:'A',note:'one',incoming:null}, {id:'i2',type:'location',nodeId:'c',name:'C',note:'two',incoming}]};
  const before=structuredClone(day);normalizeDay(day,r);assert.deepEqual(day,before);
 }
});
test('known v1 global itinerary preserves identity, notes and actual-minute override under full graph',()=>{
 const a=graph.nodes.find(n=>n.name==='新登山口'),b=graph.nodes.find(n=>n.name==='舊登山口');
 const days=[{id:'d',startTime:'05:00',coefficient:.7,note:'day note',items:[{id:'i1',type:'location',nodeId:a.id,name:a.name,incoming:null},
 {id:'i2',type:'location',nodeId:b.id,name:b.name,note:'keep me',incoming:{kind:'official',from:a.name,to:b.name,fromNodeId:a.id,toNodeId:b.id,officialMinutes:999,actualMinutes:73}}]}];
 const old=structuredClone(days);const migrated=migrateDaysToNodeIds(days,graph);normalizeDay(migrated[0],graph);assert.deepEqual(migrated,old);
});
