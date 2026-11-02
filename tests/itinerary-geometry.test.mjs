import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveItineraryGeometry,geometryToGpx,validateGeometry,distanceMeters} from '../js/itinerary-geometry.js';
import {mergeReviewedRoutes} from '../js/global-route.js';
import {addRouteIdentity} from '../js/node-identity.js';
import {shortestPath} from '../js/planner.js';
const data=JSON.parse(readFileSync(new URL('../data/geometry/xueshan-osm-v1.json',import.meta.url)));
const ids=['g04-045','shared:cw-v07-003','g04-027','g04-044','shared:cw-v07-004','g04-039','shared:cw-v07-074'];
const day=(sequence=ids)=>({note:'保留備註',items:sequence.map((nodeId,i)=>({id:String(i),type:'location',nodeId,name:data.nodes.find(n=>n.nodeId===nodeId)?.name||nodeId,incoming:i?{kind:'official',fromNodeId:sequence[i-1],toNodeId:nodeId,actualMinutes:123}:null}))});
test('actual reviewed routing order resolves without altering plan or time',()=>{
  const source=JSON.parse(readFileSync(new URL('../data/routes/owner-reviewed/G04.json',import.meta.url)));
  const route=mergeReviewedRoutes([addRouteIdentity(source)]);
  const path=shortestPath(route,ids[0],ids.at(-1));
  assert.deepEqual([path.segments[0].fromId,...path.segments.map(s=>s.toId)],ids);
  const days=[day()],before=JSON.stringify(days),result=resolveItineraryGeometry(days,data);
  assert.equal(JSON.stringify(days),before);assert.equal(result.days[0].features.length,5);assert.equal(result.gaps.length,0);
  assert.ok(result.distanceMeters>10000&&result.distanceMeters<10300);
  assert.deepEqual(result.unlocated.map(n=>n.nodeId),['g04-039']);
  assert.equal(result.waypoints.length,6);
});
test('reverse itinerary preserves exact reversed coordinates and equal distance',()=>{
  const f=resolveItineraryGeometry([day()],data),b=resolveItineraryGeometry([day([...ids].reverse())],data);
  assert.equal(b.gaps.length,0);assert.ok(Math.abs(f.distanceMeters-b.distanceMeters)<1e-7);
  assert.deepEqual(b.days[0].features[0].coordinates,[...f.days[0].features.at(-1).coordinates].reverse());
});
test('unknown circle endpoint never gains coordinate or straight geometry',()=>{
  const r=resolveItineraryGeometry([day(['shared:cw-v07-004','g04-039'])],data);
  assert.equal(r.gaps.length,1);assert.equal(r.days[0].features.length,0);assert.equal(r.waypoints.some(n=>n.nodeId==='g04-039'),false);
});
test('manual time segment inside an aggregate span prevents geometry export of that span',()=>{
  const d=day();d.items[5].incoming.kind='manual';
  const r=resolveItineraryGeometry([d],data);
  assert.equal(r.days[0].features.length,4);assert.equal(r.gaps.length,2);
  assert.throws(()=>geometryToGpx(r,data),/缺漏/);
  const gpx=geometryToGpx(r,data,{allowPartial:true});assert.match(gpx,/部分路徑/);assert.match(gpx,/缺漏/);
  assert.equal((gpx.match(/<trkseg>/g)||[]).length,4);
});
test('days, rest entries, repeated trips and gaps retain order without joining',()=>{
  const one=day(ids.slice(0,5));one.items.splice(2,0,{type:'rest',name:'休息'});
  const two=day([ids[4],ids[5],ids[6],ids[5],ids[4]]);
  const r=resolveItineraryGeometry([one,two],data),gpx=geometryToGpx(r,data);
  assert.equal(r.days[0].features.length,4);assert.equal(r.days[1].features.length,2);
  assert.equal((gpx.match(/<trk>/g)||[]).length,2);
  assert.equal((gpx.match(/<trkseg>/g)||[]).length,6);
  assert.doesNotMatch(gpx,/<time>|<ele>/);assert.match(gpx,/ODbL/);assert.match(gpx,/圈谷底部：未定位/);
});
test('mismatched edge IDs, car edges and manual locations never snap onto trails',()=>{
  for(const mutate of [d=>d.items[1].incoming.fromNodeId='other',d=>d.items[1].incoming.kind='vehicle',d=>d.items[1].type='manual-location']){
    const d=day(ids.slice(0,2));mutate(d);assert.equal(resolveItineraryGeometry([d],data).gaps.length,1);
  }
});
test('unknown intermediate locations cannot be silently swallowed by an aggregate span',()=>{
  const d=day([ids[4],'unknown',ids[6]]),r=resolveItineraryGeometry([d],data);assert.equal(r.gaps.length,2);assert.equal(r.distanceMeters,0);
});
test('snapshot edge membership and endpoint joins prove no inserted straight connectors',()=>{
  const objects=new Map(data.osmObjects.filter(o=>o.type==='way').map(o=>[o.id,o]));
  for(const s of data.spans){
    assert.equal(s.edgeWayIds.length,s.coordinates.length-1);assert.equal(s.osmNodeIds.length,s.coordinates.length);
    for(const id of s.edgeWayIds){assert.notEqual(id,'1222030823');assert.ok(!['no','private'].includes(objects.get(id).tags.access))}
    for(let i=1;i<s.coordinates.length;i++)assert.ok(distanceMeters(s.coordinates[i-1],s.coordinates[i])<150);
  }
  assert.ok(validateGeometry(data));
  const bad=structuredClone(data);bad.spans[0].coordinates[0]=[0,0];assert.throws(()=>validateGeometry(bad));
});
test('GPX escapes arbitrary names and never injects markup',()=>{
  const altered=structuredClone(data);altered.nodes[0].name='<script>&"';
  const r=resolveItineraryGeometry([day(ids.slice(0,2))],altered),gpx=geometryToGpx(r,altered);
  assert.match(gpx,/&lt;script&gt;&amp;&quot;/);assert.doesNotMatch(gpx,/<script>/);
});
