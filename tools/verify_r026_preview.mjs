// Focused acceptance only: use an existing local Preview server.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=fileURLToPath(new URL('../docs/assets/r026-walking-20261125/',import.meta.url));
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(process.argv[2]||'http://127.0.0.1:56333/preview/unified-editor.html');await page.waitForFunction(()=>document.querySelector('#classicSelect').options.length>0);
 const plan=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem(document.body.dataset.mode==='production'?'mountain-planner.global-autosave.v1.tab':'mountain-planner.idea003-autosave.v1.tab'))),card=()=>page.locator('.day-card').first();
 await page.selectOption('#routeSelect','G04');assert.equal(await card().locator('[data-start-node="g04-062"]').count(),0);assert.equal(await card().locator('[data-start-node="g04-033"]').count(),1);
 await mkdir(output,{recursive:true});await card().locator('.quick-starts').scrollIntoViewIfNeeded();await page.screenshot({path:output+'g04-desktop.png'});
 await page.setViewportSize({width:390,height:844});await card().locator('.quick-starts').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:output+'g04-mobile.png'});
 await card().locator('[data-start-node="g04-033"]').click();assert.equal((await plan()).days[0].items.length,1);assert.equal((await plan()).days[0].items[0].nodeId,'g04-033');assert.ok(await card().locator('[data-quick-key]').count()>0);
 await card().getByRole('button',{name:'＋ A.B區神木岔路',exact:true}).click();assert.equal((await plan()).days[0].items.length,2);assert.equal((await plan()).days[0].items[1].nodeId,'g04-065');
 await page.setViewportSize({width:1280,height:900});
 await page.click('#undoBtn');assert.equal((await plan()).days[0].items.length,1);await page.click('#redoBtn');assert.equal((await plan()).days[0].items.length,2);
 await page.click('[data-source="routes"]');await page.selectOption('#classicSelect','R026');assert.ok(!(await page.locator('.classic-sequence').innerText()).includes('鎮西堡'));assert.equal(await page.locator('#classicApply').isDisabled(),false);await page.click('#classicApply');await page.waitForFunction(()=>!document.querySelector('#classicApply').disabled);
 const day=(await plan()).days[0];assert.equal(day.items.length,33);assert.equal(day.items[0].nodeId,'g04-033');assert.equal(day.items.at(-1).nodeId,'g04-033');assert.ok(day.items.every(i=>i.nodeId!=='g04-062'&&i.incoming?.travelMode!=='vehicle'));
 await page.evaluate(()=>{window.showSaveFilePicker=undefined;});const downloading=page.waitForEvent('download');await page.click('#saveBtn');const {readFile}=await import('node:fs/promises'),bytes=await readFile(await(await downloading).path());await page.setInputFiles('#importFile',{name:'r026-walking.mplan.json',mimeType:'application/json',buffer:bytes});assert.deepEqual((await plan()).days[0],day);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#classicSelect').options.length>0);assert.deepEqual((await plan()).days[0],day);assert.deepEqual(errors,[]);
 const report={result:'PASS',routeId:'R026',start:'神木區登山口',end:'神木區登山口',walkingOccurrences:33,vehicleSegments:0,checks:['G04 excludes vehicle-only Zhenxibao','connected Shenmu trailhead quick start','one-node addition','next walking node','undo/redo','whole R026 walking application','JSON roundtrip','reload','390px no overflow'],pageErrors:errors};await writeFile(output+'acceptance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));await context.close();
}finally{await browser.close();}
