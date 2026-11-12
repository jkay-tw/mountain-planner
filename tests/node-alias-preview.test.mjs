import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filterLocations,searchLocationLabel} from '../preview/js/node-browser.js';
import {nodeAliases} from '../preview/js/node-aliases.js';
import {placeMapLabels} from '../preview/js/map-label-layout.js';
import {mergeReviewedRoutes} from '../preview/js/global-route.js';
const load=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));

test('both owner-confirmed aliases find the original camp once and preserve its primary name and ID',()=>{
 const manifest=load('preview/data/unified-editor-manifest.json');
 const graph=mergeReviewedRoutes(manifest.routes.map(r=>load('preview/'+r.file.split('?')[0])));
 const id='node:1bafd281610a4bf66a4b';
 for(const query of ['北鞍營地','北鞍三叉避難小屋']){
  const result=filterLocations(graph.nodes,query,100,{includeRoute:false});
  const camp=result.filter(n=>n.id===id);
  assert.equal(camp.length,1);assert.equal(camp[0].name,'三叉營地');
  if(query==='北鞍三叉避難小屋')assert.equal(result.length,1);
 }
 assert.equal(graph.nodes.length,720);assert.equal(graph.segments.length,1398);
});

test('alias search is case insensitive, respects scope options, and never merges matching labels',()=>{
 const options=[{id:'a',name:'Camp A',aliases:['North Hut'],route:'Ridge'},
                {id:'b',name:'Camp B',aliases:['North Hut'],route:'Other'}];
 assert.deepEqual(filterLocations(options,'  north hut  ',100,{includeRoute:false}).map(n=>n.id),['a','b']);
 assert.equal(filterLocations(options,'Ridge',100,{includeRoute:false}).length,0);
 assert.equal(filterLocations(options,'Ridge').length,1);
 assert.equal(filterLocations(options,'north hut',1).length,1);
});

test('search results explain the matched alias and group while retaining the main name',()=>{
 const n={name:'三叉營地',route:'G10',aliases:['北鞍營地']};
 assert.equal(searchLocationLabel(n,'北鞍營地'),'三叉營地｜G10（符合別稱：北鞍營地）');
 assert.equal(searchLocationLabel(n,'三叉'),'三叉營地｜G10');
 assert.equal(n.name,'三叉營地');
});

test('叉 and 岔 match in both directions in names and aliases without merging nodes',()=>{
 const nodes=[{id:'a',name:'三叉路口',aliases:['四叉營地']},{id:'b',name:'三岔路口',aliases:[]}];
 assert.deepEqual(filterLocations(nodes,'三岔',100,{includeRoute:false}).map(n=>n.id),['a','b']);
 assert.deepEqual(filterLocations(nodes,'三叉',100,{includeRoute:false}).map(n=>n.id),['a','b']);
 assert.equal(searchLocationLabel(nodes[0],'四岔'),'三叉路口（符合別稱：四叉營地）');
});

test('expanded alias details stay inside the map near its lower right edge',()=>{
 const point={x:310,y:340};
 const [placed]=placeMapLabels([{point,w:220,h:105,selected:true}],[],[],{x:340,y:360});
 assert.ok(placed.box.x>=0&&placed.box.y>=0);
 assert.ok(placed.box.x+placed.box.w<=340&&placed.box.y+placed.box.h<=360);
 assert.deepEqual(point,{x:310,y:340});
});

test('node details omit empty, duplicate and primary-name aliases without changing source records',()=>{
 const n={name:'三叉營地',aliases:['北鞍營地',' 北鞍營地 ','','三叉營地','北鞍三叉避難小屋',null]};
 const before=structuredClone(n);assert.deepEqual(nodeAliases(n),['北鞍營地','北鞍三叉避難小屋']);assert.deepEqual(n,before);
 assert.deepEqual(nodeAliases(null),[]);
});
