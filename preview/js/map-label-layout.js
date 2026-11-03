// Screen-space placement for all itinerary labels; no geographic data is changed.
const overlaps=(a,b,p=3)=>a.x<b.x+b.w+p&&a.x+a.w+p>b.x&&a.y<b.y+b.h+p&&a.y+a.h+p>b.y;
function crosses(a,b,r){
 let t0=0,t1=1;const dx=b.x-a.x,dy=b.y-a.y;
 for(const [p,q] of [[-dx,a.x-r.x],[dx,r.x+r.w-a.x],[-dy,a.y-r.y],[dy,r.y+r.h-a.y]]){
  if(!p){if(q<0)return false;continue}const t=q/p;if(p<0){if(t>t1)return false;t0=Math.max(t0,t)}else{if(t<t0)return false;t1=Math.min(t1,t)}
 }
 return true;
}
export function placeMapLabels(labels,points,segments,size){
 const placed=[],occupied=[];
 for(const label of labels){
  const {point:p,w,h}=label;let result=null;
  for(const distance of [14,28,46,68,92,120]){
   const candidates=[[p.x+distance,p.y-h/2],[p.x-distance-w,p.y-h/2],[p.x-w/2,p.y-distance-h],[p.x-w/2,p.y+distance],[p.x+distance,p.y-distance-h],[p.x-distance-w,p.y-distance-h],[p.x+distance,p.y+distance],[p.x-distance-w,p.y+distance]];
   for(const [x,y] of candidates){const box={x,y,w,h};
    if(x<2||y<2||x+w>size.x-2||y+h>size.y-2||occupied.some(b=>overlaps(box,b)))continue;
    if(points.some(q=>q.x>=x-6&&q.x<=x+w+6&&q.y>=y-6&&q.y<=y+h+6))continue;
    if(segments.some(([a,b])=>crosses(a,b,{x:x-3,y:y-3,w:w+6,h:h+6})))continue;
    result=box;break;
   }if(result)break;
  }
  // A selected node always remains readable; other labels still avoid it.
  if(!result&&label.selected){
   const x=Math.max(2,Math.min(size.x-w-2,p.x+14)),y=Math.max(2,Math.min(size.y-h-2,p.y-h/2));
   if(x>=2&&y>=2&&x+w<=size.x-2&&y+h<=size.y-2)result={x,y,w,h};
  }
  if(result){occupied.push(result);placed.push({...label,box:result})}
 }
 return placed;
}
