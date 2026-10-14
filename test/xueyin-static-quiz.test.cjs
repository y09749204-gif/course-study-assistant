const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const content=fs.readFileSync(path.join(__dirname,'../src/xueyin-content.cjs'),'utf8');
for(const mode of ['static','reading-detail','unconfirmed','interactive','task','cross-origin'])test(`completed reading card classification: ${mode}`,async t=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
  t.after(()=>browser.close());const page=await browser.newPage();
  const origin=mode==='cross-origin'?'https://mooc2.chaoxing.com':'https://mooc1.chaoxing.com';
  await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:r.request().url().includes('/knowledge/cards')?
    `<div class="wrap"><p>模拟静态练习材料</p>${mode==='interactive'?'<textarea></textarea>':mode==='task'?'<span class="ans-job-icon">任务点</span>':''}</div>`:
    `${mode==='reading-detail'?'<h2 id="detailTitle">章节详情</h2><button onclick="window.returns++;document.querySelector(\'#detailTitle\').remove();this.remove()">返回课程</button>':''}<ul><li><div class="posCatalog_select posCatalog_active">1.2 章节测验 ${mode==='unconfirmed'?'':'<i class="icon_Completed" style="display:inline-block;width:20px;height:20px"></i>'}</div></li><li onclick="window.nextClicks++">2.1 视频 1</li></ul><iframe style="width:700px;height:300px" src="${origin}/mooc-ans/knowledge/cards"></iframe>`}));
  await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy');
  await page.waitForFunction(()=>document.querySelector('iframe').contentWindow.length===0);
  await page.evaluate(()=>{
    window.nextClicks=0;window.returns=0;window.answers=0;window.notifications=[];
    window.s={status:'running',currentSection:'1.2',currentIsQuiz:true,quizStatuses:{},submittedQuizzes:[],sectionPending:{}};
    window.XyBridge={state:async()=>structuredClone(s),update:async p=>Object.assign(s,p),notify:async m=>notifications.push(m),report:()=>{},catalogDiagnostic:()=>{},onCommand:()=>{},answer:async()=>{answers++;}};
  });
  await page.addScriptTag({content});
  if(['static','reading-detail'].includes(mode)){
    await page.waitForFunction(()=>nextClicks===1,null,{timeout:7000});
    assert.equal(await page.evaluate(()=>s.currentSection),'2.1');
    assert.equal(await page.evaluate(()=>s.quizStatuses['1.2']),'content-only');
    if(mode==='reading-detail')assert.equal(await page.evaluate(()=>returns),1);
  }else{
    await page.waitForTimeout(3500);
    assert.equal(await page.evaluate(()=>nextClicks),0);
    assert.equal(await page.evaluate(()=>s.quizStatuses['1.2']),undefined);
  }
  assert.deepEqual(await page.evaluate(()=>s.submittedQuizzes),[]);
  assert.equal(await page.evaluate(()=>answers),0);
});
