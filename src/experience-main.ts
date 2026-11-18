import '../design/recipe-prototype/style.css';
import './experience-game.css';
import { mountGame } from './game-scene';
import { rolePairSchedule, maxPairs, type IngredientId, type Evidence } from './game';
import { experienceIngredients } from './content';
import { experienceFoodIds } from './experience-protocol';
import data from './experience-data.json';
import { saveExperience, onSaved, flushOutbox } from './experience-sync';
const groups = ['staple','protein','vegetable'].map(role => data.foods.filter(food => food.group === role).map(food => food.id as IngredientId));
declare global {
 interface Window { cookgameRuntime: {
   saveExperience: typeof saveExperience; onSaved: typeof onSaved; flushOutbox: typeof flushOutbox;
   mountGame: (container:HTMLElement,options:{input:'camera'|'demo';onFinish:(evidence:Evidence)=>Promise<void>})=>ReturnType<typeof mountGame>;
 }; }
}
window.cookgameRuntime = {
 saveExperience, onSaved, flushOutbox,
 mountGame: (container, options) => mountGame(container, {
  ...options, catalog: experienceIngredients, allowed: [...experienceFoodIds], schedule: rolePairSchedule(groups, maxPairs),
  canPlay: () => true, onStatus: async () => {}, showPreview: true, autoPrepare: true, localResult: true,
 }),
};
// Shared rendering keeps the review prototype and the shipped experience in sync.
// @ts-expect-error This small HTML view module intentionally remains plain JavaScript.
await import('../design/recipe-prototype/app.js');
