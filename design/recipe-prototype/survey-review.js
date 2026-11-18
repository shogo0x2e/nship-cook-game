import { scale, frames, surveyTable } from './survey.js';
import { freshMarket, marketView } from './market.js';
document.querySelector('#review-scale').innerHTML = scale.map((label,i)=>`<li><b>${i+1}</b>${label}</li>`).join('');
document.querySelector('#survey-review').innerHTML = [
  { title: '08：子どもの方へ — 8歳以下', role: 'child', young: true, frame: frames.young },
  { title: '08：子どもの方へ — 9歳以上', role: 'child', young: false, frame: frames.child },
  { title: '09：保護者の方へ — 今回の体験', role: 'parent', young: false, frame: frames.parent },
].map(item => `<section><h2>${item.title}</h2><p class="survey-frame">${item.frame}</p><div class="survey-container">${surveyTable(item.role, undefined, true, item.young)}</div></section>`).join('') +
  ['concept', 'budget'].map(step => `<section class="market-review"><h2>09：${step === 'concept' ? '今後の構想（説明のみ）' : '月額の上限（1世帯・税込）'}</h2>${marketView({ ...freshMarket(), step, budgetKind: 'paid' })}</section>`).join('');
document.querySelectorAll('#survey-review input, #survey-review button, #survey-review textarea').forEach(input => { input.disabled = true; });
