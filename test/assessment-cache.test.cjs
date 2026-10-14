const test=require('node:test');
const assert=require('node:assert/strict');
const {createAssessmentCache}=require('../src/assessment-cache.cjs');
test('resume reuses successful answers but retries a failed later question',async()=>{
 let calls=[],fail=true;
 const answer=createAssessmentCache(async input=>{calls.push(input.question);return input.question==='third'&&fail?null:{type:'multi',answer:[0,2]};});
 const config={model:'one'};
 for(const question of ['first','second','third'])await answer({type:'multi',question},config,'key');
 fail=false;
 for(const question of ['first','second','third'])await answer({type:'multi',question},config,'key');
 assert.deepEqual(calls,['first','second','third','third']);
});
test('changed question, options, model or key invalidate reuse; cache expires and is bounded',async()=>{
 let clock=0,calls=0;
 const answer=createAssessmentCache(async()=>{calls++;return {type:'single',answer:0};},{now:()=>clock,ttl:10,limit:2});
 const input={type:'single',question:'one',options:['a','b']},config={model:'one'};
 const first=await answer(input,config,'one');first.answer=99;
 assert.equal((await answer(input,config,'one')).answer,0);assert.equal(calls,1);
 await answer({...input,options:['c','b']},config,'one');
 await answer(input,{model:'two'},'one');await answer(input,config,'one');assert.equal(calls,4);
 await answer(input,config,'two');clock=20;await answer(input,config,'two');assert.equal(calls,6);
});
