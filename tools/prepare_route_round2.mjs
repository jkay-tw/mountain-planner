import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadProject,loadSnapshot} from './route-validator/core.mjs';
import {hash} from './route-validator/utils.mjs';
import {accessIssues,importantNode,scanSequence} from './route-validator/sequence-review.mjs';
const p=loadProject(),s=loadSnapshot(undefined,'.route-validator/backups/round2-snapshot.json');
const routes=s.routes.filter(r=>r.occurrences.length),changes=[];
const byName=(name,group)=>{const ns=[...p.nodes.values()].filter(n=>n.name===name&&(!group||n.groups.includes(group)));assert.equal(ns.length,1,`${name} ${group}`);assert.ok(p.nodeAuthority.has(ns[0].id));return ns[0].id;};
const proposed=new Map(routes.map(r=>[r.routeId,r.occurrences.map(o=>o.nodeId)]));
function replace(routeIds,before,after,reason,sources){
 for(const routeId of routeIds){const ids=proposed.get(routeId);let count=0;for(let i=0;i<=ids.length-before.length;i++)if(before.every((id,j)=>ids[i+j]===id)){ids.splice(i,before.length,...after);changes.push({routeId,oldPositions:[i+1,i+before.length],before,after,reason,sources});i+=after.length-1;count++;}assert.ok(count,'Pattern absent '+routeId+' '+before);}
}
const biji=id=>`https://hiking.biji.co/index.php?act=detail&id=${id}&q=trail`;
replace(['R027','R028'],['shared:cw-v07-004','shared:cw-v07-074'],['shared:cw-v07-004','g04-039','shared:cw-v07-074'],'補三六九與雪山主峰間實際經過的圈谷底部；不是新增登頂支線。',[biji(431),biji(641),'https://www.sunriver.com.tw/images/hiking/G04_hiking.jpg']);
replace(['R027','R031'],['shared:cw-v07-074','shared:cw-v07-066'],['shared:cw-v07-074','g04-fork-xueshan','shared:cw-v07-066'],'補雪山主峰下翠池共用岔口；沿用已建立節點與方向邊。',['https://www.sunriver.com.tw/images/hiking/G04_hiking.jpg',biji(641)]);
// G07_hiking_new explicitly has BOTH upper-cirque direct ascent and the four-way-junction path.
// A geometry corridor crossing the junction does not authorize replacing the direct variant.
replace(['R057','R058'],['node:83a76c46935de2ee6f88','node:dca389db39359114677f'],['node:83a76c46935de2ee6f88','shared:cw-v07-012','node:dca389db39359114677f'],'補奇萊主北共用稜線三岔口；摘要直連不再略去已建立的分岔點。',[biji(542),biji(1485),'https://www.sunriver.com.tw/images/hiking/G10_hiking.jpg']);
const summit='shared:cw-v07-027',west='shared:cw-v07-070',hut='shared:cw-v07-032',junction='shared:owner-v0724-xiangyang-junction';
replace(['R072','R073'],[west,summit,junction],[west,summit,west,hut,junction],'向陽山由西側登山口登頂並返回原口，再經嘉明湖避難山屋至三岔路口；禁止山頂直通三岔口。',[biji(632),biji(347),'user:2026-11-25-xiangyang-west-only']);
replace(['R073'],[junction,summit,west],[junction,hut,west,summit,west],'保留回程再次登向陽山的既有行程意圖，但改由西側登山口往返。',[biji(347),'user:2026-11-25-xiangyang-west-only']);
replace(['R072'],['shared:cw-v07-035','shared:cw-v07-033','node:8426704609cea5d43db4','shared:cw-v07-064','shared:cw-v07-009'],['shared:cw-v07-035','shared:cw-v07-060','shared:cw-v07-059','shared:cw-v07-009'],'以632路線第六日明列的秀姑坪／白洋金礦走法取代前輪AI保留的杜鵑腰繞；補重要山屋，原列排除荖濃溪維持。',[biji(632),'https://www.sunriver.com.tw/images/hiking/G17_hiking.jpg']);
const dongpu=['shared:cw-v07-051','shared:cw-v07-018','shared:cw-v07-008','shared:cw-v07-055','shared:cw-v07-076','shared:cw-v07-054','shared:cw-v07-013','shared:cw-v07-044','shared:cw-v07-072'];
// Direct source chains, intentionally explicit: no shortest-path expansion.
const approach=[...dongpu,'shared:cw-v07-026','shared:cw-v07-019','shared:cw-v07-016','shared:cw-v07-046','shared:cw-v07-007','shared:cw-v07-009'];
const day3=['shared:cw-v07-059','shared:cw-v07-060','shared:cw-v07-062','shared:cw-v07-061','shared:cw-v07-062','shared:cw-v07-060','shared:cw-v07-035','shared:cw-v07-060','shared:cw-v07-059','shared:cw-v07-009'];
const day4=['shared:cw-v07-007','shared:cw-v07-046','shared:cw-v07-016','shared:cw-v07-015','shared:cw-v07-014','shared:cw-v07-015','shared:cw-v07-016','shared:cw-v07-019','shared:cw-v07-026',...dongpu.slice().reverse()];
const old70=proposed.get('R070');proposed.set('R070',[...approach,...day3,...day4]);changes.push({routeId:'R070',before:old70,after:proposed.get('R070'),reason:'按指定623走法重建：先秀姑巒，再大水窟經秀姑坪／白洋回中央金礦；回程登八通關；不經杜鵑營地。補東埔共用古道節點，保留草原行程。',sources:[biji(623),'https://hiking.biji.co/index.php?act=info&q=review&review_id=34188','https://www.sunriver.com.tw/images/hiking/G16_hiking.jpg','https://www.sunriver.com.tw/images/hiking/G17_hiking.jpg'],excludedGpx:{recordingId:'272178',reason:'該GPX由大水窟經大水窟山屋、南營地、杜鵑返回；不同於指定走法，只作進出段與登頂順序輔助。'}});
replace(['R072'],['shared:cw-v07-071','shared:cw-v07-072'],['shared:cw-v07-071','shared:cw-v07-057','shared:cw-v07-026','shared:cw-v07-072'],'補西峰高繞回觀高途中溪水營地與古道崩斷岔路；沿用G16高繞順序。',['https://www.sunriver.com.tw/images/hiking/G16_hiking.jpg','https://hiking.biji.co/index.php?q=trail&act=gpx_detail&id=1622']);
replace(['R072'],['shared:cw-v07-072','shared:cw-v07-054'],['shared:cw-v07-072','shared:cw-v07-044','shared:cw-v07-013','shared:cw-v07-054'],'補觀高至樂樂之間對觀、乙女瀑布；外部行程與兩份GPX均有同序經過。',['https://www.sunriver.com.tw/images/hiking/G16_hiking.jpg','https://hiking.biji.co/index.php?q=trail&act=gpx_detail&id=1622']);
replace(['R072'],['shared:cw-v07-076','shared:cw-v07-018'],['shared:cw-v07-076','shared:cw-v07-055','shared:cw-v07-008','shared:cw-v07-018'],'補雲龍至登山口間樂樂溫泉岔路、三聖宮；不把摘要直連當成無中間點。',['https://www.sunriver.com.tw/images/hiking/G16_hiking.jpg','https://hiking.biji.co/index.php?q=trail&act=gpx_detail&id=1622']);
replace(['R069'],['shared:cw-v07-078','shared:cw-v07-080'],['shared:cw-v07-078','node:e9cc87a6032a69ff2163','shared:cw-v07-080'],'補馬利加南東峰至馬布谷之3191公尺峰；G16及逆向GPX同序。',['https://www.sunriver.com.tw/images/hiking/G16_hiking.jpg','https://hiking.biji.co/index.php?q=trail&act=gpx_detail&id=1622']);
const tail=['太平谷南口','太平谷東北口','44K林道盡頭','43K廢棄工寮','捷徑下切點','廢棄發電機','35K工寮岔路','35K廢棄工寮','35K工寮岔路','林道玉林橋下切點','下切溪床點','大石帆布營地','溪谷上切處','林道崩毀處','林道石壁營地','19K廢工寮','17K水泥橋','16.5K行車終點'].map(n=>byName(n,'G16'));
replace(['R069'],['shared:cw-v07-040','node:1670c3f1247b747ba02a','shared:cw-v07-001'],tail,'補完整中平林道出山順序與35K工寮短支線；不再用兩段摘要掩蓋林道、下切及溪谷行走。17K至16.5K沿原圖步行段，GPX1622僅到19K，不能聲稱其涵蓋最後道路。',['https://www.sunriver.com.tw/images/hiking/G16_hiking.jpg',biji(625),'https://hiking.biji.co/index.php?q=trail&act=gpx_detail&id=1622','https://www.samejantravel.tw/trails/3de644c1a89b81cb9814dc6e52127196']);
const results=[];
for(const route of routes){const ids=proposed.get(route.routeId);assert.ok(ids.every(id=>p.nodes.has(id)&&p.nodeAuthority.has(id)),route.routeId);assert.equal(accessIssues(ids).length,0,route.routeId);const after={...route,occurrences:ids.map((nodeId,i)=>({position:i+1,nodeId,name:p.nodes.get(nodeId).name,key:importantNode(p.nodes.get(nodeId)),source:{}}))};const scan=scanSequence(after,p);results.push({routeId:route.routeId,name:route.name,beforeCount:route.occurrences.length,afterCount:ids.length,before:route.occurrences.map(o=>o.nodeId),after:ids,changes:changes.filter(c=>c.routeId===route.routeId),compileIssues:scan.compileIssues,remainingCorridorCandidates:scan.omissions});}
assert.deepEqual(proposed.get('R064'),routes.find(r=>r.routeId==='R064').occurrences.map(o=>o.nodeId),'Never reorder user R064');
const report={schemaVersion:1,status:'PREPARED_NOT_APPLIED',snapshotSha256:s.sha256,graphDigest:p.digest,generatedAt:new Date().toISOString(),summary:{expanded:results.length,sequenceChanged:results.filter(r=>r.changes.length).length,changes:changes.length,beforeNodes:results.reduce((a,r)=>a+r.beforeCount,0),afterNodes:results.reduce((a,r)=>a+r.afterCount,0)},results};
fs.writeFileSync('data/audits/route-review-20261125-round2/corrections.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report.summary));for(const r of results.filter(r=>r.changes.length))console.log(r.routeId,r.beforeCount+'→'+r.afterCount,'compile issues',JSON.stringify(r.compileIssues));
