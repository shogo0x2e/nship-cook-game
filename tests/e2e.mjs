import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createSessionServer } from '../server/server.ts';
import { cookingPlans } from '../src/shared.ts';

const app=await createSessionServer({port:0});await app.listen();
const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({channel:process.env.E2E_BROWSER??'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const adultContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const childContext=await browser.newContext({viewport:{width:820,height:1180},hasTouch:true});
const adult=await adultContext.newPage(),child=await childContext.newPage();
const errors=[],unexpected=[],bodies=[],checks=[];
const username=`family_${Date.now()}`,password='poc4';
for(const page of [adult,child]){
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 page.on('request',req=>{if(!req.url().startsWith(base+'/'))unexpected.push(req.url());if(req.method()==='POST'&&!req.url().includes('/api/auth/'))bodies.push(req.postDataJSON());});
}
await child.addInitScript(()=>{Math.random=()=>.5;navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Synthetic denial','NotAllowedError');};});
const click=(page,action)=>page.locator(`[data-action="${action}"]`).click();
const visible=(page,text)=>page.getByText(text,{exact:false}).first().waitFor();
const check=name=>{checks.push(name);console.log(`PASS ${name}`);};
const shot=(page,name)=>page.screenshot({path:`test-results/${name}.png`,fullPage:true});
const layout=async page=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'horizontal overflow');
const login=async page=>{await page.locator('#username').fill(username);await page.locator('#password').fill(password);await page.locator('#auth-form button[type="submit"]').click();};
await mkdir('test-results',{recursive:true});
try{
 await Promise.all([adult.goto(base),child.goto(base)]);
 await shot(adult,'01-login');await layout(adult);
 assert.equal(await adult.locator('#room-code').count(),0);
 await click(child,'toggle-auth');await login(child);await click(child,'role-child');
 await child.locator('[data-action="start-demo"]').waitFor();
 const cookies=await childContext.cookies();assert.ok(cookies.some(cookie=>cookie.name==='cookgame_session'&&cookie.httpOnly&&cookie.sameSite==='Strict'));
 assert.equal(await child.evaluate(()=>Object.values(sessionStorage).some(value=>/token|password/i.test(value))),false);
 check('four-character password registration, HttpOnly session and code-free child screen');
 // Adult has never logged in: starting is entirely child-controlled.
 await click(child,'start-demo');await child.locator('[data-game="start"]').click();
 await child.locator('[data-game="pause"]').click();await child.locator('[data-game="resume"]').click();
 await childContext.setOffline(true);await visible(child,'再接続しています');await child.locator('.game-overlay').waitFor();
 await childContext.setOffline(false);await visible(child,'つながっています');await child.locator('[data-game="resume"]').click();
 await shot(child,'02-child-game');await layout(child);
 await child.getByRole('heading',{name:'食材を、大人に届けたよ！',exact:true}).waitFor({timeout:50000});
 check('child starts and finishes a 30-second game while adult is logged out; pause and reconnect preserve the round');
 await login(adult);await click(adult,'role-adult');await adult.locator('[data-select="egg"]').waitFor();
 assert.ok((await adult.locator('.food-choice small').allTextContents()).some(text=>!text.startsWith('0こ')));
 check('adult logs in later with same family credentials and receives latest actual catches');
 const selected=adult.locator('[data-select="egg"]');await selected.setChecked(!await selected.isChecked());
 await adult.waitForFunction(()=>!document.querySelector('[data-select="egg"]').disabled);
 const chosen=await adult.locator('[data-select="egg"]').isChecked();await adult.reload();await adult.locator('[data-select="egg"]').waitFor();
 assert.equal(await adult.locator('[data-select="egg"]').isChecked(),chosen);await shot(adult,'03-adult-review');
 check('adult role and ingredient adjustment survive reload without entering another code');
 await click(adult,'recipes');await adult.locator('.recipe-details summary').first().click();await adult.locator('[data-action="choose-recipe"]').first().click();
 const firstId=await adult.locator('[data-action="activate-step"]').first().getAttribute('data-step');const recipeId=firstId.slice(0,firstId.lastIndexOf('-'));
 let replayed=false;
 for(const step of cookingPlans[recipeId]){
  await adult.locator(`[data-action="activate-step"][data-step="${step.id}"]`).click();
  if(step.role==='child'){
   await child.getByRole('heading',{name:step.title,exact:true}).waitFor();assert.equal(await adult.locator('[data-action="complete-step"]').count(),0);
   await shot(adult,'04-adult-supervise');await shot(child,'05-child-task');await layout(adult);await layout(child);
   await child.setViewportSize({width:1180,height:820});await layout(child);await shot(child,'06-child-landscape');await child.setViewportSize({width:820,height:1180});
   if(!replayed){
    await click(child,'start-demo');await child.locator('[data-game="start"]').click();await child.locator('[data-game="finish"]').click();
    await child.getByRole('heading',{name:step.title,exact:true}).waitFor();
    await adult.waitForFunction(()=>!document.querySelector('.info-note')?.textContent?.includes('子どもが食材キャッチで遊んでいます'));
    assert.equal(await adult.locator('.step-active h2').innerText(),step.title);
    assert.equal(await adult.locator('.step-complete').count(),1);
    await child.reload();await child.getByRole('heading',{name:step.title,exact:true}).waitFor();
    check('child replay retains chosen recipe and active/completed cooking steps; reload restores current help');replayed=true;
   }
   await click(child,'child-done');await visible(child,'できたを送ったよ');
   await adult.locator(`[data-action="complete-step"][data-step="${step.id}"]`).waitFor();
  }
  await adult.locator(`[data-action="complete-step"][data-step="${step.id}"]`).click();
 }
 await visible(adult,'ふたりで、できました');await visible(child,'いっしょに、できたね');await shot(adult,'07-adult-complete');
 check('all adult/child cooking steps, child report, adult confirmation and completion still synchronize');
 await click(child,'switch-role');await click(child,'role-adult');await visible(child,'ふたりで、できました');await child.reload();await visible(child,'ふたりで、できました');
 await click(child,'switch-role');await click(child,'role-child');await click(child,'logout');await child.locator('#auth-form').waitFor();await login(child);await visible(child,'いっしょに、できたね');
 check('free parent/child role switching, remembered role, logout and re-login');
 await click(child,'start-camera');await child.locator('[data-game="prepare-camera"]').click();await visible(child,'カメラが許可されていません');assert.equal(await child.locator('[data-game="start"]').isDisabled(),true);
 await click(child,'cancel-game');await click(child,'start-demo');await child.locator('[data-game="start"]').click();
 await childContext.setOffline(true);await visible(child,'再接続しています');await child.locator('[data-game="finish"]').click();await visible(child,'送れませんでした');
 await childContext.setOffline(false);await visible(child,'つながっています');await child.locator('[data-game="retry-result"]').click();await visible(child,'いっしょに、できたね');
 await click(adult,'back-review');await adult.locator('[data-select="egg"]').waitFor();
 assert.ok((await adult.locator('.food-choice small').allTextContents()).every(text=>text.startsWith('0こ')));
 check('synthetic camera denial, cancellation, offline result retry and latest-only result replacement');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 for(const body of bodies)assert.ok(!/video|image|landmark|skeleton|data:|base64/i.test(JSON.stringify(body)));
 check('no runtime errors, external app requests or camera/landmark uploads');
 await Promise.all([click(adult,'logout'),click(child,'logout')]);
 await writeFile('test-results/e2e-report.json',JSON.stringify({passed:checks.length,checks,viewports:['390x844','820x1180','1180x820'],realDevices:false,realCamera:false,externalRequests:unexpected.length,runtimeErrors:errors.length},null,2));
}finally{await browser.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
