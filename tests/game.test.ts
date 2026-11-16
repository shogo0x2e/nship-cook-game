import test from 'node:test';
import assert from 'node:assert/strict';
import { basketWidth, caughtAtBasket, freshEvidence, hintIds, lanes, mirroredTorsoX, pairSchedule, recommend } from '../src/game.ts';

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

test('two-choice schedule offers every ingredient equally, on both sides, without repeating a pairing', async () => {
  const { ingredients } = await import('../src/content.ts');
  const ids = ingredients.map(i => i.id);
  for (let seed = 1; seed <= 50; seed++) {
    let state = seed; const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
    const pairs = pairSchedule(ids, 28, random);
    assert.equal(new Set(pairs.map(pair => [...pair].sort().join('+'))).size, 28);
    for (const id of ids) {
      const left = pairs.filter(pair => pair[0] === id).length, right = pairs.filter(pair => pair[1] === id).length;
      assert.equal(left + right, 7);
      assert.ok(Math.abs(left - right) <= 3, `${id} side balance ${left}/${right}`);
    }
    for (let block = 0; block < 28; block += 4) assert.equal(new Set(pairs.slice(block, block + 4).flat()).size, 8);
  }
  const odd = pairSchedule(ids.slice(0, 3), 6);
  for (const id of ids.slice(0, 3)) assert.equal(odd.flat().filter(food => food === id).length, 4);
  assert.deepEqual(pairSchedule(ids.slice(0, 2), 2).map(pair => [...pair].sort()), [['carrot', 'tomato'], ['carrot', 'tomato']]);
  assert.deepEqual(pairSchedule(ids.slice(0, 1), 5), []);
});
test('the basket can reach one lane at a time, never both', () => {
  for (const width of [340, 800, 1240]) {
    const reach = (x: number, basket: number) => caughtAtBasket({ x, previousY: .8, y: .83 }, basket, width);
    for (const lane of lanes) assert.equal(reach(lane, lane), true);
    for (let basket = .09; basket <= .91; basket += .005) assert.equal(reach(lanes[0], basket) && reach(lanes[1], basket), false);
    assert.ok(basketWidth(width) / width < lanes[1] - lanes[0]);
  }
});
