import fs from 'node:fs';
import {loadProject,loadLibrary} from './route-validator/core.mjs';
import {lineIndex,candidates} from './route-validator/match.mjs';
const p=loadProject(),library=loadLibrary();
for(const source of library.entries.filter(s=>['1622','272178'].includes(s.recordingId))){
 const index=lineIndex(source.parsed.components,{nearMeters:30,reviewMeters:100}),events=[];
 for(const [id,n]of p.nodes){if(!n.groups.some(g=>['G16','G17'].includes(g)))continue;const coordinate=p.coordinates.get(id)?.coordinate;if(!coordinate)continue;const cs=candidates(coordinate,index).values;for(const c of cs.filter(c=>c.offset<=100))events.push({nodeId:id,name:n.name,along:Math.round(c.along),offset:Math.round(c.offset),component:c.component});}
 events.sort((a,b)=>a.along-b.along);const selected=[];for(const e of events){const prev=selected.findLast(x=>x.nodeId===e.nodeId);if(prev&&e.along-prev.along<300){if(e.offset<prev.offset)Object.assign(prev,e);continue;}selected.push(e);}
 fs.writeFileSync('.route-validator/research/order-'+source.recordingId+'.json',JSON.stringify({source:source.sourceUrl,events:selected},null,2));console.log('SOURCE',source.recordingId);for(const e of selected)console.log(e.along,e.name,e.offset+'m');
}
