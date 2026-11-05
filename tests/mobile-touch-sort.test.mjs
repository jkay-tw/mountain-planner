import test from 'node:test';
import assert from 'node:assert/strict';
import {dropSlotAtY,insertionIndex} from '../preview/js/mobile-touch-sort.js';

test('touch target uses each row midpoint, not tiny seven-pixel gaps', () => {
  const rows = [
    {index:0,top:10,bottom:50},
    {index:1,top:57,bottom:137},
    {index:2,top:144,bottom:190}
  ];
  assert.equal(dropSlotAtY(rows,0),0);
  assert.equal(dropSlotAtY(rows,29),0);
  assert.equal(dropSlotAtY(rows,31),1);
  assert.equal(dropSlotAtY(rows,96),1);
  assert.equal(dropSlotAtY(rows,98),2);
  assert.equal(dropSlotAtY(rows,181),3);
});

test('touch target works for a single row and empty timeline', () => {
  assert.equal(dropSlotAtY([],42),0);
  assert.equal(dropSlotAtY([{index:0,top:15,bottom:55}],25),0);
  assert.equal(dropSlotAtY([{index:0,top:15,bottom:55}],45),1);
});

test('insertionIndex preserves the desktop drag insertion convention', () => {
  assert.equal(insertionIndex(1,4,5),3);
  assert.equal(insertionIndex(3,1,5),1);
  assert.equal(insertionIndex(2,2,5),2);
  assert.equal(insertionIndex(2,3,5),2);
  assert.equal(insertionIndex(0,5,5),4);
  assert.equal(insertionIndex(4,0,5),0);
});

test('reject invalid moves without touching day data', () => {
  assert.equal(insertionIndex(-1,2,5),null);
  assert.equal(insertionIndex(5,2,5),null);
  assert.equal(insertionIndex(0,6,5),null);
  assert.equal(insertionIndex(0,-1,5),null);
  assert.equal(insertionIndex(0,0,0),null);
});
