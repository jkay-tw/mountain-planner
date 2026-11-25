export async function openTerrainCache(storage,prefix,version){
 if(!storage)return null;const name=prefix+version;
 for(const old of await storage.keys())if(old.startsWith(prefix)&&old!==name)await storage.delete(old);
 return storage.open(name);
}
export async function putTerrainCache(cache,url,bytes,budget){
 if(!cache)return;await cache.delete(url);await cache.put(url,new Response(bytes,{headers:{'Content-Length':String(bytes.byteLength)}}));
 const entries=await cache.keys();let total=0;const sizes=[];for(const entry of entries){const response=await cache.match(entry),size=Number(response?.headers.get('Content-Length'))||0;sizes.push(size);total+=size;}
 for(let i=0;i<entries.length&&total>budget;i++){await cache.delete(entries[i]);total-=sizes[i];}
}
