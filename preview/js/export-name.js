// One naming rule for JSON, Excel and GPX. The suffix describes partial output.
export function itineraryExportName({tripName='',tripStartDate='',dayCount=1},extension,{partial=false}={}){
 const base=tripName.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'登山行程';
 let date='';if(tripStartDate){const start=tripStartDate.replaceAll('-',''),end=new Date(tripStartDate+'T00:00:00');end.setDate(end.getDate()+dayCount-1);const finish=String(end.getFullYear())+String(end.getMonth()+1).padStart(2,'0')+String(end.getDate()).padStart(2,'0');date='_'+start+(dayCount>1?'-'+(start.slice(0,4)===finish.slice(0,4)?finish.slice(4):finish):'');}
 return base+date+(partial?'-partial':'')+'.'+extension;
}
