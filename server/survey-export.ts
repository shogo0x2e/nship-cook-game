import type {DatabaseSync} from 'node:sqlite';
import {timingSafeEqual} from 'node:crypto';
import {SessionError} from './session-store.ts';

// Deliberate allowlist: never export private experience keys, auth tables or token hashes.
export const surveyColumns = [
 ['id','受付ID','回答を識別するID'], ['device_id','端末ID','同じブラウザで再利用するUUID。人数ではありません'],
 ['age','体験者の年齢','体験をした人の現在の年齢（歳）'], ['child_mode','子ども設問の回答形式','young-current-experience: 8歳以下／older-kindergarten-hypothetical: 9歳以上'],
 ['questionnaire_version','質問版','設問を変更した版'], ['recipe_version','レシピ版','提示レシピの版'], ['concept_version','構想版','提示した機能案の版'], ['inventory_version','在庫版','提示した在庫サンプルの版'],
 ['recipe_id','選択レシピ','curry: カレー／nikujaga: 肉じゃが など'], ['selected_ingredients','選択食材','ゲームで選んだ食材ID（複数は / 区切り）'],
 ['game_fun','子1：ゲームの楽しさ','1〜7。高いほど肯定'], ['help_intent','子2：お手伝いの意欲','1〜7。高いほど肯定'],
 ['child_play_frequency','子3：遊ぶ頻度','daily: 毎日／four_to_six_days: 週4〜6日／two_to_three_days: 週2〜3日／one_day: 週1日／less_often: それより少ない頻度／never: 遊ばないと思う'],
 ['daily_feasibility','旧設問：毎日遊べそうか','旧版のみの1〜7評価。頻度とは別項目'],
 ['task_feasibility','親1：分担の実行可能性','提案された分担なら、子どもにお手伝いを任せられそうだと思う。'],
 ['continued_use','親2：利用意向','このアプリを、日々の食事づくりで使いたいと思う。'],
 ['meal_preparation_ease','親3：食事の用意の負担','このアプリによって、日々の食事の用意が楽になると思う。'],
 ['meal_decision_ease','旧設問：献立の決めやすさ','旧版のみの1〜7評価'],
 ['child_initiative','親4：子どもの主体性','このアプリによって、子どもが自分から料理を手伝ってくれると思う。'],
 ['employment_status','共働き','yes: はい／no: いいえ／prefer_not: 答えたくない（パート・自営・育休を含む）'],
 ['gameplay_status','ゲームの体験状況','smooth: 問題なし／issues_completed: 不具合あり完了／issues_partial: 途中まで／issues_unable: 全く不可／stopped_other: その他中止／not_attempted: 未体験'],
 ['game_input','操作の種類','camera: カメラ／demo: カメラなし'],
 ['child_comment','子どもの自由記述','任意回答'], ['parent_comment','保護者の自由記述','任意回答'], ['gameplay_comment','動作状況の自由記述','任意回答'],
 ['interested_features','気になる機能','game_recipe／food_learning／challenge_feedback／expert_recipes／family_schedule／none（複数は / 区切り）'],
 ['feature_comment','機能の自由記述','任意回答'], ['payment_kind','料金の回答','paid: 金額入力／free: 無料なら利用／no_use: 無料でも利用しない'],
 ['max_monthly_yen','月額上限（税込・円）','paid: 入力額／free: 0／no_use: 空欄'], ['created_at','開始日時（UTC）','サーバーに最初に保存した日時'], ['completed_at','送信完了日時（UTC）','最終回答の保存日時'],
] as const;

export function requireSurveyExportKey(expected:string|undefined,authorization:string|undefined){
 if(!expected)throw new SessionError(404,'Not found');
 const supplied=authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 if(!supplied||!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(supplied,'hex')))throw new SessionError(401,'Export key required');
}
export function surveySnapshot(db:DatabaseSync){
 const records=db.prepare('SELECT id,age,child_mode,questionnaire_version,recipe_id,created_at,completed_at,payload FROM experience_responses WHERE complete=1 AND demo=0 ORDER BY created_at,id LIMIT 5001').all();
 if(records.length>5000)throw new SessionError(503,'Export exceeds the configured response limit');
 const rows=records.map(row=>{
  const p=JSON.parse(row.payload as string);
  const cells:Record<string,unknown>={
   id:row.id,device_id:p.deviceId,age:row.age,child_mode:row.child_mode,questionnaire_version:row.questionnaire_version,
   recipe_version:p.recipeVersion,concept_version:p.conceptVersion,inventory_version:p.inventoryVersion,recipe_id:row.recipe_id,selected_ingredients:p.selectedIngredients.join(' / '),
   game_fun:p.child.answers.game_fun,help_intent:p.child.answers.help_intent,child_play_frequency:p.child.playFrequency,daily_feasibility:p.child.answers.daily_feasibility,
   task_feasibility:p.parent.answers.task_feasibility,continued_use:p.parent.answers.continued_use,meal_preparation_ease:p.parent.answers.meal_preparation_ease,meal_decision_ease:p.parent.answers.meal_decision_ease,child_initiative:p.parent.answers.child_initiative,
   employment_status:p.parent.employmentStatus,gameplay_status:p.parent.gameplayStatus,game_input:p.gameInput,
   child_comment:p.child.comment,parent_comment:p.parent.comment,gameplay_comment:p.parent.gameplayComment,
   interested_features:p.serviceFeedback?.interestedFeatures.join(' / '),feature_comment:p.serviceFeedback?.comment,
   payment_kind:p.payment?.kind,max_monthly_yen:p.payment?.maxMonthlyYen,created_at:row.created_at,completed_at:row.completed_at,
  };
  return surveyColumns.map(([key])=>cells[key]??'');
 });
 return {schemaVersion:1,generatedAt:new Date().toISOString(),scope:'completed-non-demo',count:rows.length,columns:surveyColumns.map(([id,label,description])=>({id,label,description})),rows};
}
