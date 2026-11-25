import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chartStartNodes} from '../preview/js/chart-starts.js';
import {mergeReviewedRoutes} from '../preview/js/global-route.js';
import {clipSourceSpan} from '../tools/classic_route_bindings.mjs';
import {withClassicSources} from '../preview/js/classic-route-source.js';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url)));
const manifest=read('preview/data/unified-editor-manifest.json'),graph=mergeReviewedRoutes(manifest.routes.map(r=>read('preview/'+r.file.split('?')[0]))),catalog=read('data/staging/idea002/classic-routes.candidate.json');
const starts=scope=>chartStartNodes(graph,catalog,manifest,scope),ids=scope=>starts(scope).map(n=>n.id);
test('Yushan chart covers both runtime datasets, including Dongpu, without summit turnaround',()=>{
 assert.deepEqual(new Set(ids('G02-d1e06c0d')),new Set(['g02-004','shared:cw-v07-051']));
 assert.ok(!ids('G02-d1e06c0d').includes('g02-011'));
 assert.ok(starts('G02-d1e06c0d').find(n=>n.id==='shared:cw-v07-051').endpointRouteIds.includes('R070'));
});
test('traverse reverse endpoints are available in their own charts, not by owning Routes group',()=>{
 assert.ok(ids('G04').includes('shared:cw-v07-056'));assert.ok(ids('G05').includes('g04-045'));
 assert.ok(ids('G15').includes('node:ef56761122345906961b'));assert.ok(ids('G15').includes('node:a17ec4e667d55d3d99c3'));
 assert.ok(!ids('G04').includes('shared:cw-v07-051'));
});
test('all groups use only effective first/last occurrences, unique Node IDs and stable sorting',()=>{
 const actual=ids('all'),expected=new Set(catalog.routes.flatMap(r=>[r.forward.occurrences[0].nodeId,r.forward.occurrences.at(-1).nodeId]));
 assert.equal(actual.length,new Set(actual).size);assert.deepEqual(new Set(actual),expected);
 for(const group of manifest.routes){const got=starts(group.id);assert.equal(new Set(got.map(n=>n.id)).size,got.length);assert.ok(got.every(n=>expected.has(n.id)));}
 assert.deepEqual(ids('unknown'),[]);assert.deepEqual(chartStartNodes(graph,null,manifest,'all'),[]);
});
test('disabled routes, hidden nodes, interior turnaround and same-name IDs cannot leak into starts',()=>{
 const graph={nodes:[{id:'a',name:'同名',groups:['G01']},{id:'b',name:'同名',groups:['G01']},{id:'peak',name:'峰',groups:['G01']},{id:'hidden',name:'隱藏',groups:['G01'],plannerHidden:true}]};
 const manifest={routes:[{id:'G01',source_url:'chart-one'}]};
 const route=(routeId,ids)=>({routeId,forward:{occurrences:ids.map(nodeId=>({nodeId}))}});
 const catalog={enabledRouteIds:['R001','R002'],routes:[route('R001',['a','peak','a']),route('R002',['b','hidden']),route('R003',['peak','a'])]};
 assert.deepEqual(chartStartNodes(graph,catalog,manifest,'G01').map(n=>n.id),['a','b']);
});
test('new bindings clip actual vertices and retain source hashes, profiles and asymmetric times',()=>{
 const [north,exit]=catalog.supplement.spans.slice(-2);
 assert.ok(north.clip.toOffsetMeters<1);assert.ok(north.distanceMeters>3100&&north.distanceMeters<3200);
 assert.ok(exit.clip.fromOffsetMeters<5&&exit.clip.toOffsetMeters<8);assert.ok(exit.coordinates.length>10);
 for(const s of [north,exit]){assert.match(s.sourceSpanSha256,/^[a-f0-9]{64}$/);assert.equal(s.profile[0][0],0);assert.equal(s.profile.at(-1)[0],s.distanceMeters);assert.ok(s.profile.every(p=>Number.isFinite(p[1])));}
 assert.deepEqual(catalog.supplement.walkingSegments.map(s=>s.minutes),[85,120]);
 assert.throws(()=>clipSourceSpan({coordinates:[[121,23],[121.001,23]],profile:[[0,1],[100,2]],distanceMeters:100},{nodeId:'a',coordinate:[120,23]},{nodeId:'b',coordinate:[121,23]},'wrong source'));
});
test('malformed time supplement is rejected, and approved supplement does not mutate global graph',()=>{
 const before=JSON.stringify(graph),geometry=read('preview/data/geometry/planner-terrain-v1.json');
 withClassicSources(graph,geometry,catalog.supplement);assert.equal(JSON.stringify(graph),before);
 const bad=structuredClone(catalog.supplement);bad.walkingSegments[0].sourceSha256='';assert.throws(()=>withClassicSources(graph,geometry,bad));
});
