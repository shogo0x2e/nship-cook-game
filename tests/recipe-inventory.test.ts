import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,statSync} from 'node:fs';
import data from '../src/experience-data.json' with {type:'json'};
import stock from '../design/recipe-prototype/stock-data.json' with {type:'json'};
import photos from '../design/recipe-prototype/flow-photo-data.json' with {type:'json'};
import {inventoryVersion} from '../src/experience-protocol.ts';
// @ts-expect-error The stock selection helper is shared with the HTML prototype.
import {inventorySelection,defaultStock,foodStockKeys} from '../design/recipe-prototype/inventory.js';

test('household stock covers every recipe material and seasoning, including grouped source lines',()=>{
 assert.equal(stock.version,inventoryVersion);
 for(const recipe of data.recipes){
  const rows=stock.recipeMaterials[recipe.id as keyof typeof stock.recipeMaterials];
  assert.ok(rows.length>0,recipe.id);
  assert.deepEqual([...new Set(rows.flatMap(row=>row.source))].sort((a,b)=>a-b),recipe.materials.map((_,i)=>i),recipe.id);
  for(const row of rows){assert.ok(row.key in stock.items,row.key);assert.ok(row.name&&row.amount,recipe.id);}
 }
 // The sample can make nikujaga, while yakisoba genuinely needs bean sprouts.
 const present=new Set(Object.entries(stock.items).filter(([,item])=>item.present).map(([key])=>key));
 assert.equal(stock.recipeMaterials.nikujaga.filter(row=>!present.has(row.key)).length,0);
 assert.deepEqual(stock.recipeMaterials.yakisoba.filter(row=>!present.has(row.key)).map(row=>row.key),['sprouts']);
});

test('the combined stock panel only highlights selected foods that are present, with other stock kept separate',()=>{
 const result=inventorySelection(['pork','pork','noodles','salmon','tomato','bread']);
 assert.deepEqual(result.availableFoodIds,['pork','noodles','bread']);
 assert.deepEqual(result.missingFoodIds,['salmon','tomato']);
 const selectedKeys=new Set(result.availableFoodIds.flatMap((id:string)=>foodStockKeys[id]));
 assert.ok(result.otherItems.every(([key]:[string,unknown])=>defaultStock.has(key)&&!selectedKeys.has(key)));
 assert.ok(result.otherItems.some(([key]:[string,unknown])=>key==='potato'));
 assert.ok(result.otherItems.some(([key]:[string,unknown])=>key==='soy'));
 assert.ok(!result.otherItems.some(([key]:[string,unknown])=>key==='water'));
 const none=inventorySelection([]);assert.equal(none.availableFoodIds.length,0);assert.equal(none.otherItems.length,33);
});
test('every displayed adult step has an optimized photo and child steps keep their existing task photo',()=>{
 for(const recipe of data.recipes){
  const mapping=photos.recipes[recipe.id as keyof typeof photos.recipes] as Record<string,{photo:string;photoAlt:string}>;
  const adultTitles=['先に準備する',...recipe.steps.filter(step=>step.task!==recipe.childTaskId).map(step=>step.title)];
  assert.deepEqual(Object.keys(mapping),adultTitles,recipe.id);
  for(const row of Object.values(mapping)){
   assert.ok(row.photoAlt,recipe.id);assert.ok(row.photo.endsWith('.webp'));
   assert.ok(existsSync(`public${row.photo}`),row.photo);
   assert.ok(statSync(`public${row.photo}`).size<200_000,row.photo);
  }
  assert.ok(existsSync(`public${recipe.tasks[0].photo}`),recipe.id);
 }
});
