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
 assert.equal(a.segments.length,18);assert.equal(b.segments.length,32);
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

import {filterLocations,adjacentLocations} from '../js/node-browser.js';
test('node search matches partial Chinese names or chart and respects result caps',()=>{
 const opts=[{name:'嘉明湖岔路口',route:'南二段',key:'a'},
  {name:'新康山岔路口',route:'新康橫斷',key:'b'},
  {name:'拉庫音溪山屋',route:'南二段',key:'c'}];
 assert.deepEqual(filterLocations(opts,'岔路').map(x=>x.key),['a','b']);
 assert.deepEqual(filterLocations(opts,'南二段').map(x=>x.key),['a','c']);
 assert.equal(filterLocations(opts,'不在圖上').length,0);
 assert.equal(filterLocations(opts,'',1).length,1);
});
test('adjacent node browser shows verified outgoing connections only, collapsed across charts',async()=>{
 const {readFileSync}=await import('node:fs');
 const load=n=>JSON.parse(readFileSync(new URL('../data/staging/'+n+'.overlap-verified-subset.json',import.meta.url),'utf8'));
 const a=load('G17'),b=load('G18');
 const x=JSON.parse(readFileSync(new URL('../data/crosswalk-reviewed.json',import.meta.url),'utf8'));
 const g=buildVerifiedWalkingGraph([a,b],x,{allowCrossMap:true});
 const origin=a.nodes.find(n=>n.name==='新康山岔路口');
 const nodeId=g.locationId.get(JSON.stringify([a.route_id,origin.id]));
 const next=adjacentLocations(g,nodeId);
 assert.deepEqual(next.map(n=>n.name),['嘉明湖岔路口','布新岔路口','拉庫音溪山屋']);
 assert.ok(next.every(n=>n.minutes>0));
 const jm=next.find(n=>n.name==='嘉明湖岔路口');
 assert.equal(jm.minutes,30);
 assert.equal(jm.edges.length,2);
});

test('crossmap preview cache bust and browser control bindings are versioned together',async()=>{
 const {readFileSync}=await import('node:fs');
 const page=readFileSync(new URL('../crossmap-preview.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../js/crossmap-preview.js',import.meta.url),'utf8');
 assert.match(page,/js\/crossmap-preview\.js\?v=20261027b/);
 assert.match(app,/node-browser\.js\?v=20261027b/);
 for(const id of ['startSearch','endSearch','startMatches','endMatches','neighbors'])
   assert.match(page,new RegExp('id="'+id+'"'));
 assert.match(app,/renderNeighbors\(\)/);
 assert.match(app,/addEventListener\('input',\(\)=>renderSearch\(which\)\)/);
 assert.match(app,/搜尋與相鄰節點已啟用/);
});

test('integrated preview day selector has scoped search and keeps v1 itinerary schema',async()=>{
 const {readFileSync}=await import('node:fs');
 const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
 assert.match(app,/node-search-inline/);
 assert.match(app,/filterLocations\(/);
 assert.match(app,/search\.oninput/);
 assert.match(app,/schemaVersion:1/);
 assert.match(app,/STORAGE_KEY='mountain-planner\.autosave\.v1'/);
});

test('day picker ignores group name 白姑大山 when matching node labels',()=>{
 const candidates=[
  {name:'司晏池營地',route:'白姑大山',id:'a'},
  {name:'白姑大山東南峰',route:'白姑大山',id:'b'},
  {name:'白姑大山',route:'白姑大山',id:'c'}];
 assert.deepEqual(filterLocations(candidates,'白姑',100,{includeRoute:false}).map(n=>n.id),['b','c']);
 assert.deepEqual(filterLocations(candidates,'大山',100,{includeRoute:false}).map(n=>n.id),['b','c']);
 assert.deepEqual(filterLocations(candidates,'司晏',100,{includeRoute:false}).map(n=>n.id),['a']);
 assert.deepEqual(filterLocations(candidates,'白姑').map(n=>n.id),['a','b','c']);
});
test('per-day picker explicitly selects node-name-only search mode',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
 assert.match(source,/search\.value,100,\{includeRoute:false\}/);
});

test('v0.7.5 composite graph supports cross-group multi-day planner shortestPath',async()=>{
 const {readFileSync}=await import('node:fs');
 const raw=JSON.parse(readFileSync(new URL('../data/routes/G17G18.preview.json',import.meta.url),'utf8'));
 const route=addRouteIdentity(raw);
 assert.equal(route.nodes.length,24);
 assert.equal(route.segments.length,46);
 assert.ok(route.segments.every(e=>e.travelMode==='walking'&&e.verificationStatus==='verified'));
 const id=n=>route.nodes.find(x=>x.name===n)?.id;
 const go=shortestPath(route,id('南雙頭山'),id('3058公尺峰'));
 const back=shortestPath(route,id('3058公尺峰'),id('南雙頭山'));
 assert.equal(go.minutes,480);assert.equal(back.minutes,480);
 assert.deepEqual(go.segments.map(x=>x.minutes),[110,220,70,80]);
 assert.equal(shortestPath(route,id('三叉山登山口'),id('3058公尺峰')).minutes,220);
});
test('v0.7.5 preserves per-direction source and user edits during itinerary normalization',async()=>{
 const {readFileSync}=await import('node:fs');
 const route=addRouteIdentity(JSON.parse(readFileSync(new URL('../data/routes/G17G18.preview.json',import.meta.url),'utf8')));
 const start=route.nodes.find(n=>n.name==='南雙頭山');
 const end=route.nodes.find(n=>n.name==='3058公尺峰');
 const d={startTime:'06:00',coefficient:1,note:'',linkedStart:false,items:[
  {...point('one',start.name),nodeId:start.id},
  {...point('last',end.name,{kind:'manual',fromId:'one',toId:'last',actualMinutes:480}),nodeId:end.id}
 ]};
 normalizeDay(d,route);
 assert.deepEqual(d.items.map(i=>i.name),['南雙頭山','拉庫音溪山屋','新康山岔路口','布新岔路口','3058公尺峰']);
 assert.deepEqual(d.items.slice(1).map(i=>i.incoming.officialMinutes),[110,220,70,80]);
 assert.deepEqual(d.items.slice(1).map(i=>i.incoming.source),[
  'https://www.sunriver.com.tw/images/hiking/G17_hiking.jpg',
  'https://www.sunriver.com.tw/images/hiking/G17_hiking.jpg',
  'https://www.sunriver.com.tw/images/hiking/G18_hiking.jpg',
  'https://www.sunriver.com.tw/images/hiking/G18_hiking.jpg'
 ]);
 d.items[d.items.length-1].incoming.actualMinutes=95;
 normalizeDay(d,route);
 assert.equal(d.items[d.items.length-1].incoming.actualMinutes,95);
 const payload={format:'mountain-planner',schemaVersion:1,routeId:'G17G18-PREVIEW',tripStartDate:'',days:[d]};
 assert.equal(validatePlan(payload,['G17G18-PREVIEW']),payload);
});
test('v0.7.5 crossmap editor never shares main planner autosave key or route manifest',async()=>{
 const {readFileSync}=await import('node:fs');
 const app=readFileSync(new URL('../js/crossmap-editor.js',import.meta.url),'utf8');
 const main=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../crossmap-editor.html',import.meta.url),'utf8');
 const manifest=JSON.parse(readFileSync(new URL('../data/crossmap-editor-manifest.json',import.meta.url),'utf8'));
 assert.match(app,/crossmap-autosave\.v075/);
 assert.match(app,/crossmap-editor-manifest\.json/);
 assert.match(html,/js\/crossmap-editor\.js\?v=v0710/);
 assert.doesNotMatch(main,/crossmap-autosave/);
 assert.ok(manifest.routes.some(x=>x.id==='G17G18-PREVIEW'));
 assert.equal(manifest.routes.length,1);
});

test('v0.7.9 responsive tools keep exactly two control groups and retain add/select selectors',async()=>{
 const {readFileSync}=await import('node:fs');
 const css=readFileSync(new URL('../css/style.css',import.meta.url),'utf8');
 const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
 const crossmap=readFileSync(new URL('../js/crossmap-editor.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../crossmap-editor.html',import.meta.url),'utf8');
 const style=css.slice(css.lastIndexOf('/* v0.7.9'));
 for(const source of [app,crossmap]){
   assert.match(source,/node-picker-controls/);
   assert.match(source,/node-action-controls/);
   assert.match(source,/class="add-node"/);
   assert.match(source,/class="add-dest"/);
   assert.match(source,/class="manual-start/);
   assert.match(source,/class="manual-end/);
 }
 assert.match(style,/grid-template-areas:"link picker actions"/);
 assert.match(style,/display:flex;align-items:center;justify-content:flex-start;gap:7px/);
 assert.match(style,/@container dayCard \(max-width:780px\)/);
 assert.match(style,/grid-template-areas:"link" "picker" "actions"/);
 assert.match(style,/grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
 assert.match(html,/css\/style\.css\?v=v0710/);
 assert.match(html,/js\/crossmap-editor\.js\?v=v0710/);
});

test('preview UI build labels and asset cache keys stay synchronized across editors',async()=>{
 const {readFileSync}=await import('node:fs');
 for(const [htmlName,scriptName] of [
   ['index.html','app.js'],['crossmap-editor.html','crossmap-editor.js']]){
   const html=readFileSync(new URL('../'+htmlName,import.meta.url),'utf8');
   const js=readFileSync(new URL('../js/'+scriptName,import.meta.url),'utf8');
   const version=js.match(/const APP_VERSION='v0\.(\d+)\.(\d+) /);
   assert.ok(version,scriptName+' must label preview build');
   const cache='v0'+version[1]+version[2];
   assert.ok(html.includes('js/'+scriptName+'?v='+cache),htmlName+' cache/version mismatch');
   assert.ok(html.includes('css/style.css?v='+cache),htmlName+' CSS cache/version mismatch');
 }
});

test('optional condition-specific time hints survive normalization without replacing standard minutes',async()=>{
 const source=addRouteIdentity({route_id:'TEST',source:{image_url:'https://example.org/route'},
  segments:[{from:'A',to:'B',minutes:190,travelMode:'walking',verificationStatus:'verified',
    timeAlternatives:[{kind:'slow',minutes:350}]}]});
 const day={startTime:'06:00',coefficient:1,items:[
  {...point('n1','A'),nodeId:source.nodes.find(x=>x.name==='A').id},
  {...point('n2','B',{kind:'manual',fromId:'n1',toId:'n2',actualMinutes:null}),
    nodeId:source.nodes.find(x=>x.name==='B').id}
 ]};
 normalizeDay(day,source);
 assert.equal(day.items[1].incoming.officialMinutes,190);
 assert.deepEqual(day.items[1].incoming.timeAlternatives,[{kind:'slow',minutes:350}]);
 day.items[1].incoming.actualMinutes=350;
 normalizeDay(day,source);
 assert.equal(day.items[1].incoming.officialMinutes,190);
 assert.equal(day.items[1].incoming.actualMinutes,350);
 assert.equal(day.items[1].incoming.timeAlternatives[0].minutes,350);
});
test('v0.7.10 preview exposes optional alternate-time controls while keeping node search intact',async()=>{
 const {readFileSync}=await import('node:fs');
 for(const js of ['app.js','crossmap-editor.js']){
  const content=readFileSync(new URL('../js/'+js,import.meta.url),'utf8');
  assert.match(content,/class="alternate-time"/);
  assert.match(content,/alternate-time'\)\.forEach/);
  assert.match(content,/timeAlternatives/);
  assert.match(content,/node-picker-controls/);
 }
});
