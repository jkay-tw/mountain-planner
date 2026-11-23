import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {toTwd97} from '../js/twd97.js';
import {mergeReviewedRoutes,nodesInScope} from '../js/global-route.js';
import {filterLocations} from '../js/node-browser.js';
import {shortestPath} from '../js/planner.js';
import {resolveItineraryGeometry} from '../js/itinerary-geometry.js';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url)));
const routes=read('data/unified-editor-manifest.json').routes.map(e=>read(e.file.split('?')[0])),graph=mergeReviewedRoutes(routes),data=read('data/geometry/planner-terrain-v1.json');
test('owner coordinate roundtrip and DEM, hidden identities retained only in database discovery',()=>{
 const n=data.nodes.find(n=>n.nodeId==='node:2262a9d2e8c96b37a520');const xy=toTwd97(n.coordinate);assert.ok(Math.abs(xy[0]-241342)<1&&Math.abs(xy[1]-2570474)<1);assert.ok(Number.isFinite(n.elevationMeters));
 for(const id of ['g04-fork-zhenxibao','node:67f469173d3d382ca79c']){assert.ok(graph.nodes.some(n=>n.id===id));assert.ok(!nodesInScope(graph,'all').some(n=>n.id===id));assert.ok(!filterLocations(graph.nodes,'').some(n=>n.id===id));}
});
test('consolidated source parts preserve exact directed times and continuous geometry',()=>{
 const decision=read('data/geometry/sources/route-owner-20261123.json');
 for(const c of decision.consolidations){const e=graph.segments.find(e=>e.fromId===c.fromId&&e.toId===c.toId);assert.equal(e.minutes,c.minutes);assert.equal(e.sourceParts.reduce((n,p)=>n+p.minutes,0),c.minutes);const route=shortestPath(graph,c.fromId,c.toId);assert.ok(route);assert.ok(!route.nodes.includes(c.nodeId));const day={items:[{id:'a',type:'location',nodeId:c.fromId,name:e.from,incoming:null},{id:'b',type:'location',nodeId:c.toId,name:e.to,incoming:{kind:'official',fromNodeId:c.fromId,toNodeId:c.toId,officialMinutes:e.minutes}}]};assert.equal(resolveItineraryGeometry([day],data).gaps.length,0);}
});
test('unaffected geometry and identities stay unchanged, transport remains separately directed',()=>{
 const prior=JSON.parse(gunzipSync(readFileSync(new URL('../data/geometry/sources/route-prior-20261123.json.gz',import.meta.url))));const old=JSON.parse(prior['data/geometry/planner-terrain-v1.json']);assert.deepEqual(new Set(old.nodes.map(n=>n.nodeId)),new Set(data.nodes.map(n=>n.nodeId)));const changed=new Set(['g04-fork-zhenxibao','node:67f469173d3d382ca79c','node:2262a9d2e8c96b37a520']);for(const s of old.spans)if(![s.fromId,s.toId,...(s.viaNodeIds||[])].some(id=>changed.has(id)))assert.deepEqual(data.spans.find(n=>n.id===s.id),s);
 const t=read('data/transport-owner-reviewed.json');for(const [fromId,toId] of [['g04-062','g04-033'],['g04-033','g04-062']])assert.equal(t.segments.find(e=>e.fromId===fromId&&e.toId===toId).minutes,10);
});
