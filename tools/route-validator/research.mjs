// Public reference cache: no credentials, no login bypass, no guessed GPX.
import fs from 'node:fs';
import {resolve} from 'node:path';
import {publicDownload} from './network.mjs';
import {hash} from './utils.mjs';
export function htmlText(html){return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&(?:lt|gt|quot);/g,' ').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();}
export async function cacheReferences(urls,dir){
 fs.mkdirSync(dir,{recursive:true});const results=[];
 for(const url of [...new Set(urls)]){const key=hash(url),file=resolve(dir,key+'.json');
  if(fs.existsSync(file)){const cached=JSON.parse(fs.readFileSync(file));if(cached.status==='FETCHED'){results.push(cached);continue;}}
  let record;try{const r=await publicDownload(url,{maxBytes:8*1024*1024,timeout:15000});const html=r.bytes.toString('utf8'),binary=r.bytes.subarray(0,4).toString()==='%PDF';record={url,retrievedAt:new Date().toISOString(),sha256:hash(r.bytes),status:binary?'BINARY_NOT_EXTRACTED':'FETCHED',...(binary?{reason:'PDF取得但尚未抽取內容；不得把下載成功當成已核對'}:{text:htmlText(html)}),gpxLinks:binary?[]:[...html.matchAll(/href=["']([^"']*(?:download_gpx|gpx_detail)[^"']*)["']/g)].map(m=>new URL(m[1].replaceAll('&amp;','&'),url).href)};}catch(e){record={url,status:'UNAVAILABLE',reason:e.message};}
  fs.writeFileSync(file,JSON.stringify(record,null,2));results.push(record);console.log(record.status,url);
 }
 return results;
}
if(process.argv[1]?.endsWith('research.mjs')){
 const evidence=JSON.parse(fs.readFileSync('data/route-validator/review-evidence-20261125.json'));
 const urls=evidence.groups.flatMap(g=>g.sources);urls.push('https://hiking.biji.co/index.php?act=detail&id=623&q=trail','https://www.samejantravel.tw/trails/3de644c1a89b81cb9814dc6e52127196','https://hiking.biji.co/index.php?act=info&q=review&review_id=34188');
 const results=await cacheReferences(urls,'.route-validator/research/round2');fs.writeFileSync('.route-validator/research/round2/index.json',JSON.stringify(results.map(({text,...r})=>r),null,2));
}
