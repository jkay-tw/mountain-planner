import {normalizeDay} from './planner.js?v=segments1';

const locations=day=>day.items.filter(item=>item.type!=='rest');
const last=day=>locations(day).at(-1);
const same=(a,b)=>a&&b&&a.type===b.type&&(a.type==='location'?a.nodeId&&a.nodeId===b.nodeId:a.coordinate||b.coordinate?JSON.stringify(a.coordinate)===JSON.stringify(b.coordinate):a.name===b.name);

export function syncLinkedDays(days,route,uid){
 for(let i=1;i<days.length;i++){
  const day=days[i];if(!day.linkedStart)continue;
  const previous=last(days[i-1]);let first=locations(day)[0];
  if(first?._linkedSourceId===previous?.id&&first?.type==='manual-location'){first.name=previous.name;if(previous.coordinate)first.coordinate=[...previous.coordinate];}
  if(first?._linkedGenerated&&!same(first,previous)){
   day.items.splice(day.items.indexOf(first),1);
   first=locations(day)[0];
  }
  if(!previous){normalizeDay(day,route);continue}
  if(same(first,previous)){
   first.incoming=null;first._linkedStart=true;first._linkedSourceId=previous.id;if(previous.type==='manual-location')first.name=previous.name;
  }else{
   day.items.unshift({id:uid(),type:previous.type,name:previous.name,...(previous.nodeId?{nodeId:previous.nodeId}:{}),...(previous.coordinate?{coordinate:[...previous.coordinate]}:{}),note:'',isPeak:!!previous.isPeak,hasWater:!!previous.hasWater,incoming:null,_linkedSourceId:previous.id,_linkedStart:true,_linkedGenerated:true});
  }
  normalizeDay(day,route);
 }
}
