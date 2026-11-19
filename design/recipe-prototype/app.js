import { inventoryVersion } from './inventory.js';
import { inventorySummary, inventoryRecipes, inventoryMaterials } from './inventory-view.js';
import { foods, recipes, matches, suggestions, childTaskFor, foodPairs, categoryLabels, duration, cookingFlow } from './recipes.js';
import { questionnaireVersion, scale, questions, playFrequencyQuestion, playFrequencyOptions, freshSurvey, missingQuestions, surveyQuestionCount, surveyForm } from './survey.js';
import { freshParticipant, restoreParticipant, participantComplete, participantFields, isYoung } from './participant.js';
import { offer, features, freshMarket, validBudget, validInterests, marketComplete, marketView } from './market.js';
import { newExperienceId } from './experience-id.js';

const stages = [
  { id: 'intro', number: '01', title: '体験の説明', actor: '保護者の方へ', note: '何を体験するか、親に説明する。' },
  { id: 'camera', number: '02', title: 'カメラの写りを確認', actor: '子ども', note: '顔・両ひじ・両手を、プレビューで確認する。' },
  { id: 'game', number: '03', title: 'ゲーム', actor: '子ども', note: '前半はタップ操作のデモ。食材を選んで先へ進める。' },
  { id: 'result', number: '04', title: 'ゲーム結果', actor: '子ども', note: '点数と選んだ食材だけを表示する。' },
  { id: 'handoff', number: '05', title: '親に返す', actor: '子ども → 親', note: '1台のスマホを保護者に返す。' },
  { id: 'recipes', number: '06-A', title: 'レシピ候補を見る', actor: '保護者', note: '選んだ食材とのつながりと、実在する料理の写真を見る。' },
  { id: 'recipe', number: '06-B', title: 'レシピを確認する', actor: '保護者', note: '材料・作り方と子どもの担当を確認し、子どもへ渡す。' },
  { id: 'child-task', number: '07', title: '子どもがやることを見る', actor: '子ども', note: '料理の写真と、自分がやることを見る。そのままアンケートへ進む。' },
  { id: 'child-survey', number: '08', title: '子どものアンケート', actor: '子ども', note: '8歳以下はやさしい言葉で今の感想、それより上は幼稚園頃を想定して回答する。' },
  { id: 'parent-survey', number: '09', title: '親のアンケート', actor: '保護者', note: '今回の体験を評価し、今後の構想を見て月額の上限を回答する。' },
  { id: 'done', number: '10', title: '終了', actor: '親子', note: '料理と担当工程を見る体験を終える。' },
];

const runtime = window.cookgameRuntime;
const production = Boolean(runtime);
const app = document.querySelector('#app');
const panel = document.querySelector('#flow-panel');
const actor = document.querySelector('#actor');
const demoMode = new URLSearchParams(location.search).get('demo') === '1';
const recordsKey = 'cookgame-recipe-survey-records-v1' + (demoMode ? '-demo' : '');
if (demoMode) document.querySelector('.prototype-bar>span').textContent += '（デモ回答）';
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
function browserId() {
  const name='cookgame-browser-id-v1';
  try { const saved=localStorage.getItem(name); if(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(saved || ''))return saved; } catch { /* Browsing remains possible without storage. */ }
  const id=crypto.randomUUID();try { localStorage.setItem(name,id); } catch { /* This visit still has an identifier. */ }return id;
}
const deviceId=browserId();
const freshState = () => ({ started: false, returnPortrait: false, caught: [], evidence: {}, gameFinished: false, gameInput: 'demo', key: newKey(), sequence: 0, receipt: null, finalPacket: null, score: 0, recipeId: null, showAll: false, stage: 'intro', sessionId: newExperienceId(), createdAt: new Date().toISOString(), participant: freshParticipant(), market: freshMarket(), surveys: { child: freshSurvey(), parent: freshSurvey() } });
let state = freshState();
// Each document visit is a new experience. Only the browser ID and delivery outbox persist.
for (const key of ['cookgame-experience-v1','cookgame-experience-v1-demo'])try { localStorage.removeItem(key); } catch { /* Optional cleanup of the previous resume state. */ }
let nativeGame = null;
let gameMountGeneration=0;
let gameEntryRequested=false;
let sending = false;
let sendError = '';
let draftTimer;

let storageNotice = '';
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const button = (label, action, extra = '') => `<button class="primary" data-action="${action}" ${extra}>${label}<span aria-hidden="true">→</span></button>`;
const secondary = (label, action, extra = '') => `<button class="secondary" data-action="${action}" ${extra}>${label}</button>`;
const recipeNow = () => recipes.find(recipe => recipe.id === state.recipeId);
const heading = (eyebrow, title, copy = '') => `<div class="page-heading">${eyebrow?`<p class="eyebrow">${eyebrow}</p>`:''}<h1>${title}</h1>${copy ? `<p class="lead">${copy}</p>` : ''}</div>`;
const back = (stage, text = '戻る') => `<button class="back" data-action="go" data-stage="${stage}"><span aria-hidden="true">←</span> ${text}</button>`;
const credit = recipe => `<p class="photo-credit">完成写真・元レシピ：<a href="${recipe.source}" target="_blank" rel="noopener noreferrer">${recipe.publisher}</a></p>`;
const photo = (recipe, className = 'recipe-photo') => `<img class="${className}" src="${recipe.image}" alt="${esc(recipe.name)}の完成写真" loading="eager" width="720" height="540">`;
const chips = (ids, editable = false) => `<div class="food-chips">${foods.filter(food => ids.includes(food.id)).map(food => `<${editable ? 'button' : 'span'} class="food-chip" ${editable ? `data-action="remove-food" data-food="${food.id}"` : ''}><span aria-hidden="true">${food.emoji}</span>${food.name}${editable ? '<span aria-hidden="true">×</span>' : ''}</${editable ? 'button' : 'span'}>`).join('')}</div>`;

let warnsOnLeave=false;
const warnOnLeave=event=>{event.preventDefault();event.returnValue='';};
function save() {
  const warn=state.started&&!state.receipt;
  if(warn===warnsOnLeave)return;
  warnsOnLeave=warn;
  window[warn?'addEventListener':'removeEventListener']('beforeunload',warnOnLeave);
}
function readRecords() {
  try { const records = JSON.parse(localStorage.getItem(recordsKey) || '[]'); return Array.isArray(records) ? records : []; }
  catch { return []; }
}
function responseRecord() {
  const recipe = recipeNow();
  return { sessionId: state.sessionId, deviceId, questionnaireVersion, inventoryVersion, createdAt: state.createdAt, updatedAt: new Date().toISOString(), demo: demoMode,
    participant: { ...state.participant, childSurveyMode: isYoung(state.participant) ? 'young-current-experience' : 'older-kindergarten-hypothetical' },
    questionnaire: { child: questions.child.map(q => ({ id: q.id, text: isYoung(state.participant) ? q.youngText : q.text })), playFrequency: { question: isYoung(state.participant) ? playFrequencyQuestion.youngText : playFrequencyQuestion.text, options: playFrequencyOptions.map(([value,label,youngLabel]) => ({value,label:isYoung(state.participant)?youngLabel:label})) }, parent: questions.parent },
    plannedService: { offer, features, responses: JSON.parse(JSON.stringify(state.market)) },
    selectedIngredients: [...state.caught], recipe: recipe ? { id: recipe.id, name: recipe.name, source: recipe.source, childTaskId: recipe.childTaskId } : null,
    responses: JSON.parse(JSON.stringify(state.surveys)), complete: Boolean(state.surveys.child.submittedAt && !missingQuestions('child', state.surveys.child).length && state.surveys.parent.submittedAt && marketComplete(state.market)) };
}
function persistResponse() {
  if (production) { checkpoint(); return; }
  try {
    const records = readRecords();
    const index = records.findIndex(record => record.sessionId === state.sessionId);
    const record = responseRecord();
    if (index < 0) records.push(record); else records[index] = record;
    localStorage.setItem(recordsKey, JSON.stringify(records));
    storageNotice = '';
  } catch { storageNotice = 'ブラウザへの保存に失敗しました。回答データをJSON保存してください。'; }
}
function packet(complete = false) {
  const market = state.market;
  const evidence = Object.fromEntries(foods.map(food => [food.id, state.evidence[food.id] || { offered: 0, caught: 0 }]));
  return { id: state.sessionId, key: state.key, payload: {
    questionnaireVersion, recipeVersion: 'daily-2026-11-19-v1', conceptVersion: offer.version, inventoryVersion, deviceId,
    sequence: ++state.sequence, age: Number(state.participant.age), demo: demoMode, stage: complete ? 'done' : state.stage,
    selectedIngredients: [...new Set(state.caught)], evidence, recipeId: state.recipeId,
    child: { answers: { ...state.surveys.child.answers }, comment: state.surveys.child.comment, playFrequency: state.surveys.child.playFrequency || null },
    parent: { answers: { ...state.surveys.parent.answers }, comment: state.surveys.parent.comment, gameplayStatus: state.surveys.parent.gameplayStatus || null, gameplayComment: state.surveys.parent.gameplayComment, employmentStatus: state.surveys.parent.employmentStatus || null },
    serviceFeedback: { interestedFeatures: [...market.interestedFeatures], comment: market.featureComment },
    payment: validBudget(market) ? { kind: market.budgetKind, maxMonthlyYen: market.budgetKind === 'paid' ? Number(market.maxMonthlyYen) : market.budgetKind === 'free' ? 0 : null } : null,
    gameInput: state.gameInput, complete,
  }};
}
function checkpoint() {
  if (!production || state.finalPacket || !participantComplete(state.participant)) return;
  clearTimeout(draftTimer);
  const draft = packet(); save();
  void runtime.saveExperience(draft).catch(() => {});
}
function acceptSaved(ack, key=state.key) {
  if (key !== state.key || ack.id !== state.sessionId || !ack.complete || !ack.receipt || !state.finalPacket) return;
  state.receipt = ack.receipt; sendError = ''; sending = false; save(); go('done');
}
async function submitFinal() {
  if (sending || state.receipt) return;
  if (!state.finalPacket) state.finalPacket = packet(true);
  save(); sending = true; sendError = ''; render();
  try { acceptSaved(await runtime.saveExperience(state.finalPacket)); }
  catch (error) { sending = false; sendError = error.message || '回答を送信できませんでした。'; render(); }
}
function sendingView() {
  return `${heading('回答の送信', sending ? '回答を送信しています。' : '回答をもう一度<br>送信してください。')}<p class="lead">保存が完了すると、受付IDが表示されます。</p><p class="survey-error" role="alert">${esc(sendError)}</p>${sending ? '<p role="status">送信中…</p>' : button('回答を再送信する', 'retry-send')}<p class="plain-note">通信できる状態で、この画面から再送信してください。画面を閉じると、この体験には戻れません。</p>`;
}
function exportResponses() {
  const records = readRecords();
  const index = records.findIndex(record => record.sessionId === state.sessionId);
  if (index < 0) records.push(responseRecord()); else records[index] = responseRecord();
  const data = { schemaVersion: 2, questionnaireVersion, exportedAt: new Date().toISOString(), demo: demoMode, scale, questions, playFrequencyQuestion, playFrequencyOptions, offer, features, records };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `cookgame-survey-${Date.now()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function updateSurvey(form) {
  const role = form.dataset.surveyRole;
  const response = state.surveys[role];
  const data = new FormData(form);
  for (const question of questions[role]) {
    const raw = data.get(question.id);
    if (raw !== null && /^[1-7]$/.test(raw)) response.answers[question.id] = Number(raw);
    else delete response.answers[question.id];
  }
  response.comment = String(data.get('comment') || ''); response.submittedAt = null;
  if (role === 'child') response.playFrequency = String(data.get('playFrequency') || '');
  if (role === 'parent') { response.gameplayStatus = String(data.get('gameplayStatus') || ''); response.gameplayComment=String(data.get('gameplayComment') || ''); response.employmentStatus=String(data.get('employmentStatus') || ''); }
  if (role === 'parent') { state.market.experienceCompletedAt = null; state.market.submittedAt = null; }
  const missing = missingQuestions(role, response);
  document.querySelector('#survey-progress').textContent = `回答済み ${surveyQuestionCount(role) - missing.length} / ${surveyQuestionCount(role)}`;
  form.querySelectorAll('[data-question-row]').forEach(row => row.classList.toggle('is-missing', row.classList.contains('is-missing') && missing.some(q => q.id === row.dataset.questionRow)));
  save();
  if (production) { clearTimeout(draftTimer); draftTimer = setTimeout(checkpoint, 900); }
}
function routeId() { return location.hash.slice(1).split('?')[0]; }
function go(stage, step) {
  const hash=`#${stage}${step?`?step=${step}`:''}`;
  if (location.hash === hash) render();
  else location.hash = hash;
}
const phoneViewport=()=>navigator.maxTouchPoints>0&&Math.min(innerWidth,innerHeight)<=600;
function sample() {
  state.caught = ['rice', 'pork', 'potato'];
  state.score = 300;
  state.showAll = false;
}
function reviewJump(stage) {
  if (stage === 'game') { state.caught = []; state.score = 0; state.recipeId = null; }
  if (stages.findIndex(item => item.id === stage) >= 5 && !state.caught.length) sample();
  if (['recipe', 'child-task'].includes(stage) && !recipeNow()) {
    chooseRecipe(suggestions(state.caught, true)[0]);
  }
  go(stage);
}
function renderPanel() {
  if (production) return;
  const meta = stages.find(item => item.id === state.stage);
  panel.innerHTML = `<p class="review-label">スマホの体験を確認</p><h2>料理を選んで、<br>お手伝いにつなぐ。</h2><p class="review-description">ゲームはタップ操作で再現。レシピとお手伝いの提案を確認する試作です。</p><button class="sample-start" data-action="sample">レシピの確認から試す <span aria-hidden="true">↗</span></button><nav>${stages.map(item => `<button data-action="review" data-stage="${item.id}" ${state.stage === item.id ? 'aria-current="step"' : ''}><span>${item.number}</span>${item.title}</button>`).join('')}</nav><div class="review-current"><b>${meta.number} ${meta.title}</b><p>${meta.note}</p></div><a class="review-document" href="./survey-review.html" target="_blank" rel="noopener">アンケート一覧を表で見る ↗</a><button class="reset-link" data-action="review-market">機能・料金の質問を確認</button><button class="reset-link" data-action="export-survey">回答データをJSON保存</button><button class="reset-link" data-action="reset">新しい体験を始める</button>`;
}

function contactView(receipt) {
  const subject=receipt?`回答に関するお問い合わせ（受付ID：${receipt}）`:'体験に関するお問い合わせ';
  return `<section class="completion-contact"><h2>お問い合わせ</h2><p>芝浦工業大学 ビジネスコンテスト チーム芝（北田、宮尾、岡部）<br>代表：北田 章伍（修士1年）</p><a href="mailto:bp22026@shibaura-it.ac.jp?subject=${encodeURIComponent(subject)}">bp22026@shibaura-it.ac.jp</a><p>ご不明な点がありましたら、お気軽にお問い合わせください。</p>${receipt?`<p>回答に関するお問い合わせの際は、受付IDをお知らせください。</p><p class="receipt"><span>受付ID：</span><strong>${esc(receipt)}</strong></p>`:''}</section>`;
}
function introView() {
  const steps = [
    ['ゲームをする', 'カメラの前で手を動かし、好きな食材を選びます。<br>スマホでもご参加いただけます。'],
    ['レシピの推薦を見る', '選んだ食材を使った料理と、子どもがお手伝いできる工程を確認します。'],
    ['アンケートに答える', 'ゲームの楽しさや、提案された分担について伺います。'],
  ];
  return `<h1 class="intro-title">食材選びから始める、<br>共働き家庭の<br>親子のごはんづくり</h1><div class="intro-study"><p>芝浦工業大学 ビジネスコンテストプロジェクトでは、アンケート調査の結果をもとに、親子のごはんづくりを支えるアプリを考えました。</p><p>使いやすさや、提案された料理の分担への納得感を確かめるため、体験とアンケートへのご協力をお願いします。</p><p>主な対象は、8歳以下のお子さんがいる共働き家庭ですが、幅広いご意見を集めていますので、対象に当てはまらない方も、ぜひご参加ください。</p></div><h2 class="experience-flow-title">体験の流れ</h2><ol class="experience-steps">${steps.map(([title,copy],i)=>`<li><div class="experience-step-image step-image-${i+1}" role="img" aria-label="${title}のイメージ"></div><div class="experience-step-copy"><span>${i+1}</span><div><h2>${title}</h2><p>${copy}</p></div></div></li>`).join('')}</ol><form id="participant-form">${participantFields(state.participant)}<button type="submit" class="primary">子どもに渡して体験を開始<span aria-hidden="true">→</span></button></form>${contactView()}`;
}

function cameraView() {
 return `<div class="camera-launch"><h1 class="sr-only">ゲームを始める</h1><button class="primary camera-launch-button" data-action="start-camera-game"><span>カメラを起動して、<br>ゲームを始める</span><span aria-hidden="true">→</span></button><p class="privacy">カメラ映像は端末内だけで使い、送信・保存しません。<br>動作の改善のため、端末の種類やエラー情報を収集します。</p></div>`;
}

function gameView() {
  if (production || state.gameInput==='camera') return '<div id="native-game" class="native-game"></div><nav class="game-navigation" aria-label="ゲームの操作"><button class="text-action" data-action="go" data-stage="camera">開始画面に戻る</button><button class="text-action" data-action="demo-game">カメラなしで試す</button><button class="text-action" data-action="skip-game">ゲームを終了して先に進む</button></nav>';
  const pair = foodPairs[Math.min(state.caught.length, foodPairs.length - 1)];
  return `${heading('子ども', 'すきなほうを<br>キャッチしよう。')}<p class="demo-label">画面確認用：食材をタップして進みます</p><div class="simple-game"><div class="game-top"><b>${state.score} <small>点</small></b><span>${state.caught.length} / ${foodPairs.length} キャッチ</span></div><div class="catch-choices">${pair.map(id => foods.find(food => food.id === id)).map(food => `<button data-action="catch" data-food="${food.id}" aria-label="${food.name}をキャッチ"><span>${food.emoji}</span><small>${food.name}</small></button>`).join('')}</div><div class="demo-character" aria-hidden="true"><div class="demo-face">◡</div><img src="/avatar/body.png" alt=""></div></div>${chips(state.caught)}<button class="text-action" data-action="go" data-stage="result">ここまでで終わる</button>`;
}

function resultView() {
  if(state.returnPortrait&&innerWidth>innerHeight)return `<div class="portrait-return" role="status"><svg viewBox="0 0 120 100" aria-hidden="true"><rect x="38" y="12" width="44" height="76" rx="7" fill="none" stroke="currentColor" stroke-width="4"/><path d="M24 72C6 46 15 19 35 9m-11-2 13 1-2 13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><h1>端末を縦に戻してください。</h1><p>ゲームはおしまいです。<br>縦にすると、結果を確認できます。</p></div>`;
  state.returnPortrait=false;
  return `<div class="center-view">${heading('ゲーム結果', 'ナイスキャッチ！')}<p class="score">${state.score}<span>点</span></p><p class="section-label">今回、選んだ食材</p>${chips(state.caught)}${!state.caught.length ? '<p class="muted">今回はキャッチがありませんでした。</p>' : ''}${button('つぎへ', 'go', 'data-stage="handoff"')}</div>`;
}

function handoffView() {
  return `<div class="center-view">${heading('子ども → 親', '親に<br>わたしてください。', '続いて、保護者がレシピを確認します。')}${button('親が受け取りました', 'go', 'data-stage="recipes"')}</div>`;
}

function recipeListView() {
  const list = suggestions(state.caught, state.showAll);
  const cards = inventoryRecipes(list, state.caught, recipe => button('レシピを見る', 'open-recipe', `data-recipe="${recipe.id}" aria-label="${recipe.name}のレシピを見る"`));
  return `${heading('保護者の方へ', 'お子さんの好みと、<br>家にあるものから提案します。')}${inventorySummary(state.caught)}${list.length ? cards : `<div class="empty-state"><h2>この${recipes.length}品には、<br>一致する食材がありません。</h2><p>使う食材を見直すか、参考としてほかのレシピを見られます。</p>${secondary('参考レシピを見る', 'show-all')}</div>`}${!state.showAll && list.length && list.length < recipes.length ? secondary(`すべてのレシピを見る（${recipes.length}品）`, 'show-all') : ''}`;
}

function chooseRecipe(recipe) {
  if (state.recipeId !== recipe.id && Object.values(state.surveys).some(response => Object.keys(response.answers).length)) {
    state.surveys = { child: freshSurvey(), parent: freshSurvey() };
    state.market = freshMarket();
  }
  state.recipeId = recipe.id;
}
function recipeDetailView(recipe) {
  const hit = matches(recipe, state.caught);
  return `${back('recipes', '候補に戻る')}<p class="eyebrow">レシピを確認</p>
    ${photo(recipe, 'recipe-photo detail-photo')}<h1 class="recipe-title">${recipe.name}</h1>
    <div class="recipe-meta"><span>${duration(recipe)}</span><span>${recipe.servings}</span></div>
    ${hit.length ? `<p class="match-label">選んだ${hit.map(food => food.name).join('・')}を使います</p>` : ''}
    <section class="content-section">${inventoryMaterials(recipe)}</section>
    <section class="content-section"><h2>料理の流れ</h2><ol class="cooking-overview">${cookingFlow(recipe).map(step => `<li${step.photo ? ' class="has-step-photo"' : ''}><span class="role-label ${step.role === 'child' ? 'child-role' : ''}">${step.role === 'child' ? '子ども' : '大人'}</span><div class="flow-step-copy"><b>${step.title}</b><p>${step.detail}</p></div>${step.photo ? `<img class="flow-step-photo" src="${step.photo}" alt="${step.photoAlt}" width="600" height="400" loading="lazy" decoding="async">` : ''}</li>`).join('')}</ol></section>
    ${credit(recipe)}<div class="sticky-action">${button('子どもに渡す', 'show-child')}</div>`;
}
function childTaskView(recipe) {
  const task = childTaskFor(recipe);
  return `${back('recipe', 'ごはんを みる')}${heading('こども', 'きみの おてつだい')}
    <div class="dish-context child-recipe-context">${photo(recipe)}<div><span>この ごはんの おてつだいだよ</span><b>${recipe.childName}</b></div></div>
    <h2 class="child-task-title">${task.childTitle}</h2>
    ${task.photo ? `<figure class="task-figure"><img src="${task.photo}" alt="${task.title}の工程イメージ" width="1448" height="1086"></figure>` : ''}
    <ol class="child-instructions">${task.instructions.map((line, i) => `<li><span>${i + 1}</span><p>${line}</p></li>`).join('')}</ol>
    <p class="child-care">${task.care}</p>
    ${button('かんそうを きかせてね', 'go', 'data-stage="child-survey"')}`;
}

function surveyView(parent) {
  const role = parent ? 'parent' : 'child';
  if (parent && state.market.step !== 'experience') return marketView(state.market, production);
  const young = !parent && isYoung(state.participant);
  return `${heading('', young ? 'あそんだ かんそうを<br>おしえてね。' : '体験の感想を<br>教えてください。')}${surveyForm(role, state.surveys[role], young)}`;
}
function doneView() {
  if (production) return `<div class="completion-view"><h1>ありがとう<br>ございました</h1><p class="lead">回答を受け付けました。<br>この画面を閉じて終了してください。</p>${contactView(state.receipt)}</div>`;
  const complete = state.surveys.child.submittedAt && state.surveys.parent.submittedAt && marketComplete(state.market);
  return `<div class="center-view">${heading('体験のおわり', 'ありがとう<br>ございました', '料理とお手伝いの内容を見る体験は、ここまでです。')}
    <p class="plain-note">${storageNotice || (complete ? '回答をこの端末のブラウザに保存しました。' : 'アンケートはまだ完了していません。')}${demoMode ? ' デモ回答は通常の回答とは別に保存しています。' : ''}</p>
    ${secondary('回答データをJSON保存', 'export-survey')}${secondary('レシピの確認をもう一度試す', 'sample')}
  </div>`;
}

function render() {
  let stage = production && state.finalPacket ? (state.receipt ? 'done' : 'parent-survey') : routeId() || (production ? 'intro' : state.stage);
  stage = ({ help: 'recipe', 'child-recipe': 'child-task' })[stage] ?? stage;
  if (!stages.some(item => item.id === stage)) stage = 'intro';
  if(stage==='parent-survey'){
    const step=new URLSearchParams(location.hash.split('?')[1]||'').get('step');
    if(['experience','concept','budget'].includes(step))state.market.step=step;
  }
  if (stage !== 'intro' && !participantComplete(state.participant)) stage = 'intro';
  if(production&&stage==='done'&&!state.receipt)stage=participantComplete(state.participant)?'parent-survey':'intro';
  if (['recipe', 'child-task'].includes(stage) && !recipeNow()) stage = 'recipes';
  // A restored URL or browser history must never activate the camera by itself.
  if (production && stage === 'game' && !gameEntryRequested) stage = 'intro';
  if (production && stage === 'game' && state.gameFinished) stage = 'result';
  if (!production && stage === 'game' && state.caught.length >= foodPairs.length) stage = 'result';
  if (nativeGame) { nativeGame.destroy(); nativeGame = null; }
  if (stage !== 'game') gameEntryRequested=false;
  const generation=++gameMountGeneration;
  state.stage = stage;
  runtime?.setDiagnosticContext?.({experienceId:state.sessionId,deviceId,screen:stage,demo:demoMode});
  if (routeId() !== stage) history.replaceState(null, '', `#${stage}`);
  actor.textContent = stages.find(item => item.id === stage).actor;
  const recipe = recipeNow();
  const views = {
    intro: introView, camera: cameraView, game: gameView, result: resultView, handoff: handoffView,
    recipes: recipeListView, recipe: () => recipeDetailView(recipe),
    'child-task': () => childTaskView(recipe),
    'child-survey': () => surveyView(false), 'parent-survey': () => surveyView(true), done: doneView,
  };
  app.innerHTML = production && state.finalPacket && !state.receipt ? sendingView() : views[stage]();
  if (stage === 'game' && (production || state.gameInput==='camera')) {
    const onFinish=async evidence=>{
      if(generation!==gameMountGeneration)return;
      state.gameFinished=true;state.returnPortrait=phoneViewport();state.evidence=Object.fromEntries(foods.map(food=>[food.id,evidence[food.id]]));
      state.caught=foods.flatMap(food=>Array(evidence[food.id].caught).fill(food.id));state.score=state.caught.length*100;save();checkpoint();go('result');
    };
    if(production)nativeGame=runtime.mountGame(app.querySelector('#native-game'),{input:state.gameInput,onFinish});
    else void (import.meta.env?.DEV?import('/src/camera-runtime.ts'):import(/* @vite-ignore */ '/camera-runtime.js')).then(module=>{
      if(generation===gameMountGeneration)nativeGame=module.mountCameraTrial(app.querySelector('#native-game'),onFinish);
    }).catch(()=>{if(generation===gameMountGeneration)app.innerHTML='<p>ゲームを読み込めませんでした。ページを再読み込みしてください。</p>';});
  }
  app.dataset.screen = stage;
  app.dataset.experienceId=state.sessionId;
  document.body.classList.toggle('is-game', stage === 'game');
  document.body.classList.toggle('is-portrait-return',Boolean(app.querySelector('.portrait-return')));
  document.querySelector('.app-footer').hidden=['intro','done'].includes(stage);
  renderPanel();
  save();
  document.body.classList.remove('flow-open');
  document.querySelector('#flow-toggle').setAttribute('aria-expanded', 'false');
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
  if (production && stage !== 'game') checkpoint();
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  if (production && state.finalPacket && !['reset', 'retry-send'].includes(target.dataset.action)) return;
  const action = target.dataset.action;
  if (action === 'retry-send') void submitFinal();
  if (action === 'go') go(target.dataset.stage);
  if (action === 'review') reviewJump(target.dataset.stage);
  if (action === 'sample') { const participant = state.participant; state = freshState(); state.participant = participant; sample(); go('recipes'); }
  if (action === 'reset') { nativeGame?.destroy();nativeGame=null; state = freshState(); storageNotice = ''; go('intro'); }
  if (action === 'start-camera-game') {gameEntryRequested=true;state.caught=[];state.evidence={};state.gameFinished=false;state.score=0;state.recipeId=null;state.gameInput='camera';go('game');}
  if (action === 'demo-game') { gameEntryRequested=true;state.caught = []; state.evidence = {}; state.gameFinished = false; state.score = 0; state.recipeId = null; state.gameInput = 'demo'; go('game'); }
  if (action === 'skip-game') { state.gameFinished = true; state.returnPortrait=phoneViewport(); save(); go(state.returnPortrait&&innerWidth>innerHeight?'result':'handoff'); }
  if (action === 'market-back') { state.market.step = target.dataset.step; save(); go('parent-survey',state.market.step); }
  if (action === 'market-next') { state.market.step = 'budget'; save(); go('parent-survey','budget'); }
  if (action === 'review-market') { state.market.step = 'concept'; go('parent-survey','concept'); }
  if (action === 'catch') { const pair = foodPairs[state.caught.length]; for (const id of pair) { state.evidence[id] ||= {offered:0,caught:0}; state.evidence[id].offered++; } state.evidence[target.dataset.food].caught++; state.caught.push(target.dataset.food); state.score += 100; state.caught.length >= foodPairs.length ? go('result') : render(); }
  if (action === 'show-all') { state.showAll = true; render(); }
  if (action === 'open-recipe') {
    const recipe = recipes.find(item => item.id === target.dataset.recipe);
    if (recipe) { chooseRecipe(recipe); go('recipe'); }
  }
  if (action === 'show-child') go('child-task');
  if (action === 'export-survey') exportResponses();
});

document.addEventListener('input', event => {
  const form = event.target.closest('#survey-form');
  if (form) updateSurvey(form);
  const marketForm = event.target.closest('#market-form');
  if (marketForm) updateMarket(marketForm, event.target);
});
document.addEventListener('submit', event => {
  const participantForm = event.target.closest('#participant-form');
  if (participantForm) {
    event.preventDefault();
    const data = new FormData(participantForm);
    const participant = restoreParticipant({ age: data.get('age') });
    if (!participantComplete(participant)) return;
    if (JSON.stringify(state.participant) !== JSON.stringify(participant)) {
      state.surveys = { child: freshSurvey(), parent: freshSurvey() }; state.market = freshMarket();
    }
    state.started=true; state.participant = participant; save(); go('camera'); return;
  }
  const marketForm = event.target.closest('#market-form');
  if (marketForm) { event.preventDefault(); submitMarket(marketForm); return; }
  const form = event.target.closest('#survey-form');
  if (!form) return;
  event.preventDefault(); updateSurvey(form);
  const role = form.dataset.surveyRole;
  const missing = missingQuestions(role, state.surveys[role]);
  if (missing.length) {
    document.querySelector('#survey-error').textContent = role === 'child' ? isYoung(state.participant) ? 'まだ こたえていない ところが あるよ。ひとつずつ えらんでね。' : '未回答の設問があります。各設問で1つ選んでください。' : '未回答の設問があります。各設問で1つ選んでください。';
    form.querySelectorAll('[data-question-row]').forEach(row => row.classList.toggle('is-missing', missing.some(q => q.id === row.dataset.questionRow)));
    form.querySelector(`[data-question-row="${missing[0].id}"] input`)?.focus();
    return;
  }
  if (role === 'parent') {
    state.market.experienceCompletedAt = new Date().toISOString(); state.market.step = 'concept'; save(); persistResponse(); go('parent-survey','concept');
  } else {
    state.surveys.child.submittedAt = new Date().toISOString(); save(); persistResponse(); go('parent-survey');
  }
});

function updateMarket(form, target) {
  if(target?.name==='interestedFeatures'&&target.checked){
    form.querySelectorAll('[name="interestedFeatures"]').forEach(input=>{if(input!==target&&(target.value==='none'||input.value==='none'))input.checked=false;});
  }
  const data = new FormData(form); const market = state.market;
  market.budgetKind = String(data.get('budgetKind') || '');
  const field = form.querySelector('.amount-field'); const input = form.querySelector('[name="maxMonthlyYen"]');
  field.hidden = market.budgetKind !== 'paid'; input.disabled = market.budgetKind !== 'paid'; input.required = market.budgetKind === 'paid';
  market.maxMonthlyYen = input.value;
  market.interestedFeatures=data.getAll('interestedFeatures').map(String);
  market.featureComment=String(data.get('featureComment')||'');
  market.submittedAt = null; state.surveys.parent.submittedAt = null; save();
  if(production){clearTimeout(draftTimer);draftTimer=setTimeout(checkpoint,900);}
}
function submitMarket(form) {
  updateMarket(form); const market = state.market;
  if (!validBudget(market)) { document.querySelector('#market-error').textContent = '回答を選び、金額を入力する場合は1円以上の整数を入力してください。'; return; }
  if (!validInterests(market)) { document.querySelector('#market-error').textContent = '気になる機能を1つ以上選んでください。ない場合は「特にない」を選べます。'; form.querySelector('[name="interestedFeatures"]').focus(); return; }
  if (!market.experienceCompletedAt || missingQuestions('parent', state.surveys.parent).length) { market.step = 'experience'; save(); go('parent-survey','experience'); return; }
  if (production && !state.recipeId) { go('recipes'); return; }
  if (production && missingQuestions('child', state.surveys.child).length) { go('child-survey'); return; }
  if (market.budgetKind !== 'paid') market.maxMonthlyYen = market.budgetKind === 'free' ? '0' : '';
  market.submittedAt = new Date().toISOString(); state.surveys.parent.submittedAt = market.submittedAt;
  save();
  if (production) { void submitFinal(); return; }
  persistResponse(); go('done');
}

document.querySelector('#flow-toggle').addEventListener('click', event => {
  const open = document.body.classList.toggle('flow-open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});
window.addEventListener('hashchange', render);
window.addEventListener('resize',()=>{if(state.stage==='result'&&state.returnPortrait&&innerHeight>=innerWidth)render();});
window.addEventListener('pagehide', () => { clearTimeout(draftTimer);checkpoint();gameMountGeneration++;nativeGame?.destroy(); });
window.addEventListener('pageshow', event=>{if(event.persisted){state=freshState();gameEntryRequested=false;history.replaceState(null,'','#intro');render();}});
if (production) {
  runtime.onSaved(acceptSaved);
  runtime.onIdChanged(({key,id})=>{if(state.key!==key)return;state.sessionId=id;if(state.finalPacket)state.finalPacket={...state.finalPacket,id};app.dataset.experienceId=id;});
  history.replaceState(null, '', '#intro');
}
render();
if (production) void runtime.flushOutbox();
