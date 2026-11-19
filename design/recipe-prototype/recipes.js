import data from '../../src/experience-data.json' with { type: 'json' };
import flowPhotos from './flow-photo-data.json' with {type:'json'};
export const foods = data.foods;
export const recipes = data.recipes;
export const recipeVersion = data.recipeVersion;
export const taskBasis = { name: 'PoC用に設計した分担', url: 'https://www.kewpie.co.jp/kids_yasai/challenge-recipe/' };
export const categoryLabels = { 'ごはん':'ごはん', 'めん':'めん', 'パン':'パン', 'おかず':'おかず' };
export const childTaskFor = recipe => recipe.tasks.find(task => task.id === recipe.childTaskId);
const taskFlowDetails = {
 '玉ねぎの皮をむく':'玉ねぎの茶色い皮をゆっくりはがし、むいた皮をボウルに入れます。',
 'じゃがいもを洗う':'ボウルの水でじゃがいもをやさしくこすり、土が落ちたら大人に渡します。',
 '粗熱を取ったご飯をほぐす':'粗熱を取ったご飯をしゃもじでやさしくほぐし、かたまりが小さくなったら大人に渡します。',
 'キャベツをちぎる':'キャベツを食べやすい大きさにちぎり、ボウルに入れます。',
 'しめじを小房に分ける':'しめじを手で少しずつ小房に分け、ボウルに入れます。',
 'ゆで卵をつぶす':'ゆで卵をフォークでやさしくつぶし、小さくなったら大人に見せます。',
 'トマトとピーマンをパンにのせる':'用意したトマトとピーマンをパンに並べ、大人に渡します。',
};
export const cookingFlow = recipe => [
 {title:'先に準備する',detail:recipe.adultPrep,role:'adult'},
 ...recipe.steps.map(step=>step.task===recipe.childTaskId
  ? {...step,role:'child',detail:taskFlowDetails[childTaskFor(recipe).title] ?? childTaskFor(recipe).instructions.join(' ')}
  : {...step,role:'adult'}),
].map(step=>({...step,...(step.role==='child'
 ? {photo:childTaskFor(recipe).photo,photoAlt:`子どもが${childTaskFor(recipe).title}様子`}
 : flowPhotos.recipes[recipe.id]?.[step.title])}));
export const duration = recipe => recipe.timeLabel || `約${recipe.minutes}分`;
export const matches = (recipe, ids) => foods.filter(food => recipe.match.includes(food.id) && ids.includes(food.id));
export function suggestions(ids, showAll = false) {
 const ranked=recipes.map((recipe,index)=>({recipe,index,hits:matches(recipe,ids).length})).filter(item=>showAll||!ids.length||item.hits).sort((a,b)=>b.hits-a.hits||a.index-b.index);
 const result=[],used=new Set();
 while(ranked.some(item=>!used.has(item.recipe.id))){
  const categories=new Set();
  for(const item of ranked)if(!used.has(item.recipe.id)&&!categories.has(item.recipe.category)){
   result.push(item.recipe);used.add(item.recipe.id);categories.add(item.recipe.category);
  }
 }
 return result;
}
// One play shows matched roles. Rotate the third staple so bread is also offered across trials.
export const foodGroups = [foods.filter(f=>f.group==='staple').map(f=>f.id), foods.filter(f=>f.group==='protein').map(f=>f.id), foods.filter(f=>f.group==='vegetable').map(f=>f.id)];
export const foodPairs = [['rice','noodles'],['chicken','pork'],['carrot','pepper'],['bread','rice'],['salmon','egg'],['onion','cabbage'],['potato','tomato'],['noodles','bread'],['chicken','salmon']];
