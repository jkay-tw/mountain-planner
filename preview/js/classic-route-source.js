// Route-local candidate sources never enter the authoritative walking graph.
export function withClassicSources(graph,geometry,supplement){
 if(!supplement)return {graph,geometry};
 const ids=new Set(graph.nodes.map(n=>n.id));
 if(supplement.edges.some(e=>!ids.has(e.fromId)||!ids.has(e.toId)||e.minutes!==null||e.verificationStatus!=='owner-confirmed-connection'))throw Error('試作來源格式不符。');
 const walking=supplement.walkingSegments||[];
 if(walking.some(e=>!ids.has(e.fromId)||!ids.has(e.toId)||typeof e.from!=='string'||typeof e.to!=='string'||!Number.isFinite(e.minutes)||e.minutes<0||e.travelMode!=='walking'||e.verificationStatus!=='verified'||!e.sourceRef||!/^[a-f0-9]{64}$/.test(e.sourceSha256)))throw Error('方向時間來源格式不符。');
 return {graph:{...graph,segments:[...graph.segments,...walking],vehicleSegments:supplement.vehicleSegments||[],manualConnections:[...(graph.manualConnections||[]),...supplement.edges]},geometry:{...geometry,spans:[...geometry.spans,...supplement.spans]}};
}
