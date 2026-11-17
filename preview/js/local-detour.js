import {meters} from './osm-pilot-router.js';
export function projectOnShape(shape,p){
 let best=null,total=0;const scale=Math.cos(p[1]*Math.PI/180);
 for(let i=1;i<shape.length;i++){const a=shape[i-1].coordinate,b=shape[i].coordinate,dx=(b[0]-a[0])*scale,dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*scale*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1))),coordinate=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],length=meters(a,b),distance=meters(p,coordinate);if(!best||distance<best.distance)best={coordinate,along:total+t*length,distance};total+=length;}
 return {...best,total};
}
function at(shape,d){let walked=0;for(let i=1;i<shape.length;i++){const a=shape[i-1].coordinate,b=shape[i].coordinate,n=meters(a,b);if(walked+n>=d){const t=n?(d-walked)/n:0;return [a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]}walked+=n}return [...shape.at(-1).coordinate]}
export function proposeDetour(base,origin,target,id){
 const shape=structuredClone(base),hit=projectOnShape(shape,origin);let lower=0,upper=hit.total,walked=0;
 for(let i=0;i<shape.length;i++){if(i)walked+=meters(shape[i-1].coordinate,shape[i].coordinate);if(shape[i].controlId){if(walked<=hit.along)lower=walked;else{upper=walked;break}}}
 const start=Math.max(lower,hit.along-100),end=Math.min(upper,hit.along+100);let pId=id+'-P',qId=id+'-Q';walked=0;for(let i=0;i<shape.length;i++){if(i)walked+=meters(shape[i-1].coordinate,shape[i].coordinate);if(shape[i].controlId){if(Math.abs(walked-start)<.001)pId=shape[i].controlId;if(Math.abs(walked-end)<.001)qId=shape[i].controlId;}}
 return {base:shape,min:lower,max:upper,start:Math.max(lower,hit.along-100),end:Math.min(upper,hit.along+100),target:[...target],id,pId,qId};
}
export function detourShape(d){
 const prefix=[],suffix=[];let walked=0;
 for(let i=0;i<d.base.length;i++){if(i)walked+=meters(d.base[i-1].coordinate,d.base[i].coordinate);if(walked<d.start)prefix.push(structuredClone(d.base[i]));if(walked>d.end)suffix.push(structuredClone(d.base[i]));}
 return [...prefix,{coordinate:at(d.base,d.start),controlId:d.pId},{coordinate:[...d.target],controlId:d.id},{coordinate:at(d.base,d.end),controlId:d.qId},...suffix];
}
export function moveDetour(d,id,coordinate){
 if(id===d.id)d.target=[...coordinate];else{const p=projectOnShape(d.base,coordinate);if(id===d.pId){if(p.along<d.min)throw Error('P 不可越過前一控制點');if(p.along>=d.end)throw Error('P 必須在 Q 前方');d.start=p.along;}else if(id===d.qId){if(p.along>d.max)throw Error('Q 不可越過後一控制點');if(p.along<=d.start)throw Error('Q 必須在 P 後方');d.end=p.along;}}
 return detourShape(d);
}
export function applyDetour(edit,d){edit.detour=structuredClone(d);edit.shape=detourShape(d);edit.controls=edit.shape.filter(p=>p.controlId).map(p=>({id:p.controlId,coordinate:[...p.coordinate],name:p.controlId===d.pId?'P 離開步道':p.controlId===d.qId?'Q 返回步道':p.controlId===d.id?'B 路外目標':''}));edit.mode='straight';delete edit.osmSnapshot;delete edit.autoReference;delete edit.networkNodeIds;edit.osmRouting=false;}
