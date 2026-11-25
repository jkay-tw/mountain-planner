// Read existing bounded OSM tiles; write only a separate candidate evidence record.
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {buildGraph,nearestVertex,distanceRoute} from '../preview/js/osm-pilot-router.js';
const root=fileURLToPath(new URL('../',import.meta.url)),read=p=>readFileSync(resolve(root,p));
const hash=value=>createHash('sha256').update(value).digest('hex');
export function auditR057(){
 const base='preview/data/osm-mainland/',manifestBytes=read(base+'manifest.json'),manifest=JSON.parse(manifestBytes);
 const selected=manifest.tiles.filter(t=>{const b=t.cellBounds||t.bounds;return b[0]<121.39&&b[2]>121.31&&b[1]<24.18&&b[3]>24.09;});
 const merged={nodes:{},ways:[],blockedNodeIds:[]},ways=new Map(),tileSources=[];
 for(const tile of selected){const bytes=read(base+tile.file);if(hash(bytes)!==tile.sha256)throw Error('OSM tile hash mismatch: '+tile.file);const data=JSON.parse(gunzipSync(bytes));
  for(const [id,p]of Object.entries(data.nodes)){if(merged.nodes[id]&&JSON.stringify(merged.nodes[id])!==JSON.stringify(p))throw Error('Conflicting OSM vertex');merged.nodes[id]=p;}
  for(const w of data.ways){if(ways.has(w.id)&&JSON.stringify(ways.get(w.id))!==JSON.stringify(w))throw Error('Conflicting OSM way');ways.set(w.id,w);}
  merged.blockedNodeIds.push(...data.blockedNodeIds);tileSources.push({file:base+tile.file,sha256:tile.sha256});
 }
 merged.ways=[...ways.values()];const graph=buildGraph(merged);
 const endpoints=[{nodeId:'shared:cw-v07-041',name:'奇萊主山北峰',labelCoordinate:[121.3345459,24.1183377],coordinateSource:'https://www.openstreetmap.org/node/2268441047'},{nodeId:'node:f2ece3876a2d0d5ba88c',name:'屏風山',labelCoordinate:[121.342943,24.149291],coordinateSource:'https://twmap.happyman.idv.tw/gen/api/pointdata.php?id=71'}];
 for(const endpoint of endpoints){endpoint.candidateAnchor=nearestVertex(graph,endpoint.labelCoordinate,100);if(!endpoint.candidateAnchor)throw Error('Missing candidate OSM anchor');}
 const directions=[[0,1],[1,0]].map(([from,to])=>{
  const path=distanceRoute(graph,endpoints[from].candidateAnchor.id,endpoints[to].candidateAnchor.id);if(!path)throw Error('OSM path not connected');
  return {fromNodeId:endpoints[from].nodeId,toNodeId:endpoints[to].nodeId,minutes:null,actualMinutes:null,distanceMeters:path.distanceMeters,osmNodeIds:path.ids,edgeWayIds:path.wayIds,coordinates:path.coordinates,ways:[...new Set(path.wayIds)].map(id=>{const w=ways.get(id);return {id,version:w.version,timestamp:w.timestamp,tags:w.tags,url:'https://www.openstreetmap.org/way/'+id};})};
 });
 return {schemaVersion:1,routeId:'R057',status:'osm-topology-candidate-not-integrated',inspectionDate:'2026-11-20',source:manifest.source,attribution:'© OpenStreetMap contributors, ODbL 1.0',copyrightUrl:'https://www.openstreetmap.org/copyright',manifestSha256:hash(manifestBytes),tileSources,endpoints,directions,limitations:['Candidate anchors are proximity results, not confirmed equivalence to reviewed Nodes.','No off-trail straight connectors, minutes, DEM, current passage or source verification are inferred.','OSM topology allows both searches under existing foot/access filters; this is not a reverse-route safety approval.','No authoritative Node, walking Edge, geometry or route catalog is changed.']};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const output='data/staging/idea002/r057-osm-evidence-20261120.json',arg=process.argv[2];if(!['--write','--check'].includes(arg))throw Error('Usage: node tools/audit_r057_osm.mjs --write|--check');
 const text=JSON.stringify(auditR057(),null,2)+'\n';if(arg==='--write')writeFileSync(resolve(root,output),text);else if(read(output).toString()!==text)throw Error('OSM evidence is stale');
 console.log('R057: existing OSM path found in both directions; candidate only, not integrated');
}
