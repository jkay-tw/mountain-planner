import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGraph,distanceRoute} from '../preview/js/osm-pilot-router.js';
import {attachedRoute} from '../preview/js/osm-attachment-routing.js';
import {attachedAlternatives} from '../preview/js/osm-attachment-routing.js';
import {MainlandNetwork} from '../preview/js/mainland-network.js';
import {readFile} from 'node:fs/promises';
const data={nodes:{a:[121,24],b:[121.001,24.001],c:[121.002,24],d:[121.003,24.001],e:[121.004,24],f:[121.002,24]},ways:[{id:11,refs:['a','b','c','d','e'],tags:{'oneway:foot':'yes'}},{id:12,refs:['f','e'],tags:{'oneway:foot':'yes'}}]};
test('compressed junction edges preserve every ordered source vertex, direction and identity',()=>{
 const ordinary=buildGraph(data),compact=buildGraph({...data,junctionIds:['a','e','f']});
 assert.ok(compact.adjacency.size<ordinary.adjacency.size);
 assert.deepEqual(distanceRoute(compact,'a','e'),distanceRoute(ordinary,'a','e'));
 assert.equal(distanceRoute(compact,'e','a'),null);assert.equal(distanceRoute(compact,'a','f'),null);
});
test('projection inside a compressed edge retains bends and does not connect nearby different IDs',()=>{
 const a=[121.0005,24.0005],b=[121.0035,24.0005];
 const ordinary=attachedRoute(buildGraph(data),a,b),compact=attachedRoute(buildGraph({...data,junctionIds:['a','e','f']}),a,b);
 assert.deepEqual(compact,ordinary);
});
test('blocked intermediate geometry cannot gain a compressed bridge',()=>{
 const blocked={...data,blockedNodeIds:['c'],junctionIds:['a','b','c','d','e','f']};
 assert.equal(distanceRoute(buildGraph(blocked),'a','e'),null);
});
test('closed loops and overlapping directed ways keep independent source edges',()=>{
 const loop={nodes:{a:[121,24],b:[121.001,24.001],c:[121.002,24]},ways:[{id:1,refs:['a','b','c','a'],tags:{}},{id:2,refs:['a','b'],tags:{'oneway:foot':'yes'}}]};
 const original=buildGraph(loop),compact=buildGraph({...loop,junctionIds:['a','b']});assert.deepEqual(distanceRoute(compact,'a','b'),distanceRoute(original,'a','b'));
});
test('real 27.8km routing across original tile boundaries preserves all three candidate geometries and source order',async()=>{
 const service=new MainlandNetwork({base:new URL('../preview/data/osm-mainland/',import.meta.url),cacheStorage:null,fetcher:async url=>new Response(await readFile(url))});
 const points=[[121.11685,24.50425],[121.2583824,24.460065]];await service.ensure(points,.01);const merged={nodes:{},ways:[],blockedNodeIds:[]};for(const tile of service.loaded.values()){Object.assign(merged.nodes,tile.nodes);merged.ways.push(...tile.ways);merged.blockedNodeIds.push(...tile.blockedNodeIds);}
 const compact=attachedAlternatives(service.graph(),...points),ordinary=attachedAlternatives(buildGraph(merged),...points);assert.equal(compact.length,3);assert.equal(ordinary.length,3);assert.equal(service.loaded.size,8);
 for(let i=0;i<3;i++){assert.deepEqual(compact[i].coordinates,ordinary[i].coordinates);assert.deepEqual(compact[i].wayIds,ordinary[i].wayIds);assert.ok(Math.abs(compact[i].distanceMeters-ordinary[i].distanceMeters)<1e-6);}
});
