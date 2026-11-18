import {meters} from './osm-pilot-router.js';
// GPX-only approximate association. No itinerary identities or elevations enter.
export function matchGpxWaypoints(segments,waypoints,{radiusMeters=20,checkBudget=2000000}={}){
 const edges=[];let offset=0;
 segments.forEach((segment,segmentIndex)=>{for(let i=1;i<segment.length;i++){const a=segment[i-1],b=segment[i],length=meters(a,b);edges.push({a,b,length,offset,segmentIndex,index:i-1});offset+=length;}});
 let checks=0;return waypoints.map(waypoint=>{
  const p=waypoint.coordinate,scale=Math.max(.000001,Math.cos(p[1]*Math.PI/180)),marginY=radiusMeters/111195,marginX=marginY/scale,candidates=[];
  for(const edge of edges){if(++checks>checkBudget)return {...waypoint,matched:false,reason:'比對預算已達上限，未推定位置'};
   const {a,b}=edge;if(Math.abs(a[0]-b[0])>180)continue;
   if(p[0]<Math.min(a[0],b[0])-marginX||p[0]>Math.max(a[0],b[0])+marginX||p[1]<Math.min(a[1],b[1])-marginY||p[1]>Math.max(a[1],b[1])+marginY)continue;
   const dx=(b[0]-a[0])*scale,dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*scale*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1))),coordinate=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],distance=meters(p,coordinate);
   if(distance<=radiusMeters)candidates.push({segmentIndex:edge.segmentIndex,index:edge.index,coordinate,distance,along:edge.offset+meters(a,coordinate)});
  }
  if(!candidates.length)return {...waypoint,matched:false,reason:'20公尺內沒有可核對的軌跡位置'};
  const groups=[];for(const candidate of candidates){const group=groups.at(-1),previous=group?.at(-1);if(previous&&candidate.segmentIndex===previous.segmentIndex&&candidate.index===previous.index+1)group.push(candidate);else groups.push([candidate]);}
  const positions=[];for(const group of groups){const best=group.reduce((a,b)=>a.distance<=b.distance?a:b),minima=group.filter((candidate,index)=>candidate.distance<=(group[index-1]?.distance??Infinity)+.000001&&candidate.distance<=(group[index+1]?.distance??Infinity)+.000001);if(minima.some(candidate=>Math.abs(candidate.along-best.along)>1)||group.reduce((v,c)=>Math.max(v,c.along),-Infinity)-group.reduce((v,c)=>Math.min(v,c.along),Infinity)>radiusMeters*2+1)return {...waypoint,matched:false,reason:'交叉、繞行或重訪造成多個里程候選，未選擇'};
   // Only numerical roundoff is tolerated across separate candidate groups.
   // Nearby ends of disconnected segments must not become one shared endpoint.
   if(!positions.some(position=>Math.abs(position.along-best.along)<=.0001&&meters(position.coordinate,best.coordinate)<=.0001))positions.push(best);
  }
  if(positions.length!==1)return {...waypoint,matched:false,reason:'多段或重訪有不同里程候選，未選擇'};
  const best=positions[0];return {...waypoint,matched:true,distanceMeters:best.along,projectionMeters:best.distance,segmentIndex:best.segmentIndex};
 });
}
