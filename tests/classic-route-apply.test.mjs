import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSnapshot} from '../tools/route-validator/core.mjs';
import {routeContext} from '../preview/js/classic-route.js';
import {prepareClassicDay,routePickerNodes,searchClassicRoutes,hasRouteDirection,classicRoutePreview} from '../preview/js/classic-route-apply.js';
import {withClassicSources} from '../preview/js/classic-route-source.js';
import {resolveItineraryGeometry,geometryToGpx} from '../preview/js/itinerary-geometry.js';
import {normalizeDay,summarizeDay} from '../preview/js/planner.js';
import {mergeReviewedRoutes} from '../preview/js/global-route.js';
import {validatePlan} from '../preview/js/validation.js';
import {visibleTimelineRows} from '../preview/js/path-editor.js';
import {classicSplitIssue} from '../preview/js/classic-route-geometry.js';
import {applyDayDisplay} from '../preview/js/day-display.js';
import {auditR057} from '../tools/audit_r057_osm.mjs';
const root=new URL('../',import.meta.url),catalog=JSON.parse(readFileSync(new URL('data/staging/idea002/classic-routes.candidate.json',root)));
const baseline=p=>JSON.parse(readFileSync(new URL(p,root)));
const manifest=baseline('preview/data/unified-editor-manifest.json'),datasets=manifest.routes.map(m=>baseline('preview/'+m.file.split('?')[0])),graph=mergeReviewedRoutes(datasets),augmented=withClassicSources(graph,baseline('preview/data/geometry/planner-terrain-v1.json'),catalog.supplement),geometry=augmented.geometry,context=routeContext(augmented.graph,geometry,catalog.graphDigest);
let id=0;const uid=()=>String(++id),blank=()=>({id:uid(),startTime:'06:00',coefficient:.8,linkedStart:false,note:'preserve',items:[]});
const def=(id,direction='forward')=>catalog.routes.find(r=>r.routeId===id)[direction];
const prepare=(id,direction='forward',day=blank())=>prepareClassicDay(def(id,direction),context,geometry,day,uid,catalog.spanDigests);
test('all enabled Sheet routes apply with exact occurrences, direction times and saved geometry',async()=>{
 const sheet=normalizeSnapshot(JSON.parse(readFileSync(new URL(catalog.snapshotRef,root))));
 assert.deepEqual(catalog.enabledRouteIds,sheet.routes.filter(r=>r.enabled&&r.occurrences.length>1).map(r=>r.routeId));
 assert.equal(catalog.routes.length,60);
 assert.equal(catalog.routes.reduce((n,r)=>n+r.forward.occurrences.length,0),1469);
 for(const entry of catalog.routes)for(const direction of ['forward','reverse']){
  const definition=entry[direction],day=await prepare(entry.routeId,direction);
  const expected=sheet.routes.find(r=>r.routeId===entry.routeId).occurrences.map(n=>({nodeId:n.nodeId,key:n.key}));if(direction==='reverse')expected.reverse();
  assert.deepEqual(definition.occurrences.map(n=>({nodeId:n.nodeId,key:n.key})),expected,entry.routeId+' literal Sheet order');
  assert.deepEqual(definition.issues,[],entry.routeId+' '+direction);
  assert.deepEqual(day.items.map(i=>i.nodeId),definition.occurrences.map(o=>o.nodeId));
  validatePlan(JSON.parse(JSON.stringify({format:'mountain-planner',schemaVersion:1,routeId:'GLOBAL-PREVIEW',tripStartDate:'',days:[day]})),['GLOBAL-PREVIEW']);
  normalizeDay(day,graph);
  assert.equal(resolveItineraryGeometry([day],geometry).gaps.length,0,entry.routeId+' '+direction);
  for(let i=1;i<day.items.length;i++){
   const ref=definition.directedSegments[i-1].edgeRef,key=JSON.stringify([ref.fromId,ref.toId]);
   if(ref.kind==='vehicle')assert.equal(day.items[i].incoming.actualMinutes,context.vehicles.get(key).minutes);
   else if(ref.kind==='walking')assert.equal(day.items[i].incoming.officialMinutes,context.edges.get(key).minutes);
  }
 }
});
for(const routeId of ['R052'])test(routeId+' separates driving time from walking, draws no driving line and preserves JSON',async()=>{
 const day=await prepare(routeId),cars=day.items.filter(i=>i.incoming?.travelMode==='vehicle');assert.equal(cars.length,routeId==='R026'?2:3);
 assert.ok(!day.items.some(i=>['g04-fork-zhenxibao','node:67f469173d3d382ca79c'].includes(i.nodeId)));
 assert.ok(cars.every(i=>i.incoming.actualMinutes===(routeId==='R026'?10:null)));
 for(const c of [.4,2]){day.coefficient=c;normalizeDay(day,graph);assert.ok(cars.every(i=>i.incoming.actualMinutes===(routeId==='R026'?10:null)));}
 cars[0].incoming.actualMinutes=29;normalizeDay(day,graph);assert.equal(cars[0].incoming.actualMinutes,29);
 const resolved=resolveItineraryGeometry([day],geometry);assert.equal(resolved.gaps.length,0);for(const item of cars)assert.ok(!resolved.days[0].features.some(f=>f.toItemId===item.id));
 validatePlan(JSON.parse(JSON.stringify({format:'mountain-planner',schemaVersion:1,routeId:'GLOBAL-PREVIEW',tripStartDate:'',days:[day]})),['GLOBAL-PREVIEW']);
});
for(const routeId of ['R001','R015','R027','R057'])test(routeId+' applies both directions with all occurrences and exact source geometry',async()=>{
 const results=[];
 for(const direction of ['forward','reverse']){
  const route=def(routeId,direction),day=await prepare(routeId,direction),snapshot=JSON.stringify(day);normalizeDay(day,graph);
  assert.equal(JSON.stringify(day),snapshot);assert.deepEqual(day.items.map(i=>i.nodeId),route.occurrences.map(o=>o.nodeId));
  assert.equal(new Set(day.items.map(i=>i.id)).size,day.items.length);assert.ok(visibleTimelineRows(day.items,day).length<day.items.length);
  const resolved=resolveItineraryGeometry([day],geometry);assert.equal(resolved.gaps.length,0);
  results.push(resolved.days[0]);
  assert.deepEqual(resolved.days[0].features.map(f=>({id:f.spanId,reverse:f.reverse})),route.geometryBindings.map(b=>({id:b.spanId,reverse:b.reverse})));
  assert.ok(geometryToGpx(resolved,geometry).includes('<trkseg>'));assert.equal(day.note,'preserve');
 }
 assert.ok(results.every(r=>Number.isFinite(r.ascentMeters)&&Number.isFinite(r.descentMeters)));
 assert.ok(Math.abs(results[0].distanceMeters-results[1].distanceMeters)<.001);
 assert.ok(Math.abs(results[0].ascentMeters-results[1].descentMeters)<.001);
 assert.ok(Math.abs(results[0].descentMeters-results[1].ascentMeters)<.001);
});
test('DAY application is nonmutating and refuses occupied targets',async()=>{
 const day=blank(),before=JSON.stringify(day);await prepare('R001','forward',day);assert.equal(JSON.stringify(day),before);
 day.items=[{id:'existing',note:'manual time'}];await assert.rejects(()=>prepare('R001','forward',day));assert.equal(day.items[0].note,'manual time');
});
test('R057 keeps unknown minutes manual across normalization and JSON; supplied coordinates do not become connectors',async()=>{
 const day=await prepare('R057'),manual=day.items.find(i=>i.incoming?.kind==='manual');assert.ok(manual);assert.equal(manual.incoming.actualMinutes,null);manual.incoming.actualMinutes=217;
 normalizeDay(day,graph);assert.equal(manual.incoming.actualMinutes,217);assert.equal(manual.incoming.connectionStatus,'owner-confirmed');
 validatePlan({format:'mountain-planner',schemaVersion:1,routeId:'GLOBAL-PREVIEW',tripStartDate:'',days:[day]},['GLOBAL-PREVIEW']);
 const line=day.items.find(i=>i.classicGeometry?.spanId.startsWith('classic-R057')).classicGeometry.coordinates;
 const clip=catalog.supplement.spans.find(s=>s.id==='classic-R057-north-to-3241-20261125');
 assert.deepEqual(line,clip.coordinates);assert.ok(clip.profile.every(p=>Number.isFinite(p[1])));
 assert.equal(clip.toId,'node:79b43ef005b9dfe9c481');
 assert.equal(graph.manualConnections.some(e=>e.source?.includes('北稜試作')),false);
});
test('preview follows exact occurrence direction, retaining returns; direction control is limited to loops and traverses',()=>{
 assert.equal(hasRouteDirection(def('R001')),false);assert.equal(hasRouteDirection(def('R015')),true);assert.equal(hasRouteDirection(def('R027')),true);assert.equal(hasRouteDirection({type:'multi_segment'}),false);
 for(const id of ['R001','R015','R027','R057']){const forward=classicRoutePreview(def(id),context,geometry),reverse=classicRoutePreview(def(id,'reverse'),context,geometry);assert.deepEqual(reverse.names,[...forward.names].reverse());assert.equal(forward.lines.length,def(id).geometryBindings.length);}
});
test('all/important/custom never change saved full GPX, directional time, manual minutes or terrain totals',async()=>{
 const day=await prepare('R001');day.items[1].incoming.actualMinutes=117;
 const before=summarizeDay(day),resolved=resolveItineraryGeometry([day],geometry),gpx=geometryToGpx(resolved,geometry);
 for(const mode of ['all','custom','important']){
  applyDayDisplay(day,mode,[]);assert.deepEqual(summarizeDay(day),before);assert.equal(day.items[1].incoming.actualMinutes,117);
  const after=resolveItineraryGeometry([day],geometry);assert.equal(geometryToGpx(after,geometry),gpx);
  assert.equal(after.distanceMeters,resolved.distanceMeters);assert.equal(after.days[0].ascentMeters,resolved.days[0].ascentMeters);assert.equal(after.days[0].descentMeters,resolved.days[0].descentMeters);
 }
});
test('a changed source span blocks new application but never changes saved itinerary geometry or time',async()=>{
 const day=await prepare('R001');day.items[1].incoming.actualMinutes=123;
 const before=resolveItineraryGeometry([day],geometry),updated=structuredClone(geometry);updated.spans.reverse();
 const changed=updated.spans.find(s=>s.id===day.items[0].classicGeometry.spanId);changed.coordinates[1][0]+=.0001;
 assert.deepEqual(resolveItineraryGeometry([day],updated),before);normalizeDay(day,graph);assert.equal(day.items[1].incoming.actualMinutes,123);
 await assert.rejects(()=>prepareClassicDay(def('R001'),routeContext(graph,updated,catalog.graphDigest),updated,blank(),uid,catalog.spanDigests));
});
test('JSON roundtrip, boundary split and hidden rows preserve fixed geometry and full totals',async()=>{
 const day=await prepare('R001'),payload={format:'mountain-planner',schemaVersion:1,routeId:'GLOBAL-PREVIEW',tripStartDate:'',days:[day]};
 validatePlan(JSON.parse(JSON.stringify(payload)),['GLOBAL-PREVIEW']);
 const badMode=JSON.parse(JSON.stringify(payload));badMode.days[0].displayMode='invalid';assert.throws(()=>validatePlan(badMode,['GLOBAL-PREVIEW']));
 const badKey=JSON.parse(JSON.stringify(payload));badKey.days[0].items[0].classicRoute.key='yes';assert.throws(()=>validatePlan(badKey,['GLOBAL-PREVIEW']));
 const before=summarizeDay(day),beforeGeometry=resolveItineraryGeometry([day],geometry),cut=def('R001').geometryBindings[2].fromPosition;
 const next={...blank(),linkedStart:true,items:[{...structuredClone(day.items[cut]),id:uid(),incoming:null},...day.items.splice(cut+1)]};
 normalizeDay(next,graph);
 const combined=resolveItineraryGeometry([day,next],geometry);assert.equal(combined.gaps.length,0);
 assert.ok(Math.abs(combined.distanceMeters-beforeGeometry.distanceMeters)<.001);
 assert.deepEqual(combined.days.flatMap(d=>d.features.map(f=>f.coordinates)),beforeGeometry.days[0].features.map(f=>f.coordinates));
 assert.equal(summarizeDay(day).total+summarizeDay(next).total,before.total);
 const bad=JSON.parse(JSON.stringify(payload));bad.days[0].items[0].classicGeometry.coordinates[0]=[999,999];assert.throws(()=>validatePlan(bad,['GLOBAL-PREVIEW']));
});
test('route picker keeps fixed order with one entry per Node; aliases search without changing routes',()=>{
 const route=def('R001'),nodes=routePickerNodes(route,graph);assert.equal(new Set(nodes.map(n=>n.id)).size,nodes.length);
 assert.equal(nodes[0].id,route.occurrences[0].nodeId);
 const entries=[{routeId:'R001',forward:{name:'玉山主峰單攻',aliases:['玉主']}}];assert.equal(searchClassicRoutes(entries,'玉主').length,1);assert.equal(searchClassicRoutes(entries,'R001').length,1);
});
test('splitting inside an unlocated aggregate span is stopped before changing the itinerary',()=>{
 const day={items:[{id:'start',classicGeometry:{batchId:'one',positions:[0,1,2]}},{id:'middle',classicRoute:{batchId:'one',position:1}},{id:'end',classicRoute:{batchId:'one',position:2}}]},before=JSON.stringify(day);
 assert.match(classicSplitIssue(day,'middle'),/分段定位/);assert.equal(classicSplitIssue(day,'end'),'');assert.equal(JSON.stringify(day),before);
});
test('R057 bounded OSM audit retains exact vertices, source hashes, directions and unknown minutes',()=>{
 const audit=auditR057();assert.equal(audit.directions.length,2);assert.ok(audit.endpoints.every(e=>e.candidateAnchor.meters<5));
 assert.ok(audit.directions.every(d=>d.distanceMeters>4000&&d.distanceMeters<4100&&d.minutes===null&&d.actualMinutes===null));
 assert.deepEqual(audit.directions[0].osmNodeIds,[...audit.directions[1].osmNodeIds].reverse());
 assert.ok(audit.directions[0].ways.some(w=>w.id===220625143&&w.tags.name==='奇萊北稜'));
 assert.deepEqual(audit,JSON.parse(readFileSync(new URL('data/staging/idea002/r057-osm-evidence-20261120.json',root))));
});
