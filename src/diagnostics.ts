import config from './diagnostics-config.json';
import { DiagnosticLimiter, diagnosticBrowser, diagnosticErrorKind, type DiagnosticCode, type DiagnosticContext, type DiagnosticMetrics, type DeviceDiagnosticContext } from './diagnostics-policy';

let context:DiagnosticContext={};
let enabled=false;
let send:((code:DiagnosticCode,error:unknown,metrics:DiagnosticMetrics)=>void)|undefined;
const limiter=new DiagnosticLimiter();
const pending:{code:DiagnosticCode;error:unknown;metrics:DiagnosticMetrics}[]=[];
export function setDiagnosticContext(value:DiagnosticContext){context={...value};}
export function reportDiagnostic(code:DiagnosticCode,error?:unknown,metrics:DiagnosticMetrics={}){
  if(!enabled||!limiter.accept(code,diagnosticErrorKind(error)))return;
  try{if(send)send(code,error,metrics);else pending.push({code,error,metrics});}catch{/* Logging cannot interrupt inference or interaction. */}
}
async function deviceContext():Promise<DeviceDiagnosticContext>{
  const ua=navigator.userAgent;
  const android=/Android ([\d.]+)/.exec(ua),ios=/(?:CPU (?:iPhone )?OS|iPhone OS) ([\d_]+)/.exec(ua);
  const result:DeviceDiagnosticContext={browser:diagnosticBrowser(ua),
    os:{name:android?'Android':ios?'iOS':/Windows/.test(ua)?'Windows':/Macintosh/.test(ua)?'macOS':'Other',version:android?.[1]??ios?.[1]?.replaceAll('_','.')},
    device:{processor_count:navigator.hardwareConcurrency,screen_width:innerWidth,screen_height:innerHeight,touch:navigator.maxTouchPoints>0}};
  const nav=navigator as Navigator&{deviceMemory?:number;userAgentData?:{getHighEntropyValues:(keys:string[])=>Promise<{model?:string;platformVersion?:string}>}};
  result.device.memory_size_gb=nav.deviceMemory;
  if(nav.userAgentData){
    try{
      const values=await Promise.race([nav.userAgentData.getHighEntropyValues(['model','platformVersion']),new Promise<null>(resolve=>setTimeout(()=>resolve(null),500))]);
      if(values?.model&&/^[\w .()+-]{1,80}$/.test(values.model))result.device.model=values.model;
      if(values?.platformVersion&&/^[\d.]{1,32}$/.test(values.platformVersion))result.os.version=values.platformVersion;
    }catch{/* Reduced device information is sufficient when hints are unavailable. */}
  }
  return result;
}
export async function initDiagnostics(){
  // Local review and all legacy entry points stay offline. No query parameter
  // can enable upload. Browser tests route this exact origin to a local server.
  if(enabled||location.origin!==config.origin)return;
  enabled=true;
  const ownScript=(filename:string)=>{try{const url=new URL(filename);return url.origin===location.origin&&/^\/(?:assets\/|src\/|camera-runtime\.js)/.test(url.pathname);}catch{return false;}};
  window.addEventListener('error',event=>{if(event.error&&ownScript(event.filename))reportDiagnostic('app_error',event.error);});
  window.addEventListener('unhandledrejection',event=>{if(event.reason instanceof Error&&event.reason.stack?.includes(location.origin+'/'))reportDiagnostic('app_rejection',event.reason);});
  try{
    const [sdk,version,device]=await Promise.all([
      import('./diagnostics-sentry'),
      fetch('/api/version',{credentials:'omit',signal:AbortSignal.timeout(2000)}).then(response=>response.ok?response.json():null).catch(()=>null),
      deviceContext(),
    ]);
    const revision=typeof version?.revision==='string'&&/^[\w.-]{1,80}$/.test(version.revision)?version.revision:'unknown';
    send=sdk.configureDiagnosticSender(config.dsn,`cookgame@${revision}`,location.origin,device,()=>context);
    for(const event of pending.splice(0))send(event.code,event.error,event.metrics);
  }catch{enabled=false;pending.length=0;/* Diagnostics must never prevent the experience from starting. */}
}
