const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {answerCodex,call}=require('../src/codex-assessment.cjs');
const input={type:'short',question:'Synthetic question',options:[]};
const events=content=>[{type:'item.completed',item:{type:'agent_message',text:content}},
  {type:'turn.completed'}].map(event=>JSON.stringify(event)).join('\n');

test('plan provider uses authenticated ephemeral schema inference and removes its schema',async()=>{
  let inference;
  const result=await answerCodex(input,{model:'gpt-6.1-sol'},'',null,()=>{},
    {executable:'synthetic-codex',call:async(exe,args,prompt,settings)=>{
      if(args[0]==='login')return {code:0,stderr:'Logged in using ChatGPT'};
      inference={args,prompt,settings,schemaFile:args[args.indexOf('--output-schema')+1]};
      assert.equal(JSON.parse(fs.readFileSync(inference.schemaFile,'utf8')).additionalProperties,false);
      return {code:0,output:events('{"answer":"合成答复","uncertain":false}')};
    }});
  assert.deepEqual(result,{type:'short',answer:'合成答复'});
  assert.ok(inference.args.includes('--ephemeral'));
  assert.ok(inference.args.includes('--ignore-user-config'));
  assert.ok(inference.args.includes('forced_login_method="chatgpt"'));
  assert.ok(inference.args.includes('read-only'));
  assert.ok(inference.args.includes('shell_tool'));
  assert.ok(inference.args.includes('unbounded_connection_retries'));
  assert.ok(inference.args.includes('model_reasoning_effort="low"'));
  assert.ok(!inference.args.includes(input.question));
  assert.ok(inference.prompt.includes(input.question));
  assert.equal(fs.existsSync(inference.schemaFile),false);
});

test('API key authentication never starts inference under the plan setting',async()=>{
  let calls=0,detail;
  const result=await answerCodex(input,{},'',null,value=>detail=value,
    {executable:'synthetic',call:async()=>{calls++;return {code:0,stderr:'Logged in using an API key'};}});
  assert.equal(result,null);assert.equal(calls,1);assert.equal(detail.reason,'codex-login-required');
});

for(const [output,expected] of [
  [events('{"answer":null,"uncertain":true}'),'uncertain'],
  [events('{"answer":{"text":"reply"},"uncertain":false}'),'invalid-answer'],
  [JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{}'}}),'invalid-answer'],
  [JSON.stringify({type:'turn.failed'}),'network-error'],
  [JSON.stringify({type:'item.completed',item:{type:'command_execution'}})+'\n'+events('{"answer":"reply","uncertain":false}'),'invalid-answer']
])test(`invalid completion safely reports ${expected}`,async()=>{
  let detail;
  const result=await answerCodex(input,{},'',null,value=>detail=value,
    {executable:'synthetic',call:async(exe,args)=>args[0]==='login'?
      {code:0,output:'Logged in using ChatGPT'}:{code:0,output}});
  assert.equal(result,null);assert.equal(detail.reason,expected);
  assert.equal(JSON.stringify(detail).includes('Synthetic question'),false);
});

test('quota failures pause with a specific error and no secret diagnostics',async()=>{
  let detail;
  await answerCodex(input,{},'',null,value=>detail=value,{executable:'synthetic',
    call:async(exe,args)=>args[0]==='login'?{code:0,output:'Logged in using ChatGPT'}:
      {code:1,stderr:'private response: usage limit reached'}});
  assert.equal(detail.reason,'codex-limit');assert.equal(JSON.stringify(detail).includes('private'),false);
});

test('CLI startup warnings do not discard a completed structured response',async()=>{
  const result=await answerCodex(input,{},'',null,()=>{}, {executable:'synthetic',
    call:async(exe,args)=>args[0]==='login'?{code:0,output:'Logged in using ChatGPT'}:
      {code:0,output:JSON.stringify({type:'item.completed',item:{type:'error',message:'Feature warning'}})+'\n'+
        events('{"answer":"合成答复","uncertain":false}')}});
  assert.deepEqual(result,{type:'short',answer:'合成答复'});
});

test('subprocess has no shell, hidden window, stdin prompt and no inherited API keys',async()=>{
  const original=process.env.CODEX_API_KEY;process.env.CODEX_API_KEY='synthetic-secret';
  try{
    const result=await call('synthetic',[],'private prompt',{spawnProcess:(exe,args,settings)=>{
      assert.equal(settings.shell,false);assert.equal(settings.windowsHide,true);
      assert.equal(settings.env.CODEX_API_KEY,undefined);
      const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
      child.stdin.on('finish',()=>{child.stdout.write('safe output');child.emit('close',0);});
      return child;
    }});
    assert.equal(result.code,0);
  }finally{if(original===undefined)delete process.env.CODEX_API_KEY;else process.env.CODEX_API_KEY=original;}
});

test('transient failed inference retries once and returns a completed answer',async()=>{
  let count=0;const details=[];
  const result=await answerCodex(input,{},'',null,value=>details.push(value),{executable:'synthetic',
    call:async(exe,args)=>{
      if(args[0]==='login')return {code:0,output:'Logged in using ChatGPT'};
      count++;return count===1?{code:1,output:JSON.stringify({type:'turn.failed',error:{message:'Stream disconnected private-details'}})}:
        {code:0,output:events('{"answer":"有效答复","uncertain":false}')};
    }});
  assert.equal(count,2);assert.equal(result.answer,'有效答复');
  assert.equal(details[0].reason,'connection-retry');
  assert.equal(details[0].providerFailure,'transport');
  assert.equal(details.at(-1).attempt,2);
  assert.equal(JSON.stringify(details).includes('private-details'),false);
});

test('persistent transport errors have only two attempts',async()=>{
  let count=0,detail;
  const result=await answerCodex(input,{},'',null,value=>detail=value,{executable:'synthetic',
    call:async(exe,args)=>{
      if(args[0]==='login')return {code:0,output:'Logged in using ChatGPT'};
      count++;return {code:1,output:'',stderr:'socket request failed'};
    }});
  assert.equal(result,null);assert.equal(count,2);assert.equal(detail.reason,'network-error');
  assert.equal(detail.exitCode,1);assert.equal(detail.attempt,2);
});

for(const [message,reason] of [['usage limit reached','codex-limit'],['authentication expired','codex-login-required'],
  ['model is not supported','codex-model-unavailable'],['invalid JSON schema','invalid-answer']])
test(`${reason} in a failed turn is classified and never retried`,async()=>{
  let count=0,detail;
  await answerCodex(input,{},'',null,value=>detail=value,{executable:'synthetic',call:async(exe,args)=>{
    if(args[0]==='login')return {code:0,output:'Logged in using ChatGPT'};
    count++;return {code:0,output:JSON.stringify({type:'turn.failed',error:{message}})};
  }});
  assert.equal(count,1);assert.equal(detail.reason,reason);
});


test('timeout reports fragmented stream phase and reconnect counts without dumping content',async()=>{
  const result=await call('synthetic',[],'private prompt',{timeoutMs:15,spawnProcess:()=>{
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.kill=()=>{};child.unref=()=>{};
    child.stdin.on('finish',()=>{
      child.stdout.write('{"type":"thread.st');child.stdout.write('arted"}\n{"type":"turn.started"}\n');
      child.stderr.write('Reconnecting after private transport details');
    });
    return child;
  }});
  assert.equal(result.error,'timeout');assert.equal(result.progress.phase,'reconnecting');
  assert.equal(result.progress.eventCount,2);assert.equal(result.progress.networkRetries,1);
  assert.equal(JSON.stringify(result.progress).includes('private'),false);
});

test('a partial quota error at timeout is classified and does not spend a second inference',async()=>{
  let count=0,detail;
  await answerCodex(input,{},'',null,value=>detail=value,{executable:'synthetic',call:async(exe,args)=>{
    if(args[0]==='login')return {code:0,output:'Logged in using ChatGPT'};
    count++;return {error:'timeout',stderr:'usage limit reached private details',progress:{phase:'requesting',eventCount:2,networkRetries:0}};
  }});
  assert.equal(count,1);assert.equal(detail.reason,'codex-limit');assert.equal(detail.phase,'requesting');
  assert.equal(JSON.stringify(detail).includes('private'),false);
});
