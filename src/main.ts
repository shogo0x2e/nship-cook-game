import './style.css';
import { ingredients, recipes, recommend, type IngredientId } from './game';
import { mountGame } from './game-scene';
import { cookingPlans, type RoomAction, type RoomResponse, type RoomState } from './shared';
import { ApiError, SessionClient, request, savedConnection, saveConnection } from './session-client';

const root = document.querySelector<HTMLDivElement>('#app')!;
let client: SessionClient | null = null;
let state: RoomState | null = null;
let online = false, busy = false, errorMessage = '', expired = false;
let entry: 'choose' | 'adult' | 'child' = 'choose';
let showRecipes = false;
let game: ReturnType<typeof mountGame> | null = null;
let mountedRound = '';
const excluded = new Set<IngredientId>();
const allergens = new Set<string>();
const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector);
const safe = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const disabled = () => busy || !online ? 'disabled' : '';
const button = (action: string, label: string, extra = '') => `<button class="button primary" data-action="${action}" ${disabled()} ${extra}>${label}</button>`;
function errorText(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 404 || error.status === 401) return '部屋が見つからないか、有効期限が切れました。大人の端末で新しい部屋を作ってください。';
    if (error.status === 409) return '状態が変わったか、すでに参加済みです。表示を確認してください。参加済みの子どもは元のタブに戻ってください。';
    if (error.status === 429) return '操作が続いたため、少し待ってからもう一度お試しください。';
    if (error.status === 400) return '入力内容や使わない食材を確認してください。食材は1つ以上残してください。';
  }
  return 'つながりませんでした。Macの起動と同じWi-Fiへの接続を確認して、もう一度お試しください。';
}
function header() {
  return `<header class="header"><span class="brand">もぐもぐキャッチ</span><span class="header-right">${client ? client.connection.role === 'adult' ? '大人のスマホ' : '子どものタブレット' : '親子の料理 PoC'}</span></header><div class="connection-bar" role="status">${client ? `<span id="connection-state">${online ? '● つながっています' : '○ 再接続しています…'}</span><span>部屋 <b>${client.connection.code}</b></span>` : 'スマホとタブレットを、同じWi-Fiに。'}</div><p class="session-error" role="alert" id="session-error">${safe(errorMessage)}</p>`;
}
function destroyGame() { game?.destroy(); game = null; mountedRound = ''; }
function render() {
  // Preserve the video, animation and unsent result during polling.
  if (!expired && client?.connection.role === 'child' && state?.stage === 'game' && game && mountedRound === state.game.roundId) { updateStatus(); return; }
  destroyGame();
  root.innerHTML = header() + (!client ? entryView() : expired ? '<main class="page child-center"><h1>部屋は終了しました。</h1><p>大人の端末で新しい部屋をつくってください。</p><button class="text-button" data-action="leave">部屋の選択へ戻る</button></main>' : !state ? '<main class="page child-center"><h1>部屋につないでいます…</h1><button class="text-button" data-action="leave">接続をやり直す</button></main>' : client.connection.role === 'adult' ? adultView(state) : childView(state));
  if (!expired && client?.connection.role === 'child' && state?.stage === 'game') {
    const roundId = state.game.roundId;
    mountedRound = roundId;
    const food = ingredients.filter(i => !state!.excluded.includes(i.id) && !i.allergens.some(a => state!.allergens.includes(a))).map(i => i.id);
    game = mountGame($('#child-game')!, { input: state.game.input, allowed: food,
      onStatus: status => client!.action({ type: 'GAME_STATUS', roundId, status }),
      onFinish: evidence => client!.action({ type: 'GAME_RESULT', roundId, evidence }),
      canPlay: () => online,
    });
    if (state.game.status === 'playing') void client.action({ type: 'GAME_STATUS', roundId, status: 'paused' }).catch(() => {});
  }
  updateStatus();
}
function updateStatus() {
  const status = $('#connection-state');
  if (status) status.textContent = expired ? '○ 部屋は終了しました' : online ? '● つながっています' : '○ 再接続しています…';
  const error = $('#session-error'); if (error) error.textContent = errorMessage;
  root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('[data-action]:not([data-action="leave"]), [data-select]').forEach(element => { element.disabled = client ? busy || !online : busy; });
  if (state && !state.childJoined) root.querySelectorAll<HTMLButtonElement>('[data-action^="start-"]').forEach(element => { element.disabled = true; });
}
function entryView() {
  if (entry === 'choose') return `<main class="page pairing"><p class="audience">大人はスマホ、子どもはタブレット</p><h1>いっしょに、<br>今日のごはんを。</h1><p>子どもが食材をキャッチ。<br>大人が献立を選んで、お手伝いを届けます。</p><div class="entry-actions"><button class="button primary" data-action="entry-adult">大人：部屋をつくる →</button><button class="button secondary" data-action="entry-child">子ども：部屋に入る →</button></div><p class="small-note">名前・年齢の入力はありません。<br>映像はタブレット内で処理。食材・進捗だけをMacで共有します。</p></main>`;
  if (entry === 'child') return `<main class="page pairing"><p class="audience">子どものタブレット</p><h1>部屋に入ろう。</h1><form id="join-form"><label for="room-code">大人の画面にある6けたの数字</label><input id="room-code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required aria-describedby="join-note"><button class="button primary" type="submit" ${busy ? 'disabled' : ''}>つなぐ →</button></form><p class="small-note" id="join-note">大人と同じURLで開いてね。</p><button class="text-button" data-action="entry-back">← 戻る</button></main>`;
  return `<main class="page pairing"><p class="audience">大人のスマホ</p><h1>準備は、これだけ。</h1><p>部屋をつくったら、子どものタブレットで<br>同じURLを開き、6桁コードを入れます。</p><details class="onboard-settings"><summary>使わない食材を選ぶ（任意）</summary><div class="chips">${ingredients.map(i => `<label class="chip exclude ${excluded.has(i.id) ? 'active' : ''}"><input type="checkbox" data-exclude="${i.id}" ${excluded.has(i.id) ? 'checked' : ''}>${i.emoji} ${i.name}</label>`).join('')}</div><div class="allergy-row">含むレシピを除外：${['卵', '乳'].map(a => `<label><input type="checkbox" data-allergen="${a}" ${allergens.has(a) ? 'checked' : ''}> ${a}</label>`).join('')}</div><p class="small-note">全アレルゲンには対応していません。大人が全材料・製品表示を確認してください。</p></details><button class="button primary" data-action="create" ${busy ? 'disabled' : ''}>部屋をつくる →</button><button class="text-button block-button" data-action="entry-back">← 戻る</button><p class="small-note">包丁・火・熱い器具は大人の担当。<br>遊びも調理も、大人がそばで見守ってください。</p></main>`;
}
function startOptions(s: RoomState) {
  return `<div class="entry-actions">${button('start-camera', 'からだで食材キャッチ →', s.childJoined ? '' : 'disabled')}${button('start-demo', 'カメラなしで おためし', s.childJoined ? '' : 'disabled')}</div><p class="small-note">カメラはタブレットで許可します。信頼されたHTTPSが必要です。<br>30秒・その場でゆっくり左右へ。座ったままでも遊べます。</p>`;
}
function adultView(s: RoomState) {
  const close = '<footer class="room-footer"><button class="text-button" data-action="close">部屋を終了する</button></footer>';
  if (s.stage === 'lobby') return `<main class="page adult-page pairing"><p class="audience">子どものタブレットとつなぐ</p><h1>${s.childJoined ? 'つながりました。' : 'このコードを、タブレットへ。'}</h1><div class="pair-code" aria-label="参加コード">${client!.connection.code}</div><p>${s.childJoined ? '見守る準備ができたら、遊び方を選んでください。' : '同じURLで「子ども：部屋に入る」を選びます。'}</p>${startOptions(s)}${close}</main>`;
  if (s.stage === 'game') return `<main class="page adult-page pairing"><p class="audience">子どものタブレットで遊んでいます</p><h1>${s.game.status === 'ready' ? '子どもの準備を待っています。' : s.game.status === 'paused' ? 'いまは、ひとやすみ。' : 'どんな食材が、とれるかな。'}</h1><div class="home-foods" aria-hidden="true">🍅　🥕　🥦</div><p>そばで見守ってください。<br>終わると、こちらに食材の結果が届きます。</p><p class="small-note">カメラ映像・姿勢は共有しません。途中の個数は送らず、終了時に結果を届けます。</p><button class="text-button" data-action="cancel-game">ゲームを中止して選び直す</button>${close}</main>`;
  if (s.stage === 'review') return `<main class="page adult-page">${showRecipes ? recipeView(s) : reviewView(s)}${close}</main>`;
  if (s.stage === 'complete') return `<main class="page adult-page pairing"><p class="audience">${safe(recipes.find(r => r.id === s.selectedRecipeId)!.name)}</p><h1>ふたりで、できました。</h1><span class="celebration" aria-hidden="true">🍽️</span><p>全工程が完了しました。<br>温度と食べやすさを確認して、いただきます。</p>${button('back-review', '食材と献立に戻る')}${close}</main>`;
  return `<main class="page adult-page supervise">${superviseView(s)}${close}</main>`;
}
function reviewView(s: RoomState) {
  const options = ingredients.filter(i => !s.excluded.includes(i.id) && !i.allergens.some(a => s.allergens.includes(a)));
  return `<p class="audience">大人が確認する</p><h1>今日、気になった食材。</h1><p>キャッチは好みのヒントです。お子さんに聞きながら選び直せます。</p><div class="food-choices">${options.map(i => `<label class="food-choice ${s.selected.includes(i.id) ? 'chosen' : ''}"><input type="checkbox" data-select="${i.id}" ${s.selected.includes(i.id) ? 'checked' : ''} ${disabled()}><span class="choice-check">✓</span><span class="choice-emoji">${i.emoji}</span><b>${i.name}</b><small>${s.game.evidence[i.id].caught}こ キャッチ</small></label>`).join('')}</div><p class="small-note">取り逃した食材を「苦手」とはみなしません。キャッチがなくても選べます。</p>${button('recipes', 'この食材をヒントに 献立を見る →')}<details class="replay-options"><summary>もう一度あそぶ</summary>${startOptions(s)}</details>`;
}
function recipeView(s: RoomState) {
  const unavailable = new Set([...s.excluded, ...ingredients.filter(i => i.allergens.some(a => s.allergens.includes(a))).map(i => i.id)]);
  const suggestions = recommend(s.selected, unavailable, new Set(s.allergens));
  return `<button class="text-button" data-action="review">← 食材の選択へ</button><h1>今日の献立を、選ぼう。</h1><p>大人＋子ども 約2人分の目安。材料を確認してから選んでください。</p>${!s.selected.length ? '<p class="info-note">食材は未選択です。分担しやすいサンプルを表示しています。</p>' : ''}<div class="recipe-grid">${suggestions.map(r => `<article class="recipe-card"><div class="recipe-body"><div class="recipe-meta"><span>約${r.minutes}分</span><span>${r.allergens.length ? `含む：${r.allergens.join('・')}` : '卵・乳 不使用'}</span></div><h2>${safe(r.name)}</h2><p class="match-note">${r.foods.filter(id => s.selected.includes(id)).map(id => ingredients.find(i => i.id === id)!.name).join('・') || '親子で分担しやすいサンプル'}</p><details class="recipe-details"><summary>材料・全工程を見る ＋</summary><h3>材料</h3><ul>${r.materials.map(m => `<li>${safe(m)}</li>`).join('')}</ul><ol>${cookingPlans[r.id].map(step => `<li><b>${step.role === 'child' ? '子ども' : '大人'}：${safe(step.title)}</b><br>${safe(step.detail)}</li>`).join('')}</ol></details>${button('choose-recipe', 'この献立で つくる →', `data-recipe="${r.id}"`)}</div></article>`).join('')}</div>${suggestions.length ? '' : '<p class="no-recipes">今の除外条件に合うレシピはありません。部屋を終了して条件を見直すか、別の献立を大人が用意してください。</p>'}<p class="recipe-warning">アレルギーの安全性は保証できません。全材料・製品表示を大人が確認し、年齢や発達に合わせて調整してください。</p>`;
}
function superviseView(s: RoomState) {
  const recipe = recipes.find(r => r.id === s.selectedRecipeId)!;
  const steps = cookingPlans[recipe.id], c = s.cooking;
  return `<p class="audience">大人：全工程と見守り</p><h1>${safe(recipe.name)}</h1><p class="progress-label">${c.completedStepIds.length} / ${steps.length} 工程 完了</p><progress max="${steps.length}" value="${c.completedStepIds.length}" aria-label="調理の進み具合"></progress><p class="info-note">${c.childReportStepId ? '子どもから「できた」が届きました。手元を確認して完了にしてください。' : c.activeStepId ? steps.find(step => step.id === c.activeStepId)!.role === 'child' ? '子どもの端末に、現在のお手伝いを表示しています。' : 'いまは大人の担当。子どもの端末には待つ画面を表示しています。' : '次の工程を始めてください。'}</p><ol class="step-list">${steps.map((step, index) => {
    const complete = c.completedStepIds.includes(step.id), active = c.activeStepId === step.id;
    const ready = !c.activeStepId && step.requires.every(id => c.completedStepIds.includes(id));
    return `<li class="step-card ${complete ? 'step-complete' : active ? 'step-active' : ''}"><span class="step-role">${index + 1} · ${step.role === 'child' ? '子ども' : '大人'} ${complete ? '✓ 完了' : active ? '· いまの工程' : ''}</span><h2>${safe(step.title)}</h2><p>${safe(step.detail)}</p>${complete ? '' : active ? step.role === 'adult' ? button('complete-step', '大人の工程を完了する', `data-step="${step.id}"`) : c.childReportStepId === step.id ? button('complete-step', '手元を確認した：完了にする', `data-step="${step.id}"`) : '<p class="waiting-report" role="status">子どもの「できた」を待っています。</p>' : ready ? button('activate-step', step.role === 'child' ? 'このお手伝いを子どもに渡す →' : 'この工程を始める', `data-step="${step.id}"`) : '<small>前の工程が終わると始められます。</small>'}</li>`;
  }).join('')}</ol><details class="recipe-details"><summary>材料をもう一度見る</summary><ul>${recipe.materials.map(m => `<li>${safe(m)}</li>`).join('')}</ul></details><button class="text-button" data-action="back-review">調理をやめて献立を選び直す</button>`;
}
function childView(s: RoomState) {
  if (s.stage === 'game') return '<main class="page game-page"><div id="child-game"></div></main>';
  let content: string;
  if (s.stage === 'lobby') content = '<span class="celebration" aria-hidden="true">🧺</span><h1>つながったよ！</h1><p>あそぶじゅんびを、大人にお願いしてね。</p>';
  else if (s.stage === 'review') content = '<span class="celebration" aria-hidden="true">🥕</span><h1>どのごはんに、なるかな。</h1><p>大人が食材と献立をえらんでいるよ。<br>いっしょに、今日の食材を話してみよう。</p>';
  else if (s.stage === 'complete') content = '<span class="celebration" aria-hidden="true">🍽️</span><h1>いっしょに、できたね！</h1><p>おてつだい、ありがとう。<br>大人といっしょに、いただきます。</p>';
  else {
    const steps = cookingPlans[s.selectedRecipeId!], step = steps.find(step => step.id === s.cooking.activeStepId);
    content = step?.role === 'child' ? `<p class="audience">いまの おてつだい</p><span class="celebration" aria-hidden="true">🙌</span><h1>${safe(step.title)}</h1><p class="child-detail">${safe(step.detail)}</p>${s.cooking.childReportStepId === step.id ? '<p class="report-sent" role="status">できたを送ったよ！<br>大人がたしかめているよ。</p>' : button('child-done', 'できた！ →', `data-step="${step.id}"`)}<p class="small-note">こまったら、大人をよんでね。</p>` : '<span class="celebration" aria-hidden="true">🌱</span><h1>つぎのおてつだいを、まとう。</h1><p>いまは、大人がじゅんびしているよ。<br>包丁やあつい道具には、さわらないでね。</p>';
  }
  return `<main class="page child-center">${content}</main>`;
}
function connect(response: RoomResponse | ReturnType<typeof savedConnection>) {
  if (!response) return;
  client?.stop(); state = null; online = false; expired = false; errorMessage = ''; showRecipes = false;
  const connection = { roomId: response.roomId, token: response.token, role: response.role, code: response.code };
  saveConnection(connection);
  client = new SessionClient(connection, next => { state = next; render(); }, (connected, error) => {
    const wasOnline = online;
    online = connected;
    if (connected) { expired = false; if (!wasOnline) { errorMessage = ''; game?.syncStatus(); } }
    else { game?.pause('つながりが戻るまで、ひとやすみ。'); errorMessage = errorText(error); if (error instanceof ApiError && [401, 404].includes(error.status)) { expired = true; client?.stop(); render(); } }
    updateStatus();
  });
  render(); client.start('state' in response ? response : undefined);
}
async function perform(work: () => Promise<unknown>) {
  if (busy) return;
  busy = true; errorMessage = ''; updateStatus();
  try { await work(); }
  catch (error) { errorMessage = errorText(error); }
  finally { busy = false; updateStatus(); }
}
async function act(action: RoomAction) { if (client && online) await client.action(action); }
function leave() { client?.stop(); destroyGame(); client = null; state = null; online = false; expired = false; errorMessage = ''; saveConnection(null); entry = 'choose'; render(); }
root.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  if (action === 'entry-adult' || action === 'entry-child' || action === 'entry-back') { entry = action === 'entry-adult' ? 'adult' : action === 'entry-child' ? 'child' : 'choose'; errorMessage = ''; render(); return; }
  if (action === 'leave') { leave(); return; }
  if (action === 'recipes' || action === 'review') { showRecipes = action === 'recipes'; render(); window.scrollTo({ top: 0 }); return; }
  void perform(async () => {
    if (action === 'create') connect(await request<RoomResponse>('/api/rooms', 'POST', { excluded: [...excluded], allergens: [...allergens] }));
    if (action === 'start-camera' || action === 'start-demo') { showRecipes = false; await act({ type: 'START_GAME', input: action === 'start-camera' ? 'camera' : 'demo' }); }
    if (action === 'cancel-game') await act({ type: 'CANCEL_GAME' });
    if (action === 'choose-recipe') { await act({ type: 'CHOOSE_RECIPE', recipeId: target.dataset.recipe! }); window.scrollTo({ top: 0 }); }
    if (action === 'activate-step' || action === 'complete-step' || action === 'child-done') await act({ type: action === 'activate-step' ? 'ACTIVATE_STEP' : action === 'complete-step' ? 'COMPLETE_STEP' : 'CHILD_DONE', stepId: target.dataset.step! });
    if (action === 'back-review' && (state?.stage === 'complete' || window.confirm('調理の進捗をリセットして、献立の選択に戻りますか？'))) { showRecipes = false; await act({ type: 'BACK_TO_REVIEW' }); }
    if (action === 'close' && window.confirm('この部屋を終了しますか？子どもの端末との共有も終了します。')) { await request(`/api/rooms/${client!.connection.roomId}`, 'DELETE', undefined, client!.connection.token); leave(); }
  });
});
root.addEventListener('submit', event => {
  if ((event.target as HTMLElement).id !== 'join-form') return;
  event.preventDefault();
  const code = $<HTMLInputElement>('#room-code')!.value.trim();
  void perform(async () => connect(await request<RoomResponse>('/api/join', 'POST', { code })));
});
root.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (input.dataset.exclude) { const id = input.dataset.exclude as IngredientId; input.checked ? excluded.add(id) : excluded.delete(id); input.closest('label')?.classList.toggle('active', input.checked); }
  if (input.dataset.allergen) input.checked ? allergens.add(input.dataset.allergen) : allergens.delete(input.dataset.allergen);
  if (input.dataset.select) {
    const selected = [...root.querySelectorAll<HTMLInputElement>('[data-select]:checked')].map(element => element.dataset.select as IngredientId);
    void perform(async () => { await act({ type: 'SET_SELECTED', selected }); render(); root.querySelector<HTMLInputElement>(`[data-select="${input.dataset.select}"]`)?.focus({ preventScroll: true }); });
  }
});
window.addEventListener('pagehide', () => { game?.pause('画面を離れたので、ひとやすみ。'); destroyGame(); client?.stop(); });
window.addEventListener('pageshow', event => { if (event.persisted) connect(savedConnection()); });
const saved = savedConnection(); if (saved) connect(saved); else render();
