import {attachedRoute} from './osm-attachment-routing.js';
export function rememberIntervals(edit){
 if(!edit.shape?.length)return;
 const points=edit.shape,ends=[0,...points.map((p,i)=>p.controlId?i:-1).filter(i=>i>0&&i<points.length-1),points.length-1];
 const previous=edit.intervals||[];edit.intervals=ends.slice(1).map((end,i)=>{const start=ends[i],x=points[start],y=points[end],key=(x.controlId||'start')+'>'+(y.controlId||'end'),mode=edit.intervalModes?.[key]||'auto';const signature=JSON.stringify([x.coordinate,y.coordinate,mode]),cached=previous.find(p=>p.key===key&&p.signature===signature);if(cached)return cached;return {key,signature,mode,preserved:true,network:false,coordinates:points.slice(start,end+1).map(p=>[...p.coordinate])};});
}
// Stable boundary IDs let unchanged intervals retain their confirmed geometry.
export function routeIntervals(edit,a,b,graph){
 const boundaries=[{id:'start',coordinate:a},...edit.controls,{id:'end',coordinate:b}],old=edit.intervals||[];
 const intervals=[];
 for(let i=1;i<boundaries.length;i++){
  const x=boundaries[i-1],y=boundaries[i],key=x.id+'>'+y.id;
  const mode=edit.intervalModes?.[key]||'auto',signature=JSON.stringify([x.coordinate,y.coordinate,mode]);
  const cached=old.find(p=>p.key===key&&p.signature===signature&&(p.preserved||p.network||mode==='straight'));
  if(cached){intervals.push(cached);continue;}
  const r=mode==='auto'&&graph?attachedRoute(graph,x.coordinate,y.coordinate):null;
  intervals.push({key,signature,mode,network:!!r,coordinates:r?[x.coordinate,...r.coordinates.map(p=>p.slice(0,2)),y.coordinate]:[x.coordinate,y.coordinate],access:r?Math.max(r.start.distance,r.end.distance):null});
 }
 const shape=[];
 intervals.forEach((p,i)=>{p.coordinates.forEach((coordinate,j)=>{if(i&&j===0)return;shape.push({coordinate:[...coordinate],...(j===p.coordinates.length-1&&i<edit.controls.length?{controlId:edit.controls[i].id}:{})})});});
 if(shape.length>5000)throw Error('路徑超過 5,000 頂點，請分段規劃');
 return {intervals,shape};
}
