// The picker must open during the click gesture, before asynchronous file generation.
export async function chooseSaveTarget(name,mime,extension){
 if(typeof globalThis.showSaveFilePicker!=='function')return null;
 return await globalThis.showSaveFilePicker({suggestedName:name,types:[{description:extension.toUpperCase()+' 檔案',accept:{[mime]:['.'+extension]}}]});
}
export async function writeDownload(blob,name,handle){
 if(handle){const stream=await handle.createWritable();try{await stream.write(blob);await stream.close()}catch(error){await stream.abort?.();throw error}return}
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function reportSaveError(error){if(error?.name!=='AbortError')alert('匯出失敗：'+(error?.message||error))}
