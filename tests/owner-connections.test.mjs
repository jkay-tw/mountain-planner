import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeReviewedRoutes} from '../js/global-route.js';
import {quickAddCandidates,appendQuickPath} from '../js/quick-add.js';
import {shortestPath,normalizeDay,edgeActual,missingSegments,ownerTimedConnection,incomingForSegment} from '../js/planner.js';
import {migrateDaysToNodeIds} from '../js/node-identity.js';
import {resolveItineraryGeometry} from '../js/itinerary-geometry.js';
const load=p=>JSON.parse(readFileSync(new URL('../'+p.split('?')[0],import.meta.url),'utf8'));
const manifest=load('data/unified-editor-manifest.json'),routes=manifest.routes.map(r=>load(r.file)),graph=mergeReviewedRoutes(routes);
const camp='local:G19::shenchi-camp',summit='node:d93ab765aeb31141e24c';
test('G19 removal and explicit alias do not rename the other water sources',()=>{
 const r=routes.find(r=>r.route_id==='G19');
 assert.ok(!r.nodes.some(n=>['鐵杉營地','登山口','凹谷營地'].includes(n.name)));
 assert.deepEqual(r.nodes.find(n=>n.id===camp).aliases,['第一水源']);
 assert.equal(r.nodes.filter(n=>n.name==='水源').length,2);
 for(const s of r.segments)assert.ok(r.nodes.some(n=>n.id===s.fromId)&&r.nodes.some(n=>n.id===s.toId));
});
test('both owner connections have no official time and never become zero-time shortcuts',()=>{
 for(const [a,b] of [[camp,summit],[summit,camp]]){
  const s=ownerTimedConnection(graph,a,b);assert.ok(s);assert.equal(s.minutes,null);
  assert.equal(shortestPath(graph,a,b),null);
  const e=incomingForSegment(s,'i1','i2');assert.equal(e.kind,'manual');assert.equal(edgeActual(e,.8),null);assert.equal(e.officialMinutes,undefined);
 }
 assert.ok(graph.segments.every(s=>s.verificationStatus==='verified'&&Number.isFinite(s.minutes)));
});
test('quick add exposes both directions and retains a manually entered estimate',()=>{
 let id=0;
 for(const [a,b] of [[camp,summit],[summit,camp]]){
  const n=graph.nodes.find(n=>n.id===a),d={startTime:'06:00',coefficient:.8,items:[{id:'start',type:'location',nodeId:a,name:n.name,note:'keep',incoming:null}]};
  const c=quickAddCandidates(graph,a).find(c=>c.nodeId===b&&c.segments.length===1);assert.ok(c);
  assert.equal(appendQuickPath(d,graph,c.key,()=>String(++id)),true);assert.equal(missingSegments(d),1);
  d.items[1].incoming.actualMinutes=123;d.coefficient=1.2;normalizeDay(d,graph);
  assert.equal(d.items[1].incoming.actualMinutes,123);assert.equal(edgeActual(d.items[1].incoming,.5),123);assert.equal(missingSegments(d),0);
 }
});
test('normal reconnection uses an explicit owner edge without fabricating a time',()=>{
 const d={startTime:'06:00',coefficient:.8,items:[{id:'a',type:'location',nodeId:camp,name:'神池營地',incoming:null},{id:'b',type:'location',nodeId:summit,name:'小關山'}]};
 normalizeDay(d,graph);assert.equal(d.items[1].incoming.connectionStatus,'owner-confirmed');assert.equal(missingSegments(d),1);
});
test('deleted catalog nodes in saved plans retain identity, notes and time snapshots',()=>{
 const old={nodeId:'node:5432a0accfa0ca8738af',name:'鐵杉營地',type:'location',note:'saved',id:'x'};
 const result=migrateDaysToNodeIds([{items:[old]}],graph)[0].items[0];
 assert.equal(result.catalogStatus,'retired');assert.equal(result.note,'saved');assert.equal(result.nodeId,old.nodeId);
 assert.throws(()=>migrateDaysToNodeIds([{items:[{...old,name:'wrong'}]}],graph));
});
test('active geometry loads all selected active labels and keeps pilot geometry unchanged',()=>{
 const full=load('data/geometry/planner-terrain-v1.json'),pilot=load('data/geometry/xueshan-terrain-v1.json');
 assert.equal(full.counts.activeNodes,724);assert.equal(full.counts.located,622);assert.equal(full.counts.unlocated,102);
 assert.deepEqual(new Set(full.nodes.map(n=>n.nodeId)),new Set(graph.nodes.map(n=>n.id)));
 for(const s of pilot.spans)assert.deepEqual(full.spans.find(x=>x.id===s.id),s);
 for(const n of pilot.nodes)assert.deepEqual(Object.fromEntries(Object.keys(n).map(k=>[k,full.nodes.find(x=>x.nodeId===n.nodeId)[k]])),n);
 const d={items:[{id:'a',type:'location',nodeId:camp,name:'神池營地',incoming:null},{id:'b',type:'location',nodeId:summit,name:'小關山',incoming:incomingForSegment(ownerTimedConnection(graph,camp,summit),'a','b')}]};
 const result=resolveItineraryGeometry([d],full);assert.equal(result.waypoints.length,1);assert.equal(result.unlocated.length,1);assert.equal(result.gaps.length,1);assert.equal(result.days[0].features.length,0);
});
