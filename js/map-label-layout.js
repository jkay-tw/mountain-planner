// Fixed offsets keep names anchored while collision filtering hides crowded labels.
const overlaps=(a,b,p=3)=>a.x<b.x+b.w+p&&a.x+a.w+p>b.x&&a.y<b.y+b.h+p&&a.y+a.h+p>b.y;
export function placeMapLabels(labels,points,segments,size){
 const placed=[],occupied=[];
 for(const label of labels){
  const {point:p,w,h}=label;
  const box={x:p.x+8,y:p.y-10+(label.dayOffset||0),w,h};
  if(label.selected){
   box.x=Math.max(4,Math.min(box.x,size.x-w-4));
   box.y=Math.max(4,Math.min(box.y,size.y-h-4));
  }
  if(box.x+w<0||box.y+h<0||box.x>size.x||box.y>size.y)continue;
  if(occupied.some(b=>overlaps(box,b)))continue;
  occupied.push(box);placed.push({...label,box});
 }
 return placed;
}
