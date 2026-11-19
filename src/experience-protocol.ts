/** Versioned public-PoC answers. No account, camera frames or landmarks in this payload. */
export const questionnaireVersion = 'poc-2026-11-20-v1';
export const recipeVersion = 'daily-2026-11-19-v1';
export const conceptVersion = 'family-cooking-concept-v4';
export const inventoryVersion = 'household-stock-2026-11-19-v2';
export const experienceFoodIds = ['rice','noodles','bread','chicken','pork','salmon','egg','onion','carrot','potato','cabbage','pepper','tomato'] as const;
export const experienceRecipeIds = ['curry','nikujaga','hamburger','oyakodon','fried-rice','yakisoba','yakiudon','salmon-foil','salmon-cabbage','egg-sandwich','chicken-tomato','pizza-toast'] as const;
export const childQuestionIds = ['game_fun','help_intent'] as const;
export const childPlayFrequencies = ['daily','four_to_six_days','two_to_three_days','one_day','less_often','never'] as const;
export const parentQuestionIds = ['task_feasibility','continued_use','meal_preparation_ease','child_initiative'] as const;
export const employmentStatuses = ['yes','no','prefer_not'] as const;
export const gameplayStatuses = ['smooth','issues_completed','issues_partial','issues_unable','stopped_other','not_attempted'] as const;
export const serviceFeatureIds = ['game_recipe','food_learning','challenge_feedback','expert_recipes','family_schedule','none'] as const;
export const experienceStages = ['intro','camera','game','result','handoff','recipes','recipe','child-task','child-survey','parent-survey','done'] as const;
export type ExperiencePayload = {
  questionnaireVersion: typeof questionnaireVersion; recipeVersion: typeof recipeVersion; conceptVersion: typeof conceptVersion;
  inventoryVersion?: typeof inventoryVersion;
  sequence: number; age: number; demo: boolean; stage: typeof experienceStages[number];
  selectedIngredients: string[]; evidence: Record<string,{offered:number;caught:number}>; recipeId: string|null;
  gameInput?: 'camera'|'demo';
  deviceId?: string;
  child: {answers:Record<string,number>;comment:string;playFrequency?:typeof childPlayFrequencies[number]|null}; parent: {answers:Record<string,number>;comment:string;gameplayStatus?: typeof gameplayStatuses[number]|null;gameplayComment?:string;employmentStatus?:typeof employmentStatuses[number]|null};
  serviceFeedback?: {interestedFeatures:string[];comment:string};
  payment: {kind:'paid'|'free'|'no_use';maxMonthlyYen:number|null}|null; complete:boolean;
};
