import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createSessionServer} from '../server/server.ts';

const app=await createSessionServer({port:0});await app.listen();
const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({channel:process.env.E2E_BROWSER??'chrome',headless:true});
const errors=[],external=[],checks=[];
const check=name=>{checks.push(name);console.log(`PASS ${name}`);};
await mkdir('test-results/camera-framing',{recursive:true});
async function openTrial(viewport){
 const page=await browser.newPage({viewport});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(!request.url().startsWith(base+'/')&&!request.url().startsWith('blob:'))external.push(request.url());});
 await page.goto(`${base}/?demo=1`);
 await page.locator('[name="age"]').fill('5');
 await page.locator('#participant-form button').click();
 assert.equal(await page.locator('main button').count(),1);
 await page.getByRole('button',{name:'カメラを起動して、 ゲームを始める',exact:true}).waitFor();
 return page;
}
try{
 const denied=await openTrial({width:390,height:844});
 await denied.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Synthetic denial','NotAllowedError');};});
 await denied.locator('[data-action="start-camera-game"]').click();
 await denied.getByText('カメラが許可されていません。大人の人に確認してね。',{exact:true}).waitFor({timeout:30000});
 assert.equal(await denied.locator('#field').getAttribute('data-phase'),'setup');
 await denied.locator('[data-game="prepare-camera"]').waitFor({state:'visible'});
 await denied.locator('[data-action="demo-game"]').click();
 await denied.locator('[data-game="start"]').click();
 await denied.locator('[data-game="finish"]').click();
 await denied.waitForFunction(()=>document.querySelector('main')?.dataset.screen==='result');
 check('one-button entry, recoverable camera denial and camera-free fallback in the public experience');
 for(const hash of ['', '#game', '#camera']){
  await denied.evaluate(()=>{
   const key='cookgame-experience-v1-demo',saved=JSON.parse(localStorage.getItem(key));
   saved.stage='game';saved.gameInput='camera';saved.gameFinished=false;
   saved.surveys.child.comment='再読み込み後にも保持するテスト回答';
   localStorage.setItem(key,JSON.stringify(saved));
  });
  await denied.goto(`${base}/?demo=1${hash}`);
  await denied.reload();
  await denied.locator('main[data-screen="intro"]').waitFor();
  assert.equal(await denied.locator('#native-game, #camera').count(),0);
  assert.equal(await denied.locator('[name="age"]').inputValue(),'5');
  assert.equal(await denied.evaluate(()=>JSON.parse(localStorage.getItem('cookgame-experience-v1-demo')).surveys.child.comment),'再読み込み後にも保持するテスト回答');
 }
 // A restored history entry is also navigation, not a fresh start-button press.
 await denied.evaluate(()=>{location.hash='game';});
 await denied.waitForFunction(()=>location.hash==='#intro');
 assert.equal(await denied.locator('#native-game').count(),0);
 check('reopening the root, camera/game URLs or game history shows the PoC explanation without starting a camera or losing answers');
 await denied.close();

 for(const [name,viewport] of Object.entries({phone:{width:360,height:800},tablet:{width:820,height:1180},desktop:{width:1440,height:1000}})){
  const page=await openTrial(viewport);
  // Supply synthetic frames only in this test; use the public view and its real finish callback.
  await page.evaluate(async()=>{
   const {mountCameraTrial}=await import('/camera-runtime.js');
   const original=window.cookgameRuntime.mountGame;
   window.cookgameRuntime.mountGame=(container,options)=>options.input==='camera'?mountCameraTrial(container,options.onFinish,true):original(container,options);
  });
  await page.locator('[data-action="start-camera-game"]').click();
  await page.locator('.framing-overlay').waitFor();
  assert.equal(await page.locator('.game-preview-wrap').isVisible(),false);
  assert.equal(await page.locator('#camera').evaluate(video=>getComputedStyle(video).opacity),'1');
  await page.screenshot({path:`test-results/camera-framing/${name}-before.png`,fullPage:true});
  await page.waitForFunction(()=>document.querySelector('#field')?.dataset.phase==='playing');
  assert.equal(await page.locator('.framing-overlay').count(),0);
  const position=await page.evaluate(()=>{
   const field=document.querySelector('#field').getBoundingClientRect();
   const wrap=document.querySelector('.game-preview-wrap'),preview=wrap.getBoundingClientRect();
   const video=wrap.querySelector('video');
   return {right:field.right-preview.right,bottom:field.bottom-preview.bottom,width:preview.width,visible:getComputedStyle(wrap).display!=='none',sameStream:video.srcObject===document.querySelector('#camera').srcObject,fit:getComputedStyle(video).objectFit,overflow:document.documentElement.scrollWidth>innerWidth+1};
  });
  assert.equal(position.visible,true);assert.equal(position.sameStream,true);assert.equal(position.fit,'contain');assert.equal(position.overflow,false);
  assert.ok(position.right>=0&&position.right<=13);assert.ok(position.bottom>=0&&position.bottom<=13);assert.ok(position.width>=100&&position.width<=180);
  await page.screenshot({path:`test-results/camera-framing/${name}-playing.png`,fullPage:true});
  const stream=await page.locator('#camera').evaluateHandle(video=>video.srcObject);
  await page.locator('[data-game="finish"]').click();
  await page.waitForFunction(()=>document.querySelector('main')?.dataset.screen==='result');
  assert.equal(await stream.evaluate(value=>value.getTracks().every(track=>track.readyState==='ended')),true);
  check(`${name}: large preview, hands-free auto-start, complete-image preview inside lower right, result and camera cleanup`);
  await page.close();
 }
 const slow=await openTrial({width:390,height:844});
 await slow.evaluate(async()=>{
  const {mountCameraTrial}=await import('/camera-runtime.js');
  const profile={intervalMs:330,latencyMs:180,dropEvery:4};window.trackingTestProfile=profile;
  const original=window.cookgameRuntime.mountGame;
  window.cookgameRuntime.mountGame=(container,options)=>options.input==='camera'?mountCameraTrial(container,options.onFinish,true,profile):original(container,options);
 });
 await slow.locator('[data-action="start-camera-game"]').click();
 await slow.waitForFunction(()=>document.querySelector('#field')?.dataset.phase==='playing');
 const feedback=await slow.evaluate(()=>new Promise(resolve=>{
  const started=performance.now();let frames=0,pausedFrames=0,flashes=0;
  const tick=()=>{
   const field=document.querySelector('#field');frames++;
   if(field.dataset.tracked==='false')pausedFrames++;
   if(field.dataset.trackingVisible!=='true'||document.querySelector('#tracking-note').textContent)flashes++;
   if(performance.now()-started<4500)requestAnimationFrame(tick);else resolve({frames,pausedFrames,flashes});
  };requestAnimationFrame(tick);
 }));
 assert.ok(feedback.frames>30);assert.ok(feedback.pausedFrames>0);assert.equal(feedback.flashes,0);
 await slow.screenshot({path:'test-results/camera-framing/slow-inference-stable.png',fullPage:true});
 await slow.evaluate(()=>{window.trackingTestProfile.dropEvery=1;});
 await slow.waitForFunction(()=>document.querySelector('#field')?.dataset.trackingVisible==='false');
 assert.match(await slow.locator('#tracking-note').innerText(),/時間は止まっている/);
 await slow.evaluate(()=>{window.trackingTestProfile.dropEvery=0;});
 await slow.waitForFunction(()=>document.querySelector('#field')?.dataset.tracked==='true');
 assert.equal(await slow.locator('#tracking-note').innerText(),'');
 await slow.locator('[data-game="finish"]').click();await slow.close();
 check('3 fps with inference latency and intermittent misses: controls stop on missing input, feedback stays stable, sustained loss and recovery still work');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile('test-results/camera-framing/report.json',JSON.stringify({checks,realCamera:false,syntheticPose:true,runtimeErrors:errors,externalRequests:external},null,2));
}finally{await browser.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
