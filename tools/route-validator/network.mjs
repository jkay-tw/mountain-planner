import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
// Only public HTTPS resources. No login, cookies, private hosts or HTML-as-GPX.
export function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a>=224||a===198&&(b===18||b===19));
  }
  if (net.isIP(address) === 6) {const a=address.toLowerCase();return !a.includes('.')&&!a.startsWith('::')&&!a.startsWith('fc')&&!a.startsWith('fd')&&!a.startsWith('fe')&&!a.startsWith('ff')&&!a.startsWith('2001:db8');}
  return false;
}
export async function publicDownload(url, {maxBytes=32*1024*1024,timeout=20000,redirects=3}={}) {
  const u=new URL(url);
  if (u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||/login|signin|oauth|captcha/i.test(u.pathname)||u.hostname==='localhost') throw Error('只允許不需登入的公開 HTTPS 來源');
  const answers=await dns.lookup(u.hostname,{all:true});
  if(!answers.length||answers.some(a=>!publicAddress(a.address)))throw Error('不允許存取私人網路來源');
  const response=await new Promise((resolve,reject)=>{
    const req=https.get(u,{headers:{'User-Agent':'MountainPlanner-RouteValidator/1.0 (public reference retrieval; no login)'},lookup:(host,opts,cb)=>{if(opts.all)cb(null,answers);else cb(null,answers[0].address,answers[0].family);}},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy(Error('下載超出大小上限'));return;}chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)}));
    });
    const deadline=setTimeout(()=>req.destroy(Error('來源下載超過時間上限')),timeout);req.on('close',()=>clearTimeout(deadline));
    req.setTimeout(timeout,()=>req.destroy(Error('來源回應逾時')));req.on('error',reject);
  });
  if(response.status>=300&&response.status<400){
    if(!response.headers.location||redirects<=0)throw Error('來源轉址過多');
    const next=new URL(response.headers.location,u);
    if(/login|signin|oauth|captcha/i.test(next.href)||next.hostname.startsWith('member.'))throw Error('來源要求登入；已停止，未繞過限制');
    return publicDownload(next.href,{maxBytes,timeout,redirects:redirects-1});
  }
  if(response.status!==200)throw Error('來源 HTTP '+response.status);
  return {...response,url:u.href};
}
