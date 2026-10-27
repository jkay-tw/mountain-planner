import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeActual,buildTimeline,summarizeDay,recalcConnections,canDeleteItem} from '../js/planner.js';
import {validatePlan} from '../js/validation.js';
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
