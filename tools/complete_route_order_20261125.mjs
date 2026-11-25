// One-time source review application plan. This is NOT an automatic source
// verification algorithm: the fixed baseline and findings record the 19 maps
// actually inspected and the independent track subsections reviewed this round.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadSnapshot,loadProject} from './route-validator/core.mjs';
import {hash,writeJson} from './route-validator/utils.mjs';
import {accessIssues} from './route-validator/sequence-review.mjs';

const baseline='39390ad721d27eace670ca8afbd99bd8fc2604533afe6f59bb5944f03c9b4cc6';
const input=loadSnapshot(undefined,'data/route-validator/snapshots/sheet-20261125-round2-applied.json');
assert.equal(input.sha256,baseline,'One-time plan only; changed routes require a fresh source review');
const p=loadProject(),native=JSON.parse(fs.readFileSync('.route-validator/backups/round3-before-complete.json'));
const rs=native.sheets.find(s=>s.properties.title==='Routes_順序校核'),ns=native.sheets.find(s=>s.properties.title==='RouteNodes_順序校核');
const value=c=>c?.effectiveValue?Object.values(c.effectiveValue)[0]??'':c?.userEnteredValue?.formulaValue?'':Object.values(c?.userEnteredValue||{})[0]??'';
const literal=v=>({userEnteredValue:typeof v==='boolean'?{boolValue:v}:typeof v==='number'?{numberValue:v}:{stringValue:String(v)}});
for(const route of input.routes){const nativeRow=rs.data[0].rowData[route.row.sheetRow-1];assert.equal(value(nativeRow?.values?.[0]),route.routeId);}
for(const route of input.routes.filter(r=>r.occurrences.length))for(const o of route.occurrences){const row=ns.data[0].rowData[o.sheetRow-1];assert.equal(value(row.values[0]),route.routeId);assert.equal(value(row.values[2]),o.position);assert.equal(value(row.values[3]),o.nodeId);}

const mapFindings={
 G02:'主峰／東峰、北峰、西峰、前峰及後四峰各支線逐一對照；保留上東埔步行段與既有選峰先後。',
 G03:'郡大32K→望鄉→北峰→主峰；西巒第二登山口、森林／瞭望台營地及展望點依序往返。',
 G04:'大霸、四秀及聖稜分支逐一對照；伊澤只由8.8K往返。鎮西堡岔路按既有明示合併／排除政策保留，不自行恢復空白position。',
 G05:'西稜與志佳陽、雪劍幹線、火石／大雪／中雪及大小劍支線逐一對照；水源與額外登峰不強加。',
 G06:'白姑登山口→水管岔→三錐→司晏→東南峰→吉他→一線天→草青池→主峰往返。',
 G07:'南湖及中央尖所有已列分岔、營地、山峰逐一對照；上圈谷直登東峰與四岔版分開。',
 G08:'北二段閂山捷徑、鈴鳴至甘薯主稜、耳無溪進出，以及畢羊鋸山與兩峰支線逐一對照。',
 G09:'合歡各峰／車行轉場、奇萊主北分岔、屏風新路全段對照；北壁段另用兩位2026作者交叉佐證3241稜線。',
 G10:'奇萊東稜磐石、斷崖前後、上下舖、太魯閣支線、平安池、立霧、帕托魯、江口林道逐一對照。',
 G11:'能高越嶺屯原至奇萊保線所既定步行端點、南華／南峰選登支線分開。',
 G12:'能高安東軍全部池、營地、南峰支線及萬大南溪匯流／越嶺順序逐一對照。',
 G13:'干卓萬、牧山火山往返、東北鞍轉卓社、卓社山至栗栖溪出口逐一對照；牧山池為額外支線。',
 G14:'保留使用者六順2897舊路往返；林道入口最近湖區到達依指定政策，不恢復已排除湖心點，也不加機車段。',
 G15:'南三段林道草原路與鐵線斷崖為替代線；東郡／東巒支線、傳統無雙吊橋至33K出山順序逐一對照。',
 G16:'東埔共用進出、草原古道／西峰高繞分開；馬博至太平谷、中平林道全部已列節點逐一對照。',
 G17:'八大秀採623秀姑坪白洋版不經杜鵑；南二段各山屋／支線／接點及向陽西口限制逐一對照。',
 G18:'新康布拉克桑支線、新仙營地與新康往返、瓦拉米出口及戒茂斯進路逐一對照；額外向陽／三叉／天宮不強加。',
 G19:'南一段關山、海諾、小關岔口至卑南及石山進出逐一對照；最低鞍部屬往雲水支線，不插入北峰側。',
 G20:'北大武新舊口、越嶺鞍、4K山莊支線、神木水源與主稜、大武祠及主峰往返逐一對照。',
};
const mapManifest=JSON.parse(fs.readFileSync('.route-validator/research/round3-maps/index.json'));
assert.equal(mapManifest.length,19);for(const m of mapManifest)assert.equal(hash(fs.readFileSync(m.file)),m.sha256);
const oldEvidence=JSON.parse(fs.readFileSync('data/route-validator/review-evidence-20261125.json'));
const extras=JSON.parse(fs.readFileSync('.route-validator/research/ordinal-new-node-candidates.json'));
const routeReason={
 R016:'四秀GPX另走桃山支線；池品指定走池有入口。',R017:'桃山山屋側支線或鄰近點，不是登頂主路新增必經點。',
 R022:'翠池是岔口另一分支；本線經北稜角。',R023:'依排除紀錄不選伊澤／加利；小霸、穆特勒布與翠池均為額外選登。',
 R024:'大霸北支、穆特勒布、翠池與喀拉業是來源額外支線，O型不強加。',R025:'穆特勒布、翠池是額外支線，不改Y型大霸折返意圖。',
 R027:'北稜角是雪主／翠池岔口另一支線；本線下翠池。',R028:'雪山南峰是山莊舊址另一登頂支線。',
 R030:'取水是鞍部岔口往返支線，不強加取水點。',R031:'來源另登小劍／佳陽、北稜角、雪山南峰或取水；志雪劍指定走大劍支線。',
 R035:'審馬陣山莊為叉路支線，未選住宿，不強加。',R039:'審馬陣山莊為叉路支線，未選住宿，不強加。',
 R050:'北合歡分支或近點線索；原圖反射板至北峰主路沒有強制走天巒方向叉路。',
 R052:'轉場道路附近建物及其他分支；車行與步行分開，未將建物當強制登山錨點。',
 R054:'南華為來源額外登頂，保留原不登南華版。',R057:'3241稜線由兩位2026作者及歷史第三來源同序佐證，補入現有ID；不創造洞穴／雙塔ID。',
 R058:'江口山為岔路另一支線；本線下林道。',R059:'來源額外走奇萊南華；越嶺主路按G11保留。',R061:'來源額外走奇萊南華；能安主路按G11/G12保留。',
 R062:'牧山池為獨立5分鐘支線，未選取水／宿營則不強加。',R064:'湖區依使用者最近既有線形到達政策；七彩妹池另屬額外繞行。',
 R066:'烏達佩與天南可蘭為岔口選登，來源額外支線不強加。',R069:'觀高服務站、八通關山或大水窟是來源額外分支；馬博採既定草原進入。',
 R070:'觀高服務站為側支線；維持623定義。',R072:'秀姑巒登頂及杜鵑腰繞屬其他變體；本線維持大水窟→秀姑坪→白洋。',
 R077:'向陽、三叉與天宮堡壘為來源額外選登，不強加新康。',R081:'最低鞍部是四岔往雲水側；不能用近點或錯線把它加到海諾北側。',
};
const out='data/audits/route-order-20261125';fs.mkdirSync(out,{recursive:true});
const added={routeId:'R057',afterPosition:8,nodeId:'node:79b43ef005b9dfe9c481',reason:'奇萊北峰至屏風主峰之間補列資料庫已有3241稜線；兩位2026作者正逆向軌跡同序經過，第三歷史來源僅作輔助。',sources:['https://hiking.biji.co/index.php?q=trail&act=gpx_detail&id=6053878','https://hiking.biji.co/index.php?q=trail&act=gpx_detail&id=6008189','https://hiking.biji.co/index.php?q=trail&act=gpx_detail&id=11822','https://www.sunriver.com.tw/images/hiking/G09_hiking_new.jpg']};
assert.ok(p.nodeAuthority.has(added.nodeId));
const results=input.routes.filter(r=>r.occurrences.length).map(r=>{
 const after=r.occurrences.map(o=>o.nodeId);if(r.routeId===added.routeId)after.splice(added.afterPosition,0,added.nodeId);
 const maps=[...new Set(r.occurrences.flatMap(o=>p.nodes.get(o.nodeId).groups.map(g=>g.slice(0,3))))].filter(g=>mapFindings[g]);
 const excluded=input.excluded.filter(e=>e.routeId===r.routeId).map(e=>({nodeId:e.nodeId,reason:e.source['審核備註']||'原先position空白，繼續排除'}));
 const references=[...new Set([...maps.flatMap(g=>mapManifest.filter(m=>m.file.split('/').at(-1).startsWith(g+'_')).map(m=>m.url)),...oldEvidence.groups.filter(g=>g.routeIds.includes(r.routeId)).flatMap(g=>g.sources),...(r.routeId===added.routeId?added.sources:[])])];
 const candidateDispositions=extras.filter(e=>e.routeId===r.routeId).map(e=>({...e,status:r.routeId==='R057'?'ADD_EXISTING_NODE':'KEEP_DEFINED_VARIANT',reason:/^R00[1-57]$/.test(r.routeId)?'來源另登玉山其他山峰；排除額外支線後保留目前選峰順序。':routeReason[r.routeId]}));
 assert.ok(candidateDispositions.every(d=>d.reason),'Every candidate needs a reviewed disposition '+r.routeId);
 assert.equal(accessIssues(after).length,0);assert.ok(after.every(id=>p.nodeAuthority.has(id)));
 return {routeId:r.routeId,name:r.name,before:r.occurrences.map(o=>o.nodeId),after,sequenceSha256:hash(after),status:'SOURCE_NODE_ORDER_REVIEWED',maps:maps.map(g=>({group:g,finding:mapFindings[g]})),references,excluded,candidateDispositions,scope:'現有上河Node ID、指定走法、實際經過順序與漏點；不把GPX額外繞行或微小偏移當錯序。',geometryAndTimeStatus:'獨立維護，不以線形／時間缺口否定已核對的節點順序。'};
});
assert.equal(results.length,60);assert.equal(results.reduce((n,r)=>n+r.candidateDispositions.length,0),extras.length);
writeJson(out+'/source-review.json',{schemaVersion:1,reviewedAt:new Date().toISOString(),baselineSha256:baseline,graphDigest:p.digest,nodeAuthority:p.authoritySource,mapReferences:mapManifest.map(({file,...m})=>m),reviewMethod:'逐張讀取19張上河原圖，逐條對照60條有效節點序列；78份GPX跨路線比較與分段觀察；逐項處置160個不同額外節點線索。非單份／舊GPX投票通過。',corrections:[added],results,unexpanded:input.routes.filter(r=>!r.occurrences.length).map(r=>({routeId:r.routeId,name:r.name}))});

const insertAt=input.routes.find(r=>r.routeId==='R057').occurrences[8].sheetRow-1;
const requestInsert={insertDimension:{range:{sheetId:ns.properties.sheetId,dimension:'ROWS',startIndex:insertAt,endIndex:insertAt+1},inheritFromBefore:true}};
const newCells=['R057',{formulaValue:`=IF($A${insertAt+1}="","",IFNA(VLOOKUP($A${insertAt+1},'Routes_順序校核'!$A:$B,2,FALSE),""))`},9,added.nodeId,p.nodes.get(added.nodeId).name,p.nodes.get(added.nodeId).groups.join('、'),'稜線',false,added.sources.join('\n'),'現有上河節點順序已核對','途經（第1次）',added.reason,'',false].map(v=>typeof v==='object'?{userEnteredValue:v}:literal(v));
const requests=[requestInsert,{updateCells:{start:{sheetId:ns.properties.sheetId,rowIndex:insertAt,columnIndex:0},rows:[{values:newCells}],fields:'userEnteredValue'}},...([7,13].map(col=>({copyPaste:{source:{sheetId:ns.properties.sheetId,startRowIndex:insertAt-1,endRowIndex:insertAt,startColumnIndex:col,endColumnIndex:col+1},destination:{sheetId:ns.properties.sheetId,startRowIndex:insertAt,endRowIndex:insertAt+1,startColumnIndex:col,endColumnIndex:col+1},pasteType:'PASTE_DATA_VALIDATION'}})))];
const nativeRows=structuredClone(ns.data[0].rowData);nativeRows.splice(insertAt,0,{values:newCells});
// Update positions only on R057. Native row insertion keeps all other formulas,
// notes, excluded rows and columns O:AA in place; never rewrite the entire table.
const r57=input.routes.find(r=>r.routeId==='R057');
requests.push({updateCells:{start:{sheetId:ns.properties.sheetId,rowIndex:r57.occurrences[0].sheetRow-1,columnIndex:2},rows:results.find(r=>r.routeId==='R057').after.map((_,i)=>({values:[literal(i+1)]})),fields:'userEnteredValue'}});
for(let i=0;i<nativeRows.length;i++){
 const cells=nativeRows[i].values||[];if(i===insertAt)continue;
 const id=value(cells[0]),nodeId=value(cells[3]),position=Number(value(cells[2]));if(!id||!nodeId||!position)continue;
 const node=p.nodes.get(nodeId);assert.ok(node);
 if(!value(cells[5]))requests.push({updateCells:{start:{sheetId:ns.properties.sheetId,rowIndex:i,columnIndex:5},rows:[{values:[literal(node.groups.join('、'))]}],fields:'userEnteredValue'}});
 const occurrence=results.find(r=>r.routeId===id).after;const at=id==='R057'?occurrence.indexOf(nodeId):position-1;
 const pass=occurrence.slice(0,at+1).filter(n=>n===nodeId).length;
 const direction=at===0?'起點':at===occurrence.length-1?`終點（第${pass}次）`:`途經（第${pass}次）`;
 requests.push({updateCells:{start:{sheetId:ns.properties.sheetId,rowIndex:i,columnIndex:9},rows:[{values:[literal('現有上河節點順序已核對'),literal(direction)]}],fields:'userEnteredValue'}});
}
const rowUpdates=[];
for(const r of results){const route=input.routes.find(z=>z.routeId===r.routeId),row=route.row.sheetRow-1;
 const changed=r.routeId==='R057',note=changed?added.reason:r.maps.map(m=>m.finding).join(' ');
 const updates={8:'現有上河節點序列核對完成',10:changed?'已補3241稜線，修正後順序已核對':'指定走法下，未發現仍待修正的現有節點漏列／錯序',12:'來源與程式核對完成；未代填使用者人工簽核',17:'2026-11-25 上河原圖／指定走法／分段GPX順序核對',20:changed?'補列已有3241稜線；重要點旗標維持原規則':'保留已核對的選峰、折返及排除政策',23:changed?'已修正並完成節點順序核對':'已完成節點順序核對',25:note,26:r.references.join('\n'),28:'節點順序核對完成；正式模組匯入未執行'};
 if(!route.row['目前順序屬於順行或逆行?']||route.row['目前順序屬於順行或逆行?']==='/')updates[19]=route.type==='往返'?'往返（按表列選峰順序）':route.occurrences[0].name+' → '+route.occurrences.at(-1).name+'（按表列方向）';
 for(const [col,v]of Object.entries(updates)){requests.push({updateCells:{start:{sheetId:rs.properties.sheetId,rowIndex:row,columnIndex:Number(col)},rows:[{values:[literal(v)]}],fields:'userEnteredValue'}});rowUpdates.push({rowIndex:row,columnIndex:Number(col),value:v});}
}
for(const request of requests){assert.equal(Object.keys(request).length,1);if(request.updateCells){assert.equal(request.updateCells.fields,'userEnteredValue');assert.ok(request.updateCells.rows.length);}}
const compact=requests.slice(0,5),buckets=new Map();
for(const request of requests.slice(5)){const u=request.updateCells;assert.equal(u.rows.length,1);const key=[u.start.sheetId,u.start.columnIndex,u.rows[0].values.length].join(':');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(u);}
for(const list of buckets.values()){
 list.sort((a,b)=>a.start.rowIndex-b.start.rowIndex);let block;
 for(const u of list){if(!block||block.rows.length>=30||block.start.rowIndex+block.rows.length!==u.start.rowIndex){block={start:u.start,rows:[],fields:u.fields};compact.push({updateCells:block});}block.rows.push(u.rows[0]);}
}
writeJson('.route-validator/backups/round3-plan.json',{baselineSha256:baseline,insertAt,requests:compact,rowUpdates,added,sourceReview:out+'/source-review.json',summary:{reviewedRoutes:60,activeNodesBefore:1470,activeNodesAfter:1471,excluded:24,insertedExistingNodes:1,unexpanded:26}});
console.log(JSON.stringify({requests:compact.length,insertAt,reviewedRoutes:results.length,extraCandidates:extras.length,added:added.nodeId}));
