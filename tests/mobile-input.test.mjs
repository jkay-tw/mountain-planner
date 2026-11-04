import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeTimeInput} from '../preview/js/time-input.js';

test('mobile numeric keyboard accepts common 24h entry formats',()=>{
  for(const [typed,expected] of [['0630','06:30'],['630','06:30'],['6:30','06:30'],['06:30','06:30'],['6','06:00'],['00:00','00:00'],['23:59','23:59']]){
    assert.equal(normalizeTimeInput(typed),expected,typed);
  }
});

test('time entries reject invalid, incomplete and unintended values',()=>{
  for(const typed of ['24:00','25:11','23:60','2960','9999','6:','6:300','-1:00','','12abc','12345']){
    assert.equal(normalizeTimeInput(typed),null,typed);
  }
});

test('preview time controls preserve native picker element on change',()=>{
  const source=readFileSync(new URL('../preview/js/unified-editor.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../preview/unified-editor.html',import.meta.url),'utf8');
  assert.match(source,/class="start-time-text" type="text" inputmode="numeric"/);
  assert.match(source,/class="start-time-picker" type="time"/);
  assert.match(source,/nativePicker\.onchange=\(\)=>acceptTime\(nativePicker\)/);
  assert.match(source,/function syncArrivalTimes\(\)/);
  assert.doesNotMatch(source,/start-time'\)\.onchange=e=>\{d\.startTime=e\.target\.value;render\(\)\}/);
  assert.match(html,/css\/style\.css\?v=mobile1/);
  assert.match(html,/js\/unified-editor\.js\?v=mobile1/);
});

test('mobile input selectors override sub-16px field styles without disabling zoom',()=>{
  const css=readFileSync(new URL('../preview/css/style.css',import.meta.url),'utf8');
  assert.match(css,/input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\)/);
  assert.match(css,/select,textarea\{font-size:16px!important\}/);
  assert.match(css,/\.minute-input\{width:54px!important/);
  assert.doesNotMatch(css,/user-scalable\s*:\s*no/i);
});
