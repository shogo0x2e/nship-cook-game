import { foods, recipes, matches, suggestions, childTaskFor, foodPairs, categoryLabels, duration } from './recipes.js';
import { questionnaireVersion, scale, questions, freshSurvey, restoreSurvey, missingQuestions, surveyForm } from './survey.js';
import { freshParticipant, restoreParticipant, participantComplete, participantFields, isYoung } from './participant.js';
import { offer, features, freshMarket, restoreMarket, validBudget, marketComplete, marketView } from './market.js';

const stages = [
  { id: 'intro', number: '01', title: 'PoCの説明', actor: '保護者の方へ', note: '何を体験するか、親に説明する。' },
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
const storageKey = (production ? 'cookgame-experience-v1' : 'cookgame-recipe-prototype-v3') + (demoMode ? '-demo' : '');
const recordsKey = 'cookgame-recipe-survey-records-v1' + (demoMode ? '-demo' : '');
if (demoMode) document.querySelector('.prototype-bar>span').textContent += '（デモ回答）';
const storage = production ? localStorage : sessionStorage;
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
const freshState = () => ({ caught: [], evidence: {}, gameFinished: false, gameInput: 'demo', key: newKey(), sequence: 0, receipt: null, finalPacket: null, score: 0, recipeId: null, showAll: false, stage: 'intro', sessionId: crypto.randomUUID(), createdAt: new Date().toISOString(), participant: freshParticipant(), market: freshMarket(), surveys: { child: freshSurvey(), parent: freshSurvey() } });
let state = freshState();
try {
  const saved = JSON.parse(storage.getItem(storageKey) ?? 'null');
  if (saved && Array.isArray(saved.caught)) {
    // Restore the recipe and game state. Old task selections are no longer used.
    state = {
      ...state,
      key: /^[a-f0-9]{64}$/.test(saved.key) ? saved.key : state.key,
      sequence: Number.isSafeInteger(saved.sequence) ? saved.sequence : 0,
      receipt: typeof saved.receipt === 'string' ? saved.receipt : null,
      finalPacket: saved.finalPacket ?? null,
      evidence: saved.evidence ?? {},
      gameFinished: saved.gameFinished === true,
      gameInput: saved.gameInput === 'camera' ? 'camera' : 'demo',
      caught: saved.caught.filter(id => foods.some(food => food.id === id)),
      score: Number.isFinite(saved.score) ? saved.score : 0,
      recipeId: recipes.some(recipe => recipe.id === saved.recipeId) ? saved.recipeId : null,
      showAll: saved.showAll === true,
      stage: typeof saved.stage === 'string' ? saved.stage : 'intro',
      sessionId: typeof saved.sessionId === 'string' ? saved.sessionId : state.sessionId,
      createdAt: typeof saved.createdAt === 'string' ? saved.createdAt : state.createdAt,
      participant: restoreParticipant(saved.participant),
      market: restoreMarket(saved.market),
      surveys: { child: restoreSurvey('child', saved.surveys?.child), parent: restoreSurvey('parent', saved.surveys?.parent) },
    };
  }
} catch { /* Session storage is optional in this local prototype. */ }
let nativeGame = null;
let sending = false;
let sendError = '';
let draftTimer;
let stream = null;
let cameraGeneration = 0;
let cameraBusy = false;
let cameraError = '';
let cameraChecks = new Set();
let storageNotice = '';
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const button = (label, action, extra = '') => `<button class="primary" data-action="${action}" ${extra}>${label}<span aria-hidden="true">→</span></button>`;
const secondary = (label, action, extra = '') => `<button class="secondary" data-action="${action}" ${extra}>${label}</button>`;
const recipeNow = () => recipes.find(recipe => recipe.id === state.recipeId);
const heading = (eyebrow, title, copy = '') => `<div class="page-heading"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${copy ? `<p class="lead">${copy}</p>` : ''}</div>`;
const back = (stage, text = '戻る') => `<button class="back" data-action="go" data-stage="${stage}"><span aria-hidden="true">←</span> ${text}</button>`;
const credit = recipe => `<p class="photo-credit">完成写真・元レシピ：<a href="${recipe.source}" target="_blank" rel="noopener noreferrer">${recipe.publisher}</a></p>`;
const photo = (recipe, className = 'recipe-photo') => `<img class="${className}" src="${recipe.image}" alt="${esc(recipe.name)}の完成写真" loading="eager" width="720" height="540">`;
const chips = (ids, editable = false) => `<div class="food-chips">${foods.filter(food => ids.includes(food.id)).map(food => `<${editable ? 'button' : 'span'} class="food-chip" ${editable ? `data-action="remove-food" data-food="${food.id}"` : ''}><span aria-hidden="true">${food.emoji}</span>${food.name}${editable ? '<span aria-hidden="true">×</span>' : ''}</${editable ? 'button' : 'span'}>`).join('')}</div>`;

function save() {
  try { storage.setItem(storageKey, JSON.stringify(state)); } catch { /* Private mode remains usable. */ }
}
function readRecords() {
  try { const records = JSON.parse(localStorage.getItem(recordsKey) || '[]'); return Array.isArray(records) ? records : []; }
  catch { return []; }
}
function responseRecord() {
  const recipe = recipeNow();
  return { sessionId: state.sessionId, questionnaireVersion, createdAt: state.createdAt, updatedAt: new Date().toISOString(), demo: demoMode,
    participant: { ...state.participant, childSurveyMode: isYoung(state.participant) ? 'young-current-experience' : 'older-kindergarten-hypothetical' },
    questionnaire: { child: questions.child.map(q => ({ id: q.id, text: isYoung(state.participant) ? q.youngText : q.text })), parent: questions.parent },
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
    questionnaireVersion, recipeVersion: 'daily-2026-11-19-v1', conceptVersion: offer.version,
    sequence: ++state.sequence, age: Number(state.participant.age), demo: demoMode, stage: complete ? 'done' : state.stage,
    selectedIngredients: [...new Set(state.caught)], evidence, recipeId: state.recipeId,
    child: { answers: { ...state.surveys.child.answers }, comment: state.surveys.child.comment },
    parent: { answers: { ...state.surveys.parent.answers }, comment: state.surveys.parent.comment },
    payment: validBudget(market) ? { kind: market.budgetKind, maxMonthlyYen: market.budgetKind === 'paid' ? Number(market.maxMonthlyYen) : market.budgetKind === 'free' ? 0 : null } : null,
    complete,
  }};
}
function checkpoint() {
  if (!production || state.finalPacket || !participantComplete(state.participant)) return;
  clearTimeout(draftTimer);
  const draft = packet(); save();
  void runtime.saveExperience(draft).catch(() => {});
}
function acceptSaved(ack) {
  if (ack.id !== state.sessionId || !ack.complete || !ack.receipt || !state.finalPacket) return;
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
  return `${heading('回答の送信', sending ? '回答を送信しています。' : '回答をもう一度<br>送信してください。')}<p class="lead">保存が完了すると、受付番号が表示されます。</p><p class="survey-error" role="alert">${esc(sendError)}</p>${sending ? '<p role="status">送信中…</p>' : button('回答を再送信する', 'retry-send')}<p class="plain-note">回答内容は保持しています。通信できる状態で、この画面から再送信してください。</p>`;
}
function exportResponses() {
  const records = readRecords();
  const index = records.findIndex(record => record.sessionId === state.sessionId);
  if (index < 0) records.push(responseRecord()); else records[index] = responseRecord();
  const data = { schemaVersion: 2, questionnaireVersion, exportedAt: new Date().toISOString(), demo: demoMode, scale, questions, offer, features, records };
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
  if (role === 'parent') { state.market.experienceCompletedAt = null; state.market.submittedAt = null; }
  const missing = missingQuestions(role, response);
  document.querySelector('#survey-progress').textContent = `回答済み ${questions[role].length - missing.length} / ${questions[role].length}`;
  form.querySelectorAll('[data-question-row]').forEach(row => row.classList.toggle('is-missing', row.classList.contains('is-missing') && missing.some(q => q.id === row.dataset.questionRow)));
  save();
  if (production) { clearTimeout(draftTimer); draftTimer = setTimeout(checkpoint, 900); }
}
function stopCamera() {
  cameraGeneration++;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  cameraBusy = false;
  cameraChecks.clear();
}
function routeId() { return location.hash.slice(1).split('?')[0]; }
function go(stage) {
  if (location.hash === `#${stage}`) render();
  else location.hash = stage;
}
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

function introView() {
  return `${heading('保護者の方へ', '食材の選択から、<br>料理とお手伝いへ。', 'ゲームで選択した食材をもとに、料理とお手伝いの工程を提案する体験です。')}<div class="intro-photo">${photo(recipes[0])}<span>料理と、お手伝いの提案</span></div><ol class="intro-steps"><li><span>1</span><div><b>子どもが食材を選ぶ</b><p>食材を選択するゲームを体験します。</p></div></li><li><span>2</span><div><b>親がレシピを確認する</b><p>材料・作り方と、子どもの担当工程を確認します。</p></div></li><li><span>3</span><div><b>子どもがやることを見る</b><p>完成写真と担当工程を確認し、アンケートに回答します。</p></div></li></ol><p class="study-note">幼稚園くらいのお子さん向けの体験です。年上の方は、当時の自分を思い浮かべてお試しください。</p><p class="plain-note">今回は、レシピと担当工程を見るまでの体験です。実際の調理は行いません。</p><form id="participant-form">${participantFields(state.participant)}<button type="submit" class="primary">子どもに渡して体験を開始<span aria-hidden="true">→</span></button></form><p class="privacy">カメラ映像は端末内だけで使い、送信・保存しません。</p>${production ? '<p class="privacy">アンケートの回答は、PoCの改善・検討のために収集します。名前やログイン情報の入力は不要です。</p>' : ''}${credit(recipes[0])}`;
}

function cameraView() {
  const labels = [['face', '顔'], ['elbows', '両ひじ'], ['hands', '両手']];
  const cameraSize = stream?.getVideoTracks()[0]?.getSettings() ?? {};
  const ratio = cameraSize.width && cameraSize.height ? `${cameraSize.width} / ${cameraSize.height}` : '3 / 4';
  return `${back('intro')}${heading('カメラの準備', 'カメラの写りを<br>確認してください。', '顔・両ひじ・両手が映る位置に端末を設置してください。')}<div class="camera-frame ${stream ? 'has-video' : ''}" data-aspect-ratio="${ratio}"><video id="camera-preview" autoplay muted playsinline aria-label="鏡映しのカメラプレビュー"></video><div class="camera-placeholder"><span aria-hidden="true">◎</span><p>カメラのプレビューを表示します</p></div><div class="body-guide" aria-hidden="true"><div class="guide-head"></div><div class="guide-body"></div><i class="guide-hand left"></i><i class="guide-hand right"></i></div></div><p class="camera-error" role="status">${esc(cameraError)}</p>${!stream ? `${button(cameraBusy ? '準備中…' : 'カメラを起動', 'camera', cameraBusy ? 'disabled' : '')}` : `<div class="camera-checks">${labels.map(([id, label]) => `<label><input type="checkbox" data-camera-check="${id}" ${cameraChecks.has(id) ? 'checked' : ''}><span>${label}が映っている</span></label>`).join('')}</div><p class="plain-note">映像を見てチェックしてください。次の画面では、手の動きで食材をキャッチします。</p>${button('確認してゲームへ進む', 'start-game', cameraChecks.size === 3 ? '' : 'disabled')}`}<button class="text-action" data-action="demo-game">カメラなしで画面を試す</button>`;
}

function gameView() {
  if (production) return '<div id="native-game" class="native-game"></div><button class="text-action" data-action="go" data-stage="camera">カメラの確認に戻る</button>';
  const pair = foodPairs[Math.min(state.caught.length, foodPairs.length - 1)];
  return `${heading('子ども', 'すきなほうを<br>キャッチしよう。')}<p class="demo-label">画面確認用：食材をタップして進みます</p><div class="simple-game"><div class="game-top"><b>${state.score} <small>点</small></b><span>${state.caught.length} / ${foodPairs.length} キャッチ</span></div><div class="catch-choices">${pair.map(id => foods.find(food => food.id === id)).map(food => `<button data-action="catch" data-food="${food.id}" aria-label="${food.name}をキャッチ"><span>${food.emoji}</span><small>${food.name}</small></button>`).join('')}</div><div class="demo-character" aria-hidden="true"><div class="demo-face">◡</div><img src="/avatar/body.png" alt=""></div></div>${stream ? '<div class="live-strip"><video id="live-preview" autoplay muted playsinline aria-label="ゲーム中のカメラ映像"></video><span>カメラの写りを<br>ここで確認</span></div>' : ''}${chips(state.caught)}<button class="text-action" data-action="go" data-stage="result">ここまでで終わる</button>`;
}

function resultView() {
  return `<div class="center-view">${heading('ゲーム結果', 'ナイスキャッチ！')}<p class="score">${state.score}<span>点</span></p><p class="section-label">今回、選んだ食材</p>${chips(state.caught)}${!state.caught.length ? '<p class="muted">今回はキャッチがありませんでした。</p>' : ''}${button('つぎへ', 'go', 'data-stage="handoff"')}</div>`;
}

function handoffView() {
  return `<div class="center-view">${heading('子ども → 親', '親に<br>わたしてください。', '続いて、保護者がレシピを確認します。')}${button('親が受け取りました', 'go', 'data-stage="recipes"')}</div>`;
}

function recipeListView() {
  const list = suggestions(state.caught, state.showAll);
  return `${heading('保護者の方へ', '選択した食材から<br>料理を提案します。', '完成写真・材料・調理時間を確認し、レシピをご覧ください。')}<section class="chosen-foods"><p class="section-label">ゲームで選択した食材</p>${state.caught.length ? chips(state.caught) : '<p class="muted">食材は未選択です。</p>'}</section><div class="recipe-list">${list.map(recipe => {
    const hit = matches(recipe, state.caught);
    return `<article class="recipe-card">${photo(recipe)}<div class="recipe-card-body"><p class="match-label">${hit.length ? `${hit.map(food => food.name).join('・')}を使えます` : '食材の一致なし・参考レシピ'}</p><h2>${recipe.name}</h2><div class="recipe-meta"><span>${duration(recipe)}</span><span>${recipe.servings}</span><span>${categoryLabels[recipe.category]}</span></div>${button('レシピを見る', 'open-recipe', `data-recipe="${recipe.id}" aria-label="${recipe.name}のレシピを見る"`)}</div></article>`;
  }).join('')}</div>${!list.length ? `<div class="empty-state"><h2>この${recipes.length}品には、<br>一致する食材がありません。</h2><p>使う食材を見直すか、参考としてほかのレシピを見られます。</p>${secondary('参考レシピを見る', 'show-all')}</div>` : ''}${!state.showAll && list.length && list.length < recipes.length ? secondary(`すべてのレシピを見る（${recipes.length}品）`, 'show-all') : ''}<p class="plain-note">完成写真と元レシピの出典は、各レシピの画面に記載しています。子どもの担当工程は、この体験用に提案したものです。</p>`;
}

function chooseRecipe(recipe) {
  if (state.recipeId !== recipe.id && Object.values(state.surveys).some(response => Object.keys(response.answers).length)) {
    state.sessionId = crypto.randomUUID(); state.key = newKey(); state.sequence = 0; state.receipt = null; state.finalPacket = null; state.createdAt = new Date().toISOString(); state.surveys = { child: freshSurvey(), parent: freshSurvey() };
    state.market = freshMarket();
  }
  state.recipeId = recipe.id;
}
function recipeDetailView(recipe) {
  const hit = matches(recipe, state.caught);
  const task = childTaskFor(recipe);
  return `${back('recipes', '候補に戻る')}<p class="eyebrow">レシピを確認</p>
    ${photo(recipe, 'recipe-photo detail-photo')}<h1 class="recipe-title">${recipe.name}</h1>
    <div class="recipe-meta"><span>${duration(recipe)}</span><span>${recipe.servings}</span></div>
    ${hit.length ? `<p class="match-label">選んだ${hit.map(food => food.name).join('・')}を使います</p>` : ''}
    <p class="lead recipe-description">${recipe.description}</p>${credit(recipe)}
    <p class="recipe-child-role"><b>子どもの担当：</b>${task.title}</p>
    <section class="content-section"><h2>使う材料</h2><ul class="materials">${recipe.materials.map(item => `<li>${item}</li>`).join('')}</ul></section>
    <section class="content-section"><h2>料理の流れ</h2><ol class="cooking-overview">${recipe.steps.map(step => `<li><span class="role-label ${step.task === recipe.childTaskId ? 'child-role' : ''}">${step.task === recipe.childTaskId ? '子ども' : '大人'}</span><b>${step.title}</b><p>${step.detail}</p></li>`).join('')}</ol></section>
    <section class="prep-note"><p class="section-label">大人が先に準備すること</p><p>${recipe.adultPrep}</p></section>
    <p class="fine-print">${recipe.timeNote}</p><p class="fine-print">${recipe.evidence}</p>
    <p class="fine-print">家庭の材料・商品の表示、お子さんができる作業を確認してください。</p>
    <div class="sticky-action">${button('子どもに渡す', 'show-child')}</div>`;
}
function childTaskView(recipe) {
  const task = childTaskFor(recipe);
  return `${back('recipe', 'ごはんを みる')}${heading('こども', 'きみの おてつだい')}
    <div class="dish-context child-recipe-context">${photo(recipe)}<div><span>この ごはんの おてつだいだよ</span><b>${recipe.childName}</b></div></div>
    <h2 class="child-task-title">${task.childTitle}</h2>
    ${task.photo ? `<figure class="task-figure"><img src="${task.photo}" alt="${task.title}の工程イメージ" width="1448" height="1086"><figcaption>工程説明用の生成画像</figcaption></figure>` : ''}
    <ol class="child-instructions">${task.instructions.map((line, i) => `<li><span>${i + 1}</span><p>${line}</p></li>`).join('')}</ol>
    <p class="child-care">${task.care}</p>
    <p class="plain-note">いまは みるだけで だいじょうぶだよ。</p>
    ${button('かんそうを きかせてね', 'go', 'data-stage="child-survey"')}`;
}

function surveyView(parent) {
  const role = parent ? 'parent' : 'child';
  if (parent && state.market.step !== 'experience') return marketView(state.market, production);
  const young = !parent && isYoung(state.participant);
  return `${heading(parent ? '保護者の方へ' : '子どもの方へ', young ? 'あそんだ かんそうを<br>おしえてね。' : '体験の感想を<br>教えてください。')}${surveyForm(role, state.surveys[role], young)}`;
}
function doneView() {
  if (production) return `<div class="center-view">${heading('回答の保存が完了しました', 'ありがとう<br>ございました。')}<p class="lead">回答を受け付けました。</p><p class="receipt">受付番号：${esc(state.receipt)}</p>${demoMode ? '<p class="plain-note">デモ回答として保存しました。通常の集計からは除外します。</p>' : ''}${secondary('新しい体験を始める', 'reset')}</div>`;
  const complete = state.surveys.child.submittedAt && state.surveys.parent.submittedAt && marketComplete(state.market);
  return `<div class="center-view">${heading('体験のおわり', 'ありがとう<br>ございました。', '料理とお手伝いの内容を見る体験は、ここまでです。')}
    <p class="plain-note">${storageNotice || (complete ? '回答をこの端末のブラウザに保存しました。' : 'アンケートはまだ完了していません。')}${demoMode ? ' デモ回答は通常の回答とは別に保存しています。' : ''}</p>
    ${secondary('回答データをJSON保存', 'export-survey')}${secondary('レシピの確認をもう一度試す', 'sample')}
  </div>`;
}

function render() {
  let stage = production && state.finalPacket ? (state.receipt ? 'done' : 'parent-survey') : routeId() || state.stage;
  stage = ({ help: 'recipe', 'child-recipe': 'child-task' })[stage] ?? stage;
  if (!stages.some(item => item.id === stage)) stage = 'intro';
  if (stage !== 'intro' && !participantComplete(state.participant)) stage = 'intro';
  if (['recipe', 'child-task'].includes(stage) && !recipeNow()) stage = 'recipes';
  if (production && stage === 'game' && state.gameFinished) stage = 'result';
  if (!production && stage === 'game' && state.caught.length >= foodPairs.length) stage = 'result';
  if (nativeGame) { nativeGame.destroy(); nativeGame = null; }
  state.stage = stage;
  if (routeId() !== stage) history.replaceState(null, '', `#${stage}`);
  if (stage !== 'camera' && (production || stage !== 'game')) stopCamera();
  actor.textContent = stages.find(item => item.id === stage).actor;
  const recipe = recipeNow();
  const views = {
    intro: introView, camera: cameraView, game: gameView, result: resultView, handoff: handoffView,
    recipes: recipeListView, recipe: () => recipeDetailView(recipe),
    'child-task': () => childTaskView(recipe),
    'child-survey': () => surveyView(false), 'parent-survey': () => surveyView(true), done: doneView,
  };
  app.innerHTML = production && state.finalPacket && !state.receipt ? sendingView() : views[stage]();
  if (stage === 'game' && production) {
    nativeGame = runtime.mountGame(app.querySelector('#native-game'), { input: state.gameInput, onFinish: async evidence => {
      state.gameFinished = true;
      state.evidence = Object.fromEntries(foods.map(food => [food.id, evidence[food.id]]));
      state.caught = foods.flatMap(food => Array(evidence[food.id].caught).fill(food.id));
      state.score = state.caught.length * 100; save(); checkpoint(); go('result');
    }});
  }
  app.dataset.screen = stage;
  renderPanel();
  save();
  const frame = app.querySelector('.camera-frame');
  if (frame) frame.style.aspectRatio = frame.dataset.aspectRatio;
  if (stream) {
    const video = app.querySelector('video');
    if (video) { video.srcObject = stream; void video.play().catch(() => {}); }
  }
  document.body.classList.remove('flow-open');
  document.querySelector('#flow-toggle').setAttribute('aria-expanded', 'false');
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
  if (production && stage !== 'game') checkpoint();
}

async function activateCamera() {
  if (cameraBusy) return;
  cameraBusy = true;
  cameraError = '';
  const generation = ++cameraGeneration;
  render();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unavailable');
    const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
    if (generation !== cameraGeneration || state.stage !== 'camera') { next.getTracks().forEach(track => track.stop()); return; }
    stream?.getTracks().forEach(track => track.stop());
    stream = next;
    cameraChecks.clear();
  } catch (error) {
    if (generation !== cameraGeneration) return;
    cameraError = error.name === 'NotAllowedError' ? 'カメラを使うには、ブラウザでの許可が必要です。画面だけ試すこともできます。' : 'カメラを使えませんでした。localhost または HTTPS で開くか、画面だけ試してください。';
  } finally {
    if (generation === cameraGeneration) { cameraBusy = false; render(); }
  }
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
  if (action === 'reset') { stopCamera(); state = freshState(); cameraError = ''; storageNotice = ''; go('intro'); }
  if (action === 'camera') void activateCamera();
  if (action === 'demo-game' || action === 'start-game') { state.caught = []; state.evidence = {}; state.gameFinished = false; state.score = 0; state.recipeId = null; state.gameInput = action === 'start-game' ? 'camera' : 'demo'; go('game'); }
  if (action === 'market-back') { state.market.step = target.dataset.step; save(); render(); }
  if (action === 'market-next') { state.market.step = 'budget'; save(); render(); }
  if (action === 'review-market') { state.market.step = 'concept'; go('parent-survey'); }
  if (action === 'catch') { const pair = foodPairs[state.caught.length]; for (const id of pair) { state.evidence[id] ||= {offered:0,caught:0}; state.evidence[id].offered++; } state.evidence[target.dataset.food].caught++; state.caught.push(target.dataset.food); state.score += 100; state.caught.length >= foodPairs.length ? go('result') : render(); }
  if (action === 'show-all') { state.showAll = true; render(); }
  if (action === 'open-recipe') {
    const recipe = recipes.find(item => item.id === target.dataset.recipe);
    if (recipe) { chooseRecipe(recipe); go('recipe'); }
  }
  if (action === 'show-child') go('child-task');
  if (action === 'export-survey') exportResponses();
});

document.addEventListener('change', event => {
  const target = event.target;
  if (target.dataset.cameraCheck) {
    target.checked ? cameraChecks.add(target.dataset.cameraCheck) : cameraChecks.delete(target.dataset.cameraCheck);
    app.querySelector('[data-action="start-game"]').disabled = cameraChecks.size !== 3;
  }
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
      state.sessionId = crypto.randomUUID(); state.key = newKey(); state.sequence = 0; state.receipt = null; state.finalPacket = null; state.createdAt = new Date().toISOString();
      state.surveys = { child: freshSurvey(), parent: freshSurvey() }; state.market = freshMarket();
    }
    state.participant = participant; save(); go('camera'); return;
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
    state.market.experienceCompletedAt = new Date().toISOString(); state.market.step = 'concept'; save(); persistResponse(); render();
  } else {
    state.surveys.child.submittedAt = new Date().toISOString(); save(); persistResponse(); go('parent-survey');
  }
});

function updateMarket(form) {
  const data = new FormData(form); const market = state.market;
  market.budgetKind = String(data.get('budgetKind') || '');
  const field = form.querySelector('.amount-field'); const input = form.querySelector('[name="maxMonthlyYen"]');
  field.hidden = market.budgetKind !== 'paid'; input.disabled = market.budgetKind !== 'paid'; input.required = market.budgetKind === 'paid';
  market.maxMonthlyYen = input.value;
  market.submittedAt = null; state.surveys.parent.submittedAt = null; save();
}
function submitMarket(form) {
  updateMarket(form); const market = state.market;
  if (!validBudget(market)) { document.querySelector('#market-error').textContent = '回答を選び、金額を入力する場合は1円以上の整数を入力してください。'; return; }
  if (!market.experienceCompletedAt || missingQuestions('parent', state.surveys.parent).length) { market.step = 'experience'; save(); render(); return; }
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
window.addEventListener('pagehide', () => { stopCamera(); nativeGame?.destroy(); });
if (production) runtime.onSaved(acceptSaved);
render();
if (production) { if (state.finalPacket && !state.receipt) void submitFinal(); void runtime.flushOutbox(); }
