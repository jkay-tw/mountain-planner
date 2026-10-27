export async function loadManifest(){
  const res = await fetch('data/manifest.json');
  if(!res.ok) throw new Error('無法載入 manifest.json');
  return res.json();
}
export async function loadRoute(file){
  const res = await fetch(file);
  if(!res.ok) throw new Error(`無法載入 ${file}`);
  return res.json();
}
