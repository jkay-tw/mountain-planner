import {normalizeDay} from './planner.js?v=segments1';

const locations=day=>day.items.filter(item=>item.type!=='rest');
const last=day=>locations(day).at(-1);
const same=(a,b)=>a&&b&&a.type===b.type&&(a.type==='location'?a.nodeId&&a.nodeId===b.nodeId:a.name===b.name);

export function syncLinkedDays(days,route,uid){
 for(let i=1;i<days.length;i++){
  const day=days[i];if(!day.linkedStart)continue;
  const previous=last(days[i-1]);let first=locations(day)[0];
  if(first?._linkedGenerated&&!same(first,previous)){
   day.items.splice(day.items.indexOf(first),1);
   first=locations(day)[0];
  }
  if(!previous){normalizeDay(day,route);continue}
  if(same(first,previous)){
   first.incoming=null;first._linkedStart=true;
  }else{
   day.items.unshift({id:uid(),type:previous.type,name:previous.name,...(previous.nodeId?{nodeId:previous.nodeId}:{}),note:'',isPeak:!!previous.isPeak,hasWater:!!previous.hasWater,incoming:null,_linkedStart:true,_linkedGenerated:true});
  }
  normalizeDay(day,route);
 }
}
