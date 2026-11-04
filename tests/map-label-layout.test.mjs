import test from 'node:test';
import assert from 'node:assert/strict';
import {placeMapLabels} from '../js/map-label-layout.js';
const size={x:400,y:300};
test('node title remains at same position when expanded and collisions are hidden',()=>{
 const node={point:{x:100,y:100},w:50,h:20};
 const other={point:{x:100,y:125},w:50,h:20};
 const closed=placeMapLabels([node,other],[],[],size);
 const opened=placeMapLabels([{...node,h:45,selected:true},other],[],[],size);
 assert.deepEqual([closed[0].box.x,closed[0].box.y],[opened[0].box.x,opened[0].box.y]);
 assert.equal(closed.length,2);assert.equal(opened.length,1);
});
test('out and back day labels keep stable offsets and avoid overlap',()=>{
 const p={x:100,y:100};
 const labels=[{point:p,w:45,h:18,dayOffset:0},{point:p,w:45,h:18,dayOffset:25}];
 const placed=placeMapLabels(labels,[],[],size);
 assert.equal(placed.length,2);assert.equal(placed[1].box.y-placed[0].box.y,25);
});
