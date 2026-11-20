import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import data from '../src/experience-data.json' with {type:'json'};
import { experienceFoodIds, experienceRecipeIds } from '../src/experience-protocol.ts';
import { rolePairSchedule, type IngredientId } from '../src/game.ts';
import { experienceIngredients } from '../src/content.ts';
test('all 13 selected foods lead to real daily recipes with an illustrated, fixed child task',()=>{
 assert.deepEqual(data.foods.map(f=>f.id),[...experienceFoodIds]);
 assert.deepEqual(data.recipes.map(r=>r.id),[...experienceRecipeIds]);
 assert.deepEqual(new Set(experienceIngredients.map(f=>f.id)),new Set(experienceFoodIds));
 for(const food of data.foods) assert.ok(data.recipes.filter(r=>r.match.includes(food.id)).length>=2,food.id);
 for(const recipe of data.recipes){
  assert.ok(recipe.source.startsWith('https://'));assert.ok(recipe.materials.length>=3);
  assert.equal(recipe.tasks.length,1);assert.equal(recipe.childTaskId,recipe.tasks[0].id);
  assert.ok(recipe.steps.some(s=>s.task===recipe.childTaskId));
  assert.ok(existsSync(`public${recipe.image}`),recipe.image);
  assert.ok(existsSync(`public${recipe.tasks[0].photo}`),recipe.tasks[0].photo);
 }
});
test('pairing compares the same meal role and offers all foods within the first nine pairs',()=>{
 const groups=['staple','protein','vegetable'].map(role=>data.foods.filter(f=>f.group===role).map(f=>f.id as IngredientId));
 for(let seed=1;seed<50;seed++){
  let state=seed;const random=()=> (state=state*16807%2147483647)/2147483647;
  const schedule=rolePairSchedule(groups,20,random);assert.equal(schedule.length,20);
  for(const [a,b]of schedule){assert.notEqual(a,b);assert.ok(groups.some(g=>g.includes(a)&&g.includes(b)));}
  assert.equal(new Set(schedule.slice(0,9).flat()).size,13);
 }
});
