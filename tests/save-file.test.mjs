import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseSaveTarget,writeDownload,reportSaveError} from '../js/save-file.js';
test('supported picker receives suggested name and writes to selected file',async()=>{
 let options,written,closed=false;
 globalThis.showSaveFilePicker=async o=>(options=o,{createWritable:async()=>({write:async b=>{written=await b.text()},close:async()=>{closed=true}})});
 const h=await chooseSaveTarget('trip.gpx','application/gpx+xml','gpx');await writeDownload(new Blob(['track']),'trip.gpx',h);
 assert.equal(options.suggestedName,'trip.gpx');assert.equal(written,'track');assert.ok(closed);delete globalThis.showSaveFilePicker;
});
test('unsupported picker uses download and cancellation does not show error',async()=>{
 assert.equal(await chooseSaveTarget('trip.json','application/json','json'),null);
 let clicked=false,alerted=false;globalThis.document={createElement:()=>({click(){clicked=true}})};globalThis.alert=()=>{alerted=true};
 await writeDownload(new Blob(['test']),'trip.json',null);assert.ok(clicked);reportSaveError({name:'AbortError'});assert.equal(alerted,false);delete globalThis.document;delete globalThis.alert;
});
