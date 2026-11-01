import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {mergeReviewedRoutes} from '../js/global-route.js';
import {shortestPath} from '../js/planner.js';
const routes=readdirSync(new URL('../data/routes/owner-reviewed/',import.meta.url)).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(new URL('../data/routes/owner-reviewed/'+f,import.meta.url))));
const graph=mergeReviewedRoutes(routes);
const cases=[
 ['shared:cw-v07-066','g04-fork-xueshan','shared:cw-v07-074'],
 ['shared:cw-v07-003','g04-027','g04-044','shared:cw-v07-004'],
 ['shared:cw-v07-004','g04-039','shared:cw-v07-074'],
 ['shared:cw-v07-012','node:83a76c46935de2ee6f88','node:6d5573eb9babae99663c','shared:cw-v07-048'],
 ['shared:cw-v07-012','node:dca389db39359114677f','shared:cw-v07-041'],
 ['shared:cw-v07-078','node:e9cc87a6032a69ff2163','shared:cw-v07-080'],
 ['shared:cw-v07-040','node:2f804109a33585abde92','node:47059555f89c94f5c563','node:70418012ecbda7a8add8','shared:cw-v07-080'],
 ['shared:cw-v07-018','shared:cw-v07-008','shared:cw-v07-055','shared:cw-v07-076'],
 ['shared:cw-v07-054','shared:cw-v07-013','shared:cw-v07-044','shared:cw-v07-072'],
 ['shared:cw-v07-071','shared:cw-v07-057','shared:cw-v07-026','shared:cw-v07-072'],
 ['shared:cw-v07-019','shared:cw-v07-026','shared:cw-v07-072']
];
test('11 confirmed overlaps have verified matching directional times and show intermediate nodes',()=>{
 for(const forward of cases)for(const ids of [forward,[...forward].reverse()]){
  const direct=graph.segments.find(s=>s.fromId===ids[0]&&s.toId===ids.at(-1));
  assert.ok(direct,ids.join(' '));
  const parts=ids.slice(1).map((id,i)=>graph.segments.find(s=>s.fromId===ids[i]&&s.toId===id));
  assert.ok(parts.every(s=>s?.verificationStatus==='verified'&&s.travelMode==='walking'),ids.join(' '));
  assert.equal(parts.reduce((n,s)=>n+s.minutes,0),direct.minutes,ids.join(' '));
  // Restrict graph to the reviewed direct edge and detailed route to test tie handling.
  const result=shortestPath({...graph,segments:[direct,...parts]},ids[0],ids.at(-1));
  assert.deepEqual(result.nodes,ids);
  assert.equal(result.minutes,direct.minutes);
 }
});
test('the confirmed 主北 three-way triangle remains intact',()=>{
 const ids=['shared:cw-v07-012','node:83a76c46935de2ee6f88','node:dca389db39359114677f'];
 for(const fromId of ids)for(const toId of ids)if(fromId!==toId)assert.ok(graph.segments.some(s=>s.fromId===fromId&&s.toId===toId),`${fromId} -> ${toId}`);
});
