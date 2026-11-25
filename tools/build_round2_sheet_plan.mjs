import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadProject} from './route-validator/core.mjs';
import {importantNode,accessIssues} from './route-validator/sequence-review.mjs';
import {hash} from './route-validator/utils.mjs';
const base='.route-validator/backups/',b=JSON.parse(fs.readFileSync(base+'round2-before.json')),p=loadProject();
const corrections=JSON.parse(fs.readFileSync('data/audits/route-review-20261125-round2/corrections.json'));
const oldEvidence=JSON.parse(fs.readFileSync('data/route-validator/review-evidence-20261125.json'));
const value=c=>c?.userEnteredValue?.stringValue??c?.userEnteredValue?.numberValue??c?.userEnteredValue?.boolValue??(c?.userEnteredValue?.formulaValue?(c?.effectiveValue?.stringValue??c?.effectiveValue?.numberValue??c?.formattedValue??''):'');
const literal=v=>typeof v==='boolean'?{boolValue:v}:typeof v==='number'?{numberValue:v}:{stringValue:String(v)};
const ns=b.sheets.find(s=>s.properties.title==='RouteNodes_順序校核'),rs=b.sheets.find(s=>s.properties.title==='Routes_順序校核');
const oldNodes=ns.data[0].rowData.map(r=>r.values||[]),oldRoutes=rs.data[0].rowData.map(r=>r.values||[]);
const pending=[
 {id:'Q01',routeIds:['R069'],title:'馬博中平林道少一條精確接線',detail:'補齊後的林道玉林橋下切點 node:c89901cb97ccbe4d145a → 下切溪床點 node:1670c3f1247b747ba02a，現行圖缺精確有向邊與單段線形。原圖G16有下行85／上行120分鐘（本輪讀圖轉錄候選），GPX1622也經過兩點。節點順序可修，不能假稱已整合為可用路網。',owner:'程式資料維護',sources:['https://www.sunriver.com.tw/images/hiking/G16_hiking.jpg','https://hiking.biji.co/index.php?q=trail&act=gpx_detail&id=1622']},
 {id:'Q02',routeIds:['R069','R070'],title:'八通關草原至山登山口摘要線形與走法衝突',detail:'既有摘要線形近距離經過西峰岔路、八通關山西峰與山三岔口；Sheet卻是草原直達山登山口。G16原圖另有不登西峰的古道，不能因現有線形繞過山頭，就強迫加登西峰。高繞／草原節點角色與線形須另修，保留指定草原行程。',owner:'線形與來源核對',sources:['https://www.sunriver.com.tw/images/hiking/G16_hiking.jpg','https://hiking.biji.co/index.php?act=detail&id=623&q=trail']},
 {id:'Q03',routeIds:['R027'],title:'中雪山下山後的林道線形疑似又繞經山頂',detail:'26K登山口→11.5K雙流水營地的摘要線形距中雪山約1m、林文安紀念碑約0m。既有序列已完成中雪山原路往返；外部行程隨後沿230林道出山，不應為配合錯線再加一次中雪山。保留節點順序並隔離線形疑點。',owner:'線形修正',sources:['https://hiking.biji.co/index.php?act=detail&id=641&q=trail','https://www.ptt.cc/bbs/Hiking/M.1729346073.A.A2B.html']},
 {id:'Q04',routeIds:['R035','R039'],title:'南湖兩種登東峰方式不能混用線形',detail:'更新版G07同時列上圈谷直登東峰、經四岔路口與東峰登山口兩種走法。Sheet保留直登版；部分既有摘要線形卻貼近四岔路口。這是線形／端點角色待核對，不能判定必須改成另一變體。',owner:'線形與點位角色核對',sources:['https://www.sunriver.com.tw/images/hiking/G07_hiking_new.jpg']},
 {id:'Q05',routeIds:['R026'],title:'鎮西堡路線的南馬洋山實體仍未對應',detail:'官方介紹提及南馬洋山，原始Node ID表沒有該獨立節點；目前馬洋山至馬洋池的線形與峰位尚未證明一致。不可新增假ID或把同名近點當成登頂。',owner:'外部身分查證',sources:['https://hike.taiwan.gov.tw/en/information_1.aspx?c_id=243']},
 {id:'Q06',routeIds:['R057'],title:'奇萊北壁仍是摘要技術段',detail:'來源1485明列岩洞、雙塔、屏風南峰；現行權威Node ID未有這些獨立點，僅有3241稜線。維持已接受的摘要／手填政策，但不得標示為逐點完整技術路線。',owner:'來源與節點建置',sources:['https://hiking.biji.co/index.php?act=detail&id=1485&q=trail']},
 {id:'Q07',routeIds:['R064'],title:'保留你的序列，2897峰不能直接改稱2960峰',detail:'本輪線上讀得有效序列：林道舊登山口→林道入口（抵湖區）→林道舊登山口→2897公尺峰→六順山→2897公尺峰→林道舊登山口，完整保留。來源1668的2960峰未證明就是g14-007，保留原ID與名稱。交通段及湖區到達政策沿用你的指定。',owner:'點位來源查證',sources:['https://hiking.biji.co/index.php?act=detail&id=1668&q=trail']},
 {id:'Q08',routeIds:['R066'],title:'東郡峰位偏移與分日GPX缺口仍不能當作精確登頂證明',detail:'保留已核准14.6K→傳統無雙吊橋→郡大33K序列。既有三份GPX有分日缺口、東郡峰位距離差及不同登頂先後；本輪沒有改座標或憑100m候選匹配宣稱精確登頂。烏達佩、天南可蘭是可選支線，未強制加登。',owner:'座標／軌跡證據查證',sources:['https://hiking.biji.co/index.php?act=detail&id=667&q=trail','https://www.ptt.cc/bbs/Hiking/M.1572408084.A.D33.html']}
];
const groups=new Map();for(let i=1;i<oldNodes.length;i++){const row=oldNodes[i],id=value(row[0]);if(!id)continue;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(structuredClone(row.slice(0,14)));}
const newNodes=[structuredClone(oldNodes[0].slice(0,14))],importanceChanges=[];
for(const [id,original]of groups){const fix=corrections.results.find(r=>r.routeId===id),sequence=fix?.after;let rows=[];
 if(fix?.changes.length){const used=new Set();for(let i=0;i<sequence.length;i++){
  const nodeId=sequence[i],n=p.nodes.get(nodeId);const j=original.findIndex((r,j)=>!used.has(j)&&Number(value(r[2]))>0&&value(r[3])===nodeId);
  const row=j>=0?structuredClone(original[j]):Array.from({length:14},()=>({}));if(j>=0)used.add(j);
  const set=(col,v)=>row[col]={...row[col],userEnteredValue:literal(v)};
  set(0,id);set(2,i+1);set(3,nodeId);set(4,n.name);set(5,n.groups[0]);if(j<0){set(6,'途經／支線');set(7,false);set(8,'來源行程與既有Node ID交叉核對');set(10,'依position行走');set(12,'');set(13,importantNode(n)&&!/山屋|山莊|營地|獵寮|工寮/.test(n.name));}
  set(9,'2026-11-25第2輪：行走順序修正；不等於線形全通過');
  set(11,[value(row[11]),'第2輪來源修正；原position '+(j>=0?value(original[j][2]):'新增')+'；'+fix.changes.map(c=>c.reason).join(' ')].filter(Boolean).join('\n'));
  rows.push(row);
 }
 original.forEach((r,j)=>{if(used.has(j))return;const row=structuredClone(r);if(Number(value(row[2]))>0){row[11]={...row[11],userEnteredValue:literal([value(row[11]),'第2輪改線排除；原position '+value(row[2])+'；保留歷史'].filter(Boolean).join('\n'))};row[2]={...row[2],userEnteredValue:{}};row[9]={...row[9],userEnteredValue:literal('第2輪改線排除・歷史保留')};}rows.push(row);});
 }else rows=original;
 for(const row of rows){if(Number(value(row[2]))>0&&importantNode(p.nodes.get(value(row[3])),value(row[6]))&&row[7]?.userEnteredValue?.boolValue!==true){importanceChanges.push({routeId:id,position:value(row[2]),nodeId:value(row[3]),name:value(row[4])});row[7]={...row[7],userEnteredValue:{boolValue:true}};row[8]={...row[8],userEnteredValue:literal([value(row[8]),'第2輪：山頭／山屋／營地列為重要點'].filter(Boolean).join('；'))};}newNodes.push(row);}
}
newNodes.slice(1).forEach((r,i)=>r[1]={...r[1],userEnteredValue:{formulaValue:`=IF($A${i+2}="","",IFNA(VLOOKUP($A${i+2},'Routes_順序校核'!$A:$B,2,FALSE),""))`}});
const updates=[],expectedRoutes=structuredClone(oldRoutes);
for(let i=1;i<oldRoutes.length;i++){
 const row=oldRoutes[i],id=value(row[0]),fix=corrections.results.find(r=>r.routeId===id);if(!fix)continue;
 const questions=pending.filter(q=>q.routeIds.includes(id)),sources=[...new Set([...oldEvidence.groups.filter(g=>g.routeIds.includes(id)).flatMap(g=>g.sources),...fix.changes.flatMap(c=>c.sources).filter(u=>u.startsWith('http')),...questions.flatMap(q=>q.sources)])];
 const changed=fix.changes.length>0,summary=changed?fix.changes.map(c=>c.reason).join(' '):id==='R064'?pending.find(q=>q.id==='Q07').detail:'重查既有有效序列、原始Node ID、方向路段、重要節點、外部行程與可用GPX；未因不同選峰或合法折返擅自改線。';
 const notes=questions.map(q=>q.id+' '+q.detail).join('\n');
 const fields={8:changed?'已依行走順序修正；資料差異另列':'已重新檢查；不可沿用前輪全數通過推論',10:notes||'本輪未另確認新的順序錯誤；分段來源支持不等於全程GPX／現地驗證',11:summary,12:'第2輪來源交叉核對；非人工逐點簽核',17:'2026-11-25 Preview工作樹／原始Node ID；第2輪來源與差異分開保存',20:changed?'第2輪已修順序／漏點，山頭山屋營地列重要':'第2輪統一重要節點旗標；保留原有效順序',23:questions.length?'已修可確認項目；仍有具體資料待辦':changed?'第2輪已修正；不等於無條件通過':'第2輪已重查・保留指定變體',25:summary+(notes?'\n仍待處理：'+notes:''),26:sources.join('\n'),28:questions.length?'禁止自動正式匯入：'+questions.map(q=>q.id).join('、'):'候選資料；正式匯入另行驗收，不由路網連通推定通過'};
 if(changed)fields[13]=[value(row[13]),'2026-11-25第2輪：依使用者全路線重核授權修正；'+summary].filter(Boolean).join('\n');
 if(id==='R070'){fields[18]='東埔往返；秀姑巒／大水窟先行，回程登八通關；不經杜鵑';fields[19]='依623指定走法';}
 if(id==='R072'){fields[18]='向陽登頂西側往返；大水窟經秀姑坪／白洋金礦出山';fields[19]='向陽進、東埔出';}
 if(id==='R073')fields[18]='向陽／三叉去回可重登；向陽兩次皆由西側登山口往返';
 if(id==='R064'){fields[18]='林道舊登山口步行往返；林道入口視為抵達七彩湖湖區';fields[19]='保留最新RouteNodes position順序';}
 for(const [col,v]of Object.entries(fields)){assert.ok(!row[col]?.userEnteredValue?.formulaValue);updates.push({row:i,col:+col,value:literal(v)});expectedRoutes[i][col]={...expectedRoutes[i][col],userEnteredValue:literal(v)};}
}
const rowsToWrite=newNodes.map(row=>({values:Array.from({length:14},(_,j)=>({userEnteredValue:row[j]?.userEnteredValue||{},note:row[j]?.note||''}))}));
const delta=newNodes.length-ns.properties.gridProperties.rowCount,requests=[];
if(delta>0){requests.push({appendDimension:{sheetId:ns.properties.sheetId,dimension:'ROWS',length:delta}});requests.push({copyPaste:{source:{sheetId:ns.properties.sheetId,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:14},destination:{sheetId:ns.properties.sheetId,startRowIndex:ns.properties.gridProperties.rowCount,endRowIndex:newNodes.length,startColumnIndex:0,endColumnIndex:14},pasteType:'PASTE_FORMAT'}});for(const col of [7,13])requests.push({setDataValidation:{range:{sheetId:ns.properties.sheetId,startRowIndex:ns.properties.gridProperties.rowCount,endRowIndex:newNodes.length,startColumnIndex:col,endColumnIndex:col+1},rule:{condition:{type:'BOOLEAN'},strict:true}}});}
requests.push({updateCells:{start:{sheetId:ns.properties.sheetId,rowIndex:0,columnIndex:0},rows:rowsToWrite,fields:'userEnteredValue,note'}});
for(const c of updates)requests.push({updateCells:{start:{sheetId:rs.properties.sheetId,rowIndex:c.row,columnIndex:c.col},rows:[{values:[{userEnteredValue:c.value}]}],fields:'userEnteredValue'}});
const notesBefore=oldNodes.flatMap(r=>r.filter(c=>c.note).map(c=>c.note)).sort(),notesAfter=newNodes.flatMap(r=>r.filter(c=>c.note).map(c=>c.note)).sort();assert.deepEqual(notesAfter,notesBefore,'Preserve every native note');
const preservedExcluded=oldNodes.slice(1).filter(r=>!Number(value(r[2]))&&value(r[0]));for(const row of preservedExcluded)assert.ok(newNodes.some(r=>value(r[0])===value(row[0])&&value(r[3])===value(row[3])&&!Number(r[2]?.userEnteredValue?.numberValue)));
const active=newNodes.slice(1).filter(r=>Number(r[2]?.userEnteredValue?.numberValue)>0),count=active.length;assert.equal(count,corrections.summary.afterNodes);
for(const route of corrections.results){const ids=active.filter(r=>value(r[0])===route.routeId).sort((a,b)=>a[2].userEnteredValue.numberValue-b[2].userEnteredValue.numberValue).map(r=>value(r[3]));assert.deepEqual(ids,route.after);assert.equal(accessIssues(ids).length,0);}
const plan={status:'PREPARED',baselineSha256:hash(b),requests,expectedNodes:rowsToWrite,expectedRoutes:expectedRoutes.map(r=>r.map(c=>({userEnteredValue:c.userEnteredValue||{}}))),nodeRowCount:newNodes.length,routeUpdates:updates,importanceChanges,pending,counts:{active:count,excluded:newNodes.length-1-count,totalNodeRows:newNodes.length-1,importanceChanges:importanceChanges.length,sequenceChanged:corrections.summary.sequenceChanged}};
fs.writeFileSync(base+'round2-plan.json',JSON.stringify(plan));fs.writeFileSync('data/audits/route-review-20261125-round2/pending.json',JSON.stringify(pending,null,2));
console.log(JSON.stringify({counts:plan.counts,delta,requests:requests.length,nodeRowCount:plan.nodeRowCount}));
