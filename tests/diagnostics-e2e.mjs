import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {EventEmitter,once} from 'node:events';
import {chromium} from 'playwright';
import {createSessionServer} from '../server/server.ts';

process.env.APP_REVISION='diagnostics-validation-v4';
const app=await createSessionServer({port:0,allowedOrigins:['https://cookgame.shogo0x2e.com']});await app.listen();
const base=`http://127.0.0.1:${app.server.address().port}`,origin='https://cookgame.shogo0x2e.com';
const browser=await chromium.launch({channel:process.env.E2E_BROWSER??'chrome',headless:true});
const folder='test-results/diagnostics';await mkdir(folder,{recursive:true});
const envelopes=[],events=[],checks=[],unexpected=[];let refuse=false;
const received=new EventEmitter();
const nextEvent=(code,timeout=30000)=>once(received,code,{signal:AbortSignal.timeout(timeout)}).then(([event])=>event);
const check=text=>{checks.push(text);console.log(`PASS ${text}`);};
try{
 const local=await browser.newPage();const localRequests=[];local.on('request',request=>localRequests.push(request.url()));
 await local.goto(`${base}/?demo=1`);await local.locator('main[data-screen="intro"]').waitFor();
 assert.deepEqual(localRequests.filter(url=>!url.startsWith(base+'/')),[]);await local.close();
 check('localhost review never connects to Sentry');
 const context=await browser.newContext({viewport:{width:1440,height:900}});const page=await context.newPage();page.setDefaultTimeout(20000);
 const runtimeErrors=[];page.on('pageerror',error=>runtimeErrors.push(error.message));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===origin){
   const response=await context.request.fetch(base+url.pathname+url.search,{method:request.method(),data:request.postDataBuffer()??undefined,headers:{...(request.headers()['content-type']?{'Content-Type':request.headers()['content-type']}:{}),...(request.headers().authorization?{Authorization:request.headers().authorization}:{}),Origin:origin}});
   return route.fulfill({response});
  }
  if(url.origin==='https://sentry.x2e.me'){
   if(request.method()==='POST'){
    const body=request.postData();const lines=body.split('\n');
    for(let i=1;i<lines.length-1;i++){
     let header;try{header=JSON.parse(lines[i]);}catch{continue;}
     if(header.type==='event'){const event=JSON.parse(lines[++i]);envelopes.push({url:request.url(),body});events.push(event);received.emit(event.tags.diagnostic_code,event);}
     else assert.fail(`Unexpected Sentry item: ${header.type}`);
    }
   }
   if(refuse)return route.abort('failed');
   return route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST, OPTIONS'},contentType:'application/json',body:'{}'});
  }
  if(!['blob:','data:'].includes(url.protocol))unexpected.push(request.url());
  return route.abort();
 });
 await page.addInitScript(()=>{
  navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('PRIVATE_CAMERA_SENTINEL','NotAllowedError');};
  Object.defineProperty(navigator,'userAgentData',{value:{getHighEntropyValues:async()=>({model:'SM-F966B',platformVersion:'16.0.0'})}});
 });
 await page.goto(`${origin}/?demo=1&private=PRIVATE_QUERY_SENTINEL`);
 await page.locator('[name="age"]').fill('5');await page.locator('#participant-form button').click();
 const appEvent=nextEvent('app_error');
 await page.evaluate(()=>{
  const note=document.createElement('textarea');note.value='PRIVATE_ANSWER_SENTINEL';document.body.append(note);
  localStorage.setItem('private-secret','PRIVATE_TOKEN_SENTINEL');
  const error=new TypeError('PRIVATE_ERROR_SENTINEL');error.stack='TypeError: PRIVATE_ERROR_SENTINEL\n    at inference (https://cookgame.shogo0x2e.com/assets/diagnostics-check.js?token=PRIVATE_STACK_SENTINEL:10:20)';
  for(let i=0;i<4;i++)window.dispatchEvent(new ErrorEvent('error',{error,filename:'https://cookgame.shogo0x2e.com/assets/diagnostics-check.js'}));
 });
 await appEvent;
 const cameraEvent=nextEvent('camera_start',40000);
 await page.locator('[data-action="start-camera-game"]').click();await cameraEvent;
 await page.getByText('カメラが許可されていません。大人の人に確認してね。',{exact:true}).waitFor();
 assert.equal(events.filter(event=>event.tags.diagnostic_code==='app_error').length,1);
 assert.equal(events.find(event=>event.tags.diagnostic_code==='camera_start').tags.error_kind,'NotAllowedError');
 check('official SDK captures app errors and camera failures once, with permission failure distinguished');
 await page.goBack();await page.locator('main[data-screen="camera"]').waitFor();
 const unstable=nextEvent('tracking_unstable',20000);
 await page.evaluate(()=>{
  const original=window.cookgameRuntime.mountGame;
  window.cookgameRuntime.mountGame=(container,options)=>original(container,{...options,cameraFactory:callback=>{
   let timer,stream;return {async start(video){
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');stream=canvas.captureStream(20);video.srcObject=stream;void video.play();let count=0;
    timer=setInterval(()=>{
     ctx.fillStyle=count%2?'#e3e9d6':'#e3e9d7';ctx.fillRect(0,0,640,480);
     const points=Array.from({length:33},()=>({x:.5,y:.5,visibility:0}));const put=(i,x,y)=>{points[i]={x,y,visibility:1};};
     put(0,.5,.33);put(7,.43,.31);put(8,.57,.31);
     [[11,13,15],[12,14,16]].forEach(([s,e,w],side)=>{
      const up=count%2===0;const upper=side===0?(up?-2.55:2.2):(up?-.59:.94),lower=side===0?(up?-2.02:1.7):(up?-1.12:1.44);
      put(s,side===0?.6:.4,.58);put(e,points[s].x-Math.cos(upper)*74/640,points[s].y+Math.sin(upper)*74/480);
      put(w,points[e].x-Math.cos(lower)*70/640,points[e].y+Math.sin(lower)*70/480);
     });count++;window.diagnosticSamples=count;callback({points,x:.5,width:640,height:480,inferenceMs:20,capturedAt:performance.now()});
    },50);
   },stop(){clearInterval(timer);stream?.getTracks().forEach(track=>track.stop());}};
  }});
 });
 await page.locator('[data-action="start-camera-game"]').click();
 try{await unstable;}catch(error){console.log(JSON.stringify({runtimeErrors,eventCodes:events.map(event=>event.tags.diagnostic_code),state:await page.evaluate(()=>({samples:window.diagnosticSamples,hidden:document.hidden,fields:[...document.querySelectorAll('#field')].map(field=>({phase:field.dataset.phase,tracked:field.dataset.tracked,visible:field.dataset.trackingVisible,text:field.innerText}))}))}));throw error;}
 const tracking=events.find(event=>event.tags.diagnostic_code==='tracking_unstable');assert.ok(tracking.contexts.diagnostics.jumps>=12);
 check('repeated synthetic arm jumps reach Sentry as aggregate metrics through the real game callback');
 for(const event of events){
  assert.equal(event.release,'cookgame@diagnostics-validation-v4');assert.equal(event.environment,'demo');
  assert.equal(event.contexts.device.model,'SM-F966B');assert.equal(event.tags.pose_delegate,'CPU');assert.equal(event.tags.pose_model,'Lite');
  assert.match(event.tags.experience_id,/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);assert.match(event.tags.browser_id,/^[a-f0-9-]{36}$/);
  assert.ok(!/PRIVATE_|"points"|"landmarks"|"upper"|"lower"|"request"|"breadcrumbs"|"user"|"extra"|"attachment"/.test(JSON.stringify(event)));
 }
 check('actual envelopes retain device/release/anonymous IDs and omit free text, secrets, media and coordinates');
 refuse=true;
 const rejected=nextEvent('app_rejection');
 await page.evaluate(()=>{const error=new Error('PRIVATE_REJECTION_SENTINEL');error.stack='Error: PRIVATE_REJECTION_SENTINEL\n    at check (https://cookgame.shogo0x2e.com/assets/diagnostics-check.js:20:10)';void Promise.reject(error);});
 await rejected;
 await page.locator('[data-action="demo-game"]').click();await page.locator('[data-game="start"]').click();
 await page.locator('[data-game="finish"]').click();await page.locator('main[data-screen="result"]').waitFor();
 assert.ok(!JSON.stringify(envelopes).includes('PRIVATE_'));
 assert.deepEqual(runtimeErrors.filter(message=>!message.includes('PRIVATE_REJECTION_SENTINEL')),[]);
 assert.deepEqual(unexpected,[]);check('an unreachable diagnostics server does not block the game or fallback');
 await writeFile(`${folder}/synthetic-envelope.json`,JSON.stringify(envelopes[0],null,2));
 await writeFile(`${folder}/report.json`,JSON.stringify({checks,eventCodes:events.map(event=>event.tags.diagnostic_code),realDevices:false,realCamera:false,actualSentry:false,unexpected},null,2));
 await context.close();
}finally{await browser.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
