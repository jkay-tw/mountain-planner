const locations=day=>day.items.filter(item=>item.type!=='rest');
const state=item=>JSON.stringify(Object.fromEntries(Object.entries(item).filter(([key])=>!['_generatedForEndpoint','_generatedBaseline'].includes(key))));
export function markDestinationBatch(day,startIndex){
 const added=day.items.slice(startIndex).filter(item=>item.type!=='rest'),destination=added.at(-1);if(!destination)return;
 destination.showInTable=true;destination.waypoint=true;
 for(const item of added.slice(0,-1)){item.showInTable=false;item.auto=true;item.waypoint=false;item._generatedForEndpoint=destination.id;item._generatedBaseline=state(item);}
}
export function removeDestinationItem(day,index){
 const target=day.items[index];if(!target)return {removed:[],retained:false};const wasEnd=locations(day).at(-1)?.id===target.id,removed=[target.id];day.items.splice(index,1);let retained=false;
 if(wasEnd){while(day.items.length){const previous=day.items.at(-1);if(previous.type==='rest'||previous._generatedForEndpoint!==target.id)break;
   if(previous.auto!==true||previous.showInTable!==false||previous._generatedBaseline!==state(previous)){retained=true;break;}
   removed.push(previous.id);day.items.pop();
 }}
 return {removed,retained};
}
export function hiddenEndpointNotice(day){
 const points=locations(day),first=points[0],last=points.at(-1),messages=[];
 if(first?.showInTable===false)messages.push(`實際起點「${first.name}」原本被隱藏，現已顯示`);
 if(last&&last!==first&&last.showInTable===false)messages.push(`實際終點「${last.name}」原本被隱藏，現已顯示；翌日會銜接此點，請確認或明確刪除端點`);
 return messages.join('；');
}
