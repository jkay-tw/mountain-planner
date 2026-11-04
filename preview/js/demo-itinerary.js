import {shortestPath} from './planner.js?v=v0731';
export function makeDemoDays(route,uid){
 const make=(a,b,index)=>{const path=shortestPath(route,a,b);if(!path)throw Error('雪山範例路段未連通');return {id:uid(),startTime:index?'05:30':'06:00',coefficient:1,linkedStart:index>0,note:'範例模式，不寫入原行程',items:[{id:uid(),type:'location',name:route.nodes.find(n=>n.id===a).name,nodeId:a,note:'',incoming:null},...path.segments.map(s=>({id:uid(),type:'location',name:s.to,nodeId:s.toId,note:'範例備註可編輯，不影響原行程',incoming:{kind:'official',from:s.from,to:s.to,fromNodeId:s.fromId,toNodeId:s.toId,officialMinutes:s.minutes,actualMinutes:null,coefficient:1,source:s.source||route.source.image_url}}))]}};
 const days=[make('g04-045','shared:cw-v07-004',0),make('shared:cw-v07-004','shared:cw-v07-074',1)];
 days[0].items.splice(2,0,{id:uid(),type:'rest',minutes:10,note:'範例休息備註'});return days;
}
