import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../js/unified-editor.js',import.meta.url),'utf8');
test('production launch reads its existing v1 autosave without overwriting preview or legacy data',()=>{
 const body=source.match(/function loadAutosave\(\)\{([\s\S]*?)\n\}/)[1];
 const legacy={format:'mountain-planner',routeId:'G06',days:[{note:'old itinerary'}]};
 const store=new Map([['mountain-planner.autosave.v1',JSON.stringify(legacy)]]);
 const context={IS_PRODUCTION:true,STORAGE_KEY:'mountain-planner.global-autosave.v1',localStorage:{getItem:k=>store.get(k)||null}};
 const out=vm.runInNewContext('(function(){'+body+'})()',context);assert.equal(JSON.stringify(out),JSON.stringify(legacy));
 assert.equal(store.size,1);
 context.IS_PRODUCTION=false;context.STORAGE_KEY='mountain-planner.unified-preview-autosave.v0711';
 assert.equal(vm.runInNewContext('(function(){'+body+'})()',context),null);
 const current={format:'mountain-planner',routeId:'GLOBAL-PREVIEW',days:[]};store.set('mountain-planner.global-autosave.v1',JSON.stringify(current));
 context.IS_PRODUCTION=true;context.STORAGE_KEY='mountain-planner.global-autosave.v1';
 assert.equal(vm.runInNewContext('(function(){'+body+'})()',context).routeId,'GLOBAL-PREVIEW');
});
test('production entry uses reviewed global editor while preview remains separate',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const preview=readFileSync(new URL('../unified-editor.html',import.meta.url),'utf8');
 assert.match(html,/data-mode="production"/);assert.match(html,/js\/unified-editor.js\?v=v0724/);
 assert.match(html,/css\/style.css\?v=v0724/);
 assert.doesNotMatch(preview,/data-mode="production"/);
 assert.match(source,/migrateLegacyPlanDays\(restoredDays/);
});
