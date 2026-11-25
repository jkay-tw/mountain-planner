// Saved per-itinerary source geometry. Editing is handled by IDEA-003 first.
export function classicSplitIssue(day,itemId){
 const cut=day.items.find(i=>i.id===itemId)?.classicRoute;if(!cut)return '';
 for(const item of day.items){const s=item.classicGeometry;if(s?.batchId===cut.batchId&&s.positions[0]<cut.position&&s.positions.at(-1)>cut.position)return '此節點位於尚未分段定位的來源線形內，請選擇有明確線形端點的節點分天。';}
 return '';
}
export function classicGeometryMatch(items,index){
 const saved=items[index].classicGeometry;if(!saved)return null;
 const slice=items.slice(index,index+saved.nodeIds.length);
 const matches=slice.length===saved.nodeIds.length&&slice.every((item,j)=>item.nodeId===saved.nodeIds[j]&&item.classicRoute?.batchId===saved.batchId&&item.classicRoute.position===saved.positions[j]);
 const chain=slice.slice(1).every((to,j)=>to.incoming?.kind==='official'&&to.incoming.fromNodeId===slice[j].nodeId&&to.incoming.toNodeId===to.nodeId||to.incoming?.kind==='manual'&&to.incoming.connectionStatus==='owner-confirmed'&&to.incoming.fromNodeId===slice[j].nodeId&&to.incoming.toNodeId===to.nodeId);
 return matches&&chain?{saved,count:slice.length}: {invalid:true};
}
