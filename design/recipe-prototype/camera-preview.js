const main=document.querySelector('#trial-main');let game=null,generation=0;
const sample=new URLSearchParams(location.search).get('input')==='sample';
document.querySelector('#launch-camera').addEventListener('click',async()=>{
 const current=++generation;main.dataset.screen='game';main.innerHTML='<div id="native-game" class="native-game"><p role="status">ゲームを準備しています…</p></div>';
 try{
  const runtime=await (import.meta.env?.DEV?import('/src/camera-runtime.ts'):import(/* @vite-ignore */ '/camera-runtime.js'));
  if(current!==generation)return;
  game=runtime.mountCameraTrial(document.querySelector('#native-game'),async()=>{main.innerHTML='<h1>おしまい！</h1><p>この画面は、ゲームの入口と自動確認を試すローカル版です。</p>';},sample);
 }catch{main.innerHTML='<p>ゲームを読み込めませんでした。ページを再読み込みしてください。</p>';}
});
window.addEventListener('pagehide',()=>{generation++;game?.destroy();});
