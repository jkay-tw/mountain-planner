// Public government WMTS; no API keys, billing accounts or bulk/offline cache.
export function addFreeImagery({L,map,layers,onError=()=>{}}){
  const common={maxZoom:19,updateWhenIdle:true,keepBuffer:1,detectRetina:false};
  const aerial=L.tileLayer('https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}',{
    ...common,maxNativeZoom:19,bounds:[[21.5,118],[26.5,123]],
    attribution:'影像 © <a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noreferrer">內政部國土測繪中心</a> · <a href="https://maps.nlsc.gov.tw/pro/use_clause.jsp" target="_blank" rel="noreferrer">使用條款</a>'
  });
  layers.addBaseLayer(aerial,'正射影像（國土測繪中心・免費）');
  for(const layer of [aerial])layer.on('tileerror',()=>{if(map.hasLayer(layer))onError('影像暫時無法載入，請在圖層選單切回 OpenStreetMap 或魯地圖。')});
  return {aerial};
}
