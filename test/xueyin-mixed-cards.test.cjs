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
  else{await p.waitForTimeout(1500);assert.equal(await card.evaluate(()=>cards().length),0);}
});
