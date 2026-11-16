import test from 'node:test';
import assert from 'node:assert/strict';
import { caughtAtBasket, freshEvidence, hintIds, mirroredTorsoX, recommend } from '../src/game.ts';

test('catch uses swept collision even when a frame skips the line', () => {
  assert.equal(caughtAtBasket({ x: .5, previousY: .79, y: .9 }, .5), true);
  assert.equal(caughtAtBasket({ x: .8, previousY: .79, y: .9 }, .5), false);
  assert.equal(caughtAtBasket({ x: .5, previousY: .85, y: .9 }, .5), false);
});
test('only actual catches become a tentative hint; misses are not dislikes', () => {
  const evidence = freshEvidence(); evidence.tomato = { offered: 4, caught: 2 }; evidence.corn = { offered: 2, caught: 2 };
  assert.deepEqual(hintIds(evidence), ['corn', 'tomato']);
  assert.deepEqual(hintIds(freshEvidence()), []);
});
test('pose is mirrored and low confidence pauses control', () => {
  const points = Array.from({ length: 33 }, () => ({ x: .25, visibility: 1 }));
  assert.equal(mirroredTorsoX(points), .75);
  points[11].visibility = .2; assert.equal(mirroredTorsoX(points), null);
  assert.equal(mirroredTorsoX([]), null);
});
test('allergy and food exclusions are hard filters, even for favorites', () => {
  for (const recipe of recommend(['egg', 'cheese'], new Set(['potato']), new Set(['卵', '乳']))) {
    assert.equal(recipe.foods.includes('potato'), false);
    assert.equal(recipe.allergens.length, 0);
  }
  assert.deepEqual(recommend([], new Set(['potato', 'carrot', 'egg']), new Set()), []);
});
test('matching ingredients ranks suggestions without inventing a preference', () => {
  assert.equal(recommend(['egg', 'cheese', 'corn'], new Set(), new Set())[0].id, 'omelet');
  assert.equal(recommend([], new Set(), new Set()).length, 3);
});

test('all registered content has unique ids, known ingredients and both roles', async () => {
  const { ingredients, recipes } = await import('../src/content.ts');
  const ids = new Set(ingredients.map(i => i.id));
  assert.equal(ids.size, ingredients.length);
  assert.equal(new Set(recipes.map(r => r.id)).size, recipes.length);
  for (const recipe of recipes) {
    assert.ok(recipe.child.length && recipe.adult.length && recipe.materials.length);
    for (const food of recipe.foods) {
      assert.ok(ids.has(food));
      for (const allergen of ingredients.find(i => i.id === food)!.allergens) assert.ok(recipe.allergens.includes(allergen));
    }
  }
});

test('wide-layout collisions follow the visible basket, not a fixed viewport percentage', () => {
  assert.equal(caughtAtBasket({ x: .61, previousY: .79, y: .9 }, .5, 1048), false);
  assert.equal(caughtAtBasket({ x: .59, previousY: .79, y: .9 }, .5, 1048), true);
});
