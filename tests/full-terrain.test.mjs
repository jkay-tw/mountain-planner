import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveItineraryGeometry,validateGeometry,geometryToGpx,distanceMeters,terrainMetrics} from '../js/itinerary-geometry.js';
const load=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const data=load('data/geometry/planner-terrain-v1.json'),manifest=load('data/unified-editor-manifest.json');
const routes=manifest.routes.map(r=>load(r.file.split('?')[0]));
const edges=new Map(routes.flatMap(r=>r.segments).map(s=>[s.fromId+'>'+s.toId,s]));
const by=new Map(data.nodes.map(n=>[n.nodeId,n]));
function day(a,b){return {items:[{id:'a',type:'location',nodeId:a,name:by.get(a).name,incoming:null},{id:'b',type:'location',nodeId:b,name:by.get(b).name,incoming:{kind:'official',fromNodeId:a,toNodeId:b}}]}}
test('all positioned labels have elevations; every reviewed pair is covered or explicitly classified',()=>{
 assert.ok(validateGeometry(data));
 for(const n of data.nodes)if(n.coordinate)assert.ok(Number.isFinite(n.elevationMeters),n.nodeId);
 const pairs=new Set(routes.flatMap(r=>[...r.segments,...(r.manualConnections||[])]).map(s=>[s.fromId,s.toId].sort().join('>')));
 const spans=new Set(data.spans.map(s=>[s.fromId,s.toId].sort().join('>'))),gaps=new Map(data.coverage.routeDataGaps.map(g=>[[g.fromId,g.toId].sort().join('>'),g]));
 assert.equal(data.coverage.routePairs,pairs.size);
 for(const pair of pairs){assert.notEqual(spans.has(pair),gaps.has(pair),pair);if(gaps.has(pair))assert.ok(gaps.get(pair).reason)}
 assert.equal(data.coverage.elevationDataGaps.length,0);
 assert.ok(data.spans.some(s=>s.groups?.includes('G20')));
 assert.ok(data.spans.some(s=>s.groups?.includes('G02_yushan'))||data.spans.some(s=>s.groups?.some(g=>g.startsWith('G02'))));
});
test('full-route directions resolve with additive metrics, unchanged plans and independent GPX segments',()=>{
 const spans=data.spans.filter(s=>edges.has(s.fromId+'>'+s.toId)&&!s.viaNodeIds?.length);
 const days=spans.flatMap(s=>[day(s.fromId,s.toId),...(s.reversible?[day(s.toId,s.fromId)]:[])]),snapshot=JSON.stringify(days);
 const r=resolveItineraryGeometry(days,data);assert.equal(r.gaps.length,0);assert.equal(JSON.stringify(days),snapshot);
 let index=0;
 for(const s of spans){
  const f=r.days[index++];assert.equal(f.features.length,1);assert.ok(Math.abs(f.distanceMeters-s.distanceMeters)<2);assert.ok(Number.isFinite(f.ascentMeters)&&Number.isFinite(f.descentMeters));
  if(s.reversible){const b=r.days[index++];assert.deepEqual(b.features[0].coordinates,[...f.features[0].coordinates].reverse());assert.ok(Math.abs(b.ascentMeters-f.descentMeters)<.01);assert.ok(Math.abs(b.descentMeters-f.ascentMeters)<.01)}
 }
 const gpx=geometryToGpx(r,data);assert.equal((gpx.match(/<trkseg>/g)||[]).length,days.length);assert.match(gpx,/<ele>/);assert.doesNotMatch(gpx,/NaN|undefined/);
});
test('span-specific source anchors are validated without changing label coordinates',()=>{
 const x=structuredClone(data),s=x.spans.find(s=>s.fromAnchor);assert.ok(s);
 const label=by.get(s.fromId).coordinate;assert.ok(distanceMeters(label,s.fromAnchor)<=120.1);
 s.coordinates[0]=[0,0];assert.throws(()=>validateGeometry(x),/錨點/);
});
test('waypoint-only export requires explicit choice and never invents a track',()=>{
 const gap=data.coverage.routeDataGaps.find(g=>g.reason==='missing-coordinate'&&!!by.get(g.fromId).coordinate!==!!by.get(g.toId).coordinate);assert.ok(gap);
 const r=resolveItineraryGeometry([day(gap.fromId,gap.toId)],data);assert.equal(r.days[0].features.length,0);assert.equal(r.waypoints.length,1);
 assert.throws(()=>geometryToGpx(r,data),/缺漏/);assert.throws(()=>geometryToGpx(r,data,{allowPartial:true}),/沒有/);
 const gpx=geometryToGpx(r,data,{allowPartial:true,allowWaypointsOnly:true});assert.match(gpx,/<wpt /);assert.doesNotMatch(gpx,/<trk|<rte/);assert.match(gpx,/未定位/);
});
