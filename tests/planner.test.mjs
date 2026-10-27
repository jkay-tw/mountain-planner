import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeActual,buildTimeline,summarizeDay,recalcConnections,canDeleteItem,normalizeDay,retargetSplitIncoming,shortestPath} from '../js/planner.js';
import {validatePlan} from '../js/validation.js';
import {addRouteIdentity,buildNodeRegistry,provisionalNodeId,migrateDaysToNodeIds} from '../js/node-identity.js';
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

test('v0.7 routing uses IDs, not same-looking display names',()=>{
 const y=addRouteIdentity({route_id:'Y',nodes:[
  {id:'y-j',name:'主北岔路'},{id:'y-p',name:'玉山主峰'}],
  segments:[{from:'主北岔路',to:'玉山主峰',minutes:25}]});
 const q=addRouteIdentity({route_id:'Q',nodes:[
  {id:'q-j',name:'主北岔路'},{id:'q-p',name:'奇萊北峰'}],
  segments:[{from:'主北岔路',to:'奇萊北峰',minutes:35}]});
 assert.equal(shortestPath(y,'y-j','y-p').minutes,25);
 assert.equal(shortestPath(y,'q-j','y-p'),null);
 assert.equal(shortestPath(q,'y-j','q-p'),null);
});
test('v0.7 legacy itinerary migration preserves manual times and annotations',()=>{
 const r=addRouteIdentity({route_id:'G06',source:{image_url:'official'},nodes:[
   {id:'g06-a',name:'司晏池營地'},{id:'g06-b',name:'白姑大山東南峰'}
 ],segments:[{from:'司晏池營地',to:'白姑大山東南峰',minutes:60}]});
 const original={id:'day',startTime:'05:30',coefficient:.8,linkedStart:true,note:'Day note',items:[
  {id:'x',type:'location',name:'司晏池營地',note:'start',incoming:null},
  {id:'m',type:'manual-location',name:'手動點',note:'water',incoming:{kind:'manual',fromId:'x',toId:'m',actualMinutes:10}},
  {id:'z',type:'location',name:'白姑大山東南峰',note:'peak',incoming:{kind:'manual',fromId:'m',toId:'z',actualMinutes:40}}
 ]};
 const migrated=migrateDaysToNodeIds([original],r)[0];
 assert.equal(migrated.items[0].nodeId,'g06-a');
 assert.equal(migrated.items[2].nodeId,'g06-b');
 assert.equal(migrated.items[1].incoming.actualMinutes,10);
 assert.equal(migrated.items[2].incoming.actualMinutes,40);
 assert.equal(migrated.items[1].note,'water');
 assert.equal(migrated.linkedStart,true);
 assert.equal(migrated.note,'Day note');
 assert.equal(original.items[0].nodeId,undefined);
 normalizeDay(migrated,r);
 assert.equal(migrated.items[1].incoming.actualMinutes,10);
 assert.equal(migrated.items[2].incoming.actualMinutes,40);
});
test('v0.7 official paths and edited minutes use edge IDs',()=>{
 const r=addRouteIdentity({route_id:'G',nodes:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],
  source:{image_url:'official'},
  segments:[{from:'A',to:'B',minutes:30},{from:'B',to:'C',minutes:40}]});
 const day={items:[
   {...point('p','A'),nodeId:'a'},
   {...point('q','C',{kind:'official',from:'B',to:'C',fromNodeId:'b',toNodeId:'c',officialMinutes:40,actualMinutes:55}),nodeId:'c'}
 ]};
 normalizeDay(day,r);
 assert.deepEqual(day.items.map(x=>x.nodeId),['a','b','c']);
 assert.equal(day.items[2].incoming.actualMinutes,55);
 normalizeDay(day,r);
 assert.deepEqual(day.items.map(x=>x.nodeId),['a','b','c']);
 assert.equal(day.items[2].incoming.actualMinutes,55);
});

import {verifyCrosswalk,canonicalIdFor} from '../js/crosswalk.js';
test('crosswalk validates confirmed identities but never authorizes routing',()=>{
 const sample={schemaVersion:1,canonicalNodes:[{canonicalId:'cw-v07-007',routingEnabled:false,members:[
  {group:'南二段',name:'三岔路口'},{group:'馬博拉斯橫斷',name:'三岔路口'}]}]};
 assert.deepEqual(verifyCrosswalk(sample),{groups:1,members:2});
 assert.equal(canonicalIdFor(sample,'南二段','三岔路口'),'cw-v07-007');
 assert.equal(canonicalIdFor(sample,'玉山群峰','三岔路口'),null);
 assert.throws(()=>verifyCrosswalk({...sample,canonicalNodes:[{...sample.canonicalNodes[0],routingEnabled:true}]}));
 assert.throws(()=>verifyCrosswalk({...sample,canonicalNodes:[sample.canonicalNodes[0],{canonicalId:'x',routingEnabled:false,members:sample.canonicalNodes[0].members}]}));
});

test('reviewed identity map has 81 clusters, all 79 exclusions and no contradictions',async()=>{
 const {readFileSync}=await import('node:fs');
 const data=JSON.parse(readFileSync(new URL('../data/crosswalk-reviewed.json',import.meta.url),'utf8'));
 assert.equal(data.reviewedPairs,202);
 assert.equal(data.approvedPairs,123);
 assert.equal(data.deniedPairRecords.length,79);
 assert.deepEqual(verifyCrosswalk(data),{groups:81,members:180});
 const accepted=['三岔路口','四岔路口','林道登山口'];
 for(const name of accepted){
   const groups=name==='林道登山口'?['南二段','新康橫斷']:['南二段','馬博拉斯橫斷'];
   assert.equal(canonicalIdFor(data,groups[0],name),canonicalIdFor(data,groups[1],name));
 }
 assert.equal(canonicalIdFor(data,'奇萊','主北岔路'),null);
 assert.equal(canonicalIdFor(data,'玉山群峰','主北岔路'),null);
 assert.ok(data.deniedPairRecords.some(d=>d.name==='主北岔路'&&[d.groupA,d.groupB].includes('奇萊')));
 const changed=structuredClone(data);
 changed.deniedPairRecords.push({name:'三岔路口',groupA:'南二段',groupB:'馬博拉斯橫斷'});
 assert.throws(()=>verifyCrosswalk(changed),/Denied pair merged/);
});

test('walking routing refuses a vehicle shortcut and unverified edge',()=>{
 const r=addRouteIdentity({route_id:'X',nodes:[
  {id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],
  segments:[
   {from:'A',to:'B',minutes:50},
   {from:'B',to:'C',minutes:50},
   {from:'A',to:'C',minutes:1,travelMode:'vehicle'},
   {from:'A',to:'C',minutes:2,verificationStatus:'unverified'}
  ]});
 assert.deepEqual(shortestPath(r,'a','c').nodes,['a','b','c']);
 assert.equal(shortestPath(r,'a','c').minutes,100);
});

import {buildVerifiedWalkingGraph,shortestVerifiedWalkingPath} from '../js/crossmap-routing.js';
test('cross-map routing remains isolated by default even when identity is approved',()=>{
 const routes=[
  {route_id:'R1',route_name:'圖甲',nodes:[{id:'a',name:'入口甲'},{id:'j',name:'交會點'}],segments:[
   {fromId:'a',toId:'j',minutes:30,travelMode:'walking',verificationStatus:'verified'}]},
  {route_id:'R2',route_name:'圖乙',nodes:[{id:'j',name:'交會點'},{id:'b',name:'出口乙'}],segments:[
   {fromId:'j',toId:'b',minutes:40,travelMode:'walking',verificationStatus:'verified'}]}
 ];
 const crosswalk={canonicalNodes:[{canonicalId:'shared-j',members:[
  {group:'圖甲',name:'交會點'},{group:'圖乙',name:'交會點'}]}]};
 const separated=buildVerifiedWalkingGraph(routes,crosswalk);
 const a=separated.locationId.get(JSON.stringify(['R1','a']));
 const b=separated.locationId.get(JSON.stringify(['R2','b']));
 assert.equal(shortestVerifiedWalkingPath(separated,a,b),null);
 const enabled=buildVerifiedWalkingGraph(routes,crosswalk,{allowCrossMap:true});
 const joined=shortestVerifiedWalkingPath(enabled,enabled.locationId.get(JSON.stringify(['R1','a'])),enabled.locationId.get(JSON.stringify(['R2','b'])));
 assert.equal(joined.minutes,70);
 assert.deepEqual(joined.segments.map(s=>s.routeId),['R1','R2']);
});
test('cross-map graph never traverses vehicle/unverified/reverse assumed route',()=>{
 const route={route_id:'R',route_name:'圖',nodes:[
  {id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],segments:[
  {fromId:'a',toId:'b',minutes:30,travelMode:'walking',verificationStatus:'verified'},
  {fromId:'b',toId:'c',minutes:40,travelMode:'walking',verificationStatus:'verified'},
  {fromId:'a',toId:'c',minutes:1,travelMode:'vehicle',verificationStatus:'verified'},
  {fromId:'a',toId:'c',minutes:2,travelMode:'walking',verificationStatus:'pending'},
  {fromId:'c',toId:'a',minutes:3,travelMode:'walking',verificationStatus:'unverified'}]};
 const graph=buildVerifiedWalkingGraph([route],{canonicalNodes:[]});
 const id=n=>graph.locationId.get(JSON.stringify(['R',n]));
 assert.equal(shortestVerifiedWalkingPath(graph,id('a'),id('c')).minutes,70);
 assert.equal(shortestVerifiedWalkingPath(graph,id('c'),id('a')),null);
});
test('cross-map denies user-excluded membership and does not guess from identical labels',()=>{
 const base={route_id:'R',route_name:'圖甲',nodes:[{id:'j',name:'岔路'}],segments:[]};
 const other={route_id:'S',route_name:'圖乙',nodes:[{id:'j',name:'岔路'}],segments:[]};
 const graph=buildVerifiedWalkingGraph([base,other],{canonicalNodes:[]},{allowCrossMap:true});
 assert.notEqual(graph.locationId.get(JSON.stringify(['R','j'])),graph.locationId.get(JSON.stringify(['S','j'])));
 const conflict={canonicalNodes:[{canonicalId:'bad',members:[{group:'圖甲',name:'岔路'},{group:'圖乙',name:'岔路'}]}],
 deniedPairRecords:[{name:'岔路',groupA:'圖甲',groupB:'圖乙'}]};
 assert.throws(()=>buildVerifiedWalkingGraph([base,other],conflict,{allowCrossMap:true}),/Denied cross-map/);
});

test('G11 staged source-audited walking graph has 13 two-way paths but zero road legs',async()=>{
 const {readFileSync}=await import('node:fs');
 const g11=JSON.parse(readFileSync(new URL('../data/staging/G11.verified-walking.json',import.meta.url),'utf8'));
 assert.equal(g11.segments.length,26);
 assert.equal(g11.nodes.length,13);
 assert.ok(g11.segments.every(s=>s.travelMode==='walking'&&s.verificationStatus==='verified'));
 assert.ok(!g11.nodes.some(n=>['霧社','銅門','仁壽橋','花蓮'].includes(n.name)));
 const graph=buildVerifiedWalkingGraph([g11],{canonicalNodes:[]});
 const start=g11.nodes.find(n=>n.name==='屯原登山口').id;
 const end=g11.nodes.find(n=>n.name==='天池山莊').id;
 const id=x=>graph.locationId.get(JSON.stringify(['G11-STAGING',x]));
 assert.equal(shortestVerifiedWalkingPath(graph,id(start),id(end)).minutes,330);
 assert.equal(shortestVerifiedWalkingPath(graph,id(end),id(start)).minutes,280);
});
test('G11 staging is not present in publicly selectable manifest',async()=>{
 const {readFileSync}=await import('node:fs');
 const manifest=JSON.parse(readFileSync(new URL('../data/manifest.json',import.meta.url),'utf8'));
 assert.ok(!manifest.routes.some(r=>r.id==='G11-STAGING'||r.id==='G11'));
});

test('G06 plus G11 independently audited graphs remain disconnected',async()=>{
 const {readFileSync}=await import('node:fs');
 const load=n=>JSON.parse(readFileSync(new URL('../data/staging/'+n+'.verified-walking.json',import.meta.url),'utf8'));
 const g06=load('G06'),g11=load('G11');
 const graph=buildVerifiedWalkingGraph([g06,g11],{canonicalNodes:[]},{allowCrossMap:true});
 assert.equal(g06.segments.length,18);
 assert.equal(g11.segments.length,26);
 const nodeId=(routeId,node)=>graph.locationId.get(JSON.stringify([routeId,node.id]));
 const start=nodeId(g06.route_id,g06.nodes.find(n=>n.name==='白姑大山'));
 const end=nodeId(g11.route_id,g11.nodes.find(n=>n.name==='天池山莊'));
 assert.equal(shortestVerifiedWalkingPath(graph,start,end),null);
 assert.ok(graph.edges.size>0);
});


test('G17→G18 real source-audited overlap uses confirmed junction, not name matching',async()=>{
 const {readFileSync}=await import('node:fs');
 const load=file=>JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
 const g17=load('../data/staging/G17.overlap-verified-subset.json');
 const g18=load('../data/staging/G18.overlap-verified-subset.json');
 const crosswalk=load('../data/crosswalk-reviewed.json');
 const id=(graph,route,name)=>{
   const node=route.nodes.find(n=>n.name===name);
   return graph.locationId.get(JSON.stringify([route.route_id,node.id]));
 };
 const separate=buildVerifiedWalkingGraph([g17,g18],crosswalk);
 assert.equal(shortestVerifiedWalkingPath(separate,id(separate,g17,'南雙頭山'),id(separate,g18,'3058公尺峰')),null);
 const joined=buildVerifiedWalkingGraph([g17,g18],crosswalk,{allowCrossMap:true});
 const route=shortestVerifiedWalkingPath(joined,id(joined,g17,'南雙頭山'),id(joined,g18,'3058公尺峰'));
 assert.ok(route,'Source-verified join should traverse 新康山岔路口');
 assert.deepEqual(route.segments.map(s=>s.routeId),['G17-OVERLAP','G17-OVERLAP','G18-OVERLAP','G18-OVERLAP']);
 assert.equal(route.minutes,480); // 110 + 220 + 70 + 80
 const reverse=shortestVerifiedWalkingPath(joined,id(joined,g18,'3058公尺峰'),id(joined,g17,'南雙頭山'));
 assert.equal(reverse.minutes,480); // 90 + 80 + 130 + 180
 assert.equal(route.nodes.length,5);
});
test('G17 and G18 staged excerpts contain eight audited bidirectional walking pairs',async()=>{
 const {readFileSync}=await import('node:fs');
 const read=n=>JSON.parse(readFileSync(new URL('../data/staging/'+n+'.overlap-verified-subset.json',import.meta.url),'utf8'));
 const a=read('G17'),b=read('G18');
 assert.equal(a.segments.length,8);assert.equal(b.segments.length,8);
 assert.ok([...a.segments,...b.segments].every(e=>e.travelMode==='walking'&&e.verificationStatus==='verified'&&e.source.startsWith('https://www.sunriver.com.tw/')));
});

test('G17/G18 overlap audit isolates directional inversion without trusting candidate times',async()=>{
 const {readFileSync}=await import('node:fs');
 const review=JSON.parse(readFileSync(new URL('../data/audits/G17_G18_overlap_review.json',import.meta.url),'utf8'));
 assert.equal(review.counts.sharedDirectedEdges,24);
 assert.equal(review.counts.conflictingDirectedValues,2);
 assert.equal(review.confirmedIssue.officialGo,25);
 assert.equal(review.confirmedIssue.officialBack,35);
 assert.equal(review.routingSubset.published,false);
 assert.equal(review.routingSubset.previewIntegrated,false);
});

test('standalone cross-map preview contains all elements and is not wired into itinerary autosave',async()=>{
 const {readFileSync}=await import('node:fs');
 const page=readFileSync(new URL('../crossmap-preview.html',import.meta.url),'utf8');
 const controller=readFileSync(new URL('../js/crossmap-preview.js',import.meta.url),'utf8');
 for(const id of ['start','end','swap','status','result'])assert.match(page,new RegExp('id="'+id+'"'));
 assert.match(page,/js\/crossmap-preview\.js/);
 assert.match(controller,/buildVerifiedWalkingGraph\(routes,crosswalk,\{allowCrossMap:true\}\)/);
 assert.doesNotMatch(controller,/localStorage|sessionStorage|mountain-planner\.autosave|saveAutosave/);
 for(const source of ['G17.overlap-verified-subset.json','G18.overlap-verified-subset.json'])
   assert.ok(controller.includes(source));
});

test('expanded G17 verified walking path reaches G18 from 三叉山登山口',async()=>{
 const {readFileSync}=await import('node:fs');
 const read=file=>JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
 const a=read('../data/staging/G17.overlap-verified-subset.json');
 const b=read('../data/staging/G18.overlap-verified-subset.json');
 const x=read('../data/crosswalk-reviewed.json');
 const graph=buildVerifiedWalkingGraph([a,b],x,{allowCrossMap:true});
 const id=(r,name)=>graph.locationId.get(JSON.stringify([r.route_id,r.nodes.find(n=>n.name===name).id]));
 const found=shortestVerifiedWalkingPath(graph,id(a,'三叉山登山口'),id(b,'3058公尺峰'));
 assert.ok(found);
 assert.equal(found.minutes,220);
 assert.deepEqual(found.segments.map(s=>s.minutes),[30,40,70,80]);
 assert.equal(shortestVerifiedWalkingPath(graph,id(b,'3058公尺峰'),id(a,'三叉山登山口')).minutes,225);
});

test('source-reviewed G17 and G18 overlapping directed minutes agree',async()=>{
 const {readFileSync}=await import('node:fs');
 const read=n=>JSON.parse(readFileSync(new URL('../data/staging/'+n+'.overlap-verified-subset.json',import.meta.url),'utf8'));
 const a=read('G17'),b=read('G18');
 const k=s=>JSON.stringify([s.from,s.to]);
 const ea=new Map(a.segments.map(s=>[k(s),s.minutes]));
 const eb=new Map(b.segments.map(s=>[k(s),s.minutes]));
 let compared=0;
 for(const [key,minutes] of ea){if(!eb.has(key))continue;compared++;assert.equal(eb.get(key),minutes);}
 assert.equal(compared,4);
});
