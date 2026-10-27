import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeActual,buildTimeline,summarizeDay,recalcConnections,canDeleteItem,normalizeDay,retargetSplitIncoming} from '../js/planner.js';
import {validatePlan} from '../js/validation.js';
import {addRouteIdentity,buildNodeRegistry,provisionalNodeId} from '../js/node-identity.js';
const route={source:{image_url:'official'},segments:[
 {from:'A',to:'B',minutes:30},{from:'B',to:'C',minutes:40},
 {from:'B',to:'A',minutes:35},{from:'C',to:'B',minutes:45}
]};
const point=(id,name,incoming=null,auto=false)=>({id,name,type:'location',auto,waypoint:!auto,note:'',incoming});
test('missing manual minutes do not silently become zero',()=>{
 const e={kind:'manual',fromId:'a',toId:'b',actualMinutes:null};
 assert.equal(edgeActual(e,.8),null);
 const d={startTime:'06:00',coefficient:.8,items:[point('a','A'),point('b','B',e)]};
 assert.equal(buildTimeline(d).rows[1].arrival,'—');
 assert.equal(summarizeDay(d).missing,1);
 assert.equal(summarizeDay(d).total,null);
 e.actualMinutes=0;
 assert.equal(edgeActual(e,.8),0);
 assert.equal(buildTimeline(d).rows[1].arrival,'06:00');
});
test('deleted intermediary is reintroduced by official shortest path',()=>{
 const d={items:[point('a','A'),point('c','C',{kind:'official',from:'B',to:'C',officialMinutes:40,actualMinutes:null})]};
 recalcConnections(d,route);
 assert.deepEqual(d.items.map(x=>x.name),['A','B','C']);
 assert.equal(d.items[1].auto,true);
 assert.equal(d.items[2].incoming.officialMinutes,40);
 recalcConnections(d,route);
 assert.deepEqual(d.items.map(x=>x.name),['A','B','C']);
});
test('JSON validation rejects corrupt and future formats',()=>{
 const valid={format:'mountain-planner',schemaVersion:1,routeId:'G06',tripStartDate:'',days:[{startTime:'06:00',coefficient:.8,note:'',linkedStart:false,items:[]}]};
 assert.equal(validatePlan(valid,['G06']),valid);
 assert.throws(()=>validatePlan({...valid,schemaVersion:2},['G06']));
 assert.throws(()=>validatePlan({...valid,days:[{...valid.days[0],coefficient:999}]},['G06']));
 assert.throws(()=>validatePlan({...valid,routeId:'G99'},['G06']));
});

test('official-node deletion follows boundary and manual-neighbor rules',()=>{
 const d={items:[
   point('a','A'),
   point('b','B',{kind:'official',from:'A',to:'B',officialMinutes:30,actualMinutes:null},true),
   point('c','C',{kind:'official',from:'B',to:'C',officialMinutes:40,actualMinutes:null})
 ]};
 assert.equal(canDeleteItem(d,0),true);
 assert.equal(canDeleteItem(d,1),false);
 assert.equal(canDeleteItem(d,2),true);
 const m={id:'m',type:'manual-location',name:'捷徑',incoming:{kind:'manual',fromId:'b',toId:'m',actualMinutes:null}};
 d.items.splice(2,0,m);
 assert.equal(canDeleteItem(d,1),true);
 assert.equal(canDeleteItem(d,2),true);
 assert.equal(canDeleteItem(d,3),true);
});

test('normalization merges adjacent identical official locations',()=>{
 const d={items:[
   point('a','A'),
   point('b1','B',{kind:'official',from:'A',to:'B',officialMinutes:30,actualMinutes:null}),
   {id:'m',type:'manual-location',name:'手動',note:'',incoming:{kind:'manual',fromId:'b1',toId:'m',actualMinutes:null}},
   point('b2','B',{kind:'manual',fromId:'m',toId:'b2',actualMinutes:null})
 ]};
 d.items.splice(2,1);
 normalizeDay(d,route);
 assert.deepEqual(d.items.map(x=>x.name),['A','B']);
 assert.equal(d.items[0].incoming,null);
 assert.equal(d.items[1].incoming.kind,'official');
});
test('normalization never leaves a later location marked as a second start',()=>{
 const d={items:[point('a','A'),point('c','C',null)]};
 normalizeDay(d,route);
 assert.deepEqual(d.items.map(x=>x.name),['A','B','C']);
 assert.equal(d.items[0].incoming,null);
 assert.ok(d.items.slice(1).every(x=>x.incoming));
});

test('split-day retarget keeps manual minutes when only start id changes',()=>{
 const moved=[
   {id:'m',type:'manual-location',name:'手動1',note:'',incoming:{kind:'manual',fromId:'cut',toId:'m',actualMinutes:10}},
   point('b','B',{kind:'manual',fromId:'m',toId:'b',actualMinutes:10})
 ];
 retargetSplitIncoming(moved,'cut','new-cut');
 assert.equal(moved[0].incoming.fromId,'new-cut');
 assert.equal(moved[0].incoming.actualMinutes,10);
});

test('v0.7 same display name in different groups gets distinct provisional IDs',()=>{
 const y=addRouteIdentity({route_id:'Yushan',segments:[{from:'主北岔路',to:'玉山主峰',minutes:25}]});
 const q=addRouteIdentity({route_id:'Qilai',segments:[{from:'主北岔路',to:'奇萊北峰',minutes:35}]});
 assert.notEqual(y.nodes[0].id,q.nodes[0].id);
 assert.notEqual(y.segments[0].fromId,q.segments[0].fromId);
});
test('v0.7 route identity is stable and does not alter old segment names or minutes',()=>{
 const raw={route_id:'G06',segments:[{from:'司晏池營地',to:'白姑大山東南峰',minutes:60}]};
 const a=addRouteIdentity(raw),b=addRouteIdentity(raw);
 assert.deepEqual(a,b);
 assert.equal(a.segments[0].from,'司晏池營地');
 assert.equal(a.segments[0].minutes,60);
 assert.ok(a.segments[0].fromId.startsWith('G06::'));
 assert.equal(raw.segments[0].fromId,undefined);
 assert.equal(provisionalNodeId('G06','司晏池營地'),a.segments[0].fromId);
 assert.equal(buildNodeRegistry(raw).nodes.length,2);
});
