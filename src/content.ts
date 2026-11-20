export type IngredientId = 'rice' | 'noodles' | 'bread' | 'chicken' | 'pork' | 'salmon' | 'onion' | 'cabbage' | 'pepper' | 'tomato' | 'carrot' | 'broccoli' | 'corn' | 'mushroom' | 'potato' | 'egg' | 'cheese';
export const ingredients: { id: IngredientId; name: string; emoji: string; color: string; allergens: string[] }[] = [
  { id: 'tomato', name: 'トマト', emoji: '🍅', color: '#ed7465', allergens: [] },
  { id: 'carrot', name: 'にんじん', emoji: '🥕', color: '#f4a34b', allergens: [] },
  { id: 'broccoli', name: 'ブロッコリー', emoji: '🥦', color: '#70a86d', allergens: [] },
  { id: 'corn', name: 'コーン', emoji: '🌽', color: '#e8c752', allergens: [] },
  { id: 'mushroom', name: 'きのこ', emoji: '🍄', color: '#bc9785', allergens: [] },
  { id: 'potato', name: 'じゃがいも', emoji: '🥔', color: '#c8a370', allergens: [] },
  { id: 'egg', name: 'たまご', emoji: '🥚', color: '#e9c887', allergens: ['卵'] },
  { id: 'cheese', name: 'チーズ', emoji: '🧀', color: '#e8bd55', allergens: ['乳'] },
];
export const experienceIngredients: typeof ingredients = [
  { id: 'rice', name: 'ごはん', emoji: '🍚', color: '#e5d6aa', allergens: [] },
  { id: 'noodles', name: 'めん', emoji: '🍜', color: '#d9b571', allergens: [] },
  { id: 'bread', name: 'パン', emoji: '🍞', color: '#d0a466', allergens: [] },
  { id: 'chicken', name: 'とりにく', emoji: '🍗', color: '#d6a384', allergens: [] },
  { id: 'pork', name: 'ぶたにく', emoji: '🥩', color: '#dca3a1', allergens: [] },
  { id: 'salmon', name: 'さけ', emoji: '🐟', color: '#e5a087', allergens: [] },
  { id: 'onion', name: 'たまねぎ', emoji: '🧅', color: '#c6a275', allergens: [] },
  { id: 'cabbage', name: 'キャベツ', emoji: '🥬', color: '#94b57d', allergens: [] },
  { id: 'pepper', name: 'ピーマン', emoji: '🫑', color: '#6ca069', allergens: [] },
  ...ingredients.filter(food => ['carrot','potato','egg','tomato'].includes(food.id)),
];
export type Recipe = {
  id: string; name: string; emoji: string; minutes: number; description: string;
  foods: IngredientId[]; allergens: string[]; materials: string[]; child: string[]; adult: string[];
};
export const recipes: Recipe[] = [
  { id: 'rice', name: 'いろどり まぜごはん', emoji: '🍚', minutes: 15, description: 'まぜるたびに、今日の色になる。',
    foods: ['carrot', 'corn', 'mushroom'], allergens: [],
    materials: ['温かいごはん 300g', 'にんじん 1/3本', 'コーン 60g', 'しめじ 1/2パック', 'オリーブ油 小さじ2', '塩 少々'],
    child: ['大人がほぐした、加熱前のしめじをボウルへ入れる', '冷ました具をごはんとまぜる', 'お皿に盛って、名前をつける'],
    adult: ['にんじんを細かく切り、しめじの石づきを取る', 'フライパンに油をひき、にんじん・しめじ・コーンを十分に加熱する', '具を触れる温度まで冷まし、ごはんと合わせ、塩で味を調える'] },
  { id: 'potato', name: 'ほくほく おやこサラダ', emoji: '🥗', minutes: 20, description: 'つぶして、まぜて、自分のひと皿。',
    foods: ['potato', 'broccoli', 'corn'], allergens: [],
    materials: ['じゃがいも 2個', 'ブロッコリー 1/3株', 'コーン 50g', 'オリーブ油 小さじ2', 'レモン汁 小さじ1', '塩 少々'],
    child: ['洗うのを手伝う', '十分に冷ましたじゃがいもをつぶす', '具と調味料をまぜる'],
    adult: ['じゃがいもは皮・芽・緑色部分を取り、小さく切る。ブロッコリーを小房に分ける', '別々にゆで、やわらかくする。コーンも加熱する', '水気を切って触れる温度まで冷まし、子どもとまぜて塩で調える'] },
  { id: 'soup', name: 'ころころ トマトスープ', emoji: '🥣', minutes: 20, description: 'おなべの中に、小さな畑。',
    foods: ['tomato', 'carrot', 'potato', 'mushroom'], allergens: [],
    materials: ['トマト 1個', 'にんじん 1/3本', 'じゃがいも 1個', 'しめじ 1/2パック', '水 400ml', 'オリーブ油 小さじ2', '塩 少々'],
    child: ['野菜を洗う', '大人がほぐした、加熱前のしめじを器へ入れる', 'できたスープの名前を考える'],
    adult: ['じゃがいもの皮・芽・緑色部分を取り、野菜を小さく切る', '鍋で油を温め、野菜を炒めて水を加える', '野菜が十分やわらかくなるまで15分ほど煮て、塩で調える。食べる前に温度を確認する'] },
  { id: 'omelet', name: 'おひさま オムレツ', emoji: '🍳', minutes: 15, description: 'まぜる係と、焼く係のチーム戦。',
    foods: ['egg', 'corn', 'cheese', 'tomato'], allergens: ['卵', '乳'],
    materials: ['卵 3個', 'コーン 40g', 'チーズ 20g', 'トマト 1個', 'オリーブ油 小さじ2', '塩 少々'],
    child: ['生卵に触れない工程で、チーズをちぎる', '大人が切ったトマトを別のお皿に並べる', '完成後、冷めたことを確認して飾りつける'],
    adult: ['トマトを洗って食べやすく切る。卵を割り、塩・コーン・チーズを混ぜる', '油をひいたフライパンに流し、ふたをして弱火で中まで完全に火を通す', '切り分け、子どもが触れる温度まで冷ます。生卵に触れた器具を洗う'] },
  { id: 'roast', name: 'おやさい チーズやき', emoji: '🧀', minutes: 25, description: 'すきな並べ方で、小さなごちそう。',
    foods: ['broccoli', 'potato', 'cheese', 'tomato'], allergens: ['乳'],
    materials: ['じゃがいも 1個', 'ブロッコリー 1/3株', 'トマト 1個', 'チーズ 40g', 'オリーブ油 小さじ2', '塩 少々'],
    child: ['洗うのを手伝う', '冷ました加熱済みの野菜を、冷たい耐熱皿に並べる', 'チーズをのせる'],
    adult: ['じゃがいもの皮・芽・緑色部分を取り、野菜を食べやすく切る', 'じゃがいも・ブロッコリーを十分やわらかくゆで、触れる温度まで冷ます', '皿に並べて油と塩を加え、チーズをのせる。200℃のオーブンで焼き色がつくまで約10分焼く。皿と中身を十分冷ます'] },
];
