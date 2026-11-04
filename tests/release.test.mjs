import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../js/unified-editor.js',import.meta.url),'utf8');
test('production entry uses reviewed global editor while preview remains separate',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const preview=readFileSync(new URL('../unified-editor.html',import.meta.url),'utf8');
 assert.match(html,/data-mode="production"/);assert.match(html,/js\/unified-editor.js\?v=v088/);
 assert.match(html,/css\/style.css\?v=v088/);
 assert.doesNotMatch(preview,/data-mode="production"/);
 assert.match(html,/id="itineraryGeometry"/);assert.doesNotMatch(source,/if\(!IS_PRODUCTION&&\$\('itineraryGeometry'\)\)/);
 assert.match(source,/migrateLegacyPlanDays\(restoredDays/);
});
test('v0.8.8 promotes the tested planning modules and retains production storage',()=>{
 for(const name of ['planner.js','quick-add.js','day-link.js','scroll-anchor.js','time-input.js','exporter.js','itinerary-geometry.js','validation.js']){
  assert.equal(readFileSync(new URL('../js/'+name,import.meta.url),'utf8'),readFileSync(new URL('../preview/js/'+name,import.meta.url),'utf8'),name);
 }
 assert.match(source,/IS_PRODUCTION\?'v0\.8\.8'/);
 assert.match(source,/mountain-planner\.global-autosave\.v1/);
 assert.doesNotMatch(source,/\(!IS_PRODUCTION\?/);
 assert.doesNotMatch(source,/if\(!IS_PRODUCTION\)try/);
});
