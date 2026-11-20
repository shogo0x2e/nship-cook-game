// A separate browser entry also makes the plain HTML review use the real local detector.
export { PoseCamera } from './pose';
export { FramingGate } from './camera-framing';

import {mountGame} from './game-scene';
import {experienceIngredients} from './content';
import {experienceFoodIds} from './experience-protocol';
import {rolePairSchedule,maxPairs,type IngredientId,type Evidence} from './game';
import data from './experience-data.json';
import {TrialSampleCamera,type TrialTrackingProfile} from './trial-sample-camera';
export function mountCameraTrial(container:HTMLElement,onFinish:(evidence:Evidence)=>Promise<unknown>,sample=false,profile:TrialTrackingProfile={}){
 const groups=['staple','protein','vegetable'].map(role=>data.foods.filter(food=>food.group===role).map(food=>food.id as IngredientId));
 return mountGame(container,{input:'camera',allowed:[...experienceFoodIds],catalog:experienceIngredients,schedule:rolePairSchedule(groups,maxPairs),canPlay:()=>true,onStatus:async()=>{},onFinish,showPreview:true,autoPrepare:true,startWhenFramed:true,localResult:true,landscapeOnly:true,cameraFactory:sample?callback=>new TrialSampleCamera(callback,profile):undefined});
}
