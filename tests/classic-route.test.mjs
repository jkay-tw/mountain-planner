import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {routeContext,compileClassicRoute,reverseClassicRoute,validateClassicRoute,directedVehicleReference,vehiclePlannedMinutes} from '../preview/js/classic-route.js';
import {buildCatalog} from '../tools/compile_classic_routes.mjs';
const source={baseCommit:'a'.repeat(40),snapshotRef:'source.json',snapshotSha256:'b'.repeat(64),decisionRef:'decisions.json',decisionSha256:'c'.repeat(64),geometrySha256:'d'.repeat(64),spreadsheetId:'test'};
const edge=(fromId,toId,minutes)=>({fromId,toId,minutes,travelMode:'walking',verificationStatus:'verified'});
const span=(fromId,toId,id=fromId+toId)=>({id,fromId,toId,reversible:true});
const context=(edges,spans=[],manuals=[])=>routeContext({nodes:['A','B','C','D','X'].map(id=>({id,name:id})),segments:edges,manualConnections:manuals},{spans},'graph-v1');
const input=(ids,extra={})=>({routeId:'R001',name:'test',type:'out_and_back',source,anchors:ids.map(nodeId=>({nodeId,key:true})),...extra});
const fixture=()=>context([edge('A','B',25),edge('B','A',15)],[span('A','B')]);

test('nonadjacent repeat occurrences and important flags survive exact reversal',()=>{
 const c=fixture(),r=compileClassicRoute(input(['A','B','A']),c),back=reverseClassicRoute(r,c);
 assert.deepEqual(r.occurrences.map(o=>o.nodeId),['A','B','A']);
 assert.deepEqual(back.occurrences.map(o=>o.position),[0,1,2]);
 assert.ok(back.occurrences.every(o=>o.key));
 assert.equal(c.edges.get(JSON.stringify(['B','A'])).minutes,15);
 assert.deepEqual(back.geometryBindings.map(b=>b.reverse),[false,true]);
 assert.deepEqual(reverseClassicRoute(back,c).occurrences,r.occurrences);
 assert.equal(r.verification,'candidate');assert.throws(()=>validateClassicRoute(r,c,{requireVerified:true}));
});
test('explicit direct sequence is retained even if another path is faster',()=>{
 const c=context([edge('A','B',100),edge('A','C',1),edge('C','B',1)],[span('A','B')]);
 assert.deepEqual(compileClassicRoute(input(['A','B']),c).occurrences.map(o=>o.nodeId),['A','B']);
});
test('anchor expansion honors exclusion and cannot recreate the excluded node',()=>{
 const c=context([edge('A','X',1),edge('X','B',1),edge('A','C',5),edge('C','B',5)],[span('A','C'),span('C','B')]);
 const r=compileClassicRoute(input(['A','B'],{expandAnchors:true,excludedNodeIds:['X']}),c);
 assert.deepEqual(r.occurrences.map(o=>o.nodeId),['A','C','B']);assert.equal(r.occurrences[1].key,false);
 assert.throws(()=>compileClassicRoute(input(['X','B'],{excludedNodeIds:['X']}),c));
});
test('reverse uses exact reverse edges, never a reachable alternative',()=>{
 const c=context([edge('A','B',10),edge('B','C',5),edge('C','A',5)],[span('A','B')]);
 const r=reverseClassicRoute(compileClassicRoute(input(['A','B']),c),c);
 assert.deepEqual(r.occurrences.map(o=>o.nodeId),['B','A']);assert.equal(r.directionStatus,'blocked');
 assert.equal(r.directedSegments[0].timeStatus,'unknown');
});
test('a different return geometry cannot silently replace the exact reversed source span',()=>{
 const c=context([edge('A','B',10),edge('B','A',15)],[{...span('A','B','outward'),reversible:false},{...span('B','A','other-way'),reversible:false}]);
 const r=reverseClassicRoute(compileClassicRoute(input(['A','B']),c),c);
 assert.equal(r.applicationStatus,'blocked');assert.ok(r.issues.some(i=>i.code==='REVERSE_GEOMETRY_REVIEW_REQUIRED'));
});
test('owner-confirmed unknown minutes remain manual-required in both directions',()=>{
 const manuals=[['A','B'],['B','A']].map(([fromId,toId])=>({fromId,toId,minutes:null,travelMode:'walking',manualTimeRequired:true,verificationStatus:'owner-confirmed-connection'}));
 const c=context([],[{...span('A','B'),ownerConfirmed:true}],manuals),r=compileClassicRoute(input(['A','B','A']),c);
 for(const v of [r,reverseClassicRoute(r,c)]){assert.equal(v.directionStatus,'manual-time-required');assert.ok(v.directedSegments.every(s=>s.timeStatus==='manual-required'));}
});
test('vehicle defaults and overrides are independent of walking coefficients; unknown stays null',()=>{
 for(const coefficient of [.1,.8,1,3]){
  assert.equal(vehiclePlannedMinutes({minutes:5,actualMinutes:null,coefficient}),5);
  assert.equal(vehiclePlannedMinutes({minutes:5,actualMinutes:9,coefficient}),9);
  assert.equal(vehiclePlannedMinutes({minutes:null,actualMinutes:null,coefficient}),null);
  assert.equal(vehiclePlannedMinutes({minutes:null,actualMinutes:0,coefficient}),0);
 }
 assert.throws(()=>vehiclePlannedMinutes({minutes:-1}));assert.throws(()=>vehiclePlannedMinutes({minutes:5,actualMinutes:NaN}));
});
test('vehicle source lookup uses exact endpoints and direction, never a reverse fallback',()=>{
 const transport={routingEnabled:false,segments:[{...edge('A','B',5),travelMode:'vehicle',source:'reviewed-chart'}]};
 assert.equal(directedVehicleReference(transport,'A','B').minutes,5);
 const reverse=directedVehicleReference(transport,'B','A');assert.equal(reverse.minutes,null);assert.equal(reverse.timeStatus,'manual-required');
 assert.equal(directedVehicleReference(transport,'A','C').minutes,null);
 assert.throws(()=>directedVehicleReference({segments:[...transport.segments,{...transport.segments[0],minutes:9}]},'A','B'));
});
test('conflicting source times, wrong IDs, directions and graph versions are rejected',()=>{
 assert.throws(()=>context([edge('A','B',10),edge('A','B',11)]));
 const c=fixture(),r=compileClassicRoute(input(['A','B']),c);
 for(const mutate of [r=>r.occurrences[0].nodeId='unknown',r=>r.directedSegments[0].edgeRef.fromId='B',r=>r.directedSegments[0].edgeRef.graphDigest='new',r=>r.geometryBindings[0].spanId='wrong',r=>r.verification='verified']){
  const bad=structuredClone(r);mutate(bad);assert.throws(()=>validateClassicRoute(bad,c));
 }
});
test('ambiguous or absent geometry blocks readiness without fabricating a line',()=>{
 for(const spans of [[],[span('A','B','one'),span('A','B','two')]]){
  const c=context([edge('A','B',10)],spans),r=compileClassicRoute(input(['A','B']),c);
  assert.equal(r.applicationStatus,'blocked');assert.equal(r.geometryBindings.length,0);
  const bad=structuredClone(r);bad.issues=[];bad.applicationStatus='candidate-review';assert.throws(()=>validateClassicRoute(bad,c));
 }
});
test('aggregate geometry cannot hide an excluded node between permitted endpoints',()=>{
 const c=context([edge('A','B',10)],[{...span('A','B'),viaNodeIds:['X']}]);
 const r=compileClassicRoute(input(['A','B'],{excludedNodeIds:['X']}),c);
 assert.equal(r.applicationStatus,'blocked');assert.equal(r.geometryBindings.length,0);
});
test('multi-segment placeholder cannot become walking-ready by reversing it',()=>{
 const c=fixture(),r=compileClassicRoute(input(['A','B'],{type:'multi_segment'}),c);
 for(const v of [r,reverseClassicRoute(r,c)]){assert.equal(v.directionStatus,'blocked');assert.ok(v.issues.some(i=>i.code==='MULTI_SEGMENT_REVIEW_REQUIRED'));}
});
test('real candidate catalog is deterministic, pinned to reviewed snapshot and current Preview hashes',()=>{
 const catalog=buildCatalog(),again=buildCatalog();assert.deepEqual(catalog,again);
 const saved=JSON.parse(readFileSync(new URL('../data/staging/idea002/classic-routes.candidate.json',import.meta.url)));assert.deepEqual(catalog,saved);
 assert.equal(catalog.baseCommit,'65d10c572b278d96c146d9f2a9d88cd69ba3cdfe');
 assert.deepEqual(catalog.routes.filter(r=>r.pilot).map(r=>r.routeId),['R001','R015','R027','R057']);
 for(const r of catalog.routes)for(const d of [r.forward,r.reverse])assert.equal(d.verification,'candidate');
 const get=id=>catalog.routes.find(r=>r.routeId===id);
 assert.equal(catalog.dataSource,'current-preview-working-tree');
 assert.equal(catalog.snapshotSha256,'a13bcf8f91af4a19f2d1332d20d285faecb110dad2cb2ce2074d30e9d3095e1a');
 assert.equal(get('R057').forward.directionStatus,'manual-time-required');assert.equal(get('R057').reverse.directionStatus,'manual-time-required');
 assert.equal(get('R057').forward.issues.length,0);
 const expected=['node:1cf8b3c84c8feaa7f234','node:423790cb65cc1bad5df4','node:cfc709350cf852b13fe1','node:0969f8657ba80bf5fdd2','node:cfc709350cf852b13fe1','node:423790cb65cc1bad5df4','node:194fcc1bb298ce914692','node:423790cb65cc1bad5df4','node:1cf8b3c84c8feaa7f234'];
 assert.deepEqual(get('R030').forward.occurrences.filter(o=>expected.includes(o.nodeId)).map(o=>o.nodeId),expected);
 for(const id of ['R070','R072'])for(const d of [get(id).forward,get(id).reverse]){assert.ok(!d.occurrences.some(o=>o.nodeId==='shared:cw-v07-068'));assert.equal(d.applicationStatus,'candidate-review');}
 for(const d of [get('R081').forward,get('R081').reverse])assert.equal(d.directionStatus,'manual-time-required');
});
test('source snapshot preserves Sheet decisions separately from compilation overrides',()=>{
 const root=new URL('../',import.meta.url),snapshot=JSON.parse(readFileSync(new URL('data/staging/idea002/sheet-snapshot-20261120.json',root)));
 assert.ok(snapshot.routes.find(r=>r.routeId==='R026').originalKeyOrder.includes('中霸山屋'));
 assert.ok(snapshot.routes.find(r=>r.routeId==='R030').originalKeyOrder.startsWith('中興路口(66.55K)'));
});
