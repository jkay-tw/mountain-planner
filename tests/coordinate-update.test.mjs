import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {toTwd97} from '../js/twd97.js';
import {resolveItineraryGeometry,geometryToGpx,renderTerrainProfile,terrainDayColor} from '../js/itinerary-geometry.js';
const load=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
// Working inputs are staged in Preview until an explicit production promotion.
const data=load('preview/data/geometry/planner-terrain-v1.json'),review=load('data/geometry/sources/owner-coordinate-overrides.json');
const known=new Map(data.nodes.map(n=>[n.nodeId,n]));
const plan=ids=>({coefficient:.8,items:ids.map((id,i)=>({id:'i'+i,nodeId:id,name:known.get(id).name,type:'location',note:'keep '+i,incoming:i?{kind:'official',fromNodeId:ids[i-1],toNodeId:id,officialMinutes:123,actualMinutes:77}:null}))});
test('owner coordinates round-trip independently to source TWD97 and retain review identity',()=>{
 assert.equal(review.nodes.filter(n=>n.action==='coordinate').length,185);
 for(const n of review.nodes.filter(n=>n.action==='coordinate')){
  const xy=toTwd97(n.coordinate);assert.ok(Math.abs(xy[0]-n.originalCoordinate.x)<=1,n.reviewId);assert.ok(Math.abs(xy[1]-n.originalCoordinate.y)<=1,n.reviewId);
  const active=known.get(n.nodeId);
  if(active?.coordinatePolicy==='active')assert.deepEqual(active.coordinate,n.coordinate);
 }
 const originalQ013=review.nodes.flatMap(n=>[n,...(n.previousDecisions||[])]).find(n=>n.reviewId==='Q013');
 assert.equal(originalQ013.action,'coordinate');
 const fork=review.nodes.find(n=>n.nodeId==='g04-fork-daba');
 assert.ok(fork && fork.action==='coordinate');
 assert.deepEqual(fork.originalCoordinate,{format:'TWD97',x:276239,y:2705568});
 assert.equal(fork.source.name,'I Love You平台');
 for(const n of review.nodes.filter(n=>n.action==='delete'))assert.ok(!known.has(n.nodeId));
});
test('G04 fork preserves four unaffected directions and archives the removed pair',()=>{
 const route=load('data/routes/owner-reviewed/G04.json');
 const target=new Map([
  ['g04-010>g04-fork-daba',15],['g04-fork-daba>g04-010',15],
  ['g04-fork-daba>g04-063',70],['g04-063>g04-fork-daba',100],
 ]);
 const actual=new Map(route.segments.filter(s=>s.fromId==='g04-fork-daba'||s.toId==='g04-fork-daba').map(s=>[s.fromId+'>'+s.toId,s.minutes]));
 assert.deepEqual(actual,target);
 const old=load('data/geometry/sources/g04-owner-followup-20261112.json').oldDirectedEdges;
 assert.equal(old.find(e=>e.fromId==='g04-007'&&e.toId==='g04-fork-daba').minutes,50);
 assert.equal(old.find(e=>e.fromId==='g04-fork-daba'&&e.toId==='g04-007').minutes,70);
});
test('all explicit missing-label bridges resolve in order, retain times and reverse without guessing waypoints',()=>{
 const bridges=data.spans.filter(s=>s.intermediateCoordinatesUnknown);assert.equal(bridges.length,4);
 for(const span of bridges){
  const ids=[span.fromId,...span.viaNodeIds,span.toId];
  for(const order of [ids,...(span.reversible?[[...ids].reverse()]:[])]){
   const d=plan(order),before=JSON.stringify(d),r=resolveItineraryGeometry([d],data);
   assert.equal(r.gaps.length,0,span.id);assert.equal(r.days[0].features.length,1,span.id);assert.equal(JSON.stringify(d),before);
   assert.ok(Math.abs(r.distanceMeters-span.distanceMeters)<2,span.id);
   for(const id of span.viaNodeIds)assert.ok(!r.waypoints.some(n=>n.nodeId===id));
   const partial=structuredClone(d);partial.items[1].incoming.kind='vehicle';assert.ok(resolveItineraryGeometry([partial],data).distanceMeters<r.distanceMeters);
  }
 }
});
test('ignored and vehicle-only labels never appear as map or GPX coordinates',()=>{
 for(const policy of ['ignored','vehicle-only']){
  const nodes=data.nodes.filter(n=>n.coordinatePolicy===policy);assert.ok(nodes.length);
  const r=resolveItineraryGeometry([{items:nodes.map(n=>({type:'location',nodeId:n.nodeId,name:n.name}))}],data);
  assert.equal(r.waypoints.length,0);assert.equal(r.unlocated.length,0);
 }
 const span=data.spans.find(s=>!s.viaNodeIds?.length),d=plan([span.fromId,span.toId]);d.items[1].incoming.kind='vehicle';
 const r=resolveItineraryGeometry([d],data);assert.equal(r.distanceMeters,0);assert.equal(r.gaps.length,0);assert.equal(r.waypoints.length,0);
});
test('profile exports include day colors, standalone SVG, source units and copy/download controls',()=>{
 const s=data.spans.find(s=>!s.viaNodeIds?.length),d=resolveItineraryGeometry([plan([s.fromId,s.toId])],data).days[0];d.dayIndex=2;
 const html=renderTerrainProfile(d);assert.ok(html.includes(terrainDayColor(2)));assert.match(html,/fill-opacity=".12"/);assert.match(html,/xmlns="http:\/\/www.w3.org\/2000\/svg"/);assert.match(html,/data-profile-export="copy"/);assert.match(html,/data-profile-export="download"/);assert.match(html,/DEM 估算/);
 assert.match(geometryToGpx(resolveItineraryGeometry([plan([s.fromId,s.toId])],data),data),/<ele>/);
});
