import data from './stock-data.json' with {type:'json'};
export const inventoryVersion=data.version;
export const inventoryItems=data.items;
export const defaultStock=new Set(Object.entries(data.items).filter(([,item])=>item.present).map(([key])=>key));
export const foodStockKeys={rice:['rice'],noodles:['steamed-noodles','udon'],bread:['bread','sandwich-bread'],chicken:['chicken'],pork:['pork-belly','pork-sliced'],salmon:['salmon'],egg:['egg'],onion:['onion'],carrot:['carrot'],potato:['potato'],cabbage:['cabbage'],pepper:['pepper'],tomato:['tomato','canned-tomato']};
export function inventorySelection(selected,stock=defaultStock){
 const availableFoodIds=[...new Set(selected)].filter(id=>foodStockKeys[id]?.some(key=>stock.has(key)));
 const selectedKeys=new Set(availableFoodIds.flatMap(id=>foodStockKeys[id]));
 const otherItems=Object.entries(inventoryItems).filter(([key,item])=>stock.has(key)&&item.kind!=='utility'&&!selectedKeys.has(key));
 return {availableFoodIds,missingFoodIds:[...new Set(selected)].filter(id=>foodStockKeys[id]&&!availableFoodIds.includes(id)),otherItems};
}
export const recipeMaterials=recipe=>data.recipeMaterials[recipe.id];
export function inventoryFor(recipe,stock=defaultStock){
 const rows=recipeMaterials(recipe);
 return {available:rows.filter(row=>stock.has(row.key)),missing:rows.filter(row=>!stock.has(row.key))};
}
