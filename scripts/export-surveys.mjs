#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const format=option('--format','summary');
if(!['summary','json','csv'].includes(format))throw new Error('Use --format summary|json|csv');
const out=option('--out',null);
if(format!=='summary'&&!out)throw new Error('Raw answers require --out /private/path; do not print individual answers to a console');
const database=option('--db',resolve(process.env.DATA_DIR??'data','cookgame.sqlite'));
const db=new DatabaseSync(database,{readOnly:true});
const where=[];if(!args.includes('--include-demo'))where.push('demo=0');if(!args.includes('--include-drafts'))where.push('complete=1');
let rows=[];
try{rows=db.prepare(`SELECT id,receipt,age,child_mode,demo,recipe_id,questionnaire_version,created_at,updated_at,completed_at,payload FROM experience_responses${where.length?' WHERE '+where.join(' AND '):''} ORDER BY created_at`).all();}finally{db.close();}
const records=rows.map(row=>({...row,demo:Boolean(row.demo),payload:JSON.parse(row.payload)}));
let content;
if(format==='json')content=JSON.stringify({exportedAt:new Date().toISOString(),unit:'experience responses (not unique people)',includeDemo:args.includes('--include-demo'),includeDrafts:args.includes('--include-drafts'),count:records.length,records},null,2)+'\n';
if(format==='csv'){
 const fields=['id','receipt','age','child_mode','demo','questionnaire_version','recipe_version','concept_version','recipe_id','selected_ingredients','game_fun','help_intent','daily_feasibility','task_feasibility','continued_use','child_comment','parent_comment','payment_kind','max_monthly_yen','created_at','completed_at'];
 const cell=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const lines=records.map(row=>{const p=row.payload;return [row.id,row.receipt,row.age,row.child_mode,row.demo,row.questionnaire_version,p.recipeVersion,p.conceptVersion,row.recipe_id,p.selectedIngredients.join(' / '),p.child.answers.game_fun,p.child.answers.help_intent,p.child.answers.daily_feasibility,p.parent.answers.task_feasibility,p.parent.answers.continued_use,p.child.comment,p.parent.comment,p.payment?.kind,p.payment?.maxMonthlyYen,row.created_at,row.completed_at].map(cell).join(',');});
 content='\ufeff'+[fields.map(cell).join(','),...lines].join('\r\n')+'\r\n';
}
if(format==='summary'){
 const group=fn=>records.reduce((result,row)=>{const key=fn(row);result[key]=(result[key]??0)+1;return result;},{});
 const likert={};for(const mode of ['young-current-experience','older-kindergarten-hypothetical']){
  const data=records.filter(r=>r.child_mode===mode);const scores={};
  for(const [role,keys] of [['child',['game_fun','help_intent','daily_feasibility']],['parent',['task_feasibility','continued_use']]])for(const key of keys){const counts=Array.from({length:7},()=>0);for(const row of data){const value=row.payload[role]?.answers?.[key];if(Number.isInteger(value)&&value>=1&&value<=7)counts[value-1]++;}scores[key]={n:counts.reduce((a,b)=>a+b,0),scores1to7:counts};}
  likert[mode]={count:data.length,scores};
 }
 const amounts=records.filter(r=>r.payload.payment?.kind==='paid').map(r=>r.payload.payment.maxMonthlyYen).sort((a,b)=>a-b);
 const median=amounts.length?amounts.length%2?amounts[(amounts.length-1)/2]:(amounts[amounts.length/2-1]+amounts[amounts.length/2])/2:null;
 content=JSON.stringify({exportedAt:new Date().toISOString(),unit:'experience responses (not unique people)',includeDemo:args.includes('--include-demo'),includeDrafts:args.includes('--include-drafts'),count:records.length,byQuestionnaireVersion:group(r=>r.questionnaire_version),byRecipe:group(r=>r.recipe_id??'none'),paymentKinds:group(r=>r.payload.payment?.kind??'unanswered'),paidMaxMonthlyYen:{n:amounts.length,median,min:amounts[0]??null,max:amounts.at(-1)??null},likert},null,2)+'\n';
}
if(out){
 const path=resolve(out);mkdirSync(dirname(path),{recursive:true,mode:0o700});const temporary=path+'.tmp-'+process.pid;
 writeFileSync(temporary,content,{mode:0o600,flag:'wx'});const fd=openSync(temporary,'r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temporary,path);console.log(`Saved ${records.length} response(s) to ${path}`);
}else process.stdout.write(content);
