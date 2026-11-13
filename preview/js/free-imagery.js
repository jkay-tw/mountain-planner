// Public government WMTS; no API keys, billing accounts or bulk/offline cache.
export function addFreeImagery({L,map,layers,onError=()=>{}}){
  const common={maxZoom:19,updateWhenIdle:true,keepBuffer:1,detectRetina:false};
  const aerial=L.tileLayer('https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}',{
    ...common,maxNativeZoom:19,bounds:[[21.5,118],[26.5,123]],
    attribution:'影像 © <a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noreferrer">內政部國土測繪中心</a> · <a href="https://maps.nlsc.gov.tw/pro/use_clause.jsp" target="_blank" rel="noreferrer">使用條款</a>'
  });
  const satellite=L.tileLayer('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',{
    ...common,maxNativeZoom:8,
    attribution:'衛星概覽 NASA Blue Marble／MODIS · <a href="https://earthobservatory.nasa.gov/features/BlueMarble" target="_blank" rel="noreferrer">NASA Earth Observatory</a>'
  });
  layers.addBaseLayer(aerial,'正射影像（國土測繪中心・免費）');
  layers.addBaseLayer(satellite,'衛星概覽（NASA・低解析度・免費）');
  for(const layer of [aerial,satellite])layer.on('tileerror',()=>{if(map.hasLayer(layer))onError('影像暫時無法載入，請在圖層選單切回 OpenStreetMap 或魯地圖。')});
  return {aerial,satellite};
}
