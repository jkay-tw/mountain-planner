import test from 'node:test';
import assert from 'node:assert/strict';
import {directionalQuickAdd,quickAddEstimatedMinutes} from '../js/quick-add.js';
import {buildQuickTopology,layoutQuickTopology,renderQuickTopologySvg} from '../js/quick-topology.js';

const walking=(fromId,toId,minutes)=>({
 fromId,toId,from:fromId,to:toId,minutes,travelMode:'walking',verificationStatus:'verified'
});
const route={
 nodes:['previous','center','branch-a','branch-b','branch-c','shared','end'].map(id=>({id,name:id})),
 segments:[
  walking('previous','center',12),walking('center','previous',12),
  walking('center','branch-a',18),walking('center','branch-b',25),
  walking('center','branch-c',32),
  walking('branch-a','shared',20),walking('branch-b','shared',14),
  walking('branch-c','branch-a',8),
  {...walking('center','end',10),travelMode:'vehicle'}
 ],
 manualConnections:[]
};
const day={items:[{type:'location',nodeId:'previous'},{type:'rest',minutes:5},{type:'location',nodeId:'center'}],coefficient:1.25};
const candidates=directionalQuickAdd(route,day);

test('one node per ID even when a destination has multiple possible routes',()=>{
 const g=buildQuickTopology(candidates,'center','目前位置');
 assert.equal(g.nodes.filter(n=>n.id==='shared').length,1);
 assert.equal(g.edges.filter(e=>e.to==='shared').length,2);
 assert.equal(g.first.filter(n=>n.returning).length,1);
 assert.ok(!g.nodes.some(n=>n.id==='end')); // no vehicle routes
 const chart=layoutQuickTopology(g);
 assert.ok(chart.height>0);
 assert.equal(chart.positions.size,g.nodes.length);
 assert.equal(new Set(chart.positions.keys()).size,g.nodes.length);
});
test('SVG has graph edges, return styling, ambiguity and the current node',()=>{
 const svg=renderQuickTopologySvg(candidates,'center','目前位置',day.coefficient,quickAddEstimatedMinutes);
 const g=buildQuickTopology(candidates,'center','目前位置');
 assert.equal((svg.match(/<circle /g)||[]).length,g.nodes.length);
 assert.equal((svg.match(/<path /g)||[]).length,g.edges.length);
 assert.match(svg,/stroke-dasharray="4 4"/);
 assert.match(svg,/多條路線/);
 assert.match(svg,/↩/);
 assert.match(svg,/role="img"/);
});
test('escaped untrusted node names are never injected as SVG tags',()=>{
 const input=[{key:'x>y',nodeId:'y',name:'<script>',direction:0,segments:[walking('x','y',20)]}];
 input[0].segments[0].to='<script>';
 const svg=renderQuickTopologySvg(input,'x','" & <bad>',1,quickAddEstimatedMinutes);
 assert.ok(!svg.includes('<script>'));
 assert.match(svg,/&lt;script&gt;/);
 assert.match(svg,/&lt;bad&gt;/);
 assert.match(svg,/&amp;/);
});
test('one confirmed segment with unknown minutes stays unknown',()=>{
 const confirmed={...walking('center','branch-a',null),verificationStatus:'owner-confirmed-connection',manualTimeRequired:true};
 assert.equal(quickAddEstimatedMinutes({segments:[confirmed]},1.25),null);
});
