import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createSessionServer} from '../server/server.ts';
import data from '../src/experience-data.json' with {type:'json'};
import {inventoryVersion} from '../src/experience-protocol.ts';

const app=await createSessionServer({port:0});await app.listen();
const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({channel:process.env.E2E_BROWSER??'chrome',headless:true});
const errors=[],failedAssets=[],checks=[];
const folder='test-results/recipe-flow';await mkdir(folder,{recursive:true});
const layout=async page=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'horizontal overflow');
try{
 for(const [name,viewport] of Object.entries({phone:{width:360,height:800},tablet:{width:820,height:1180},desktop:{width:1440,height:1000}})){
  const context=await browser.newContext({viewport});const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.url().includes('/experience/assets/')&&!response.ok())failedAssets.push(response.url());});
  await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Synthetic denial','NotAllowedError');};});
  await page.goto(`${base}/?demo=1`);
  await page.locator('main[data-screen="intro"]').waitFor();await layout(page);
  assert.equal(await page.locator('main #username').count(),0);
  await page.locator('[name="age"]').fill(name==='phone'?'5':'16');
  await page.locator('#participant-form button').click();
  await page.locator('[data-action="start-camera-game"]').click();
  await page.locator('[data-action="demo-game"]').click();
  await page.locator('[data-game="start"]').click();await page.locator('[data-game="finish"]').click();
  await page.locator('[data-action="go"][data-stage="handoff"]').click();
  await page.locator('[data-action="go"][data-stage="recipes"]').click();
  await page.locator('main[data-screen="recipes"]').waitFor();await layout(page);
  const groupTitles=await page.locator('.inventory-group h2').allTextContents();
  assert.deepEqual(groupTitles,['家にあるもので作れる料理','買い足して作る料理']);
  assert.ok(await page.locator('.inventory-source-photo img').evaluate(img=>img.complete&&img.naturalWidth>0));
  assert.ok(await page.locator('.inventory-groups').evaluate(el=>el.children[1].getBoundingClientRect().top>=el.children[0].getBoundingClientRect().bottom));
  for(const group of await page.locator('.inventory-cards').all()){
   const cards=await group.locator('.inventory-card').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect(),b=card.querySelector('.primary').getBoundingClientRect();return{top:r.top,height:r.height,bottom:b.bottom};}));
   for(let i=1;i<cards.length;i++)if(Math.abs(cards[i].top-cards[i-1].top)<1){assert.ok(Math.abs(cards[i].height-cards[i-1].height)<1);assert.ok(Math.abs(cards[i].bottom-cards[i-1].bottom)<1);}
  }
  await page.screenshot({path:`${folder}/${name}-recipes.png`,fullPage:true});
  for(const recipe of data.recipes){
   await page.locator(`[data-action="open-recipe"][data-recipe="${recipe.id}"]`).click();
   await page.locator('main[data-screen="recipe"]').waitFor();
   assert.equal(await page.locator('.cooking-overview li').count(),recipe.steps.length+1);
   assert.equal(await page.locator('.cooking-overview li:first-child b').innerText(),'先に準備する');
   assert.equal(await page.locator('.cooking-overview .child-role').count(),1);
   assert.equal(await page.locator('.cooking-overview img').count(),recipe.steps.length+1);
   for(const photo of await page.locator('.cooking-overview img').all()){
    await photo.scrollIntoViewIfNeeded();await photo.evaluate(img=>img.decode());
    assert.ok(await photo.evaluate(img=>img.naturalWidth>0&&img.getBoundingClientRect().width>=180));
   }
   await layout(page);
   if(recipe.id==='curry'){
    await page.getByRole('heading',{name:'料理の流れ',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:`${folder}/${name}-curry-flow.png`});
   }
   await page.locator('[data-action="go"][data-stage="recipes"]').click();
  }
  await page.locator('[data-action="open-recipe"][data-recipe="nikujaga"]').click();
  await page.locator('[data-action="show-child"]').click();await layout(page);
  assert.equal(await page.locator('.task-figure figcaption').count(),0);
  await page.locator('[data-action="go"][data-stage="child-survey"]').click();
  for(const question of ['game_fun','help_intent','daily_feasibility'])await page.locator(`input[name="${question}"][value="6"]`).check();
  await page.locator('textarea[name="comment"]').fill(`demo ${name} child`);
  await layout(page);await page.locator('#survey-form button[type="submit"]').click();
  for(const question of ['task_feasibility','continued_use'])await page.locator(`input[name="${question}"][value="5"]`).check();
  await page.locator('textarea[name="comment"]').fill(`demo ${name} parent`);
  await layout(page);await page.locator('#survey-form button[type="submit"]').click();
  assert.equal(await page.locator('.concept-card').count(),5);await layout(page);
  await page.locator('[data-action="market-next"]').click();
  await page.locator('input[name="budgetKind"][value="free"]').check();
  await layout(page);
  if(name==='phone')await context.setOffline(true);
  await page.locator('#market-form button[type="submit"]').click();
  if(name==='phone'){
   await page.locator('[data-action="retry-send"]').waitFor();
   await context.setOffline(false);
  }
  await page.locator('main[data-screen="done"] .receipt').waitFor();await layout(page);
  const receipt=await page.locator('.receipt').innerText();assert.match(receipt,/MG-/);
  const stored=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('cookgame-experience-v1-demo'));return{id:s.sessionId,key:s.key};});
  const response=await context.request.get(`${base}/api/experiences/${stored.id}`,{headers:{Authorization:`Bearer ${stored.key}`}});
  assert.equal(response.status(),200);const record=await response.json();
  assert.equal(record.complete,true);assert.equal(record.payload.inventoryVersion,inventoryVersion);assert.equal(record.payload.demo,true);
  assert.equal(record.payload.recipeId,'nikujaga');assert.equal(record.payload.child.comment,`demo ${name} child`);assert.equal(record.payload.parent.answers.continued_use,5);
  await page.reload();await page.locator('main[data-screen="done"] .receipt').waitFor();assert.equal(await page.locator('.receipt').innerText(),receipt);
  await page.screenshot({path:`${folder}/${name}-saved.png`});
  checks.push(`${name}: 12 recipes, all illustrated steps, stock groups/materials, survey and server receipt${name==='phone'?', offline retry':''}`);
  console.log(`PASS ${checks.at(-1)}`);await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failedAssets,[]);
 await writeFile(`${folder}/report.json`,JSON.stringify({checks,realDevices:false,realCamera:false,errors,failedAssets},null,2));
}finally{await browser.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
