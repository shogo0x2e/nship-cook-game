import { esc } from './survey.js';
export const offer = { version: 'family-cooking-concept-v3', billing: 'monthly', unit: 'household', currency: 'JPY', taxIncluded: true };
export const features = [
  { id:'game_recipe',title:'ゲームから、料理とお手伝いへ',detail:'ゲームで選んだ食材と、冷蔵庫などの写真から把握した食材・調味料をもとに、レシピと子どもの担当を提案します。ご家庭で繰り返し使えます。',image:'/experience/assets/concept-game-recipe.webp' },
  { id:'food_learning',title:'遊びを広げて、食への興味を育てる',detail:'食材の特徴を取り入れたルールや演出、さまざまなゲームで、楽しみながら食を学びます。食への興味や自分から手伝う気持ちを育て、日々の食事づくりの負担を長い目で支える構想です。',image:'/experience/assets/concept-food-learning-v2.webp' },
  { id:'challenge_feedback',title:'お子さんの苦手な食材への挑戦を見えるようにする',detail:'苦手な食材をゲームで選んだときなど、小さな挑戦を保護者の端末にフィードバック。お子さんの変化に気づき、声をかけるきっかけを届けます。',image:'/experience/assets/concept-challenge-feedback-v2.webp' },
  { id:'expert_recipes',title:'料理家・栄養士とのコラボレシピ',detail:'料理家や栄養士と共同で考えた、家庭で使えるレシピを提案します。',image:'/experience/assets/concept-expert-recipes-v3.webp' },
  { id:'family_schedule',title:'家族の予定に合う、料理と分担',detail:'保護者や子どもなど家族それぞれの予定に合わせて、料理とお手伝いを提案します。',image:'/experience/assets/concept-family-schedule-v3.webp' },
];
export const budgetKinds = [['paid','金額を入力する'],['free','無料なら利用したい（0円）'],['no_use','無料でも利用したいと思わない']];
export const freshMarket=()=>({step:'experience',budgetKind:'',maxMonthlyYen:'',interestedFeatures:[],featureComment:'',experienceCompletedAt:null,submittedAt:null});
export function restoreMarket(value){
 const result=freshMarket();if(!value||typeof value!=='object')return result;
 result.step=['experience','concept','budget'].includes(value.step)?value.step:'experience';
 result.budgetKind=budgetKinds.some(([id])=>id===value.budgetKind)?value.budgetKind:'';
 result.maxMonthlyYen=/^\d+$/.test(String(value.maxMonthlyYen??''))?String(value.maxMonthlyYen):'';
 result.interestedFeatures=Array.isArray(value.interestedFeatures)?[...new Set(value.interestedFeatures.filter(id=>id==='none'||features.some(f=>f.id===id)))]:[];
 result.featureComment=typeof value.featureComment==='string'?value.featureComment.slice(0,3000):'';
 for(const key of ['experienceCompletedAt','submittedAt'])result[key]=typeof value[key]==='string'?value[key]:null;
 return result;
}
export const validBudget=value=>['free','no_use'].includes(value.budgetKind)||value.budgetKind==='paid'&&/^\d+$/.test(String(value.maxMonthlyYen))&&Number.isSafeInteger(Number(value.maxMonthlyYen))&&Number(value.maxMonthlyYen)>=1&&Number(value.maxMonthlyYen)<=1_000_000;
export const validInterests=value=>Array.isArray(value.interestedFeatures)&&value.interestedFeatures.length>0&&value.interestedFeatures.every(id=>id==='none'||features.some(f=>f.id===id))&&(!value.interestedFeatures.includes('none')||value.interestedFeatures.length===1);
export const marketComplete=value=>Boolean(value.experienceCompletedAt&&validBudget(value)&&validInterests(value)&&value.submittedAt);
export const concept='<p class="survey-frame">ここからは今後の構想です。今回の体験に、以下の機能が加わり、ご家庭で継続して使えるサービスを想像してください。</p><aside class="device-plan device-plan-visible"><h2>親子それぞれの端末で、アプリを利用できます。</h2><p>お子さんはご家庭のタブレット、保護者はご自身のスマートフォンなどで利用する想定です。タブレットをお持ちでないご家庭には、置いて使えるタブレットを貸与する構想です。</p></aside>';
export function marketView(market,production=false){
 const back=step=>`<button type="button" class="back" data-action="market-back" data-step="${step}">← 前の質問に戻る</button>`;
 if(market.step==='concept')return `${back('experience')}<h1>こんな体験も、<br>考えています。</h1>${concept}<div class="concept-list">${features.map((f,i)=>`<article class="concept-card"><img src="${f.image}" alt="${f.title}の構想イメージ" width="1200" height="800" loading="lazy"><div><span class="concept-number">${String(i+1).padStart(2,'0')}</span><h2>${f.title}</h2><p>${f.detail}</p></div></article>`).join('')}</div><p class="fine-print">画像は構想を伝えるための生成イメージです。</p><button class="primary" data-action="market-next">料金・気になる機能について回答する<span aria-hidden="true">→</span></button>`;
 return `${back('concept')}<form id="market-form" data-market-step="budget"><h1 class="budget-title">これらの機能が使えるサービスの場合、1世帯あたり月にいくらまでなら利用したいですか。</h1><div class="feature-options budget-options">${budgetKinds.map(([id,label])=>`<label class="choice-card"><input type="radio" name="budgetKind" value="${id}" ${market.budgetKind===id?'checked':''} required><span>${label}</span></label>`).join('')}</div><label class="amount-field" ${market.budgetKind==='paid'?'':'hidden'}>月額の上限（税込）<span><input name="maxMonthlyYen" type="number" min="1" max="1000000" step="1" inputmode="numeric" value="${esc(market.maxMonthlyYen)}" ${market.budgetKind==='paid'?'required':'disabled'} autocomplete="off"> 円 / 世帯</span></label><section class="interest-question question-card" aria-labelledby="interest-title"><h2 id="interest-title">気になる機能はどれですか？<span class="required-label">必須・複数選択可</span></h2><div class="feature-options interest-options">${[...features,{id:'none',title:'特にない'}].map(f=>`<label class="choice-card"><input type="checkbox" name="interestedFeatures" value="${f.id}" ${market.interestedFeatures.includes(f.id)?'checked':''}><span>${f.title}</span></label>`).join('')}</div></section><label class="survey-comment">機能について、ご意見やご要望があれば教えてください（任意）<textarea name="featureComment" rows="4" maxlength="3000">${esc(market.featureComment)}</textarea></label><p id="market-error" class="survey-error" role="alert"></p><button class="primary" type="submit">${production?'回答を送信して終了する':'回答を保存して終了する'}<span aria-hidden="true">→</span></button></form>`;
}
