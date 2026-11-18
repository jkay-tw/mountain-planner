import test from 'node:test';import assert from 'node:assert/strict';
import {buildGraph,nearestVertex,distanceRoute} from '../preview/js/osm-pilot-router.js';
import {pilotGpx} from '../preview/js/osm-pilot-gpx.js';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const data={nodes:{a:[121,24],b:[121.01,24],c:[121.02,24],d:[121.01,24]},ways:[{id:1,refs:['a','b'],tags:{}},{id:2,refs:['b','c'],tags:{'oneway:foot':'yes'}},{id:3,refs:['d','c'],tags:{'oneway:foot':'yes'}}]};
test('trial graph uses distance, honors exact identities and directed foot access',()=>{const g=buildGraph(data);assert.ok(distanceRoute(g,'a','c').distanceMeters>2000);assert.equal(distanceRoute(g,'c','a'),null);assert.equal(distanceRoute(g,'a','d'),null);assert.equal(nearestVertex(g,[121.02,24]).id,'c');assert.equal(distanceRoute(g,'a','a').distanceMeters,0);assert.equal(distanceRoute(g,'missing','a'),null)});
test('barriers never gain bridging edges or invented minutes',()=>{const g=buildGraph({...data,blockedNodeIds:['b']});assert.equal(distanceRoute(g,'a','c'),null);assert.equal(nearestVertex(g,[120,23]),null);assert.equal('minutes' in distanceRoute(buildGraph(data),'a','c'),false)});

const samples=JSON.parse(readFileSync(new URL('../preview/data/osm-pilot/samples.json',import.meta.url)));
for(const sample of samples)test(`published OSM sample integrity and real routing: ${sample.file}`,()=>{
 const packed=readFileSync(new URL('../preview/data/osm-pilot/'+sample.file,import.meta.url));
 assert.equal(createHash('sha256').update(packed).digest('hex'),sample.sha256);
 const d=JSON.parse(gunzipSync(packed));
 assert.equal(d.source.timestamp,'2026-11-12T21:23:05Z');
 assert.equal(d.ways.length,sample.ways);assert.equal(Object.keys(d.nodes).length,sample.nodes);
 assert.match(d.terrainSource.method,/original OSM vertices only/);
 for(const w of d.ways){assert.ok(w.version>0&&w.timestamp);for(const id of w.refs)assert.ok(d.nodes[id]);}
 assert.equal(Object.values(d.nodes).filter(p=>!Number.isFinite(p[2])).length,sample.elevationMissing);
 const g=buildGraph(d),[from,edges]=[...g.adjacency].find(([,edges])=>edges.length),edge=edges[0],r=distanceRoute(g,from,edge.to);
 assert.ok(r.distanceMeters>0);assert.equal(r.ids[0],from);assert.equal(r.ids.at(-1),edge.to);
});

test('GPX preserves user endpoints, full source geometry and separate unverified connectors',()=>{
 const route=distanceRoute(buildGraph(data),'a','c'),chosen=[{point:[120.999,24]},{point:[121.021,24]}];
 const xml=pilotGpx(route,chosen);
 assert.equal((xml.match(/<trk>/g)||[]).length,3);assert.equal((xml.match(/<wpt /g)||[]).length,2);
 assert.equal((xml.match(/<trkpt /g)||[]).length,route.coordinates.length+4);
 assert.match(xml,/OSM ways: 1,2/);assert.match(xml,/unverified, no terrain or travel time/);
 assert.match(xml,/lon="120.999"/);assert.doesNotMatch(xml,/<ele>/);
});
