import type { IngredientId } from './content.ts';
import type { Evidence } from './game.ts';
export type Role = 'adult' | 'child';
export type CookingStep = { id: string; role: Role; title: string; detail: string; requires: string[] };
export type RoomState = {
  revision: number; stage: 'lobby' | 'game' | 'review' | 'cooking' | 'complete';
  excluded: IngredientId[]; allergens: string[]; childJoined: boolean;
  game: { roundId: string; status: 'idle' | 'ready' | 'playing' | 'paused' | 'finished'; input: 'camera' | 'demo'; elapsed: number; evidence: Evidence };
  selected: IngredientId[]; selectedRecipeId: string | null;
  cooking: { activeStepId: string | null; completedStepIds: string[]; childReportStepId: string | null };
};
export type RoomAction =
  | { type: 'START_GAME'; input: 'camera' | 'demo' }
  | { type: 'GAME_STATUS'; roundId: string; status: 'playing' | 'paused' }
  | { type: 'GAME_RESULT'; roundId: string; evidence: Evidence }
  | { type: 'SET_SELECTED'; selected: IngredientId[] }
  | { type: 'CHOOSE_RECIPE'; recipeId: string }
  | { type: 'ACTIVATE_STEP' | 'COMPLETE_STEP' | 'CHILD_DONE'; stepId: string }
  | { type: 'BACK_TO_REVIEW' | 'CANCEL_GAME' };
export type RoomResponse = { roomId: string; code: string; token: string; state: RoomState; role: Role };
export type RoomSnapshot = { state: RoomState; role: Role; code: string };
const plan = (recipe: string, steps: [Role, string, string][]): CookingStep[] => steps.map(([role,title,detail], i) => ({id:`${recipe}-${i+1}`,role,title,detail,requires:i ? [`${recipe}-${i}`] : []}));
export const cookingPlans: Record<string, CookingStep[]> = {
  rice: plan('rice', [
    ['adult','野菜を準備する','にんじんを細かく切り、しめじの石づきを取ってほぐします。子どもの作業場所から包丁を片づけます。'],
    ['child','きのこをボウルへ','おとながほぐした、加熱前のしめじをボウルへ入れよう。食べずに、おわったら手を洗おう。'],
    ['adult','具を加熱して冷ます','油でにんじん・しめじ・コーンを十分加熱します。ごはんと具の両方を子どもが触れる温度まで冷まし、確認してください。'],
    ['child','まぜて盛りつける','おとなが温度を確認したごはんと具をまぜて、お皿に盛ろう。名前もつけてみよう。'],
    ['adult','味と食べやすさを確認する','塩で味を調え、温度・食べやすさを確認して完成です。'],
  ]),
  potato: plan('potato', [
    ['adult','洗う準備をする','野菜とボウルを用意し、子どもの手が届く安全な場所へ置きます。'],
    ['child','野菜を洗う','おとなといっしょに、じゃがいもとブロッコリーを洗おう。'],
    ['adult','切って、ゆでて、冷ます','じゃがいもの皮・芽・緑色部分を取り、野菜を切ります。じゃがいも・ブロッコリーを別々にやわらかくゆで、コーンも加熱。水気を切り、触れる温度まで十分冷まして確認します。'],
    ['child','つぶしてまぜる','冷めたじゃがいもをつぶし、具とおとなが用意した調味料をまぜよう。'],
    ['adult','仕上がりを確認する','味・温度・食べやすさを確認し、必要なら大人が調整します。'],
  ]),
  soup: plan('soup', [
    ['adult','材料を準備する','野菜を用意し、しめじをほぐします。子ども用のボウルを準備します。'],
    ['child','野菜を洗う','野菜を洗い、おとながほぐした加熱前のしめじを器に入れよう。食べずに、最後に手を洗おう。'],
    ['adult','野菜を切って煮る','じゃがいもの皮・芽・緑色部分を取り、野菜を小さく切ります。油で炒め、水を加えて十分やわらかくなるまで約15分煮て、塩で調えます。'],
    ['child','スープの名前を考える','あつい鍋やスープには触らず、できたスープの名前を考えよう。'],
    ['adult','冷まして盛りつける','大人が盛りつけ、食べられる温度と大きさを確認します。'],
  ]),
  omelet: plan('omelet', [
    ['adult','安全な材料を分ける','トマトを洗って切ります。子ども用のチーズと皿を用意し、生卵とその器具は別の場所に置きます。'],
    ['child','チーズをちぎる','チーズをちぎり、切ってもらったトマトを別のお皿に並べよう。生卵や包丁はおとなの担当だよ。'],
    ['adult','卵を混ぜてしっかり焼く','卵を割り、塩・コーン・チーズを混ぜます。油をひいたフライパンで、ふたをして中まで完全に火を通します。切り分けて触れる温度まで冷まし、生卵の器具を洗います。'],
    ['child','飾りつける','おとなが冷めたことを確認したオムレツに、トマトを飾ろう。'],
    ['adult','完成を確認する','加熱状態・温度・食べやすさを確認して完成です。'],
  ]),
  roast: plan('roast', [
    ['adult','材料を切ってゆでる','じゃがいもの皮・芽・緑色部分を取り、野菜を切ります。じゃがいも・ブロッコリーをやわらかくゆで、十分冷まして温度を確認します。冷たい耐熱皿を用意します。'],
    ['child','並べてチーズをのせる','冷めた野菜を、冷たい耐熱皿に並べよう。チーズをのせよう。'],
    ['adult','オーブンで焼く','油と塩を加え、200℃のオーブンで焼き色がつくまで約10分焼きます。取り出し、皿と中身を十分冷まして確認してください。'],
    ['child','料理の名前をつける','あつい皿には触らず、できた料理に名前をつけよう。'],
    ['adult','盛りつけて確認する','大人が取り分け、温度・食べやすさを確認して完成です。'],
  ]),
};
