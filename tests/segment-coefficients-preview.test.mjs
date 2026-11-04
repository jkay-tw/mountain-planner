import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {edgeActual,incomingForSegment,adoptLegacyCoefficients,setEdgeCoefficient,selectEdgeReference,recalcConnections,buildTimeline} from '../preview/js/planner.js';
import {appendQuickPath} from '../preview/js/quick-add.js';
import {syncLinkedDays} from '../preview/js/day-link.js';
import {validatePlan} from '../preview/js/validation.js';
import {renderTerrainProfile} from '../preview/js/itinerary-geometry.js';

const edge=(minutes=60)=>({kind:'official',from:'A',to:'B',officialMinutes:minutes,actualMinutes:null,timeAlternatives:[{kind:'slow',minutes:90},{kind:'heavy_pack',minutes:120}]});
const point=(id,name,nodeId,incoming=null)=>({id,type:'location',name,nodeId,note:'',incoming});
const route={source:{image_url:'source'},nodes:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],segments:[
 {from:'A',to:'B',fromId:'a',toId:'b',minutes:60,verificationStatus:'verified',travelMode:'walking',timeAlternatives:[{kind:'slow',minutes:90}]},
 {from:'B',to:'C',fromId:'b',toId:'c',minutes:40,verificationStatus:'verified',travelMode:'walking'}
]};

test('new official edges pin the insertion coefficient, including two-hop quick paths',()=>{
 const day={coefficient:.8,items:[point('a','A','a')]};let n=0;
 assert.equal(appendQuickPath(day,route,'a>b>c',()=>String(++n)),true);
 assert.deepEqual(day.items.slice(1).map(x=>x.incoming.coefficient),[.8,.8]);
 day.coefficient=1;
 assert.deepEqual(day.items.slice(1).map(x=>edgeActual(x.incoming,day.coefficient)),[48,32]);
 const next=incomingForSegment(route.segments[0],'c','d',null,day.coefficient);
 assert.equal(edgeActual(next,day.coefficient),60);
 recalcConnections(day,route);
 assert.deepEqual(day.items.slice(1).map(x=>x.incoming.coefficient),[.8,.8]);
});

test('old explicit and derived minutes survive import and later daily changes until segment edit',()=>{
 const old={coefficient:.85,items:[point('a','A','a'),point('b','B','b',{...edge(),actualMinutes:null}),point('c','C','c',{...edge(40),from:'B',to:'C',actualMinutes:37.25})]};
 const migrated=adoptLegacyCoefficients(old);migrated.coefficient=1;
 assert.deepEqual(migrated.items.slice(1).map(x=>edgeActual(x.incoming,1)),[51,37.25]);
 assert.equal(old.items[1].incoming.coefficient,undefined);
 assert.equal(setEdgeCoefficient(migrated.items[1].incoming,.95),true);
 assert.equal(edgeActual(migrated.items[1].incoming,1),57);
 assert.equal(edgeActual(migrated.items[2].incoming,1),37.25);
});

test('reference conditions toggle both directions with coefficient retained',()=>{
 const e={...edge(),coefficient:.85};
 assert.equal(selectEdgeReference(e,'slow'),true);assert.equal(edgeActual(e,1),76.5);
 assert.equal(setEdgeCoefficient(e,.95),true);assert.equal(edgeActual(e,1),85.5);
 assert.equal(selectEdgeReference(e,'heavy_pack'),true);assert.equal(edgeActual(e,1),114);
 assert.equal(selectEdgeReference(e,'regular'),true);assert.equal(edgeActual(e,1),57);
 assert.equal(selectEdgeReference(e,'unknown'),false);
});

test('pending day link follows changed previous endpoint without deleting a user point',()=>{
 const days=[{items:[]},{linkedStart:true,items:[point('b','B','b')]}];let n=0;
 syncLinkedDays(days,route,()=>String(++n));assert.deepEqual(days[1].items.map(x=>x.name),['B']);
 days[0].items.push(point('a','A','a'));syncLinkedDays(days,route,()=>String(++n));
 assert.deepEqual(days[1].items.map(x=>x.name),['A','B']);assert.equal(days[1].items[0]._linkedGenerated,true);
 days[0].items[0]=point('c','C','c');syncLinkedDays(days,route,()=>String(++n));
 assert.deepEqual(days[1].items.map(x=>x.name),['C','B']);assert.equal(days[1].items[1].id,'b');
 days[0].items=[];syncLinkedDays(days,route,()=>String(++n));
 assert.deepEqual(days[1].items.map(x=>x.name),['B']);assert.equal(days[1].linkedStart,true);
 days[1].linkedStart=false;days[0].items.push(point('a','A','a'));syncLinkedDays(days,route,()=>String(++n));
 assert.deepEqual(days[1].items.map(x=>x.name),['B']);
});

test('plan schema rejects invalid segment coefficients and preserves complete timeline after JSON roundtrip',()=>{
 const day={id:'d',startTime:'06:00',coefficient:1,linkedStart:false,note:'',items:[point('a','A','a'),point('b','B','b',{...edge(),coefficient:.85,referenceKind:'slow'})]};
 const data={format:'mountain-planner',schemaVersion:1,routeId:null,tripStartDate:'',days:[day]};
 const copy=JSON.parse(JSON.stringify(data));validatePlan(copy,[]);
 assert.equal(buildTimeline(copy.days[0]).rows[1].arrival,'07:17');
 copy.days[0].items[1].incoming.coefficient=7;assert.throws(()=>validatePlan(copy,[]));
});

test('preview contains iPhone scroll protection and focused coefficient keyboard editing',()=>{
 const content=readFileSync(new URL('../preview/js/unified-editor.js',import.meta.url),'utf8');
 assert.match(content,/captureScrollAnchor\(container\)/);
 assert.match(content,/requestAnimationFrame\(\(\)=>\{if\(token===scrollRestoreToken\)restoreScrollAnchor/);
 assert.match(content,/e\.preventDefault\(\);const value=Number\(x\.value\)/);
 assert.match(content,/replacement\?\.focus\(\)/);
});

test('short daily profile uses a smaller SVG and keeps node labels and export controls',()=>{
 const feature=(i)=>({from:'點'+i,to:'點'+(i+1),distanceMeters:100,profile:[[0,2100],[100,2200]]});
 const day=features=>({dayIndex:0,features,distanceMeters:features.length*100,ascentMeters:100,descentMeters:0,gaps:[]});
 const short=renderTerrainProfile(day([feature(0)]));
 const dense=renderTerrainProfile(day(Array.from({length:24},(_,i)=>feature(i))));
 const height=html=>Number(html.match(/viewBox="0 -80 800 (\d+)"/)?.[1]);
 assert.ok(height(short)<height(dense));
 assert.match(short,/translate\(0,-45\)/);
 assert.match(short,/點0/);assert.match(short,/點1/);
 assert.match(short,/data-profile-export="download"/);
});
