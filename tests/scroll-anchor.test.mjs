import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureScrollAnchor,restoreScrollAnchor} from '../js/scroll-anchor.js';

function makePage({y=1200,height=700,maxY=4000,cards=[]}={}) {
  const viewport={scrollY:y,innerHeight:height,scrollTo(_x,to){this.scrollY=Math.max(0,Math.min(to,maxY))}};
  const nodes=cards.map(({id,top,size})=>({
    dataset:{dayId:id},docTop:top,size,
    getBoundingClientRect(){const t=this.docTop-viewport.scrollY;return {top:t,bottom:t+this.size}}
  }));
  const container={querySelectorAll(){return nodes}};
  return {viewport,nodes,container};
}

test('a Safari-style scroll jump during day redraw is reversed',()=>{
  const p=makePage({y:1200,cards:[{id:'day1',top:500,size:2000}]});
  const before=captureScrollAnchor(p.container,p.viewport);
  assert.equal(before.dayId,'day1');
  p.viewport.scrollY=180;
  restoreScrollAnchor(before,p.container,p.viewport);
  assert.equal(p.viewport.scrollY,1200);
});

test('visible day stays anchored when a preceding day grows',()=>{
  const p=makePage({y:1200,cards:[{id:'day1',top:100,size:400},{id:'day2',top:1000,size:1800}]});
  const before=captureScrollAnchor(p.container,p.viewport);
  assert.equal(before.dayId,'day2');
  p.nodes[1].docTop+=250;
  p.viewport.scrollY=200;
  restoreScrollAnchor(before,p.container,p.viewport);
  assert.equal(p.viewport.scrollY,1450);
});

test('missing or collapsed-away day falls back to scrollY and permits browser clamping',()=>{
  const p=makePage({y:1200,maxY:500,cards:[{id:'day1',top:700,size:800}]});
  const before=captureScrollAnchor(p.container,p.viewport);
  p.nodes.length=0;
  restoreScrollAnchor(before,p.container,p.viewport);
  assert.equal(p.viewport.scrollY,500);
});

test('a new day at the same numeric index is not mistaken for the original',()=>{
  const p=makePage({y:1100,cards:[{id:'stable-1',top:800,size:2000}]});
  const before=captureScrollAnchor(p.container,p.viewport);
  p.nodes[0].dataset.dayId='new-day';
  p.viewport.scrollY=0;
  restoreScrollAnchor(before,p.container,p.viewport);
  assert.equal(p.viewport.scrollY,1100);
});

test('above itinerary, no visible day means retain the absolute position',()=>{
  const p=makePage({y:0,cards:[{id:'day1',top:1500,size:500}]});
  const before=captureScrollAnchor(p.container,p.viewport);
  assert.equal(before.dayId,null);
  p.viewport.scrollY=230;
  restoreScrollAnchor(before,p.container,p.viewport);
  assert.equal(p.viewport.scrollY,0);
  restoreScrollAnchor(null,p.container,p.viewport);
  assert.equal(p.viewport.scrollY,0);
});

test('both editor copies use stable day IDs and the protected render path',()=>{
  for(const path of ['js/unified-editor.js','preview/js/unified-editor.js']) {
    const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
    assert.match(source,/captureScrollAnchor\(container\)/);
    assert.match(source,/restoreScrollAnchor\(anchor,container\)/);
    assert.match(source,/data-day-id=/);
  }
});
