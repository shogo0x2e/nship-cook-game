import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createSessionServer} from '../server/server.ts';
import data from '../src/experience-data.json' with {type:'json'};
import {inventoryVersion} from '../src/experience-protocol.ts';
import {features} from '../design/recipe-prototype/market.js';

const app=await createSessionServer({port:0});await app.listen();
const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({channel:process.env.E2E_BROWSER??'chrome',headless:true});
const errors=[],failedAssets=[],checks=[];
const folder='test-results/recipe-flow';await mkdir(folder,{recursive:true});
const layout=async page=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'horizontal overflow');
try{
 for(const [name,viewport] of Object.entries({phone:{width:360,height:800},tablet:{width:820,height:1180},desktop:{width:1440,height:1000}})){
  const context=await browser.newContext({viewport,hasTouch:name!=='desktop',isMobile:name!=='desktop'});const page=await context.newPage();page.setDefaultTimeout(15000);
  const packets=[];let leaveWarnings=0,rejectLeave=false;
  page.on('request',request=>{if(request.method()==='PUT'&&request.url().includes('/api/experiences/'))packets.push({id:request.url().split('/').at(-1),key:request.headers().authorization.slice(7),payload:request.postDataJSON()});});
  page.on('dialog',async dialog=>{assert.equal(dialog.type(),'beforeunload');leaveWarnings++;if(rejectLeave){rejectLeave=false;await dialog.dismiss();}else await dialog.accept();});
  let collidedId=null;
  if(name==='phone')await page.route('**/api/experiences/*',async route=>{if(!collidedId&&route.request().method()==='PUT'){collidedId=route.request().url().split('/').at(-1);await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Experience ID collision'})});}else await route.continue();});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.url().includes('/experience/assets/')&&!response.ok())failedAssets.push(response.url());});
  await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Synthetic denial','NotAllowedError');};});
  await page.goto(`${base}/?demo=1`);
  await page.locator('main[data-screen="intro"]').waitFor();await layout(page);
  const title='食材選びから始める、共働き家庭の親子のごはんづくり';
  assert.equal(await page.title(),title);assert.equal(await page.locator('meta[property="og:title"]').getAttribute('content'),title);
  const introText=await page.locator('body').innerText();
  assert.equal((introText.match(/保護者の方へ/g)||[]).length,1);
  assert.ok(!/もぐもぐキャッチ|PoC|食べたい気持ちを/.test(introText));
  assert.equal(await page.locator('.app-footer').textContent(),'芝浦工業大学 ビジネスコンテスト チーム芝（北田、宮尾、岡部）');
  assert.equal(await page.locator('main #username').count(),0);
  assert.equal(await page.locator('.completion-contact').count(),1);assert.equal(await page.locator('.receipt').count(),0);
  assert.match(await page.locator('.completion-contact').innerText(),/代表：北田 章伍（修士1年）/);
  assert.ok(!(await page.locator('a[href^="mailto:"]').getAttribute('href')).includes('%E5%8F%97%E4%BB%98ID'));
  assert.equal(await page.locator('h1.intro-title').innerText().then(text=>text.replaceAll('\n','')),title);
  assert.equal(await page.locator('.experience-steps>li').count(),3);
  await page.screenshot({path:`${folder}/${name}-intro.png`,fullPage:true});
  await page.locator('[name="age"]').fill(name==='phone'?'5':'16');
  await page.locator('#participant-form button').click();
  const firstId=await page.locator('main').getAttribute('data-experience-id');
  assert.match(firstId,/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  if(name==='desktop'){
   await page.goBack();await page.locator('main[data-screen="intro"]').waitFor();
   await page.locator('[name="age"]').fill('17');await page.locator('#participant-form button').click();
   assert.equal(await page.locator('main').getAttribute('data-experience-id'),firstId);
   rejectLeave=true;const warning=page.waitForEvent('dialog');
   await page.evaluate(()=>{setTimeout(()=>{location.href='/legacy.html';},0);});await warning;
   await page.locator('main[data-screen="camera"]').waitFor();assert.equal(leaveWarnings,1);
   assert.equal(await page.locator('main').getAttribute('data-experience-id'),firstId);
   await page.evaluate(()=>{location.hash='done';});await page.locator('main[data-screen="parent-survey"]').waitFor();
   assert.equal(await page.locator('.receipt').count(),0);
   await page.goBack();await page.locator('main[data-screen="camera"]').waitFor();
  }
  await page.evaluate(()=>{
   const mount=window.cookgameRuntime.mountGame;
   window.cookgameRuntime.mountGame=(container,options)=>mount(container,{...options,onFinish:evidence=>{
    for(const id of ['rice','noodles','bread','pork','salmon','egg','onion','potato','pepper'])evidence[id]={offered:1,caught:1};
    return options.onFinish(evidence);
   }});
  });
  await page.locator('[data-action="start-camera-game"]').click();
  if(viewport.height>viewport.width){
   await page.locator('.landscape-notice').waitFor({state:'visible'});
   await page.setViewportSize({width:viewport.height,height:viewport.width});
  }
  await page.getByText('カメラが許可されていません。大人の人に確認してね。',{exact:true}).waitFor();
  await page.locator('[data-action="demo-game"]').click();
  await page.locator('[data-game="start"]').click();await page.locator('[data-game="finish"]').click();
  if(name==='phone'){
   try{await page.locator('.portrait-return').waitFor();}catch(error){await page.screenshot({path:`${folder}/${name}-failure.png`,fullPage:true});console.log(await page.evaluate(()=>({stage:document.querySelector('main').dataset.screen,width:innerWidth,height:innerHeight,coarse:matchMedia('(any-pointer: coarse)').matches,text:document.querySelector('main').innerText})));throw error;}
   await page.screenshot({path:`${folder}/${name}-return-portrait.png`});
  }else assert.equal(await page.locator('.portrait-return').count(),0);
  await page.setViewportSize(viewport);
  await page.locator('[data-action="go"][data-stage="handoff"]').click();
  await page.locator('[data-action="go"][data-stage="recipes"]').click();
  await page.locator('main[data-screen="recipes"]').waitFor();await layout(page);
  const groupTitles=await page.locator('.inventory-group h2').allTextContents();
  assert.match(await page.locator('main h1').innerText(),/お子さんの好み/);
  assert.deepEqual(groupTitles,['家にあるもので作れる料理','買い足して作る料理']);
  const missingCounts=await page.locator('#inventory-heading-shopping + p').count();assert.equal(missingCounts,1);
  const counts=await page.locator('[aria-labelledby="inventory-heading-shopping"] .inventory-badge').allTextContents();
  const values=counts.map(text=>Number(text.match(/(\d+)品/)[1]));assert.deepEqual(values,[...values].sort((a,b)=>a-b));
  assert.equal(await page.locator('.inventory-source-photo img').count(),2);
  assert.deepEqual(await page.locator('.selected-stock [data-food-id]').evaluateAll(items=>items.map(el=>el.dataset.foodId)),['rice','noodles','pork','egg','onion','potato','pepper']);
  await page.locator('.inventory-summary summary').click();
  assert.ok(await page.locator('.other-stock .food-chip').count()>10);
  assert.equal(await page.locator('.other-stock [data-inventory-key="pork-belly"]').count(),0);
  assert.equal(await page.locator('.selected-missing [data-food-id="salmon"]').count(),1);
  assert.equal(await page.locator('.selected-missing [data-food-id="bread"]').count(),1);
  assert.equal(await page.locator('[aria-labelledby="inventory-heading-available"] [data-recipe-id="egg-sandwich"]').count(),0);
  assert.equal(await page.locator('[aria-labelledby="inventory-heading-shopping"] [data-recipe-id="egg-sandwich"]').count(),1);
  assert.equal(await page.locator('[aria-labelledby="inventory-heading-available"] .inventory-buy-preview').count(),0);
  assert.match(await page.locator('[data-recipe-id="yakisoba"] .inventory-buy-preview').innerText(),/買い足すもの：もやし/);
  for(const image of await page.locator('.inventory-source-photo img').all())await image.evaluate(img=>img.decode());
  await page.locator('.inventory-summary summary').click();
  assert.ok(await page.locator('.inventory-groups').evaluate(el=>el.children[1].getBoundingClientRect().top>=el.children[0].getBoundingClientRect().bottom));
  for(const group of await page.locator('.inventory-cards').all()){
   const cards=await group.locator('.inventory-card').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect(),b=card.querySelector('.primary').getBoundingClientRect();return{top:r.top,height:r.height,bottom:b.bottom};}));
   for(let i=1;i<cards.length;i++)if(Math.abs(cards[i].top-cards[i-1].top)<1){assert.ok(Math.abs(cards[i].height-cards[i-1].height)<1);assert.ok(Math.abs(cards[i].bottom-cards[i-1].bottom)<1);}
  }
  await page.screenshot({path:`${folder}/${name}-recipes.png`,fullPage:true});
  await page.locator('.inventory-source').screenshot({path:`${folder}/${name}-stock-panel.png`});
  for(const recipe of data.recipes){
   await page.locator(`[data-action="open-recipe"][data-recipe="${recipe.id}"]`).click();
   await page.locator('main[data-screen="recipe"]').waitFor();
   assert.equal(await page.getByText(recipe.timeNote,{exact:true}).count(),0);
   assert.equal(await page.getByText(recipe.evidence,{exact:true}).count(),0);
   assert.equal(await page.locator('.cooking-overview li').count(),recipe.steps.length+1);
   assert.equal(await page.locator('.cooking-overview li:first-child b').innerText(),'先に準備する');
   assert.equal(await page.locator('.cooking-overview .child-role').count(),1);
   assert.equal(await page.locator('.recipe-child-role,.recipe-description,.inventory-section-title>span').count(),0);
   assert.equal(await page.locator('.recipe-meta').count(),1);
   assert.ok(await page.locator('.photo-credit').evaluate(el=>el.nextElementSibling.classList.contains('sticky-action')&&el.previousElementSibling.querySelector('.cooking-overview')));
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
  assert.equal(await page.getByText('いまは みるだけで だいじょうぶだよ。',{exact:true}).count(),0);
  await page.locator('[data-action="go"][data-stage="child-survey"]').click();
  await page.locator('.survey-matrix tbody th').first().waitFor();
  assert.equal(await page.locator('.scale-key').count(),0);
  assert.equal(await page.locator('.survey-matrix tbody th').evaluateAll(rows=>rows.filter(row=>row.textContent.includes('私が幼稚園くらいの年齢だったら')).length),name==='phone'?0:2);
  assert.equal(await page.getByText('子どもの方へ',{exact:true}).count(),0);
  if(name!=='phone')assert.equal(await page.locator('.survey-frame').count(),0);
  await page.screenshot({path:`${folder}/${name}-child-survey.png`,fullPage:true});
  for(const question of ['game_fun','help_intent'])await page.locator(`input[name="${question}"][value="6"]`).check();
  assert.equal(await page.locator('input[name="playFrequency"]').count(),6);
  assert.equal(await page.locator('.play-frequency-question h2').innerText(),name==='phone'?'3てを うごかして たべものを えらぶ ゲームで、このくらい あそぶと おもう。':'3私が幼稚園くらいの年齢だったら、このくらいの頻度で「手の動きで食材を選ぶゲーム」をすると思う。');
  assert.equal(await page.locator('.play-frequency-options label:last-child span').innerText(),name==='phone'?'あそばないと おもう':'遊ばないと思う');
  await page.locator('#survey-form button[type="submit"]').click();
  assert.equal(await page.locator('main').getAttribute('data-screen'),'child-survey');
  assert.equal(await page.locator('.play-frequency-question.is-missing').count(),1);
  const playFrequency=name==='phone'?'daily':name==='tablet'?'two_to_three_days':'never';
  await page.locator(`input[name="playFrequency"][value="${playFrequency}"]`).check();
  await page.locator('.play-frequency-question').screenshot({path:`${folder}/${name}-play-frequency.png`});
  await page.locator('textarea[name="comment"]').fill(`demo ${name} child`);
  await layout(page);await page.locator('#survey-form button[type="submit"]').click();
  assert.equal(await page.locator('.employment-question h2').innerText(),'現在、あなたと配偶者・パートナーは、どちらも仕事をしていますか。');
  assert.match(await page.locator('.employment-question').innerText(),/育児休業中も含みます/);
  assert.equal(await page.locator('.scale-key').count(),0);
  for(const question of ['task_feasibility','continued_use','meal_preparation_ease','child_initiative'])await page.locator(`input[name="${question}"][value="5"]`).check();
  await page.locator('input[name="gameplayStatus"][value="issues_completed"]').check();
  const employmentStatus=name==='phone'?'yes':name==='tablet'?'no':'prefer_not';
  await page.locator(`input[name="employmentStatus"][value="${employmentStatus}"]`).check();
  await page.locator('textarea[name="comment"]').fill(`demo ${name} parent`);
  await page.locator('textarea[name="gameplayComment"]').fill(`demo ${name} gameplay`);
  assert.equal(await page.getByText('このアプリを、日々の食事づくりで使いたいと思う。',{exact:false}).count(),1);
  await page.screenshot({path:`${folder}/${name}-parent-survey.png`,fullPage:true});
  await layout(page);await page.locator('#survey-form button[type="submit"]').click();
  await page.locator('.concept-card').first().waitFor();assert.equal(await page.locator('.concept-card').count(),5);await layout(page);
  assert.deepEqual(await page.locator('.concept-card h2').allTextContents(),features.map(feature=>feature.title));
  assert.equal(await page.getByText('画像は構想を伝えるための生成イメージです。',{exact:true}).count(),0);
  await page.screenshot({path:`${folder}/${name}-concept.png`,fullPage:true});
  await page.locator('[data-action="market-next"]').click();
  for(const feature of features)assert.equal(await page.locator(`[name="interestedFeatures"][value="${feature.id}"]+span`).textContent(),feature.title);
  await page.locator('input[name="budgetKind"][value="free"]').check();
  await page.locator('#market-form button[type="submit"]').click();
  assert.match(await page.locator('#market-error').innerText(),/気になる機能/);
  await page.locator('[name="interestedFeatures"][value="none"]').check();
  await page.locator('[name="interestedFeatures"][value="food_learning"]').check();
  assert.equal(await page.locator('[name="interestedFeatures"][value="none"]').isChecked(),false);
  await page.locator('[name="interestedFeatures"][value="game_recipe"]').check();
  await page.locator('[name="featureComment"]').fill(`demo ${name} features`);
  await page.goBack();await page.locator('.concept-card').first().waitFor();
  await page.goForward();await page.locator('#market-form').waitFor();
  assert.equal(await page.locator('[name="interestedFeatures"][value="food_learning"]').isChecked(),true);
  assert.equal(await page.locator('[name="featureComment"]').inputValue(),`demo ${name} features`);
  await layout(page);
  await page.screenshot({path:`${folder}/${name}-budget.png`,fullPage:true});
  if(name==='phone')await context.setOffline(true);
  await page.locator('#market-form button[type="submit"]').click();
  if(name==='phone'){
   await page.locator('[data-action="retry-send"]').waitFor();
   await context.setOffline(false);
  }
  await page.locator('main[data-screen="done"] .receipt').waitFor();await layout(page);
  const receipt=await page.locator('.receipt strong').innerText();assert.match(receipt,/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  const stored=packets.findLast(p=>p.payload.complete);assert.equal(stored.id,receipt);
  if(name==='phone')assert.notEqual(receipt,collidedId);
  const response=await context.request.get(`${base}/api/experiences/${stored.id}`,{headers:{Authorization:`Bearer ${stored.key}`}});
  assert.equal(response.status(),200);const record=await response.json();
  assert.equal(record.complete,true);assert.equal(record.payload.inventoryVersion,inventoryVersion);assert.equal(record.payload.demo,true);
  assert.equal(record.payload.recipeId,'nikujaga');assert.equal(record.payload.child.comment,`demo ${name} child`);assert.equal(record.payload.parent.answers.continued_use,5);
  assert.equal(record.payload.questionnaireVersion,'poc-2026-11-19-v5');assert.equal(record.payload.parent.answers.meal_preparation_ease,5);assert.equal(record.payload.parent.answers.child_initiative,5);assert.equal(record.payload.parent.gameplayStatus,'issues_completed');assert.equal(record.payload.gameInput,'demo');
  assert.equal(record.payload.child.playFrequency,playFrequency);assert.equal(record.payload.child.answers.daily_feasibility,undefined);assert.equal(record.payload.parent.employmentStatus,employmentStatus);assert.equal(record.payload.parent.gameplayComment,`demo ${name} gameplay`);assert.deepEqual(record.payload.serviceFeedback,{interestedFeatures:['game_recipe','food_learning'],comment:`demo ${name} features`});
  const browserId=await page.evaluate(()=>localStorage.getItem('cookgame-browser-id-v1'));assert.equal(record.payload.deviceId,browserId);
  const receiptStyle=await page.locator('.receipt strong').evaluate(el=>({font:getComputedStyle(el).fontFamily,size:parseFloat(getComputedStyle(el).fontSize),align:getComputedStyle(el).textAlign}));
  assert.match(receiptStyle.font,/monospace/);assert.ok(receiptStyle.size>=12&&receiptStyle.size<=18);assert.equal(receiptStyle.align,'left');
  assert.match(decodeURIComponent(await page.locator('a[href^="mailto:"]').getAttribute('href')),new RegExp(receipt));
  assert.equal(await page.getByText('新しい体験を始める',{exact:true}).count(),0);
  await page.screenshot({path:`${folder}/${name}-saved.png`});
  const before=leaveWarnings;await page.reload();await page.locator('main[data-screen="intro"]').waitFor();
  assert.equal(leaveWarnings,before);assert.notEqual(await page.locator('main').getAttribute('data-experience-id'),receipt);
  assert.equal(await page.locator('[name="age"]').inputValue(),'');assert.equal(await page.evaluate(()=>localStorage.getItem('cookgame-browser-id-v1')),browserId);
  checks.push(`${name}: 12 recipes, all illustrated steps, stock groups/materials, survey and server receipt${name==='phone'?', offline retry':''}`);
  console.log(`PASS ${checks.at(-1)}`);await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failedAssets,[]);
 await writeFile(`${folder}/report.json`,JSON.stringify({checks,realDevices:false,realCamera:false,errors,failedAssets},null,2));
}finally{await browser.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
