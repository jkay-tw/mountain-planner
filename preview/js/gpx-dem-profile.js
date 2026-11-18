import {alongLine} from './mainland-dem.js';
import {meters} from './osm-pilot-router.js';
// Estimate only a separate comparison view; never mutate imported coordinates.
export async function estimateGpxDem(segments,dem,{maxSamples=100000}={}){
 if(!Array.isArray(segments)||!segments.some(segment=>Array.isArray(segment)&&segment.length))throw Error('GPX沒有可取樣軌跡');
 let count=0;
 for(const segment of segments){if(!Array.isArray(segment))throw Error('GPX分段格式錯誤');if(!segment.length)continue;count++;
  for(let i=0;i<segment.length;i++){const point=segment[i];if(!Array.isArray(point)||!Number.isFinite(point[0])||!Number.isFinite(point[1])||Math.abs(point[0])>180||Math.abs(point[1])>90)throw Error('GPX座標無效');if(i)count+=Math.max(1,Math.ceil(meters(segment[i-1],point)/30));if(count>maxSamples)throw Error('GPX DEM取樣超過10萬點，請分段比較。');}
 }
 const manifest=await dem.init(),downloadBefore=dem.downloadBytes||0,cacheBefore=dem.cacheBytes||0,derived=[];let unknownSamples=0;dem.failures?.clear();
 for(const segment of segments){const samples=segment.length>1?alongLine(segment):segment.map(point=>({coordinate:point.slice(0,2)})),points=[];
  for(const sample of samples){const height=await dem.sample(sample.coordinate);if(!Number.isFinite(height))unknownSamples++;points.push([...sample.coordinate,Number.isFinite(height)?height:null]);}
  derived.push(points);
 }
 return {segments:derived,source:manifest.source,version:manifest.version,spacingMeters:30,samples:count,unknownSamples,downloadBytes:(dem.downloadBytes||0)-downloadBefore,cacheBytes:(dem.cacheBytes||0)-cacheBefore};
}
