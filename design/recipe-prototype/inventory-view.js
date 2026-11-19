import {inventoryItems,defaultStock,inventoryFor} from './inventory.js';
import {matches,duration} from './recipes.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const inventoryBadge=(text,need=false)=>`<span class="inventory-badge ${need?'needs-shopping':''}">${need?'＋':'✓'} ${esc(text)}</span>`;
export const inventoryPremise=()=>'<section class="inventory-premise"><h2>今回のPoCの前提</h2><p>冷蔵庫・食品置き場の食材と調味料は、あらかじめ把握できているものとして体験します。</p><p>今回は用意した在庫サンプルを使います。撮影や食材の登録は不要です。</p></section>';
export function inventorySummary(stock=defaultStock){
 const items=Object.entries(inventoryItems).filter(([key,item])=>stock.has(key)&&item.kind!=='utility');
 return `<section class="inventory-source" aria-label="家にある食材・調味料"><figure class="inventory-source-photo"><img src="/experience/assets/household-fridge-v1.webp" alt="食材と調味料が入った冷蔵庫" width="960" height="640"></figure><details class="inventory-summary"><summary>${inventoryBadge('家にあります！')}<span>取得済みの食材・調味料 ${items.length}品</span><span class="inventory-disclosure">一覧を見る</span></summary><div class="food-chips">${items.map(([,item])=>`<span class="food-chip">${esc(item.name)}</span>`).join('')}</div></details></section>`;
}
export function inventoryRecipes(list,selected,button,stock=defaultStock){
 const groups=[{id:'available',title:'家にあるもので作れる料理',copy:'食材も調味料も、買い足さずに作れます。',recipes:list.filter(recipe=>!inventoryFor(recipe,stock).missing.length)},{id:'shopping',title:'買い足して作る料理',copy:'足りない食材・調味料を確認して選べます。',recipes:list.filter(recipe=>inventoryFor(recipe,stock).missing.length)}];
 return `<div class="inventory-groups">${groups.map((group,column)=>`<section class="inventory-group" aria-labelledby="inventory-heading-${group.id}"><div class="inventory-group-heading"><h2 id="inventory-heading-${group.id}">${group.title}</h2><p>${group.copy}</p></div><div class="inventory-cards">${group.recipes.length?group.recipes.map(recipe=>{
  const {missing}=inventoryFor(recipe,stock),hit=matches(recipe,selected);
  const preview=missing.slice(0,2).map(row=>row.name).join('・')+(missing.length>2?` ほか${missing.length-2}品`:'');
  return `<article class="recipe-card inventory-card" data-recipe-id="${recipe.id}"><img class="recipe-photo" src="${recipe.image}" alt="${esc(recipe.name)}の完成写真" width="720" height="540"><div class="recipe-card-body">${inventoryBadge(missing.length?`買い足すもの ${missing.length}品`:'家にあります！',Boolean(missing.length))}<h3>${recipe.name}</h3><p class="match-label">${hit.length?`ゲームで選んだ${hit.map(food=>food.name).join('・')}を使います`:'参考として見られる料理です'}</p><div class="recipe-meta"><span>${duration(recipe)}</span><span>${recipe.servings}</span></div><p class="inventory-buy-preview ${missing.length?'needs-shopping':''}">${missing.length?`買い足すもの：${preview}`:'必要な食材・調味料が、家にそろっています。'}</p>${button(recipe)}</div></article>`;
 }).join(''):`<p class="inventory-empty">${column?'買い足しが必要な料理はありません。':'該当する料理はありません。買い足して作る料理からご覧ください。'}</p>`}</div></section>`).join('')}</div>`;
}
function materialGroup(title,rows,need){
 return `<section class="inventory-material-group ${need?'needs-shopping':''}"><div class="inventory-material-heading"><h3>${title}</h3><span>${rows.length}品</span>${!need&&rows.length?inventoryBadge('家にあります！'):''}</div>${rows.length?`<ul class="materials inventory-materials">${rows.map(row=>`<li data-inventory-key="${row.key}"><span>${esc(row.name)}</span><span class="inventory-amount">${esc(row.amount)}</span></li>`).join('')}</ul>`:`<p class="inventory-empty-materials">${need?'買い足すものはありません。':'この料理に使えるものはありません。'}</p>`}</section>`;
}
export function inventoryMaterials(recipe,stock=defaultStock){
 const {available,missing}=inventoryFor(recipe,stock);
 return `<div class="inventory-section-title"><h2>使う材料</h2><span>${recipe.servings}</span></div>${materialGroup('家にあるもの',available,false)}${materialGroup('買い物が必要なもの',missing,true)}`;
}
