import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createSessionServer} from '../server/server.ts';
import {questionnaireVersion,recipeVersion,conceptVersion,inventoryVersion} from '../src/experience-protocol.ts';

// Entirely local fixtures. No production browser identifier or visitor answer is used.
const ids=['7K3M9R','8K3M9R'],devices=[randomUUID(),randomUUID()],keys=ids.map(()=>randomBytes(32).toString('hex'));
const app=await createSessionServer({port:0,legacyRecoveryIds:ids});await app.listen();
const base=`http://127.0.0.1:${app.server.address().port}`;
for(const [index,id]of ids.entries())app.experiences.save(id,keys[index],{questionnaireVersion,recipeVersion,conceptVersion,inventoryVersion,deviceId:devices[index],sequence:21,age:16,demo:false,stage:index?'parent-survey':'child-survey',selectedIngredients:['rice'],evidence:{rice:{offered:1,caught:1}},recipeId:'nikujaga',child:{answers:{game_fun:6,help_intent:5},playFrequency:index?'daily':null,comment:'legacy saved comment'},parent:{answers:{},comment:'',employmentStatus:null,gameplayStatus:null},serviceFeedback:{interestedFeatures:[],comment:''},payment:null,gameInput:'demo',complete:false});
const browser=await chromium.launch({channel:process.env.E2E_BROWSER??'chrome',headless:true});
const folder='test-results/legacy-recovery';await mkdir(folder,{recursive:true});const checks=[],errors=[];
const check=text=>{checks.push(text);console.log(`PASS ${text}`);};
try{
 const stranger=await browser.newPage();await stranger.addInitScript(id=>localStorage.setItem('cookgame-browser-id-v1',id),randomUUID());await stranger.goto(base);await stranger.locator('#participant-form button:not([disabled])').waitFor();assert.equal(await stranger.locator('.resume-dialog').count(),0);await stranger.close();check('a different browser identifier does not receive either candidate');
 const declined=await browser.newContext();await declined.addInitScript(id=>localStorage.setItem('cookgame-browser-id-v1',id),devices[0]);
 const start=await declined.newPage();await start.goto(base);await start.locator('[data-action="reset"]').click();await start.reload();await start.locator('#participant-form button:not([disabled])').waitFor();assert.equal(await start.locator('.resume-dialog').count(),0);assert.equal(app.experiences.db.prepare('SELECT count(*) n FROM experience_recovery_keys').get().n,0);await declined.close();check('choosing a new experience neither claims nor changes the old answer and suppresses repeated offers');
 for(const [index,id]of ids.entries()){
  const context=await browser.newContext({viewport:index?{width:1440,height:1000}:{width:390,height:844},hasTouch:!index,isMobile:!index});
  await context.addInitScript(deviceId=>{localStorage.setItem('cookgame-browser-id-v1',deviceId);navigator.mediaDevices.getUserMedia=async()=>{throw new Error('Camera must not start while restoring a survey');};},devices[index]);
  let loseClaim=index===1;
  await context.route('**/api/experience-recovery/claim',async route=>{const response=await route.fetch();if(loseClaim){loseClaim=false;await route.abort('failed');}else await route.fulfill({response});});
  const open=async()=>{const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(base);await page.locator('.resume-dialog').waitFor();return page;};
  let page=await open();assert.equal(app.experiences.db.prepare('SELECT sequence FROM experience_responses WHERE id=?').get(id).sequence,21);
  await page.screenshot({path:`${folder}/${index?'desktop':'phone'}-legacy-prompt.png`});
  if(index){await page.setViewportSize({width:820,height:1180});await page.screenshot({path:`${folder}/tablet-legacy-prompt.png`});await page.setViewportSize({width:1440,height:1000});}
  await page.locator('[data-action="resume-experience"]').click();
  if(index){await page.getByRole('alert').getByText('通信できませんでした。',{exact:false}).waitFor();await page.close();page=await open();await page.locator('[data-action="resume-experience"]').click();}
  await page.locator(`#survey-form[data-survey-role="${index?'parent':'child'}"]`).waitFor();assert.equal(await page.locator('main').getAttribute('data-experience-id'),id);
  if(!index){assert.equal(await page.locator('[name="game_fun"][value="6"]').isChecked(),true);assert.equal(await page.locator('[name="comment"]').inputValue(),'legacy saved comment');await page.locator('[name="playFrequency"][value="daily"]').check();await page.locator('#survey-form button[type="submit"]').click();}
  await page.locator('[name="employmentStatus"][value="yes"]').check();await page.locator('[name="task_feasibility"][value="5"]').check();
  await page.close();page=await open();await page.locator('[data-action="resume-experience"]').click();await page.locator('#survey-form[data-survey-role="parent"]').waitFor();assert.equal(await page.locator('[name="task_feasibility"][value="5"]').isChecked(),true);
  for(const q of ['continued_use','meal_preparation_ease','child_initiative'])await page.locator(`[name="${q}"][value="5"]`).check();
  await page.locator('[name="gameplayStatus"][value="not_attempted"]').check();await page.locator('#survey-form button[type="submit"]').click();await page.locator('[data-action="market-next"]').click();await page.locator('[name="budgetKind"][value="free"]').check();await page.locator('[name="interestedFeatures"][value="none"]').check();await page.locator('#market-form button[type="submit"]').click();await page.locator('.receipt').waitFor();
  assert.equal(await page.locator('.receipt strong').innerText(),id);assert.equal(app.experiences.get(id,keys[index]).complete,true);assert.equal(app.experiences.db.prepare('SELECT count(*) n FROM experience_responses WHERE id=?').get(id).n,1);
  await page.reload();await page.locator('#participant-form button:not([disabled])').waitFor();assert.equal(await page.locator('.resume-dialog').count(),0);
  await context.unrouteAll({behavior:'wait'});await context.close();check(`${index?'parent':'child'} legacy answer: matching-browser offer, original ID/answers, persistent recovery, completion once${index?', lost claim response retried with its saved key':''}`);
 }
 assert.deepEqual(errors,[]);await writeFile(`${folder}/report.json`,JSON.stringify({checks,errors,actualProduction:false,realDevices:false},null,2));
}finally{await browser.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
