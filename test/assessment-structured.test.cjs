const test=require('node:test');
const assert=require('node:assert/strict');
const {answerAssessment,normalizeAnswer}=require('../src/assessment-ai.cjs');
const config={mode:'compatible',endpoint:'http://127.0.0.1:11434/v1/chat/completions',model:'qwen3:8b'};
const input={type:'short',question:'Synthetic question',options:[]};
const response=(content,done_reason='stop')=>({ok:true,json:async()=>({message:{content},done_reason})});

test('local generation constrains fields and permits an uncertain null answer',async()=>{
  let body;
  const result=await answerAssessment(input,config,'',async(url,init)=>{
    body=JSON.parse(init.body);return response('{"answer":"测试答复","uncertain":false}');
  });
  assert.deepEqual(result,{type:'short',answer:'测试答复'});
  assert.deepEqual(body.format.required,['answer','uncertain']);
  assert.equal(body.format.additionalProperties,false);
  assert.equal(body.format.properties.answer.anyOf[0].type,'string');
  assert.equal(body.format.properties.answer.anyOf[1].type,'null');
  assert.equal(body.think,false);
});

for(const [content,finish,kind] of [
  ['{"answer":"unfinished','stop','json-syntax'],
  ['{"answer":"答复"}','stop','schema'],
  ['{"answer":{"text":"答复"},"uncertain":false}','stop','answer-type'],
  ['{"answer":"","uncertain":false}','stop','answer-length'],
  ['{"answer":"答复","uncertain":false}','length','truncated'],
])test(`${kind} gets one corrective inference with no raw text in diagnostics`,async()=>{
  const requests=[],details=[];
  const result=await answerAssessment(input,config,'private-key',async(url,init)=>{
    requests.push(JSON.parse(init.body));
    return requests.length===1?response(content,finish):response('{"answer":"有效答复","uncertain":false}');
  },detail=>details.push(detail));
  assert.deepEqual(result,{type:'short',answer:'有效答复'});
  assert.equal(requests.length,2);
  assert.ok(requests[1].messages.at(-1).content.includes(kind));
  assert.equal(requests[1].options.num_predict,3072);
  assert.equal(details[0].failureKind,kind);
  assert.equal(details.at(-1).attempt,2);
  assert.equal(JSON.stringify(details).includes('有效答复'),false);
  assert.equal(JSON.stringify(details).includes('private-key'),false);
});

test('persistent malformed output stops after two attempts',async()=>{
  let count=0,detail;
  assert.equal(await answerAssessment(input,config,'',async()=>{
    count++;return response('not JSON');
  },value=>detail=value),null);
  assert.equal(count,2);assert.equal(detail.reason,'invalid-answer');
  assert.equal(detail.failureKind,'json-syntax');
});

test('explicit uncertainty and an out of range choice are never retried',async()=>{
  for(const [question,content] of [
    [input,'{"answer":null,"uncertain":true}'],
    [{type:'single',question:'Synthetic',options:['A','B']},'{"answer":5,"uncertain":false}']
  ]){
    let count=0;
    assert.equal(await answerAssessment(question,config,'',async()=>{
      count++;return response(content);
    }),null);
    assert.equal(count,1);
  }
});

test('normalizer accepts a complete fenced object but never repairs malformed or extra fields',()=>{
  assert.deepEqual(normalizeAnswer('short',[],'```json\n{"answer":"答复","uncertain":false}\n```'),{type:'short',answer:'答复'});
  for(const raw of ["{'answer':'答复','uncertain':false}",'{"answer":"答复","uncertain":false,}',
    'prefix {"answer":"答复","uncertain":false}',
    '{"answer":"答复","uncertain":false,"extra":"data"}'])assert.equal(normalizeAnswer('short',[],raw),null);
});
