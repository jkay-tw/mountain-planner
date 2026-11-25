// Trial export keeps manual access geometry separate from OSM source geometry.
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function pilotGpx(route, chosen) {
  const points = route.coordinates;
  const point = (tag,p,name='') => `<${tag} lat="${p[1]}" lon="${p[0]}">${Number.isFinite(p[2])?`<ele>${p[2]}</ele>`:''}${name?`<name>${escape(name)}</name>`:''}</${tag}>`;
  const track = (name,desc,coords) => `<trk><name>${escape(name)}</name><desc>${escape(desc)}</desc><trkseg>${coords.map(p=>point('trkpt',p)).join('')}</trkseg></trk>`;
  return '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Mountain Planner OSM pilot" xmlns="http://www.topografix.com/GPX/1/1">'
    + '<metadata><desc>Trial geometry; no Shanghe time. OSM 2026-11-12, ODbL: https://www.openstreetmap.org/copyright; DEM node samples: https://rudymap.tw/</desc></metadata>'
    + point('wpt',chosen[0].point,'指定起點') + point('wpt',chosen[1].point,'指定終點')
    + track('手動接入起點','Manual connector: unverified, no terrain or travel time',[chosen[0].point,points[0].slice(0,2)])
    + track('OSM 檢查路徑','OSM ways: '+[...new Set(route.wayIds)].join(',')+'; DEM estimated at original vertices only; reference, not verified trail',points)
    + track('手動接出終點','Manual connector: unverified, no terrain or travel time',[points.at(-1).slice(0,2),chosen[1].point])+'</gpx>';
}
