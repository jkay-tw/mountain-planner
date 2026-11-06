import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../js/unified-editor.js',import.meta.url),'utf8');
test('production entry uses reviewed global editor while preview remains separate',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const preview=readFileSync(new URL('../unified-editor.html',import.meta.url),'utf8');
 assert.match(html,/data-mode="production"/);assert.match(html,/js\/unified-editor.js\?v=v090/);
 assert.match(html,/css\/style.css\?v=v090/);
 assert.doesNotMatch(preview,/data-mode="production"/);
 assert.match(html,/id="itineraryGeometry"/);assert.doesNotMatch(source,/if\(!IS_PRODUCTION&&\$\('itineraryGeometry'\)\)/);
 assert.match(source,/migrateLegacyPlanDays\(restoredDays/);
});
test('v0.9.0 promotes the tested planning modules and retains production storage',()=>{
 for(const name of ['quick-topology.js','mobile-touch-sort.js','planner.js','day-link.js','scroll-anchor.js','time-input.js','exporter.js','itinerary-geometry.js','validation.js']){
  assert.equal(readFileSync(new URL('../js/'+name,import.meta.url),'utf8'),readFileSync(new URL('../preview/js/'+name,import.meta.url),'utf8'),name);
 }
 // Preview adds presentation helpers after the unchanged production module.
 const productionQuick=readFileSync(new URL('../js/quick-add.js',import.meta.url),'utf8');
 const previewQuick=readFileSync(new URL('../preview/js/quick-add.js',import.meta.url),'utf8');
 assert.ok(previewQuick.startsWith(productionQuick),'Production quick-add logic must stay intact in Preview');
 assert.match(source,/IS_PRODUCTION\?'v0\.9\.0'/);
 assert.match(source,/mountain-planner\.global-autosave\.v1/);
 assert.doesNotMatch(source,/\(!IS_PRODUCTION\?/);
 assert.doesNotMatch(source,/if\(!IS_PRODUCTION\)try/);
});
