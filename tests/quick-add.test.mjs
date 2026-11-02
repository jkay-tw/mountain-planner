import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {quickAddCandidates,appendQuickPath} from '../js/quick-add.js';import {toTwd97,twd97Label} from '../js/twd97.js';import {mergeReviewedRoutes} from '../js/global-route.js';import {addRouteIdentity} from '../js/node-identity.js';
const edge=(a,b)=>({fromId:a,toId:b,from:a,to:b,minutes:10,travelMode:'walking',verificationStatus:'verified'});
const route={nodes:['a','b','c','d','e'].map(id=>({id,name:id})),segments:[edge('a','b'),edge('b','a'),edge('b','c'),edge('a','d'),edge('d','c'),{...edge('a','e'),travelMode:'vehicle'}],source:{image_url:'test'}};
test('two-hop choices include all branches and explicit vias, exclude vehicles and return loops',()=>{
 const cs=quickAddCandidates(route,'a');assert.deepEqual(cs.filter(c=>!c.via).map(c=>c.nodeId),['b','d']);assert.deepEqual(cs.filter(c=>c.nodeId==='c').map(c=>c.via),['b','d']);assert.ok(!cs.some(c=>['a','e'].includes(c.nodeId)));
 assert.equal(quickAddCandidates({...route,routingEnabled:false},'a').length,0);
 assert.ok(!quickAddCandidates({...route,segments:route.segments.map(s=>({...s,verificationStatus:'unverified'}))},'a').length);
});
test('quick addition follows the shown branch and preserves existing notes and time overrides',()=>{
 const day={items:[{id:'old',type:'location',nodeId:'a',note:'保留',incoming:null},{id:'rest',type:'rest',minutes:7,note:'休息'}]},before=JSON.stringify(day.items);let i=0;
 assert.ok(appendQuickPath(day,route,'a>d>c',()=>String(++i)));assert.equal(JSON.stringify(day.items.slice(0,2)),before);assert.deepEqual(day.items.slice(2).map(x=>x.nodeId),['d','c']);
 const snapshot=JSON.stringify(day);assert.equal(appendQuickPath(day,route,'a>b',()=>''),false);assert.equal(JSON.stringify(day),snapshot);
});
test('owner-confirmed long overlaps do not become false immediate neighbours',()=>{
 const raw=JSON.parse(readFileSync(new URL('../data/routes/owner-reviewed/G04.json',import.meta.url)));const graph=mergeReviewedRoutes([addRouteIdentity(raw)]);
 const cs=quickAddCandidates(graph,'shared:cw-v07-003');assert.ok(cs.some(c=>c.nodeId==='g04-027'&&!c.via));assert.ok(cs.some(c=>c.nodeId==='g04-044'&&c.via==='哭坡觀景台'));assert.ok(!cs.some(c=>c.nodeId==='shared:cw-v07-004'));
});
test('TWD97 display matches the confirmed zone121 coordinate to the metre',()=>{
 assert.deepEqual(toTwd97([121.23638022672083,24.388491806668416]),[273977,2698069]);assert.equal(twd97Label([121.23638022672083,24.388491806668416]),'TWD97 (273977, 2698069)');assert.equal(toTwd97([NaN,24]),null);
});
test('signed one/two-hop choices use the previous point and are all available without expansion',async()=>{
 const {directionalQuickAdd}=await import('../js/quick-add.js');const graph={...route,segments:[edge('a','b'),edge('b','a'),edge('b','c'),edge('c','b'),edge('a','e'),edge('c','d')]};
 const choices=directionalQuickAdd(graph,{items:[{type:'location',nodeId:'a'},{type:'rest'},{type:'location',nodeId:'b'}]});
 assert.deepEqual(choices.map(c=>c.direction*c.steps),[1,2,-1,-2]);assert.deepEqual(choices.map(c=>c.nodeId),['c','d','a','e']);
 assert.ok(directionalQuickAdd(graph,{items:[{type:'location',nodeId:'b'}]}).every(c=>c.direction===0));
});
