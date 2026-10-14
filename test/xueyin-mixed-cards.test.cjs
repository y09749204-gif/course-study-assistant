const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const source=fs.readFileSync(path.join(__dirname,'../src/xueyin-video-frame.cjs'),'utf8');
for(const pending of [2,3,8])test(`mixed PDF/video inventory with ${pending} pending tasks`,async t=>{
  const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});t.after(()=>b.close());
  const p=await b.newPage();await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:r.request().url().includes('/knowledge/cards')?
    `${[1,2].map(i=>`<div class="ans-attach-ct"><div class="ans-job-icon" style="height:20px"> </div><iframe style="width:400px;height:180px" src="https://mooc1.chaoxing.com/ananas/modules/pdf/index.html?mock=${i}"></iframe></div>`).join('')}<div class="ans-attach-ct videoContainer ${pending===2?'ans-job-finished':''}"><div class="task-condition" style="${pending===2?'display:none':''}">Watching threshold</div><iframe style="width:400px;height:250px" src="https://mooc1.chaoxing.com/ananas/modules/video/index.html"></iframe></div>`:
    r.request().url().includes('/video/index.html')?'<video style="width:400px;height:250px"></video>':r.request().url().includes('/pdf/index.html')?'<p>Mock document</p>':'<iframe id="cards" style="width:700px;height:750px" src="https://mooc1.chaoxing.com/mooc-ans/knowledge/cards"></iframe>'}));
  await p.goto('https://mooc1.chaoxing.com/mycourse/studentstudy');
  const card=p.frames().find(f=>f.url().includes('/knowledge/cards'));
  await card.waitForSelector('.task-condition',{state:'attached'});
  const video=p.frames().find(f=>f.url().includes('/video/index.html'));
  await video.evaluate(()=>{window.plays=0;document.querySelector('video').play=()=>{plays++;return Promise.resolve();};});
  await video.addScriptTag({content:source});await card.addScriptTag({content:source});
  await p.evaluate(pending=>document.querySelector('#cards').contentWindow.postMessage({type:pending===2?'xy-inspect':'xy-play',pending},'*'),pending);
  if(pending===2){await p.waitForTimeout(1500);assert.equal(await card.evaluate(()=>cards()[0].complete),true);assert.equal(await video.evaluate(()=>plays),0);assert.equal(await card.evaluate(()=>pendingDocuments()),2);}
  else if(pending===3){await video.waitForFunction(()=>plays>0,null,{timeout:5000});assert.equal(await card.evaluate(()=>cards().length),1);assert.equal(await card.evaluate(()=>cards()[0].complete),false);assert.equal(await card.evaluate(()=>cards()[0].media.src.includes('/video/index.html')),true);}
  else{await video.waitForFunction(()=>plays>0,null,{timeout:5000});assert.equal(await card.evaluate(()=>cards().length),1);assert.equal(await card.evaluate(()=>cards()[0].complete),false);}
});

test('finished PDFs and stale zero pending count cannot complete an unfinished video job',async t=>{
  const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});t.after(()=>b.close());const p=await b.newPage();
  await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:r.request().url().includes('/knowledge/cards')?
    '<div class="ans-attach-ct ans-job-finished"><iframe src="https://mooc1.chaoxing.com/ananas/modules/pdf/index.html" style="width:400px;height:180px"></iframe></div><div class="ans-attach-ct"><div class="ans-job-icon" style="height:20px">Task</div><div class="task-condition">Watching threshold</div><video style="width:400px;height:250px"></video></div>':
    '<iframe id="cards" style="width:700px;height:650px" src="https://mooc1.chaoxing.com/mooc-ans/knowledge/cards"></iframe>'}));
  await p.goto('https://mooc1.chaoxing.com/mycourse/studentstudy');const card=p.frames().find(f=>f.url().includes('/knowledge/cards'));
  await card.waitForSelector('video');await card.addScriptTag({content:source});
  await p.evaluate(()=>document.querySelector('#cards').contentWindow.postMessage({type:'xy-inspect',pending:0},'*'));
  await card.waitForFunction(()=>pendingCount===0);
  assert.equal(await card.evaluate(()=>cards()[0].complete),false);
  assert.equal(await card.evaluate(()=>cards()[0].evidence),'job-marker');
  await card.evaluate(()=>{document.querySelector('.task-condition').remove();});
  assert.equal(await card.evaluate(()=>cards()[0].complete),false);
  await card.evaluate(()=>document.querySelector('video').closest('.ans-attach-ct').classList.add('ans-job-finished'));
  assert.equal(await card.evaluate(()=>cards()[0].complete),true);
});

test('live unfinished video marker repairs a stale local claim while preserving document credit and catalog totals',async t=>{
  const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});t.after(()=>b.close());const p=await b.newPage();
  await p.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:r.request().url().includes('/knowledge/cards')?
    '<div class="ans-attach-ct ans-job-finished"><iframe src="https://mooc1.chaoxing.com/ananas/modules/pdf/index.html" style="width:400px;height:180px"></iframe></div><div class="ans-attach-ct"><div class="ans-job-icon" style="height:20px">Task</div><div class="task-condition">Watching threshold</div><video style="width:400px;height:250px"></video></div>':
    '<div>已完成任务点 2/3</div><ul><li class="active" style="width:700px;height:40px">1.1 视频 <span>1</span></li></ul><iframe id="cards" style="width:700px;height:650px" src="https://mooc1.chaoxing.com/mooc-ans/knowledge/cards"></iframe>'}));
  await p.goto('https://mooc1.chaoxing.com/mycourse/studentstudy');const card=p.frames().find(f=>f.url().includes('/knowledge/cards'));await card.waitForSelector('video');
  await card.evaluate(()=>{window.plays=0;const v=document.querySelector('video');v.play=()=>{plays++;return Promise.resolve();};});
  await card.addScriptTag({content:source});
  await p.evaluate(()=>{
    window.s={status:'running',currentSection:'1.1',currentTask:'1.1/video/0',sectionPending:{'1.1':1},platformDone:2,platformTotal:3,completedTaskIds:['1.1/document/0','1.1/document/1','1.1/video/0'],submittedQuizzes:[],quizStatuses:{},pageDiagnostics:{}};
    window.XyBridge={state:async()=>structuredClone(s),update:async patch=>Object.assign(s,patch),notify:async()=>{},onCommand:()=>{},catalogDiagnostic:()=>{},report:()=>{}};
    document.querySelector('#cards').contentWindow.postMessage({type:'xy-inspect',pending:0},'*');
  });
  await p.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../src/xueyin-content.cjs'),'utf8')});
  await p.waitForFunction(()=>!s.completedTaskIds.includes('1.1/video/0'),null,{timeout:7000});
  await card.waitForFunction(()=>plays>0,null,{timeout:7000});
  assert.deepEqual(await p.evaluate(()=>({status:s.status,done:s.platformDone,total:s.platformTotal,ids:s.completedTaskIds})),{status:'running',done:2,total:3,ids:['1.1/document/0','1.1/document/1']});
});
