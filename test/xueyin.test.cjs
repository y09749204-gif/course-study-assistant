const test=require('node:test');
const assert=require('node:assert/strict');
const X=require('../src/xueyin-core.cjs');
const {normalizeAnswer,answerAssessment}=require('../src/assessment-ai.cjs');

const link='https://mooc2-ans.xueyinonline.com/mooc2-ans/mycourse/stu?courseid=11&clazzid=22&cpi=33&enc=secret';
test('course identity accepts official detail pages and rejects a different course',()=>{
  const target=X.validateLaunchURL(link);
  assert.equal(target.identity.courseid,'11');
  assert.equal(X.isStudyPage(link,target.identity),true);
  assert.equal(X.isStudyPage('https://mooc2-ans.xueyinonline.com/mooc2-ans/knowledge/detail',target.identity),true);
  assert.equal(X.isStudyPage('https://mooc2-ans.xueyinonline.com/mooc2-ans/knowledge/detail?courseid=12',target.identity),false);
  assert.equal(X.isStudyPage('https://mooc1.xueyinonline.com/mycourse/studentstudy?courseId=11&clazzId=22',target.identity),true);
  assert.equal(X.isStudyPage('https://mooc1.xueyinonline.com/mycourse/studentstudy?courseId=12&clazzId=22',target.identity),false);
  assert.equal(X.isStudyPage('https://bad.example/mooc2-ans/knowledge/detail',target.identity),false);
  assert.throws(()=>X.validateLaunchURL('https://evil.example/mooc2-ans/mycourse/stu?courseid=11&clazzid=22&cpi=33&enc=secret'));
});
test('daily handoff waits for 06:00 and MaYuan, then resumes environment',()=>{
  const state={...X.emptyState(),enabled:true,status:'interrupted'};
  assert.equal(X.shouldAutoRun(state,{status:'running'},new Date('2026-09-29T00:00:00Z')),false);
  assert.equal(X.shouldAutoRun(state,{status:'complete'},new Date('2026-09-28T21:59:00Z')),false);
  assert.equal(X.shouldAutoRun(state,{status:'complete'},new Date('2026-09-28T22:00:00Z')),true);
  assert.equal(X.shouldAutoRun({...state,status:'blocked'},{status:'complete'},new Date('2026-09-28T22:00:00Z')),false);
});
test('AI accepts only explicit valid answers for all three quiz types',()=>{
  assert.deepEqual(normalizeAnswer('single',['甲','乙'],'{"answer":1,"uncertain":false}'),{type:'single',answer:1});
  assert.deepEqual(normalizeAnswer('multi',['甲','乙','丙'],'{"answer":[2,0],"uncertain":false}'),{type:'multi',answer:[0,2]});
  assert.deepEqual(normalizeAnswer('short',[],'{"answer":"环境法保护公共利益。","uncertain":false}'),{type:'short',answer:'环境法保护公共利益。'});
  assert.equal(normalizeAnswer('single',['甲','乙'],'{"answer":1,"uncertain":true}'),null);
  assert.equal(normalizeAnswer('multi',['甲','乙'],'{"answer":[1,1],"uncertain":false}'),null);
  assert.equal(normalizeAnswer('short',[],'{"answer":"","uncertain":false}'),null);
});
test('AI failure leaves a question unanswered',async()=>{
  const config={mode:'compatible',endpoint:'http://127.0.0.1:11434/v1/chat/completions',model:'qwen3:8b'};
  const answer=await answerAssessment({type:'single',question:'题目',options:['甲','乙']},config,'',async()=>({ok:false}));
  assert.equal(answer,null);
});
test('task count reads both counter and course summary wording',()=>{
  assert.deepEqual(X.taskCount('已完成任务点 0/135'),{done:0,total:135});
  assert.deepEqual(X.taskCount('本课开放学习的135个任务点中，你已学习了0个'),{done:0,total:135});
});
