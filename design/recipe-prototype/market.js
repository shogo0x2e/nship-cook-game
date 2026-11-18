import { esc } from './survey.js';
export const offer = { version: 'family-cooking-concept-v1', billing: 'monthly', unit: 'household', currency: 'JPY', taxIncluded: true };
export const features = [
  { id:'game_recipe',title:'ゲームから、料理とお手伝いへ',detail:'今回のように、ゲームで選んだ食材からレシピと子どもの担当を提案。家庭で繰り返し使えます。',image:'/experience/assets/concept-game-recipe.webp' },
  { id:'food_learning',title:'遊びながら、食について学ぶ',detail:'食材や食事のことを、ゲームを通して楽しく知ることができます。',image:'/experience/assets/concept-food-learning.webp' },
  { id:'challenge_feedback',title:'苦手な食材への挑戦を、親にも',detail:'ゲーム内で苦手な食材を選ぶなどの挑戦に演出が付き、保護者にも伝わります。',image:'/experience/assets/concept-challenge-feedback.webp' },
  { id:'expert_recipes',title:'料理家・栄養士とのコラボレシピ',detail:'料理家や栄養士と共同で考えた、家庭で使えるレシピを提案します。',image:'/experience/assets/concept-expert-recipes.webp' },
  { id:'family_schedule',title:'家族の予定に合う、料理と分担',detail:'保護者や子どもなど家族それぞれの予定に合わせて、料理とお手伝いを提案します。',image:'/experience/assets/concept-family-schedule.webp' },
];
export const budgetKinds = [['paid','金額を入力する'],['free','無料なら利用したい（0円）'],['no_use','無料でも利用したいと思わない']];
export const freshMarket=()=>({step:'experience',budgetKind:'',maxMonthlyYen:'',experienceCompletedAt:null,submittedAt:null});
export function restoreMarket(value){
 const result=freshMarket();if(!value||typeof value!=='object')return result;
 result.step=['experience','concept','budget'].includes(value.step)?value.step:'experience';
 result.budgetKind=budgetKinds.some(([id])=>id===value.budgetKind)?value.budgetKind:'';
 result.maxMonthlyYen=/^\d+$/.test(String(value.maxMonthlyYen??''))?String(value.maxMonthlyYen):'';
 for(const key of ['experienceCompletedAt','submittedAt'])result[key]=typeof value[key]==='string'?value[key]:null;
 return result;
}
export const validBudget=value=>['free','no_use'].includes(value.budgetKind)||value.budgetKind==='paid'&&/^\d+$/.test(String(value.maxMonthlyYen))&&Number.isSafeInteger(Number(value.maxMonthlyYen))&&Number(value.maxMonthlyYen)>=1&&Number(value.maxMonthlyYen)<=1_000_000;
export const marketComplete=value=>Boolean(value.experienceCompletedAt&&validBudget(value)&&value.submittedAt);
export const concept='<p class="survey-frame">ここからは今後の構想です。今回の体験に、以下の機能が加わり、ご家庭で継続して使えるサービスを想像してください。</p>';
export function marketView(market,production=false){
 const back=step=>`<button type="button" class="back" data-action="market-back" data-step="${step}">← 前の質問に戻る</button>`;
 if(market.step==='concept')return `${back('experience')}<p class="eyebrow">保護者の方へ / 今後の構想</p><h1>こんな体験も、<br>考えています。</h1>${concept}<div class="concept-list">${features.map((f,i)=>`<article class="concept-card"><img src="${f.image}" alt="${f.title}の構想イメージ" width="1200" height="800" loading="lazy"><div><span class="concept-number">${String(i+1).padStart(2,'0')}</span><h2>${f.title}</h2><p>${f.detail}</p></div></article>`).join('')}</div><p class="fine-print">画像は構想を伝えるための生成イメージです。これらの機能やコラボレーションは、今後の検討内容です。</p><button class="primary" data-action="market-next">料金について回答する<span aria-hidden="true">→</span></button>`;
 return `${back('concept')}<p class="eyebrow">保護者の方へ / 最後の質問</p><h1>月にいくらまでなら<br>利用したいですか。</h1><p class="lead">先ほどの5つの機能をすべて使えるサービスについてお聞きします。</p><details class="scale-key"><summary>想定するサービスを確認</summary><ul>${features.map(f=>`<li>${f.title}</li>`).join('')}</ul></details><form id="market-form" data-market-step="budget"><p class="survey-frame">1世帯あたりの月額（税込）です。毎月継続して支払ってもよいと思う上限を教えてください。</p><div class="feature-options">${budgetKinds.map(([id,label])=>`<label class="choice-card"><input type="radio" name="budgetKind" value="${id}" ${market.budgetKind===id?'checked':''}><span>${label}</span></label>`).join('')}</div><label class="amount-field" ${market.budgetKind==='paid'?'':'hidden'}>月額の上限（税込）<span><input name="maxMonthlyYen" type="number" min="1" max="1000000" step="1" inputmode="numeric" value="${esc(market.maxMonthlyYen)}" ${market.budgetKind==='paid'?'required':'disabled'} autocomplete="off"> 円 / 世帯</span></label><p id="market-error" class="survey-error" role="alert"></p><button class="primary" type="submit">${production?'回答を送信して終了する':'回答を保存して終了する'}<span aria-hidden="true">→</span></button></form>`;
}
