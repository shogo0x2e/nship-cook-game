import data from '../../src/experience-data.json' with { type: 'json' };
export const foods = data.foods;
export const recipes = data.recipes;
export const recipeVersion = data.recipeVersion;
export const taskBasis = { name: 'PoC用に設計した分担', url: 'https://www.kewpie.co.jp/kids_yasai/challenge-recipe/' };
export const categoryLabels = { 'ごはん':'ごはん', 'めん':'めん', 'パン':'パン', 'おかず':'おかず' };
export const childTaskFor = recipe => recipe.tasks.find(task => task.id === recipe.childTaskId);
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
