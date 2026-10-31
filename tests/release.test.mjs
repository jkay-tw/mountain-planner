import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../js/unified-editor.js',import.meta.url),'utf8');
test('production entry uses reviewed global editor while preview remains separate',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const preview=readFileSync(new URL('../unified-editor.html',import.meta.url),'utf8');
 assert.match(html,/data-mode="production"/);assert.match(html,/js\/unified-editor.js\?v=v0725/);
 assert.match(html,/css\/style.css\?v=v0724/);
 assert.doesNotMatch(preview,/data-mode="production"/);
 assert.match(source,/migrateLegacyPlanDays\(restoredDays/);
});
