import './style.css';
import { ingredients, recipes, recommend, type IngredientId } from './game';
import { mountGame } from './game-scene';
import { cookingPlans, type FamilyAction, type FamilyState, type Role } from './shared';
import { ApiError, SessionClient, request, savedRole, saveRole } from './session-client';

const root=document.querySelector<HTMLDivElement>('#app')!;
let client:SessionClient|null=null, state:FamilyState|null=null;
let username:string|null=null, checking=true, authMode:'login'|'register'='login';
let online=false,busy=false,errorMessage='',showRecipes=false;
let game:ReturnType<typeof mountGame>|null=null,mountedRound='';
const $=<T extends HTMLElement>(selector:string)=>root.querySelector<T>(selector);
const safe=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const disabled=()=>busy||!online?'disabled':'';
const button=(action:string,label:string,extra='')=>`<button class="button primary" data-action="${action}" ${disabled()} ${extra}>${label}</button>`;
function errorText(error:unknown){
  if(error instanceof ApiError){
    if(error.status===401)return 'ユーザー名またはパスワードを確認してください。ログインの期限が切れた場合は、もう一度ログインしてください。';
    if(error.status===409&&error.message==='Username unavailable')return 'そのユーザー名は使えません。別の名前を選ぶか、ログインしてください。';
    if(error.status===409)return '状態が変わりました。現在の画面を確認して、もう一度お試しください。';
    if(error.status===429)return '操作が続いたため、少し待ってからもう一度お試しください。';
    if(error.status===400){if(error.message.startsWith('Username'))return 'ユーザー名は半角英数字・_・-の3〜32文字で入力してください。';if(error.message.startsWith('Password'))return 'パスワードは15〜128文字で入力してください。';if(error.message.includes('ingredient'))return '食材を1つ以上残してください。';return '入力内容を確認して、もう一度お試しください。';}
  }
  return 'つながりませんでした。通信を確認して、もう一度お試しください。';
}
function header(){return `<header class="header"><span class="brand">もぐもぐキャッチ</span><span class="header-right">${client?client.connection.role==='adult'?'大人のスマホ':'子どものタブレット':'親子の料理 PoC'}</span></header>${username?`<div class="connection-bar"><span id="connection-state" role="status">${online?'● つながっています':'○ 接続しています…'}</span><span class="account-name">${safe(username)}</span><button class="text-button" data-action="switch-role">画面を切替</button><button class="text-button" data-action="logout">ログアウト</button></div>`:''}<p class="session-error" role="alert" id="session-error">${safe(errorMessage)}</p>`;}
function destroyGame(){game?.destroy();game=null;mountedRound='';}
function render(){
  if(client?.connection.role==='child'&&state&&isGameActive(state)&&game&&mountedRound===state.game.roundId){updateStatus();return;}
  destroyGame();
  root.innerHTML=header()+(checking?'<main class="page child-center"><p>ログイン状態を確認しています…</p></main>':!username?authView():!client?roleView():!state?'<main class="page child-center"><p>家庭のデータを読み込んでいます…</p></main>':client.connection.role==='adult'?adultView(state):childView(state));
  if(client?.connection.role==='child'&&state&&isGameActive(state)){
    const roundId=state.game.roundId;mountedRound=roundId;
    const allowed=ingredients.filter(i=>!state!.excluded.includes(i.id)&&!i.allergens.some(a=>state!.allergens.includes(a))).map(i=>i.id);
    game=mountGame($('#child-game')!,{input:state.game.input,allowed,canPlay:()=>online,
      onStatus:status=>client!.action({type:'GAME_STATUS',roundId,status}),
      onFinish:evidence=>client!.action({type:'GAME_RESULT',roundId,evidence})});
    if(state.game.status==='playing')void client.action({type:'GAME_STATUS',roundId,status:'paused'}).catch(()=>{});
  }
  updateStatus();
}
function isGameActive(s:FamilyState){return ['ready','playing','paused'].includes(s.game.status);}
function updateStatus(){
  const status=$('#connection-state');if(status)status.textContent=online?'● つながっています':client?'○ 再接続しています…':'家庭アカウント';
  const error=$('#session-error');if(error)error.textContent=errorMessage;
  root.querySelectorAll<HTMLButtonElement|HTMLInputElement>('[data-action],[data-select],#auth-form button').forEach(el=>{el.disabled=busy||Boolean(client&&!online&&!['switch-role','logout'].includes(el.dataset.action??''));});
}
function authView(){return `<main class="page pairing auth-page"><p class="audience">親子でひとつの家庭アカウント</p><h1>${authMode==='register'?'家族のアカウントをつくろう。':'おかえりなさい。'}</h1><p>大人のスマホも、子どものタブレットも、<br>同じユーザー名とパスワードでログイン。</p><form id="auth-form"><label for="username">ユーザー名</label><input id="username" name="username" autocomplete="username" pattern="[a-zA-Z0-9_-]{3,32}" minlength="3" maxlength="32" required autocapitalize="none" spellcheck="false" aria-describedby="username-note"><small id="username-note">半角英数字・_・-、3〜32文字</small><label for="password">パスワード</label><input id="password" name="password" type="password" autocomplete="${authMode==='register'?'new-password':'current-password'}" minlength="15" maxlength="128" required aria-describedby="password-note"><small id="password-note">15〜128文字。長い合言葉でも使えます。</small><button type="button" class="text-button password-toggle" data-action="show-password">パスワードを表示</button><button class="button primary" type="submit">${authMode==='register'?'アカウントを作成 →':'ログイン →'}</button></form><button class="text-button" data-action="toggle-auth">${authMode==='register'?'アカウントをお持ちの方：ログイン':'はじめての方：アカウントを作成'}</button><p class="small-note">メール・名前・年齢の入力は不要です。<br>パスワードを忘れた場合は運営者へご連絡ください。<br>映像は端末内で処理し、食材と進捗だけを家庭で共有します。</p></main>`;}
function roleView(){return `<main class="page pairing"><p class="audience">${safe(username!)} の家庭</p><h1>この端末は、どちらで使う？</h1><p>選んだ画面をこの端末に覚えます。<br>あとからいつでも切り替えられます。</p><div class="entry-actions"><button class="button primary" data-action="role-adult">大人：食材・献立を見る →</button><button class="button secondary" data-action="role-child">子ども：あそぶ・手伝う →</button></div></main>`;}
function settingsView(s:FamilyState){return `<details class="settings"><summary>使わない食材を選ぶ（任意）</summary><form id="settings-form"><div class="chips">${ingredients.map(i=>`<label class="chip"><input type="checkbox" name="excluded" value="${i.id}" ${s.excluded.includes(i.id)?'checked':''}>${i.emoji} ${i.name}</label>`).join('')}</div><div class="allergy-row">含むレシピを除外：${['卵','乳'].map(a=>`<label><input type="checkbox" name="allergen" value="${a}" ${s.allergens.includes(a)?'checked':''}> ${a}</label>`).join('')}</div><p class="small-note">全材料・製品表示を大人が確認してください。ゲーム中・調理中は変更できません。</p><button type="submit" class="button secondary small" ${isGameActive(s)||s.stage==='cooking'?'disabled':''}>この条件を保存</button></form></details>`;}
function latestView(s:FamilyState){return `<details class="latest-result"><summary>最新の食材キャッチ ${s.latestResultAt===null?'· まだありません':`· ${safe(new Date(s.latestResultAt).toLocaleString('ja-JP'))}`}</summary><p>${ingredients.filter(i=>s.game.evidence[i.id].caught>0).map(i=>`${i.emoji} ${i.name} ${s.game.evidence[i.id].caught}こ`).join(' / ')||'キャッチはまだありません。'}</p></details>`;}
function adultView(s:FamilyState){
  const playing=isGameActive(s)?'<p class="info-note">子どもが食材キャッチで遊んでいます。献立と調理の進捗はそのままです。</p>':'';
  let content:string;
  if(s.stage==='lobby')content='<div class="pairing"><p class="audience">大人：食材と献立</p><h1>あそびを、ごはんのヒントに。</h1><p>タブレットで同じアカウントにログインして、<br>子どもの画面を選ぶと、いつでも遊べます。</p><p class="small-note">大人の画面を開いていなくても大丈夫。<br>終わったら、ここに最新の結果が届きます。</p></div>';
  else if(s.stage==='review')content=showRecipes?recipeView(s):reviewView(s);
  else if(s.stage==='complete')content=`<div class="pairing"><h1>ふたりで、できました。</h1><span class="celebration">🍽️</span><p>全工程が完了しました。</p>${button('back-review','次の献立を選ぶ →')}</div>`;
  else content=superviseView(s);
  return `<main class="page adult-page">${playing}${content}${latestView(s)}${settingsView(s)}</main>`;
}
function childView(s:FamilyState){
  if(isGameActive(s))return '<main class="page game-page"><div id="child-game"></div><button class="text-button" data-action="cancel-game">← おてつだいに戻る</button></main>';
  const step=s.selectedRecipeId?cookingPlans[s.selectedRecipeId].find(step=>step.id===s.cooking.activeStepId):null;
  let current=step?.role==='child'?`<p class="audience">いまの おてつだい</p><h1>${safe(step.title)}</h1><p class="child-detail">${safe(step.detail)}</p>${s.cooking.childReportStepId===step.id?'<p class="report-sent" role="status">できたを送ったよ！<br>大人がたしかめているよ。</p>':button('child-done','できた！ →',`data-step="${step.id}"`)}<p class="small-note">こまったら、大人をよんでね。</p>`:s.stage==='cooking'?'<h1>つぎのおてつだいを、まとう。</h1><p>大人がじゅんびしているよ。</p>':s.stage==='complete'?'<h1>いっしょに、できたね！</h1>':s.latestResultAt!==null?'<h1>食材を、大人に届けたよ！</h1><p>もう一度あそんでも、だいじょうぶ。</p>':'<h1>どの食材を、キャッチする？</h1><p>大人とまわりの安全をたしかめてね。</p>';
  return `<main class="page child-center">${current}<div class="child-play-options"><p>食材キャッチで あそぼう</p><div class="entry-actions">${button('start-camera','からだで あそぶ →')}${button('start-demo','カメラなしで あそぶ →')}</div><p class="small-note">その場でゆっくり左右へ。座ったままでも遊べるよ。<br>映像はこの端末の中だけで使います。</p></div></main>`;
}
function reviewView(s: FamilyState) {
  const options = ingredients.filter(i => !s.excluded.includes(i.id) && !i.allergens.some(a => s.allergens.includes(a)));
  return `<p class="audience">大人が確認する</p><h1>今日、気になった食材。</h1><p>キャッチは好みのヒントです。お子さんに聞きながら選び直せます。</p><div class="food-choices">${options.map(i => `<label class="food-choice ${s.selected.includes(i.id) ? 'chosen' : ''}"><input type="checkbox" data-select="${i.id}" ${s.selected.includes(i.id) ? 'checked' : ''} ${disabled()}><span class="choice-check">✓</span><span class="choice-emoji">${i.emoji}</span><b>${i.name}</b><small>${s.game.evidence[i.id].caught}こ キャッチ</small></label>`).join('')}</div><p class="small-note">取り逃した食材を「苦手」とはみなしません。キャッチがなくても選べます。</p>${button('recipes', 'この食材をヒントに 献立を見る →')}`;
}
function recipeView(s: FamilyState) {
  const unavailable = new Set([...s.excluded, ...ingredients.filter(i => i.allergens.some(a => s.allergens.includes(a))).map(i => i.id)]);
  const suggestions = recommend(s.selected, unavailable, new Set(s.allergens));
  return `<button class="text-button" data-action="review">← 食材の選択へ</button><h1>今日の献立を、選ぼう。</h1><p>大人＋子ども 約2人分の目安。材料を確認してから選んでください。</p>${!s.selected.length ? '<p class="info-note">食材は未選択です。分担しやすいサンプルを表示しています。</p>' : ''}<div class="recipe-grid">${suggestions.map(r => `<article class="recipe-card"><div class="recipe-body"><div class="recipe-meta"><span>約${r.minutes}分</span><span>${r.allergens.length ? `含む：${r.allergens.join('・')}` : '卵・乳 不使用'}</span></div><h2>${safe(r.name)}</h2><p class="match-note">${r.foods.filter(id => s.selected.includes(id)).map(id => ingredients.find(i => i.id === id)!.name).join('・') || '親子で分担しやすいサンプル'}</p><details class="recipe-details"><summary>材料・全工程を見る ＋</summary><h3>材料</h3><ul>${r.materials.map(m => `<li>${safe(m)}</li>`).join('')}</ul><ol>${cookingPlans[r.id].map(step => `<li><b>${step.role === 'child' ? '子ども' : '大人'}：${safe(step.title)}</b><br>${safe(step.detail)}</li>`).join('')}</ol></details>${button('choose-recipe', 'この献立で つくる →', `data-recipe="${r.id}"`)}</div></article>`).join('')}</div>${suggestions.length ? '' : '<p class="no-recipes">今の除外条件に合うレシピはありません。「使わない食材」の条件を見直すか、別の献立を大人が用意してください。</p>'}<p class="recipe-warning">アレルギーの安全性は保証できません。全材料・製品表示を大人が確認し、年齢や発達に合わせて調整してください。</p>`;
}
function superviseView(s: FamilyState) {
  const recipe = recipes.find(r => r.id === s.selectedRecipeId)!;
  const steps = cookingPlans[recipe.id], c = s.cooking;
  return `<p class="audience">大人：全工程と見守り</p><h1>${safe(recipe.name)}</h1><p class="progress-label">${c.completedStepIds.length} / ${steps.length} 工程 完了</p><progress max="${steps.length}" value="${c.completedStepIds.length}" aria-label="調理の進み具合"></progress><p class="info-note">${c.childReportStepId ? '子どもから「できた」が届きました。手元を確認して完了にしてください。' : c.activeStepId ? steps.find(step => step.id === c.activeStepId)!.role === 'child' ? '子どもの端末に、現在のお手伝いを表示しています。' : 'いまは大人の担当。子どもの端末には待つ画面を表示しています。' : '次の工程を始めてください。'}</p><ol class="step-list">${steps.map((step, index) => {
    const complete = c.completedStepIds.includes(step.id), active = c.activeStepId === step.id;
    const ready = !c.activeStepId && step.requires.every(id => c.completedStepIds.includes(id));
    return `<li class="step-card ${complete ? 'step-complete' : active ? 'step-active' : ''}"><span class="step-role">${index + 1} · ${step.role === 'child' ? '子ども' : '大人'} ${complete ? '✓ 完了' : active ? '· いまの工程' : ''}</span><h2>${safe(step.title)}</h2><p>${safe(step.detail)}</p>${complete ? '' : active ? step.role === 'adult' ? button('complete-step', '大人の工程を完了する', `data-step="${step.id}"`) : c.childReportStepId === step.id ? button('complete-step', '手元を確認した：完了にする', `data-step="${step.id}"`) : '<p class="waiting-report" role="status">子どもの「できた」を待っています。</p>' : ready ? button('activate-step', step.role === 'child' ? 'このお手伝いを子どもに渡す →' : 'この工程を始める', `data-step="${step.id}"`) : '<small>前の工程が終わると始められます。</small>'}</li>`;
  }).join('')}</ol><details class="recipe-details"><summary>材料をもう一度見る</summary><ul>${recipe.materials.map(m => `<li>${safe(m)}</li>`).join('')}</ul></details><button class="text-button" data-action="back-review">調理をやめて献立を選び直す</button>`;
}
function connect(role:Role){
  client?.stop();destroyGame();state=null;online=false;showRecipes=false;saveRole(role);
  client=new SessionClient({username:username!,role},next=>{state=next;render();},(connected,error)=>{
    const wasOnline=online;online=connected;
    if(connected){if(!wasOnline){errorMessage='';game?.syncStatus();}}
    else if(error instanceof ApiError&&error.status===401){client?.stop();destroyGame();client=null;state=null;username=null;errorMessage='ログインの期限が切れました。もう一度ログインしてください。';render();return;}
    else{game?.pause('つながりが戻るまで、ひとやすみ。');errorMessage=errorText(error);}
    updateStatus();
  });
  render();client.start();
}
async function perform(work:()=>Promise<unknown>){if(busy)return;busy=true;errorMessage='';updateStatus();try{await work();}catch(error){errorMessage=errorText(error);}finally{busy=false;updateStatus();}}
async function act(action:FamilyAction){if(!client||!online)throw new Error('Disconnected');await client.action(action);}
async function exitGame(){if(client?.connection.role==='child'&&state&&isGameActive(state)&&online)await act({type:'CANCEL_GAME'});}
root.addEventListener('click',event=>{
  const target=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');if(!target||target.disabled)return;const action=target.dataset.action;
  if(action==='show-password'){const input=$<HTMLInputElement>('#password')!;input.type=input.type==='password'?'text':'password';target.textContent=input.type==='password'?'パスワードを表示':'パスワードを隠す';target.setAttribute('aria-pressed',String(input.type==='text'));return;}
  if(action==='toggle-auth'){authMode=authMode==='login'?'register':'login';errorMessage='';render();return;}
  if(action==='recipes'||action==='review'){showRecipes=action==='recipes';render();window.scrollTo({top:0});return;}
  void perform(async()=>{
    if(action==='role-adult'||action==='role-child')connect(action==='role-adult'?'adult':'child');
    if(action==='switch-role'){await exitGame();client?.stop();destroyGame();client=null;state=null;online=false;saveRole(null);render();}
    if(action==='logout'){await exitGame();await request('/api/auth/logout','POST',{});client?.stop();destroyGame();client=null;state=null;username=null;online=false;render();}
    if(action==='start-camera'||action==='start-demo')await act({type:'START_GAME',input:action==='start-camera'?'camera':'demo'});
    if(action==='cancel-game')await act({type:'CANCEL_GAME'});
    if(action==='choose-recipe'){await act({type:'CHOOSE_RECIPE',recipeId:target.dataset.recipe!});window.scrollTo({top:0});}
    if(action==='activate-step'||action==='complete-step'||action==='child-done')await act({type:action==='activate-step'?'ACTIVATE_STEP':action==='complete-step'?'COMPLETE_STEP':'CHILD_DONE',stepId:target.dataset.step!});
    if(action==='back-review'&&(state?.stage==='complete'||window.confirm('調理の進捗をリセットして、献立の選択に戻りますか？'))){showRecipes=false;await act({type:'BACK_TO_REVIEW'});}
  });
});
root.addEventListener('submit',event=>{
  const form=event.target as HTMLFormElement;event.preventDefault();
  if(form.id==='auth-form'){
    const data=new FormData(form),credentials={username:String(data.get('username')),password:String(data.get('password'))};
    void perform(async()=>{const result=await request<{username:string}>(`/api/auth/${authMode}`,'POST',credentials);username=result.username;const role=savedRole();if(role)connect(role);else render();});
  }
  if(form.id==='settings-form'){
    const data=new FormData(form);void perform(()=>act({type:'SET_SETTINGS',excluded:data.getAll('excluded') as IngredientId[],allergens:data.getAll('allergen') as string[]}));
  }
});
root.addEventListener('change',event=>{
  const input=event.target as HTMLInputElement;if(!input.dataset.select)return;
  const selected=[...root.querySelectorAll<HTMLInputElement>('[data-select]:checked')].map(el=>el.dataset.select as IngredientId);
  void perform(async()=>{await act({type:'SET_SELECTED',selected});render();root.querySelector<HTMLInputElement>(`[data-select="${input.dataset.select}"]`)?.focus({preventScroll:true});});
});
async function boot(){
  checking=true;render();
  try{const result=await request<{username:string}>('/api/auth/me');username=result.username;}
  catch(error){username=null;if(!(error instanceof ApiError&&error.status===401))errorMessage=errorText(error);}
  finally{checking=false;}
  const role=savedRole();if(username&&role)connect(role);else render();
}
window.addEventListener('pagehide',()=>{game?.pause('画面を離れたので、ひとやすみ。');destroyGame();client?.stop();});
window.addEventListener('pageshow',event=>{if(event.persisted)void boot();});
void boot();
