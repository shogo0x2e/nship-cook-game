export const questionnaireVersion = 'poc-2026-11-19-v2';
export const scale = ['全くそう思わない', 'そう思わない', 'あまりそう思わない', 'どちらともいえない', 'ややそう思う', 'そう思う', '非常にそう思う'];
export const youngScaleLines = [['ぜんぜん','おもわない'], ['おもわない'], ['あまり','おもわない'], ['どちらでも','ない'], ['すこし','おもう'], ['おもう'], ['とても','おもう']];
export const youngScale = ['ぜんぜん おもわない', 'おもわない', 'あまり おもわない', 'どちらでもない', 'すこし おもう', 'おもう', 'とても おもう'];
export const questions = {
  child: [
    { id: 'game_fun', text: 'このゲームで遊ぶのは楽しいと思う。', youngText: 'ゲームは たのしかった。' },
    { id: 'help_intent', text: '表示されたお手伝いを、やってみたいと思う。', youngText: 'この おてつだいを やってみたい。' },
    { id: 'daily_feasibility', text: 'このゲームなら、毎日遊び続けられそうだと思う。', youngText: 'このゲームなら、まいにちでも あそべそう。' },
  ],
  parent: [
    { id: 'task_feasibility', text: '提案された分担なら、子どもにお手伝いを任せられそうだと思う。' },
    { id: 'continued_use', text: 'このプロダクトを、日々の食事づくりで使いたいと思う。' },
    { id: 'meal_decision_ease', text: '家にある食材から、作る料理を決めやすくなりそうだと思う。' },
    { id: 'child_initiative', text: '子どもが自分から料理を手伝いたくなりそうだと思う。' },
  ],
};
export const frames = {
  child: '幼稚園くらいの頃の自分を思い浮かべてください。当時、このプロダクトがあった場合について回答してください。',
  young: 'いま あそんだ ゲームと、みた おてつだいについて おしえてね。',
  parent: '今回体験したゲームとレシピ・お手伝いの提案について、家庭で使う場面を想像して回答してください。',
};
export const gameplayOptions = [
  ['smooth', '問題なくプレイできた'],
  ['issues_completed', '不具合はあったが、最後までプレイできた'],
  ['issues_partial', '不具合で、途中までしかプレイできなかった'],
  ['issues_unable', '不具合で、全くプレイできなかった'],
  ['stopped_other', '不具合以外の理由で、途中でやめた'],
  ['not_attempted', 'ゲームを試していない'],
];
const gameplayQuestion = { id: 'gameplayStatus', text: '今回、ゲームはどの程度プレイできましたか。' };
export const surveyQuestionCount = role => questions[role].length + (role === 'parent' ? 1 : 0);
export const freshSurvey = () => ({ answers: {}, comment: '', gameplayStatus: '', submittedAt: null });
export function restoreSurvey(role, saved) {
  const result = freshSurvey();
  if (!saved || typeof saved !== 'object') return result;
  result.comment = typeof saved.comment === 'string' ? saved.comment.slice(0, 3000) : '';
  result.submittedAt = typeof saved.submittedAt === 'string' ? saved.submittedAt : null;
  if (role === 'parent' && gameplayOptions.some(([value]) => value === saved.gameplayStatus)) result.gameplayStatus = saved.gameplayStatus;
  for (const question of questions[role]) {
    const value = saved.answers?.[question.id];
    if (Number.isInteger(value) && value >= 1 && value <= 7) result.answers[question.id] = value;
  }
  if (missingQuestions(role, result).length) result.submittedAt = null;
  return result;
}
export function missingQuestions(role, response) {
  const missing = questions[role].filter(question => {
    const value = response.answers[question.id];
    return !(Number.isInteger(value) && value >= 1 && value <= 7);
  });
  if (role === 'parent' && !gameplayOptions.some(([value]) => value === response.gameplayStatus)) missing.push(gameplayQuestion);
  return missing;
}
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function surveyTable(role, response = freshSurvey(), readOnly = false, young = false) {
  const labels = young ? youngScale : scale;
  const anchorLines = { 0: ['全くそう', '思わない'], 3: ['どちらとも', 'いえない'], 6: ['非常にそう', '思う'] };
  return `<table class="survey-matrix"><caption class="sr-only">${role === 'child' ? '子ども' : '保護者'}の7段階評価</caption>
    <thead><tr><th scope="col">設問</th>${labels.map((label, index) => `<th scope="col"><span>${index + 1}</span><span class="sr-only">：${label}</span></th>`).join('')}</tr></thead>
    <tbody>${questions[role].map((question, index) => {
      const text = young ? question.youngText : question.text;
      return `<tr data-question-row="${question.id}"><th scope="row"><span class="question-number">${index + 1}</span>${text}</th>${labels.map((label, i) => `<td><label class="likert-cell" title="${label}"><input type="radio" name="${question.id}" value="${i + 1}" aria-label="${esc(text)} ${i + 1}：${label}" ${response.answers[question.id] === i + 1 ? 'checked' : ''} ${readOnly ? 'disabled' : ''}><span class="score-number">${i + 1}</span>${!young ? `<span class="choice-anchor ${anchorLines[i] ? '' : 'anchor-spacer'}">${(anchorLines[i] || ['','']).map(word => `<span>${word || '&nbsp;'}</span>`).join('')}</span>` : ''}${young ? `<span class="young-score-label">${youngScaleLines[i].map(word => `<span>${word}</span>`).join('')}</span>` : ''}</label></td>`).join('')}</tr>`;
    }).join('')}</tbody></table>`;
}
export function surveyForm(role, response, young = false) {
  const labels = young ? youngScale : scale;
  return `<form id="survey-form" data-survey-role="${role}" class="survey-form ${young ? 'young-survey' : ''}">
    <p class="survey-frame">${frames[young ? 'young' : role]}</p>
    ${young ? '<p class="plain-note">おとなの ひとと よんでも いいよ。おとなの方は、お子さん自身の答えを選んでください。</p>' : ''}
    <details class="scale-key"><summary>${young ? '1〜7の こたえを みる' : '7段階の選択肢を確認'}</summary><ol>${labels.map((label, index) => `<li>${index + 1}：${label}</li>`).join('')}</ol></details>
    <p class="plain-note">${young ? 'ひとつずつ えらんでね。' : '各設問で1つ選んでください。'}</p>
    <div class="survey-container">${surveyTable(role, response, false, young)}</div>
    <label class="survey-comment">${young ? 'おもったことが あれば おしえてね（かかなくても いいよ）' : 'そう答えた理由や、気になった点を教えてください（任意）'}<textarea name="comment" rows="4" maxlength="3000">${esc(response.comment)}</textarea></label>
    ${role === 'parent' ? `<fieldset class="gameplay-question" data-question-row="gameplayStatus"><legend>${gameplayQuestion.text}</legend><p class="plain-note">ゲームの動作状況について、最も近いものを1つ選んでください。</p><div class="feature-options">${gameplayOptions.map(([value,label]) => `<label class="choice-card"><input type="radio" name="gameplayStatus" value="${value}" ${response.gameplayStatus === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></fieldset>` : ''}
    <p id="survey-error" class="survey-error" role="alert"></p><p id="survey-progress" class="selection-count" aria-live="polite">${young ? 'こたえた かず' : '回答済み'} ${surveyQuestionCount(role) - missingQuestions(role, response).length} / ${surveyQuestionCount(role)}</p>
    <button type="submit" class="primary">${role === 'child' ? young ? 'こたえて おやに わたす' : '回答を保存して親に渡す' : '今後の機能案と料金について回答する'}<span aria-hidden="true">→</span></button>
    </form>`;
}
