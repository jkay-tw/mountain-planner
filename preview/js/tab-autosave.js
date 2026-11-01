// Per-tab working copy; shared backup advances only after a plan edit.
export function createTabAutosave({local,session,key,legacyKey=null}){
  const tabKey=key+'.tab';let baseline=null;
  const fingerprint=p=>JSON.stringify({routeId:p.routeId,tripStartDate:p.tripStartDate,days:p.days});
  const get=(storage,k)=>{try{const p=JSON.parse(storage.getItem(k)||'null');return p?.format==='mountain-planner'?p:null}catch{return null}};
  const put=(storage,k,p)=>{try{storage.setItem(k,JSON.stringify(p))}catch{}};
  return {
    load(){
      const p=get(session,tabKey)||get(local,key)||(legacyKey?get(local,legacyKey):null);
      if(p){put(session,tabKey,p);baseline=fingerprint(p)}
      return p;
    },
    save(p,{shared=true}={}){
      const next=fingerprint(p);put(session,tabKey,p);
      if(shared&&baseline!==null&&next!==baseline)put(local,key,p);
      baseline=next;
    }
  };
}
