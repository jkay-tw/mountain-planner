import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addRouteIdentity,migrateDaysToNodeIds} from '../js/node-identity.js';
import {mergeReviewedRoutes,nodesInScope} from '../js/global-route.js';
import {migrateLegacyPlanDays} from '../js/legacy-plan-migration.js';
import {shortestPath,normalizeDay} from '../js/planner.js';
const load=p=>JSON.parse(readFileSync(new URL('../'+p.split('?')[0],import.meta.url),'utf8'));
const manifest=load('data/unified-editor-manifest.json');
const routes=manifest.routes.map(m=>addRouteIdentity(load(m.file)));
const graph=mergeReviewedRoutes(routes);
test('owner full preview shares reviewed physical nodes and keeps original chart IDs for imported plans',()=>{
 assert.equal(routes.length,24);assert.equal(graph.nodes.length,729);assert.equal(graph.segments.length,1424);
 assert.equal(new Set(routes.flatMap(r=>r.sourceChartIds)).size,19);
 for(const r of load('data/owner-review-base-catalog.json').routes){
  for(const n of load(r.file).nodes){const current=graph.nodes.find(x=>x.id===n.id);assert.ok(current,n.id);assert.ok(current.name===n.name||current.aliases.includes(n.name));}
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
test('snow identities are shared across G04 and G05, road references stay out of walking',()=>{
 const g04=routes.find(r=>r.route_id==='G04'),g05=routes.find(r=>r.route_id==='G05');
 for(const [name,id] of [['雪山登山口','g04-045'],['武陵農場·遊客中心','node:f6f2ba4c01559d0ff632']]){
  for(const r of [g04,g05])assert.equal(r.nodes.find(n=>n.name===name)?.id,id);
 }
 const trail=shortestPath(graph,'g04-045','shared:cw-v07-003');
 assert.equal(trail.minutes,70);
 assert.equal(shortestPath(graph,'node:f6f2ba4c01559d0ff632','g04-056'),null);
 const t=load('data/transport-owner-reviewed.json');
 for(const [a,b,n] of [['node:f6f2ba4c01559d0ff632','g04-056',10],['g04-056','shared:cw-v07-056',10],['g04-056','g04-045',20]])for(const [x,y] of [[a,b],[b,a]])assert.ok(t.segments.some(e=>e.fromId===x&&e.toId===y&&e.minutes===n&&e.travelMode==='vehicle'));
});
test('old global snow node IDs and saved edge snapshots migrate without losing names or minutes',()=>{
 const days=[{items:[{id:'a',type:'location',name:'雪山登山口',nodeId:'node:1c91e71b467300e90b6c',note:'old'},
 {id:'b',type:'location',name:'七卡山莊',nodeId:'shared:cw-v07-003',incoming:{kind:'official',from:'雪山登山口',to:'七卡山莊',fromNodeId:'node:1c91e71b467300e90b6c',toNodeId:'shared:cw-v07-003',officialMinutes:70,actualMinutes:88}}]}];
 const migrated=migrateDaysToNodeIds(days,graph);normalizeDay(migrated[0],graph);
 assert.equal(migrated[0].items[0].nodeId,'g04-045');assert.equal(migrated[0].items[0].note,'old');
 assert.equal(migrated[0].items[1].incoming.actualMinutes,88);assert.equal(migrated[0].items[1].incoming.officialMinutes,70);
 assert.throws(()=>migrateDaysToNodeIds([{items:[{type:'location',name:'錯誤',nodeId:'node:1c91e71b467300e90b6c'}]}],graph));
});

test('old G05 scoped plans migrate retired IDs and retain user data',()=>{
 const source=routes.find(r=>r.route_id==='G05');
 const old=[{items:[{type:'location',id:'a',name:'武陵農場',nodeId:'node:fba428b6693c1f3ff1b9',note:'停車'},
 {type:'location',id:'b',name:'雪山登山口',nodeId:'node:1c91e71b467300e90b6c',incoming:{kind:'manual',fromId:'a',toId:'b',actualMinutes:25}}]}];
 const result=migrateLegacyPlanDays(old,source,graph);
 assert.equal(result[0].items[0].nodeId,'node:f6f2ba4c01559d0ff632');
 assert.equal(result[0].items[1].nodeId,'g04-045');
 assert.equal(result[0].items[1].incoming.actualMinutes,25);
 assert.equal(result[0].items[0].note,'停車');
});
