import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {accessIssues,importantNode,corridorCandidates} from '../tools/route-validator/sequence-review.mjs';
import {loadSnapshot,loadProject,normalizeSnapshot} from '../tools/route-validator/core.mjs';
test('native boolean checkboxes and CSV TRUE have identical important-node meaning',()=>{
 const snapshot={schemaVersion:1,sheets:{Routes_順序校核:{rows:[['Route ID','經典登山路線名稱','使用該路線','類型'],['R001','範例',true,'往返']]},RouteNodes_順序校核:{rows:[['Route ID','position','Node ID','節點名稱','重要節點候選'],['R001',1,'a','峰',true],['R001',2,'b','山屋','TRUE'],['R001',3,'c','岔路',false]]}}};
 assert.deepEqual(normalizeSnapshot(snapshot).routes[0].occurrences.map(o=>o.key),[true,true,false]);
});
test('graph connectivity cannot override the west-only summit constraint',()=>{
 const west='shared:cw-v07-070',summit='shared:cw-v07-027',junction='shared:owner-v0724-xiangyang-junction';
 assert.equal(accessIssues([west,summit,junction]).length,1);
 assert.equal(accessIssues([junction,summit,west]).length,1);
 assert.equal(accessIssues([west,summit,west,'shared:cw-v07-032',junction]).length,0);
 assert.equal(accessIssues([west,summit,west,summit,west]).length,0);
});
test('Ize summit must return to 8.8K, not the second trailhead',()=>{
 assert.equal(accessIssues(['g04-002','g04-019','g04-020']).length,1);
 assert.equal(accessIssues(['g04-002','g04-019','g04-002','g04-020']).length,0);
});
test('important flags include visited huts and camps without labelling trailheads as summits',()=>{
 for(const name of ['九九山莊','塔芬谷山屋','新達山屋(水池)','馬西巴秀石洞營地','9K 北大武山','望鄉山','北稜角'])assert.equal(importantNode({name}),true,name);
 for(const name of ['八通關山登山口','向陽山三岔路口','北峰下解說牌'])assert.equal(importantNode({name}),false,name);
});
test('nearby summit is a candidate only; scanner never inserts a waypoint',()=>{
 const project={nodes:new Map([['spur',{name:'支線山'}]]),nodeAuthority:new Map([['spur',{}]]),coordinates:new Map([['spur',{coordinate:[121.001,23.0001]}]])};
 const span={fromId:'a',toId:'b',coordinates:[[121,23],[121.001,23],[121.002,23]]};
 const before=JSON.stringify(span),events=corridorCandidates(span,'a','b',project);
 assert.equal(events.length,1);assert.equal(events[0].nodeId,'spur');assert.equal(JSON.stringify(span),before);
});
test('round2 retains user R064 and restricts source-backed edits to known original IDs',()=>{
 const before=loadSnapshot(undefined,'data/route-validator/snapshots/sheet-20261125-round2-before.json'),p=loadProject();
 const corrections=JSON.parse(fs.readFileSync('data/audits/route-review-20261125-round2/corrections.json'));
 assert.equal(corrections.results.length,60);
 assert.deepEqual(corrections.results.find(r=>r.routeId==='R064').after,before.routes.find(r=>r.routeId==='R064').occurrences.map(o=>o.nodeId));
 for(const r of corrections.results){assert.equal(accessIssues(r.after).length,0,r.routeId);for(const id of r.after)assert.ok(p.nodeAuthority.has(id),id);}
 const r70=corrections.results.find(r=>r.routeId==='R070');
 assert.ok(!r70.after.includes('node:8426704609cea5d43db4'));
 assert.ok(r70.after.indexOf('shared:cw-v07-061')<r70.after.indexOf('shared:cw-v07-035'));
 assert.ok(r70.after.indexOf('shared:cw-v07-035')<r70.after.indexOf('shared:cw-v07-014'));
 const r72=corrections.results.find(r=>r.routeId==='R072');assert.ok(r72.after.includes('shared:cw-v07-059'));assert.ok(r72.after.includes('shared:cw-v07-032'));
});
