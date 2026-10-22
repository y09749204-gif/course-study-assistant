const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const readerSource=fs.readFileSync(path.join(__dirname,'../src/xueyin-document-frame.cjs'),'utf8');
const contentSource=fs.readFileSync(path.join(__dirname,'../src/xueyin-content.cjs'),'utf8');

for(const permanent of [false,true])test(`failed document image ${permanent?'stops retrying at its limit':'recovers through a normal image request'}`,async t=>{
  const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});t.after(()=>b.close());
  const p=await b.newPage();let requests=0;
  await p.route('**/*',route=>{
    const url=route.request().url();
    if(url.includes('/mock-image.svg')){
      requests++;
      return route.fulfill({status:permanent||requests===1?503:200,headers:{'Cache-Control':'no-store'},
        contentType:'image/svg+xml',body:permanent||requests===1?'unavailable':'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="1800"><rect width="200" height="1800" fill="white"/></svg>'});
    }
    return route.fulfill({contentType:'text/html',body:url.includes('/screen/v2/')?
      '<div class="fileBox"><img src="https://cdn.chaoxing.com/mock-image.svg"></div>':
      '<iframe style="width:500px;height:300px" src="https://p.ananas.chaoxing.com/screen/v2/mock-image"></iframe>'});
  });
  await p.goto('https://mooc1.chaoxing.com/mycourse/studentstudy');
  const reader=p.frames().find(f=>f.url().includes('/screen/v2/'));
  await reader.waitForFunction(()=>document.querySelector('img')?.complete);
  await reader.addScriptTag({content:readerSource});
  await p.evaluate(()=>{window.stages=[];addEventListener('message',e=>{if(e.data?.type==='xy-document-progress')stages.push(e.data)});document.querySelector('iframe').contentWindow.postMessage({type:'xy-read-document'},'*');});
  if(permanent){
    await p.waitForTimeout(5500);assert.equal(requests,3);
    await reader.evaluate(()=>{const realNow=Date.now;Date.now=()=>realNow()+25000;});
    await p.waitForFunction(()=>stages.some(s=>s.reason==='resource-timeout'),null,{timeout:5000});
    assert.equal(requests,3);
  }else{
    await reader.waitForFunction(()=>document.scrollingElement.scrollTop>0,null,{timeout:9000});
    assert.equal(requests,2);
    assert.equal(await p.evaluate(()=>stages.some(s=>s.stage==='unsupported')),false);
  }
});

for(const outcome of ['accepted','cooldown','exhausted'])test(`document resource timeout handles ${outcome} recovery without credit`,async t=>{
  const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});t.after(()=>b.close());
  const p=await b.newPage();
  await p.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:route.request().url().includes('/knowledge/cards')?
    `<script>let ready=false;addEventListener('message',e=>{if(e.data?.type==='mock-reloaded')ready=true});setInterval(()=>parent.postMessage({type:'xy-document-status',stage:ready?'browsing':'unsupported',reason:ready?null:'resource-timeout',tasks:[{complete:false}],index:0},'*'),100)</script>`:
    '<li class="active" style="width:700px;height:40px">1.1 模拟文档 <span>1</span></li><iframe style="width:700px;height:650px" src="https://mooc1.chaoxing.com/mooc-ans/knowledge/cards"></iframe>'}));
  await p.goto('https://mooc1.chaoxing.com/mycourse/studentstudy');
  await p.evaluate(outcome=>{
    window.calls=[];window.s={status:'running',currentSection:'1.1',currentTask:null,sectionPending:{'1.1':1},completedTaskIds:[],submittedQuizzes:[]};
    window.XyBridge={state:async()=>structuredClone(s),update:async patch=>Object.assign(s,patch),notify:async()=>{},onCommand:()=>{},report:()=>{},catalogDiagnostic:()=>{},recoverDocument:async request=>{
      calls.push(request);
      if(outcome==='exhausted')return {accepted:false,reason:'exhausted'};
      if(outcome==='cooldown'&&calls.length===1)return {accepted:false,reason:'cooldown'};
      document.querySelector('iframe').contentWindow.postMessage({type:'mock-reloaded'},'*');return {accepted:true};
    }};
  },outcome);
  await p.addScriptTag({content:contentSource});
  await p.waitForFunction(()=>calls.length>0,null,{timeout:6000});
  if(outcome==='exhausted')await p.waitForFunction(()=>s.status==='blocked');
  else{await p.waitForTimeout(2200);assert.equal(await p.evaluate(()=>s.status),'running');}
  assert.equal(await p.evaluate(()=>calls.length),outcome==='cooldown'?2:1);
  assert.deepEqual(await p.evaluate(()=>calls[0]),{taskId:'1.1/document/0',reason:'resource-timeout'});
  assert.deepEqual(await p.evaluate(()=>s.completedTaskIds),[]);
});
