import test from 'node:test';
import assert from 'node:assert/strict';
import {distanceMeters,summarizeTracks,parseGpx} from '../js/snow-gpx-pilot.js';

test('distance is calculated along each recorded segment without connecting separate segments',()=>{
 const a={lat:24,lon:121},b={lat:24.001,lon:121},c={lat:25,lon:122},d={lat:25.001,lon:122};
 const stats=summarizeTracks([[a,b],[c,d]]);
 assert.equal(stats.points,4);assert.ok(stats.distance>220&&stats.distance<225);assert.ok(stats.maxGap<112);
 assert.equal(distanceMeters(a,a),0);
});
test('invalid GPX documents are rejected',()=>{
 assert.throws(()=>parseGpx({querySelector:()=>true}),/GPX/);
});
