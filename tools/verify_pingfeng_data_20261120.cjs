// Isolated browser verification; no existing browser profile or remote state.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('fs/promises'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),types={'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png'};
(async()=>{const server=http.createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error();const body=await fs.readFile(p);res.writeHead(200,{'Content-Type':types[path.extname(p)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{
browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});const errors=[];
const base='http://127.0.0.1:'+server.address().port;
for(const entry of ['index.html','preview/unified-editor.html']){
 const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{assert.ok(!d.message().includes('匯入失敗'),d.message());await d.accept();});
 await page.goto(base+'/'+entry,{waitUntil:'domcontentloaded'});await page.waitForSelector('.add-node option[value="node:97e309d22937a82f9ade"]',{state:'attached'});
 await page.selectOption('#routeSelect','G09-cfb4c85c');const search=page.locator('.node-search-inline').first();for(const text of ['合歡北峰','北合歡山']){await search.fill(text);assert.ok(await page.locator('.add-node option[value="node:396247de591a031f9bfb"]').count()>0,text);}
 await page.selectOption('#routeSelect','G09-ee5545d1');await page.selectOption('.add-node','node:97e309d22937a82f9ade');await page.click('.add-dest');await page.selectOption('.add-node','node:d69a18f19c7940c3ebf4');await page.click('.add-dest');
 await page.evaluate(()=>window.showSaveFilePicker=undefined);const downloading=page.waitForEvent('download');await page.click('#saveBtn');const plan=JSON.parse(await fs.readFile(await (await downloading).path(),'utf8'));
 assert.deepEqual(plan.days[0].items.map(i=>i.nodeId),['node:97e309d22937a82f9ade','node:ac2e2b0473232211e496','node:d69a18f19c7940c3ebf4']);assert.equal(plan.days[0].items.slice(1).reduce((n,i)=>n+i.incoming.officialMinutes,0),175);
 const result=await page.evaluate(async({plan,prefix})=>{const module=await import(prefix+'js/itinerary-geometry.js');const data=await (await fetch(prefix+'data/geometry/planner-terrain-v1.json')).json();const resolved=module.resolveItineraryGeometry(plan.days,data);return {distance:resolved.distanceMeters,gaps:resolved.gaps.length,gpx:module.geometryToGpx(resolved,data)};},{plan,prefix:entry.startsWith('preview/')?'/preview/':'/'});assert.equal(result.gaps,0);assert.ok(result.distance>2000&&result.distance<2100);assert.ok(result.gpx.includes('<ele>'));
 const legacy=structuredClone(plan);legacy.days[0].items=[{id:'legacy',type:'location',nodeId:'shared:cw-v07-041',name:'奇萊主山北峰',note:'keep old plan',incoming:null}];await page.setInputFiles('#importFile',{name:'old.mplan.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});await page.waitForSelector('input.note-input[value="keep old plan"]');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1280,height:900});console.log(entry+' PASS: new/old alias search, corrected route, source minutes, GPX/DEM, legacy import, 390px');
 await context.close();
}
assert.deepEqual(errors,[]);console.log('Browser verification PASS; no page errors');
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
