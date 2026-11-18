import {coordinateOf} from './path-editor.js';
function target(day,toId){const items=day.items.filter(i=>i.type!=='rest'),index=items.findIndex(i=>i.id===toId);return {day,from:items[index-1],to:items[index]};}
function fingerprint({from,to},data){return JSON.stringify([from.id,to.id,coordinateOf(from,data),coordinateOf(to,data),to.pathEdit||null]);}
// Rendering linked days clones items. Track routing inputs and stable IDs instead
// of JS object identity, while still rejecting deleted/moved/re-edited targets.
export function captureRoutingRequest(day,toId,data){const pair=target(day,toId);if(!pair.from||!pair.to)return null;return {dayId:day.id,toId,fingerprint:fingerprint(pair,data)};}
export function resolveRoutingRequest(days,request,data){const day=days.find(d=>d.id===request.dayId);if(!day)return null;const pair=target(day,request.toId);return pair.from&&pair.to&&fingerprint(pair,data)===request.fingerprint?pair:null;}
