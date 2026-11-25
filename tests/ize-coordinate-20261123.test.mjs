import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {toTwd97} from '../js/twd97.js';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url)));
test('Ize second entrance changes only the approved coordinate and its three dependent lines',()=>{
 const g=read('data/geometry/planner-terrain-v1.json'),old=JSON.parse(gunzipSync(readFileSync(new URL('../data/geometry/sources/ize-prior-20261123.json.gz',import.meta.url)))),id='g04-020',n=g.nodes.find(n=>n.nodeId===id);
 assert.deepEqual(toTwd97(n.coordinate),[274493,2707010]);assert.ok(Number.isFinite(n.elevationMeters));assert.deepEqual(g.nodes.filter(n=>n.nodeId!==id),old.nodes.filter(n=>n.nodeId!==id));
 const changed=g.spans.filter(s=>JSON.stringify(s)!==JSON.stringify(old.spans.find(o=>o.id===s.id)));assert.equal(changed.length,3);assert.ok(changed.every(s=>[s.fromId,s.toId,...(s.viaNodeIds||[])].includes(id)));assert.equal(g.coverage.unrepresentedPairs.filter(p=>[p.fromId,p.toId].includes(id)).length,0);
 const main=read('data/routes/owner-reviewed/G04.json'),preview=read('preview/data/routes/owner-reviewed/G04.json');assert.deepEqual(main,preview);
});
