import {rememberIntervals,intervalShape} from './control-routing.js';
import {displayedDetourBase,proposeDetour,detourShape,projectOnDisplayedScope} from './local-detour.js';
import {meters} from './osm-pilot-router.js';

const points=edit=>edit.shape.map(p=>p.coordinate);
const keys=edit=>['start',...edit.controls.map(c=>c.id),'end'];
const signature=(a,b,mode)=>JSON.stringify([a,b,mode]);
function nextLabel(edit,label){const used=new Set(edit.controls.map(c=>c.label));if(!used.has(label))return label;let i=2;while(used.has(label+i))i++;return label+i;}
function controlsFromShape(edit,labels={}){const old=new Map((edit.controls||[]).map(c=>[c.id,c]));edit.controls=edit.shape.filter(p=>p.controlId).map(p=>({...old.get(p.controlId),id:p.controlId,coordinate:[...p.coordinate],...(labels[p.controlId]?{label:labels[p.controlId]}:{})}));}
function edited(edit){edit.mode='straight';edit.osmRouting=true;delete edit.detour;delete edit.osmSnapshot;delete edit.autoReference;delete edit.networkNodeIds;delete edit.routingError;}
export function seedRouteEdit(edit,geometry,context={}){
 const legacyDetour=!!edit.detour;
 if(edit.detour){const d=edit.detour;edit.intervalModes={...(edit.intervalModes||{}),[d.pId+'>'+d.id]:'straight',[d.id+'>'+d.qId]:'straight'};for(const c of edit.controls)c.label=c.id===d.pId?'P':c.id===d.id?'B':c.id===d.qId?'Q':c.label;delete edit.detour;}
 const shape=displayedDetourBase(edit,geometry),same=JSON.stringify(points({...edit,shape}))===JSON.stringify(edit.shape?.map(p=>p.coordinate));
 if(!same){edit.shape=shape;edit.intervals=[];edit.intervalModes={};}
 if(edit.intervals?.length&&JSON.stringify(edit.intervals.flatMap((p,i)=>p.coordinates.slice(i?1:0)))!==JSON.stringify(edit.shape.map(p=>p.coordinate)))edit.intervals=[];
 if(context.endpointCoordinates){const changed=edit.endpointCoordinates&&JSON.stringify(edit.endpointCoordinates)!==JSON.stringify(context.endpointCoordinates);edit.endpointCoordinates=context.endpointCoordinates.map(p=>[...p]);if(changed)for(const part of edit.intervals||[])if(part.key.startsWith('start>')||part.key.endsWith('>end'))part.retry=true;}
 if(edit.shape[0].controlId)edit.shape.unshift({coordinate:[...edit.shape[0].coordinate]});if(edit.shape.at(-1).controlId)edit.shape.push({coordinate:[...edit.shape.at(-1).coordinate]});
 controlsFromShape(edit);edit.intervalModes={...(edit.intervalModes||{})};
 const ids=keys(edit),fallback=legacyDetour?'auto':context.manual?'straight':'auto';
 for(let i=1;i<ids.length;i++)edit.intervalModes[ids[i-1]+'>'+ids[i]]??=fallback;
 const old=new Set((edit.intervals||[]).map(p=>p.key+'|'+p.signature));rememberIntervals(edit);
 for(const part of edit.intervals)if(!old.has(part.key+'|'+part.signature)){
  part.network=part.mode==='auto'&&(legacyDetour||!context.manual);part.accessSegments=false;
  if(context.sourceName)part.sourceName=context.sourceName;if(context.sourceUrl)part.sourceUrl=context.sourceUrl;
 }
 edit.mode='straight';return edit;
}
export function routeIntervalAt(edit,at,scope,key){
 if(key){const found=edit.intervals.findIndex(p=>p.key===key);if(found>=0)return found;}
 const hit=projectOnDisplayedScope(edit.shape,scope,at);let walked=0,index=0;
 for(let i=1;i<edit.shape.length;i++){walked+=meters(edit.shape[i-1].coordinate,edit.shape[i].coordinate);if(walked>=hit.along-.001)return index;if(edit.shape[i].controlId)index++;}
 return edit.intervals.length-1;
}
function edge(key,coordinates,mode,extra={}){return {key,coordinates:coordinates.map(p=>[...p]),mode,signature:signature(coordinates[0],coordinates.at(-1),mode),network:false,preserved:true,...extra};}
function compose(edit){edit.shape=intervalShape(edit.intervals,edit.controls);edited(edit);}
export function dragRoute(edit,geometry,at,coordinate,id,context={}){
 seedRouteEdit(edit,geometry,context);const selected=routeIntervalAt(edit,at,context.scope,context.intervalKey),original=edit.intervals[selected],ids=keys(edit),left=ids[selected],right=ids[selected+1];
 if(context.manual){
  const a=original.coordinates[0],b=original.coordinates.at(-1);
  edit.controls.splice(selected,0,{id,coordinate:[...coordinate],label:nextLabel(edit,'B')});
  edit.intervalModes[left+'>'+id]='straight';edit.intervalModes[id+'>'+right]='straight';delete edit.intervalModes[original.key];
  edit.intervals.splice(selected,1,edge(left+'>'+id,[a,coordinate],'straight'),edge(id+'>'+right,[coordinate,b],'straight'));compose(edit);return;
 }
 const d=proposeDetour(edit.shape,at,coordinate,id,context.scope),next=detourShape(d),total=projectOnDisplayedScope(edit.shape,null,at).total;
 if(d.start<=.001)delete next[0].controlId;if(total-d.end<=.001)delete next.at(-1).controlId;
 const labels={};for(const [point,label] of [[d.pId,'P'],[d.id,'B'],[d.qId,'Q']])if(!edit.controls.some(c=>c.id===point))labels[point]=nextLabel(edit,label);
 edit.shape=next;controlsFromShape(edit,labels);
 const p=edit.controls.some(c=>c.id===d.pId)?d.pId:'start',q=edit.controls.some(c=>c.id===d.qId)?d.qId:'end';
 edit.intervalModes[p+'>'+id]='straight';edit.intervalModes[id+'>'+q]='straight';
 if(left!==p)edit.intervalModes[left+'>'+p]='auto';if(q!==right)edit.intervalModes[q+'>'+right]='auto';delete edit.intervalModes[original.key];
 const oldKeys=new Set(edit.intervals.map(p=>p.key));rememberIntervals(edit);
 for(const part of edit.intervals)if(!oldKeys.has(part.key)){
  part.network=part.mode==='auto';part.accessSegments=false;
  if(part.network){part.sourceName=original.sourceName||context.sourceName;part.sourceUrl=original.sourceUrl||context.sourceUrl;}
 }
 edited(edit);
}
export function moveRouteControl(edit,index,coordinate){
 seedRouteEdit(edit,points(edit),{manual:!edit.osmRouting});
 const control=edit.controls[index];if(!control)throw Error('找不到控制點');control.coordinate=[...coordinate];
 for(const partIndex of [index,index+1]){
  const old=edit.intervals[partIndex],a=partIndex===index?old.coordinates[0]:coordinate,b=partIndex===index?coordinate:old.coordinates.at(-1),mode=edit.intervalModes[old.key]||old.mode;
  edit.intervals[partIndex]=edge(old.key,[a,b],mode,{retry:mode==='auto'});
 }
 compose(edit);
}
export function deleteRouteControl(edit,index){
 seedRouteEdit(edit,points(edit),{manual:!edit.osmRouting});
 if(!edit.controls[index])throw Error('找不到控制點');
 const left=edit.intervals[index],right=edit.intervals[index+1],ids=keys(edit),key=ids[index]+'>'+ids[index+2],mode=left.network&&right.network?'auto':'straight';
 const coordinates=mode==='auto'?[...left.coordinates,...right.coordinates.slice(1)]:[left.coordinates[0],right.coordinates.at(-1)];
 edit.controls.splice(index,1);delete edit.intervalModes[left.key];delete edit.intervalModes[right.key];edit.intervalModes[key]=mode;
 edit.intervals.splice(index,2,edge(key,coordinates,mode,{network:mode==='auto',accessSegments:false,retry:mode==='auto',sourceName:left.sourceName,sourceUrl:left.sourceUrl}));compose(edit);
}
export function switchRouteInterval(edit,geometry,at,context={}){
 seedRouteEdit(edit,geometry,context);const index=routeIntervalAt(edit,at,context.scope,context.intervalKey),part=edit.intervals[index],mode=context.manual?'auto':'straight';
 edit.intervalModes[part.key]=mode;
 edit.intervals[index]=mode==='auto'?{...part,mode,signature:signature(part.coordinates[0],part.coordinates.at(-1),mode),retry:true,preserved:true}:edge(part.key,[part.coordinates[0],part.coordinates.at(-1)],mode);
 compose(edit);
}
