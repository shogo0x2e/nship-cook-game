/** Versioned public-PoC answers. No account, camera frames or landmarks in this payload. */
export const legacyQuestionnaireVersion = 'poc-2026-11-19-v1';
export const questionnaireVersion = 'poc-2026-11-19-v2';
export const recipeVersion = 'daily-2026-11-19-v1';
export const legacyConceptVersion = 'family-cooking-concept-v1';
export const conceptVersion = 'family-cooking-concept-v2';
export const inventoryVersion = 'household-stock-2026-11-19-v1';
export const experienceFoodIds = ['rice','noodles','bread','chicken','pork','salmon','egg','onion','carrot','potato','cabbage','pepper','tomato'] as const;
export const experienceRecipeIds = ['curry','nikujaga','hamburger','oyakodon','fried-rice','yakisoba','yakiudon','salmon-foil','salmon-cabbage','egg-sandwich','chicken-tomato','pizza-toast'] as const;
export const childQuestionIds = ['game_fun','help_intent','daily_feasibility'] as const;
export const legacyParentQuestionIds = ['task_feasibility','continued_use'] as const;
export const parentQuestionIds = [...legacyParentQuestionIds,'meal_decision_ease','child_initiative'] as const;
export const gameplayStatuses = ['smooth','issues_completed','issues_partial','issues_unable','stopped_other','not_attempted'] as const;
export const experienceStages = ['intro','camera','game','result','handoff','recipes','recipe','child-task','child-survey','parent-survey','done'] as const;
export type ExperiencePayload = {
  questionnaireVersion: typeof questionnaireVersion | typeof legacyQuestionnaireVersion; recipeVersion: typeof recipeVersion; conceptVersion: typeof conceptVersion | typeof legacyConceptVersion;
  inventoryVersion?: typeof inventoryVersion;
  sequence: number; age: number; demo: boolean; stage: typeof experienceStages[number];
  selectedIngredients: string[]; evidence: Record<string,{offered:number;caught:number}>; recipeId: string|null;
  gameInput?: 'camera'|'demo';
  child: {answers:Record<string,number>;comment:string}; parent: {answers:Record<string,number>;comment:string;gameplayStatus?: typeof gameplayStatuses[number]|null};
  payment: {kind:'paid'|'free'|'no_use';maxMonthlyYen:number|null}|null; complete:boolean;
};
