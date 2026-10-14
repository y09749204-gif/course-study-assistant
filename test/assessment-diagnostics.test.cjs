const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeAnswer,answerAssessment}=require('../src/assessment-ai.cjs');
test('local Qwen uses bounded non-thinking JSON generation without changing cloud requests',async()=>{
 const input={type:'multi',question:'test question',options:['a','b','c']};
 for(const local of [true,false]){
  const endpoint=local?'http://127.0.0.1:11434/v1/chat/completions':'https://example.com/v1/chat/completions';
  let request;
  const result=await answerAssessment(input,{mode:'compatible',endpoint,model:'qwen3:8b'},'',async(url,init)=>{
    request={path:new URL(url).pathname,...JSON.parse(init.body)};
    const content='{"answer":[0,2],"uncertain":false}';
    return {ok:true,json:async()=>local?{message:{content}}:{choices:[{message:{content}}]}};
  });
  assert.deepEqual(result,{type:'multi',answer:[0,2]});
  assert.equal(request.path,local?'/api/chat':'/v1/chat/completions');
  assert.equal(request.think,local?false:undefined);
  if(local)assert.equal(request.options.num_predict,512);
 }
});
test('explicit confident letter answers normalize without accepting guesses',()=>{
 const options=['one','two','three','four'];
 assert.deepEqual(normalizeAnswer('multi',options,'{"answer":["A","C"],"uncertain":false}'),{type:'multi',answer:[0,2]});
 assert.deepEqual(normalizeAnswer('multi',options,'{"answer":"A,C","uncertain":false}'),{type:'multi',answer:[0,2]});
 assert.equal(normalizeAnswer('multi',options,'{"answer":["A","A"],"uncertain":false}'),null);
 assert.equal(normalizeAnswer('multi',options,'{"answer":["A","C"],"uncertain":true}'),null);
 assert.equal(normalizeAnswer('multi',options,'{"answer":["H"],"uncertain":false}'),null);
});
test('interface errors, uncertainty and invalid formats have distinct private diagnostics',async()=>{
 const input={type:'multi',question:'private-question',options:['a','b']},config={mode:'compatible',endpoint:'https://example.com',model:'test'};
 for(const [fetchImpl,expected] of [
  [async()=>({ok:false,status:401}),'http-error'],
  [async()=>{throw Object.assign(new Error('private-token'),{name:'TimeoutError'});},'timeout'],
  [async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"answer":null,"uncertain":true}'}}]})}),'uncertain'],
  [async()=>({ok:true,json:async()=>({choices:[{message:{content:'bad private-response'}}]})}),'invalid-answer']]){
   let detail;assert.equal(await answerAssessment(input,config,'private-key',fetchImpl,x=>detail=x),null);
   assert.equal(detail.reason,expected);assert.equal(JSON.stringify(detail).includes('private'),false);
 }
});
