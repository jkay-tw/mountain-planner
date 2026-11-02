// TWD97 / TM2 zone 121, GRS80; WGS84 geographic coordinates treated as
// equivalent at this DEM/map display precision. Output is rounded to metres.
export function toTwd97([lon,lat]){
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||lat<0||lat>90||Math.abs(lon-121)>6)return null;
 const a=6378137,b=6356752.314140356,k=.9999,rad=Math.PI/180,p=lat*rad,l=(lon-121)*rad,e2=1-b*b/(a*a),ep=e2/(1-e2);
 const N=a/Math.sqrt(1-e2*Math.sin(p)**2),T=Math.tan(p)**2,C=ep*Math.cos(p)**2,A=Math.cos(p)*l;
 const M=a*((1-e2/4-3*e2**2/64-5*e2**3/256)*p-(3*e2/8+3*e2**2/32+45*e2**3/1024)*Math.sin(2*p)+(15*e2**2/256+45*e2**3/1024)*Math.sin(4*p)-35*e2**3/3072*Math.sin(6*p));
 return [Math.round(250000+k*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep)*A**5/120)),Math.round(k*(M+N*Math.tan(p)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep)*A**6/720)))];
}
export const twd97Label=p=>{const v=toTwd97(p);return v?`TWD97 (${v[0]}, ${v[1]})`:'TWD97 座標未取得'};
