import { challengeRules, type ChallengeRun, type ChallengeProgress } from './challenge.ts';

const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const number=(value:number)=>value.toLocaleString('ja-JP');
const option=(value:string,label:string,selected?:string)=>`<option value="${value}" ${selected===value?'selected':''}>${label}</option>`;
export function challengeResultView(run:ChallengeRun,disabled:string):string {
  const best=run.completed&&run.score>run.previousBest;
  const feedback=run.feedback;
  return `<section class="challenge-result ${best?'new-best':''}" aria-label="チャレンジの結果">
    <p class="challenge-eyebrow">${!run.completed?'ここまでの記録':best?'自己ベスト更新！':'45秒チャレンジ 完了'}</p>
    <h1>ナイスキャッチ！</h1><p class="result-score">${number(run.score)}<span>点</span></p>
    <p class="best-difference">${!run.completed?'途中の記録は、自己ベストには含めません。':best?`前のベストから +${number(run.score-run.previousBest)}点`:`自己ベスト ${number(run.previousBest)}点${run.score<run.previousBest?`まで あと${number(run.previousBest-run.score)}点`:''}`}</p>
    <div class="challenge-stats"><span><b>${run.caught}</b>キャッチ</span><span><b>${Math.floor(run.caught/3)}</b>皿完成</span><span><b>${Math.round(run.activeMs/1000)}</b>秒</span></div>
    <p class="small-note">キャッチの得点＋すばやさボーナス＋3個ごとに150点。<br>自己ベストは、同じ操作・同じ食材の条件で比べます。</p>
    <details class="daily-feedback"><summary>${feedback?'使ってみた回答を見直す':'使ってみて、どうだった？（任意）'}</summary>
      <form id="challenge-feedback" data-round="${run.roundId}">
        <label for="daily-frequency">これを毎日使えそう？</label>
        <select id="daily-frequency" name="frequency" required><option value="" disabled ${feedback?'':'selected'}>えらんでください</option>${[['daily','毎日使えそう'],['weekly','週に何回かなら'],['sometimes','たまになら'],['no','使わなさそう'],['unsure','まだわからない']].map(([v,l])=>option(v,l,feedback?.frequency)).join('')}</select>
        <label for="daily-reason">そう思った理由・使うならいつ？</label><textarea id="daily-reason" name="reason" rows="3" maxlength="300" placeholder="例：夕ごはんの前なら。毎日は同じで飽きそう。">${escape(feedback?.reason??'')}</textarea>
        <label for="test-age">学年など（任意）</label><select id="test-age" name="ageGroup">${[['unspecified','回答しない'],['lower','小学校低学年'],['upper','小学校高学年'],['middle','中学生'],['other','その他']].map(([v,l])=>option(v,l,feedback?.ageGroup??'unspecified')).join('')}</select>
        <label for="test-fun">楽しかった？（任意）</label><select id="test-fun" name="fun">${[['','回答しない'],['5','とても楽しかった'],['4','楽しかった'],['3','どちらでもない'],['2','あまり楽しくなかった'],['1','楽しくなかった']].map(([v,l])=>option(v,l,feedback?.fun?.toString()??'')).join('')}</select>
        <button type="submit" class="button secondary" ${disabled}>回答を保存</button>
      </form>
    </details>${feedback?'<p class="feedback-saved" role="status">回答を保存しました。</p>':''}
  </section>`;
}
export function challengeRecordsView(progress:ChallengeProgress|undefined):string {
  if(!progress?.runs.length)return '';
  const runs=progress.runs,days=new Set(runs.map(r=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(r.finishedAt)));
  return `<details class="challenge-records"><summary>スコアチャレンジの試用記録</summary><p>保存している${runs.length}回で、遊んだ日は${days.size}日。回答は${runs.filter(r=>r.feedback).length}件。</p><p class="small-note">「毎日使えそう」という回答と、実際のプレイ日は別に記録します。最近100回を保存しています。試用者ごとに別の家庭アカウントを使ってください。</p><button class="text-button" data-action="export-challenge">記録をダウンロード</button></details>`;
}
export function downloadChallengeRecords(progress:ChallengeProgress|undefined){
  const url=URL.createObjectURL(new Blob([JSON.stringify({rules:challengeRules,exportedAt:new Date().toISOString(),runs:progress?.runs??[]},null,2)],{type:'application/json'}));
  const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
  const a=document.createElement('a');a.href=url;a.download=`catch-trial-${day}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
