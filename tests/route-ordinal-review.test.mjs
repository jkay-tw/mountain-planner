import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {subsectionObservations} from '../tools/route-validator/ordinal-review.mjs';
import {loadProject} from '../tools/route-validator/core.mjs';
import {loadSnapshot} from '../tools/route-validator/core.mjs';
import {checkNodeOrder,orderDependencies} from '../tools/route-validator/order-check.mjs';

const route={occurrences:[{position:1,nodeId:'A'},{position:2,nodeId:'B'},{position:3,nodeId:'A'}]};
const match=(position,alongMeters,component=0)=>({position,alongMeters,component,offsetMeters:65});
test('ordinal subsections tolerate spatial offset and extra side trips without inserting them',()=>{
 const before=structuredClone(route),events=[{nodeId:'extra-summit',name:'選登峰',component:0,along:400,offset:0}];
 const out=subsectionObservations(route,[match(1,0),match(2,1000),match(3,2000)],{edges:[]},events);
 assert.equal(out.length,2);assert.equal(out[0].status,'SHARED_SUBSECTION_OBSERVED');
 assert.equal(out[0].events[0].nodeId,'extra-summit');assert.deepEqual(route,before);
 assert.deepEqual(out.map(s=>s.positions),[[1,2],[2,3]]);
});
test('split GPX cannot bridge missing subsections or replace repeated visits',()=>{
 const out=subsectionObservations(route,[match(1,0),match(2,1000,1)],{edges:[]},[]);
 assert.equal(out.length,0);
 assert.equal(subsectionObservations(route,[match(1,0),match(2,1000)],{edges:[]},[]).length,1);
});
test('vehicle or GPS speed concerns are scoped to the observed subsection',()=>{
 const edge=(along,speed)=>({component:0,along,length:100,recordA:{time:0},recordB:{time:speed?1000:100000}});
 const out=subsectionObservations(route,[match(1,0),match(2,500),match(3,1500)],{edges:[edge(100,false),edge(1000,true)]},[]);
 assert.equal(out[0].speedSuspects,0);assert.equal(out[1].speedSuspects,1);
});
test('source-review application adds an existing intermediate ID and preserves every other route intent',()=>{
 const r=JSON.parse(fs.readFileSync('data/audits/route-order-20261125/source-review.json')),p=loadProject();
 assert.equal(r.results.length,60);assert.equal(r.mapReferences.length,19);
 for(const route of r.results){assert.ok(route.after.every(id=>p.nodeAuthority.has(id)));assert.ok(route.candidateDispositions.every(d=>d.reason));
  if(route.routeId!=='R057')assert.deepEqual(route.after,route.before);
  else{assert.equal(route.after[8],'node:79b43ef005b9dfe9c481');assert.equal(route.after.length,route.before.length+1);}
 }
 assert.equal(r.results.reduce((n,r)=>n+r.candidateDispositions.length,0),160);
 assert.equal(r.unexpanded.length,26);
});
test('re-running order checks retains reviewed results and detects changed sequences without using geometry PASS',()=>{
 const s=loadSnapshot(),p=loadProject(),review=JSON.parse(fs.readFileSync('data/route-validator/order-review-20261125.json'));
 assert.equal(checkNodeOrder(s,p,review).summary.checked,60);
 const before=orderDependencies(s.routes.find(r=>r.routeId==='R001'),p);p.graph.segments[0].minutes+=1;
 assert.equal(orderDependencies(s.routes.find(r=>r.routeId==='R001'),p),before,'time-only changes do not invalidate node order');
 const r=s.routes.find(r=>r.routeId==='R001');[r.occurrences[3],r.occurrences[4]]=[r.occurrences[4],r.occurrences[3]];
 assert.equal(checkNodeOrder(s,p,review).results.find(r=>r.routeId==='R001').status,'ORDER_RECHECK_REQUIRED');
 assert.equal(checkNodeOrder(s,p,review).summary.checked,59);
 s.problems.push({code:'DUPLICATE_ROUTE_ID'});assert.equal(checkNodeOrder(s,p,review).summary.checked,0);
});
