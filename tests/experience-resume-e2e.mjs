import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createSessionServer} from '../server/server.ts';

// Isolated in-memory SQLite; this test never contacts production or Google Analytics.
const app=await createSessionServer({port:0});await app.listen();
const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({channel:process.env.E2E_BROWSER??'chrome',headless:true});
const folder='test-results/experience-resume';await mkdir(folder,{recursive:true});
const checks=[],errors=[];
const check=text=>{checks.push(text);console.log(`PASS ${text}`);};
const layout=async page=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'horizontal overflow');
try{
 for(const [name,viewport] of Object.entries({phone:{width:390,height:844},tablet:{width:820,height:1180},desktop:{width:1440,height:1000}})){
  const context=await browser.newContext({viewport,hasTouch:name!=='desktop',isMobile:name!=='desktop'});
  await context.addInitScript(()=>{window.cameraRequests=0;navigator.mediaDevices.getUserMedia=async()=>{window.cameraRequests++;throw new DOMException('Test denial','NotAllowedError');};});
  const packets=[];let rejectFinal=false;
  await context.route('**/api/experiences/*',async route=>{
   const request=route.request();
   if(request.method()==='PUT'){
    packets.push({id:request.url().split('/').at(-1),key:request.headers().authorization.slice(7),payload:request.postDataJSON()});
    if(rejectFinal&&request.postDataJSON().complete)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic interruption"}'});
   }
   await route.continue();
  });
  const open=async()=>{const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());await page.goto(`${base}/?demo=1`);return page;};
  const reopen=async page=>{await page.close({runBeforeUnload:false});const next=await open();await next.locator('[data-action="resume-experience"]').waitFor();assert.equal(await next.evaluate(()=>window.cameraRequests),0);return next;};
  const resume=async page=>{await page.locator('[data-action="resume-experience"]').click();await page.locator('.resume-view').waitFor({state:'detached'});};
  let page=await open();await page.locator('#participant-form').waitFor();assert.equal(await page.locator('.resume-view').count(),0);
  await page.locator('[name="age"]').fill('16');await page.locator('#participant-form button').click();
  const id=await page.locator('main').getAttribute('data-experience-id');
  // Camera preparation, then actual game navigation without starting the camera.
  await page.evaluate(()=>{location.hash='game';});await page.locator('main[data-screen="intro"]').waitFor();
  await page.locator('#participant-form button').click();await page.locator('[data-action="start-camera-game"]').click();
  await page.locator('main[data-screen="game"]').waitFor();
  page=await reopen(page);await resume(page);await page.locator('main[data-screen="camera"]').waitFor();
  assert.equal(await page.evaluate(()=>window.cameraRequests),0,'resuming an interrupted game never activates the camera');
  assert.equal(await page.locator('main').getAttribute('data-experience-id'),id);
  await page.locator('[data-action="start-camera-game"]').click();
  await page.locator(`${viewport.height>viewport.width?'.landscape-notice':'.game-navigation'} [data-action="skip-game"]`).click();
  if(await page.locator('[data-stage="handoff"]').count())await page.locator('[data-stage="handoff"]').click();
  await page.locator('[data-stage="recipes"]').click();await page.locator('[data-recipe="nikujaga"]').click();
  await page.locator('[data-action="show-child"]').click();await page.locator('[data-stage="child-survey"]').click();
  await page.locator('[name="game_fun"][value="6"]').check();await page.locator('[name="comment"]').fill('入力直後の感想');
  page=await reopen(page);await layout(page);await page.screenshot({path:`${folder}/${name}-prompt.png`,fullPage:true});
  // Opening and closing the prompt does not discard the stored answer.
  page=await reopen(page);await resume(page);await page.locator('#survey-form[data-survey-role="child"]').waitFor();
  assert.equal(await page.locator('[name="game_fun"][value="6"]').isChecked(),true);
  assert.equal(await page.locator('[name="comment"]').inputValue(),'入力直後の感想');
  assert.equal(await page.locator('main').getAttribute('data-experience-id'),id);
  await page.locator('[name="help_intent"][value="5"]').check();await page.locator('[name="playFrequency"][value="daily"]').check();
  await page.locator('#survey-form button[type="submit"]').click();
  await page.locator('[name="employmentStatus"][value="yes"]').check();await page.locator('[name="task_feasibility"][value="5"]').check();
  page=await reopen(page);await resume(page);await page.locator('#survey-form[data-survey-role="parent"]').waitFor();
  assert.equal(await page.locator('[name="employmentStatus"][value="yes"]').isChecked(),true);
  assert.equal(await page.locator('[name="task_feasibility"][value="5"]').isChecked(),true);
  for(const question of ['continued_use','meal_preparation_ease','child_initiative'])await page.locator(`[name="${question}"][value="5"]`).check();
  await page.locator('[name="gameplayStatus"][value="not_attempted"]').check();await page.locator('#survey-form button[type="submit"]').click();
  await page.locator('.concept-card').first().waitFor();page=await reopen(page);await resume(page);await page.locator('.concept-card').first().waitFor();
  await page.locator('[data-action="market-next"]').click();
  await page.locator('[name="budgetKind"][value="paid"]').check();await page.locator('[name="maxMonthlyYen"]').fill('500');
  await page.locator('[name="interestedFeatures"][value="game_recipe"]').check();await page.locator('[name="featureComment"]').fill('料金の画面でも復元');
  page=await reopen(page);await resume(page);await page.locator('#market-form').waitFor();
  assert.equal(await page.locator('[name="maxMonthlyYen"]').inputValue(),'500');assert.equal(await page.locator('[name="featureComment"]').inputValue(),'料金の画面でも復元');
  assert.equal(await page.locator('[name="interestedFeatures"][value="game_recipe"]').isChecked(),true);
  if(name==='phone')rejectFinal=true;
  await page.locator('#market-form button[type="submit"]').click();
  if(name==='phone'){
   await page.locator('[data-action="retry-send"]').waitFor();
   page=await reopen(page);rejectFinal=false;await resume(page);
  }
  await page.locator('main[data-screen="done"] .receipt').waitFor();
  const receipt=await page.locator('.receipt strong').innerText();assert.equal(receipt,id);
  const packet=packets.findLast(p=>p.payload.complete&&p.id===id);assert.ok(packet);
  const response=await context.request.get(`${base}/api/experiences/${id}`,{headers:{Authorization:`Bearer ${packet.key}`}});
  const stored=await response.json();assert.equal(stored.complete,true);assert.equal(stored.payload.child.comment,'入力直後の感想');assert.equal(stored.payload.payment.maxMonthlyYen,500);
  assert.equal(app.experiences.db.prepare('SELECT count(*) n FROM experience_responses WHERE id=?').get(id).n,1);
  await page.reload();await page.locator('#participant-form').waitFor();assert.equal(await page.locator('.resume-view').count(),0,'completed answers are not offered for resume');
  await page.locator('[name="age"]').fill('5');await page.locator('#participant-form button').click();
  const abandonedId=await page.locator('main').getAttribute('data-experience-id');assert.notEqual(abandonedId,id);
  page=await reopen(page);await page.locator('[data-action="reset"]').click();await page.locator('#participant-form').waitFor();
  assert.equal(await page.locator('[name="age"]').inputValue(),'');
  const newId=await page.locator('main').getAttribute('data-experience-id');assert.notEqual(newId,abandonedId);assert.notEqual(newId,id);
  await page.reload();await page.locator('#participant-form').waitFor();assert.equal(await page.locator('.resume-view').count(),0);
  await context.unrouteAll({behavior:'wait'});await context.close();
  check(`${name}: closed-tab restore of child/parent/concept/budget, same answer ID, restart, completed exclusion${name==='phone'?', interrupted submission retry':''}`);
 }
 assert.deepEqual(errors,[]);
 await writeFile(`${folder}/report.json`,JSON.stringify({checks,errors,actualProduction:false,realDevices:false},null,2));
}finally{await browser.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
