import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyticsEnabled,createFlowAnalytics} from '../src/analytics.ts';

test('GA runs only on the production site outside demo mode',()=>{
  assert.equal(analyticsEnabled('https://cookgame.shogo0x2e.com/'),true);
  for(const url of ['http://localhost:5173/','https://cookgame.shogo0x2e.com/?demo=1','https://cookgame.shogo0x2e.com/legacy.html','https://cookgame.shogo0x2e.com/poc.html','https://cookgame.shogo0x2e.com.evil.test/','http://cookgame.shogo0x2e.com/'])assert.equal(analyticsEnabled(url),false);
});

test('GA screens use fixed names and URLs; repeated renders do not create views',()=>{
  const events:{name:string;parameters:Record<string,string|boolean>}[]=[];
  const analytics=createFlowAnalytics((name,parameters)=>events.push({name,parameters}));
  analytics.screen('intro');analytics.screen('intro');
  analytics.screen('PRIVATE_ID');analytics.screen('parent-survey','PRIVATE_ANSWER');
  analytics.screen('parent-survey','concept');analytics.screen('parent-survey','budget');
  analytics.screen('recipes');analytics.screen('recipes');analytics.screen('recipe');
  const views=events.filter(event=>event.name==='page_view');
  assert.deepEqual(views.map(event=>event.parameters.screen_name),['intro','parent-survey','concept','budget','recipes','recipe']);
  assert.ok(!JSON.stringify(events).includes('PRIVATE_'));
  assert.equal(events.filter(event=>event.name==='recipe_list_view').length,1);
  assert.equal(events.filter(event=>event.name==='recipe_view').length,1);
  analytics.screen('recipes');
  assert.equal(events.filter(event=>event.name==='recipe_list_view').length,2);
});

test('game resumes and repeated delivery acknowledgements count their milestone once',()=>{
  const events:string[]=[];const analytics=createFlowAnalytics(name=>events.push(name));
  analytics.screen('game');analytics.startGame();analytics.startGame();
  analytics.completeSurvey();analytics.completeSurvey();
  assert.deepEqual(events,['page_view','game_start','survey_complete']);
});
