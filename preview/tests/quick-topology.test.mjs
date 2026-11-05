import test from 'node:test';
import assert from 'node:assert/strict';
import {directionalQuickAdd,quickAddEstimatedMinutes} from '../js/quick-add.js';
import {buildQuickTopology,layoutQuickTopology,layoutQuickTopologyLabels,renderQuickTopologySvg} from '../js/quick-topology.js';

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


const compassCandidates=['north','south','east','west','unknown'].map(id=>({
 key:'center>'+id,nodeId:id,direction:0,
 segments:[walking('center',id,20)]
}));
const compassGeometry={nodes:[
 {nodeId:'center',coordinate:[121,24],coordinatePolicy:'active'},
 {nodeId:'north',coordinate:[121,24.01],coordinatePolicy:'active'},
 {nodeId:'south',coordinate:[121,23.99],coordinatePolicy:'active'},
 {nodeId:'east',coordinate:[121.01,24],coordinatePolicy:'active'},
 {nodeId:'west',coordinate:[120.99,24],coordinatePolicy:'active'},
 {nodeId:'unknown',coordinate:null,coordinatePolicy:'active'}
]};
test('coordinate-bearing local layout preserves the four rough compass directions',()=>{
 const graph=buildQuickTopology(compassCandidates,'center','起點');
 const l=layoutQuickTopology(graph,compassGeometry),c=l.positions.get('center');
 assert.equal(l.mode,'geographic');
 assert.ok(l.positions.get('north').y<c.y);
 assert.ok(l.positions.get('south').y>c.y);
 assert.ok(l.positions.get('east').x>c.x);
 assert.ok(l.positions.get('west').x<c.x);
 assert.ok(l.estimatedIds.has('unknown'));
 const svg=renderQuickTopologySvg(compassCandidates,'center','起點',1,quickAddEstimatedMinutes,compassGeometry);
 assert.match(svg,/data-layout-mode="geographic"/);
 assert.match(svg,/topo-compass/);
 assert.match(svg,/topo-estimated/);
 assert.match(svg,/stroke-dasharray="3 2"/);
 assert.match(svg,/◌/);
});
test('the old abstract topology is retained if there is insufficient coordinate coverage',()=>{
 const graph=buildQuickTopology(compassCandidates,'center','起點');
 for(const data of [null,{nodes:[]},{nodes:[{nodeId:'center',coordinate:[121,24]}]}]){
  const l=layoutQuickTopology(graph,data);
  assert.equal(l.mode,'topology');
  assert.equal(l.positions.size,graph.nodes.length);
 }
 const svg=renderQuickTopologySvg(compassCandidates,'center','起點',1,quickAddEstimatedMinutes);
 assert.match(svg,/座標不足，採純拓樸示意/);
 assert.doesNotMatch(svg,/topo-compass/);
});
test('ignored or vehicle-only coordinates never become location anchors',()=>{
 const g=buildQuickTopology(compassCandidates,'center','起點');
 const onlyIgnored={nodes:compassGeometry.nodes.map(n=>({...n,coordinatePolicy:'ignored'}))};
 assert.equal(layoutQuickTopology(g,onlyIgnored).mode,'topology');
});
test('geographic points maintain one scale and labels move independently',()=>{
 const choices=[
  {key:'origin>near',nodeId:'near',direction:0,segments:[walking('origin','near',4)]},
  {key:'origin>far',nodeId:'far',direction:0,segments:[walking('origin','far',40)]},
  {key:'origin>north',nodeId:'north',direction:0,segments:[walking('origin','north',20)]}
 ];
 const geo={nodes:[
  {nodeId:'origin',coordinate:[121,24],coordinatePolicy:'active'},
  {nodeId:'near',coordinate:[121.001,24],coordinatePolicy:'active'},
  {nodeId:'far',coordinate:[121.010,24],coordinatePolicy:'active'},
  {nodeId:'north',coordinate:[121,24.005],coordinatePolicy:'active'}
 ]};
 const g=buildQuickTopology(choices,'origin','起點');
 const layout=layoutQuickTopology(g,geo),a=layout.positions;
 assert.equal(layout.mode,'geographic');
 const p=a.get('origin'),near=a.get('near'),far=a.get('far');
 const ratio=Math.abs(far.x-p.x)/Math.abs(near.x-p.x);
 assert.ok(Math.abs(ratio-10)<.00001,'Real 10:1 separation must remain 10:1');
 assert.ok(a.get('north').y<p.y,'True north remains above');
 const positionsBefore=JSON.stringify([...a]);
 const labels=layoutQuickTopologyLabels(g,layout);
 assert.equal(JSON.stringify([...a]),positionsBefore,'Label placement must not move nodes');
 assert.equal(labels.size,g.nodes.length);
 const svg=renderQuickTopologySvg(choices,'origin','起點',1,quickAddEstimatedMinutes,geo);
 assert.match(svg,/ L /,'Connections are straight schematic links');
});
test('nearby dots can overlap, but their text labels avoid one another',()=>{
 const g=buildQuickTopology(compassCandidates,'center','起點');
 const geo={nodes:compassGeometry.nodes.map(n=>n.nodeId==='unknown'
  ?{...n,coordinate:[121.0105,24.002]}:n)};
 const l=layoutQuickTopology(g,geo);
 const labels=layoutQuickTopologyLabels(g,l);
 const nodes=g.nodes.map(n=>n.id);
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
  const a=labels.get(nodes[i]),b=labels.get(nodes[j]);
  const width=Math.max(0,Math.min(a.r,b.r)-Math.max(a.l,b.l));
  const height=Math.max(0,Math.min(a.b,b.b)-Math.max(a.t,b.t));
  assert.ok(width*height<1,'Visible text labels should not overlap');
 }
});
