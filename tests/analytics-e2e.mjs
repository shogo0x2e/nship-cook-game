import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createSessionServer} from '../server/server.ts';

// Production origin is routed entirely to an in-memory local server. No answers or events leave this test.
const origin='https://cookgame.shogo0x2e.com';
const app=await createSessionServer({port:0,allowedOrigins:[origin]});await app.listen();
const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({channel:process.env.E2E_BROWSER??'chrome',headless:true});
const checks=[],unexpected=[],errors=[];let tagRequests=0,refuseTag=false,refuseFinal=true;
const folder='test-results/analytics';await mkdir(folder,{recursive:true});
const check=text=>{checks.push(text);console.log(`PASS ${text}`);};
try{
 const local=await browser.newPage();const requests=[];local.on('request',request=>requests.push(request.url()));
 await local.goto(base);await local.locator('main[data-screen="intro"]').waitFor();
 assert.ok(!requests.some(url=>url.includes('googletagmanager.com')));await local.close();
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===origin){
   if(refuseFinal&&request.method()==='PUT'&&request.postDataJSON()?.complete)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic offline save"}'});
   const response=await context.request.fetch(base+url.pathname+url.search,{method:request.method(),data:request.postDataBuffer()??undefined,headers:{...(request.headers()['content-type']?{'Content-Type':request.headers()['content-type']}:{}),...(request.headers().authorization?{Authorization:request.headers().authorization}:{}),Origin:origin}});
   return route.fulfill({response});
  }
  if(url.origin==='https://www.googletagmanager.com'){
   tagRequests++;assert.equal(url.pathname,'/gtag/js');assert.equal(url.searchParams.get('id'),'G-1S85VPLYT6');
   return refuseTag?route.abort('failed'):route.fulfill({contentType:'application/javascript',body:'/* Official tag replaced by a local test stub; inspect its queue. */'});
  }
  if(url.origin==='https://sentry.x2e.me')return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  if(!['blob:','data:'].includes(url.protocol))unexpected.push(request.url());
  return route.abort();
 });
 await context.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Synthetic denial','NotAllowedError');};});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const queue=()=>page.evaluate(()=>Array.from(window.dataLayer??[],args=>Array.from(args)));
 const events=async name=>(await queue()).filter(args=>args[0]==='event'&&args[1]===name);
 await page.goto(`${origin}/?demo=1`);await page.locator('main[data-screen="intro"]').waitFor();
 assert.equal(tagRequests,0);assert.deepEqual(await queue(),[]);
 check('localhost and production demo mode never load GA');
 await page.goto(`${origin}/?private=PRIVATE_QUERY_SENTINEL`);await page.locator('main[data-screen="intro"]').waitFor();
 await page.waitForFunction(()=>window.dataLayer?.length>=4);
 assert.equal(tagRequests,1);assert.equal((await events('page_view')).length,1);
 assert.equal(await page.locator('.experience-flow-title').innerText(),'体験の流れ（3分程度）');
 const csp=(await context.request.get(base)).headers()['content-security-policy'];
 assert.ok(csp.includes('https://www.googletagmanager.com')&&csp.includes('https://region1.google-analytics.com'));
 assert.ok(!csp.includes("'unsafe-inline'")&&!csp.includes('https://*'));
 check('intro loads the configured tag once under the production CSP');
 await page.locator('[name="age"]').fill('16');await page.locator('#participant-form button').click();
 assert.equal((await events('game_start')).length,0);
 await page.evaluate(()=>{
  const mount=window.cookgameRuntime.mountGame;
  window.cookgameRuntime.mountGame=(container,options)=>mount(container,{...options,onFinish:evidence=>{
   for(const id of ['rice','pork','potato'])evidence[id]={offered:1,caught:1};return options.onFinish(evidence);
  }});
 });
 await page.locator('[data-action="start-camera-game"]').click();
 await page.getByText('カメラが許可されていません。大人の人に確認してね。',{exact:true}).waitFor();
 assert.equal((await events('game_start')).length,0);
 await page.locator('[data-action="demo-game"]').click();await page.locator('[data-game="start"]').click();
 assert.equal((await events('game_start')).length,1);
 await page.locator('[data-game="pause"]').click();await page.locator('[data-game="resume"]').click();
 assert.equal((await events('game_start')).length,1);
 await page.locator('[data-game="finish"]').click();
 await page.locator('[data-stage="handoff"]').click();await page.locator('[data-stage="recipes"]').click();
 await page.locator('[data-recipe="nikujaga"]').click();await page.locator('[data-action="show-child"]').click();
 await page.locator('[data-stage="child-survey"]').click();
 for(const question of ['game_fun','help_intent'])await page.locator(`input[name="${question}"][value="6"]`).check();
 await page.locator('[name="playFrequency"][value="daily"]').check();
 await page.locator('[name="comment"]').fill('PRIVATE_CHILD_SENTINEL');await page.locator('#survey-form button[type="submit"]').click();
 await page.locator('[name="employmentStatus"][value="yes"]').check();
 for(const question of ['task_feasibility','continued_use','meal_preparation_ease','child_initiative'])await page.locator(`input[name="${question}"][value="5"]`).check();
 await page.locator('[name="gameplayStatus"][value="smooth"]').check();
 await page.locator('[name="comment"]').fill('PRIVATE_PARENT_SENTINEL');await page.locator('[name="gameplayComment"]').fill('PRIVATE_GAMEPLAY_SENTINEL');
 await page.locator('#survey-form button[type="submit"]').click();await page.locator('[data-action="market-next"]').click();
 await page.locator('[name="budgetKind"][value="free"]').check();await page.locator('[name="interestedFeatures"][value="none"]').check();
 await page.locator('[name="featureComment"]').fill('PRIVATE_FEATURE_SENTINEL');await page.locator('#market-form button[type="submit"]').click();
 await page.locator('[data-action="retry-send"]').waitFor();assert.equal((await events('survey_complete')).length,0);
 refuseFinal=false;await page.locator('[data-action="retry-send"]').click();await page.locator('main[data-screen="done"] .receipt').waitFor();
 assert.equal((await events('survey_complete')).length,1);
 assert.equal((await events('recipe_list_view')).length,1);assert.equal((await events('recipe_view')).length,1);
 const data=await queue(),serialized=JSON.stringify(data),receipt=await page.locator('.receipt strong').innerText();
 const deviceId=await page.evaluate(()=>localStorage.getItem('cookgame-browser-id-v1'));
 assert.ok(!/PRIVATE_|"(?:age|answers|comment|recipeId|selectedIngredients)":/.test(serialized));
 assert.ok(!serialized.includes(receipt)&&!serialized.includes(deviceId));
 for(const args of data.filter(args=>args[0]==='event'))assert.deepEqual(Object.keys(args[2]).sort(),['page_location','page_title','screen_name','send_to']);
 assert.deepEqual(data.find(args=>args[0]==='consent')[2],{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
 const config=data.find(args=>args[0]==='config')[2];assert.equal(config.send_page_view,false);assert.equal(config.allow_google_signals,false);assert.equal(config.allow_ad_personalization_signals,false);
 const defaults=data.find(args=>args[0]==='set')[1];assert.equal(defaults.send_page_view,false);assert.equal(defaults.page_location,origin+'/');
 assert.ok(data.findIndex(args=>args[0]==='set')<data.findIndex(args=>args[0]==='js'),'defaults must precede managed destination initialization');
 check('real game start and acknowledged save count once; failed saves do not count');
 check('survey text, answers, IDs, age and URL parameters are absent from the GA queue');
 await page.screenshot({path:`${folder}/saved.png`});
 const failed=await context.newPage();refuseTag=true;
 await failed.goto(origin);await failed.locator('[name="age"]').fill('16');await failed.locator('#participant-form button').click();
 await failed.locator('main[data-screen="camera"]').waitFor();await failed.close();
 check('blocked analytics does not prevent entering the experience');
 assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
 await writeFile(`${folder}/report.json`,JSON.stringify({checks,events:data.filter(args=>args[0]==='event'),actualGoogle:false,actualProduction:false,unexpected,errors},null,2));
 await context.unrouteAll({behavior:'wait'});await context.close();
}finally{await browser.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
