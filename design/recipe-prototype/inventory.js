import data from './stock-data.json' with {type:'json'};
export const inventoryVersion=data.version;
export const inventoryItems=data.items;
export const defaultStock=new Set(Object.entries(data.items).filter(([,item])=>item.present).map(([key])=>key));
export const recipeMaterials=recipe=>data.recipeMaterials[recipe.id];
export function inventoryFor(recipe,stock=defaultStock){
 const rows=recipeMaterials(recipe);
 return {available:rows.filter(row=>stock.has(row.key)),missing:rows.filter(row=>!stock.has(row.key))};
}
