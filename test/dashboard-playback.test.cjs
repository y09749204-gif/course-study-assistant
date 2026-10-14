const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');

test('manual playback is visible while the automated task stays blocked',async t=>{
  const browser=await chromium.launch({headless:true,
    executablePath:process.env.CHROME_EXECUTABLE});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.setViewportSize({width:400,height:582});
  await page.addInitScript(()=>{
    window.study={status:async()=>({windowOpen:false,enabled:false,sidebarWidth:360,
      dailyState:{day:'2026-09-29',status:'idle',completed:[],seconds:0},dailyHistory:[]}),
      aiGet:async()=>({mode:'off'})};
    window.__environmentState={windowOpen:true,courseOnTarget:true,configured:true,
      status:'blocked',blockedReason:'学习通要求图形验证码',currentSection:'1.1',
      platformDone:0,platformTotal:135,submittedQuizzes:[],
      playbackObservation:{playing:true,positionSeconds:120,durationSeconds:600}};
    window.environment={status:async()=>window.__environmentState};
  });
  const file=path.join(__dirname,'../src/dashboard.html').replace(/\\/g,'/');
  await page.goto(`file:///${file}`);
  await page.waitForFunction(()=>document.querySelector('#badge')?.textContent==='手动播放中');
  const pane=await page.locator('#coursePane').boundingBox();
  assert.equal(pane.x,12);assert.equal(pane.y,350);assert.equal(pane.width,376);
  assert.ok(pane.y+pane.height<=582);
  await page.screenshot({path:path.join(require('node:os').tmpdir(),'zh-widget-preview.png')});
  assert.match(await page.locator('#xyDetail').innerText(),/自动任务仍暂停/);
  assert.equal(await page.locator('#xyCount').innerText(),'0 / 135');
  await page.evaluate(async()=>{
    window.__environmentState.playbackObservation={playing:false,issue:'download-failed'};
    await refresh();
  });
  assert.equal(await page.locator('#badge').innerText(),'视频加载失败');
  assert.match(await page.locator('#xyDetail').innerText(),/手动切换线路/);
  await page.evaluate(async()=>{
    window.__environmentState.playbackObservation={playing:false,issue:'playback-failed'};
    await refresh();
  });
  assert.equal(await page.locator('#badge').innerText(),'视频加载失败');
  assert.match(await page.locator('#xyDetail').innerText(),/Chrome 核对同一视频/);
  await page.evaluate(async()=>{
    window.__environmentState.playbackObservation={playing:false,issue:'media-error',mediaErrorCode:3};
    await refresh();
  });
  assert.equal(await page.locator('#badge').innerText(),'视频加载失败');
  assert.match(await page.locator('#xyDetail').innerText(),/媒体错误（代码 3）/);
  await page.evaluate(async()=>{
    window.__environmentState.playbackObservation={playing:false,issue:'stalled'};
    await refresh();
  });
  assert.equal(await page.locator('#badge').innerText(),'播放卡住');
  assert.match(await page.locator('#xyDetail').innerText(),/未前进/);
  await page.evaluate(async()=>{window.__environmentState.playbackObservation=null;await refresh();});
  assert.equal(await page.locator('#badge').innerText(),'需要处理');
  await page.evaluate(async()=>{
    window.__environmentState.windowOpen=false;
    window.__mayuan={windowOpen:true,courseOnTarget:true,enabled:false,sidebarWidth:360,
      dailyState:{day:'2026-10-11',status:'running',completed:[],seconds:0,currentLesson:'3.4',currentLessonConfirmed:false},dailyHistory:[]};
    study.status=async()=>window.__mayuan;
    await refresh();
  });
  assert.match(await page.locator('#detail').innerText(),/当前小节待确认/);
  assert.doesNotMatch(await page.locator('#detail').innerText(),/当前 3\.4/);
  await page.evaluate(async()=>{window.__mayuan.dailyState.currentLessonConfirmed=true;await refresh();});
  assert.equal(await page.locator('#currentSection').innerText(),'3.4');
  await page.evaluate(()=>{document.querySelector('#mode').value='codex-plan';
    document.querySelector('#mode').dispatchEvent(new Event('change'));});
  assert.equal(await page.locator('#endpoint').isDisabled(),true);
  assert.equal(await page.locator('#key').isDisabled(),true);
  assert.equal(await page.locator('#model').inputValue(),'gpt-6.1-sol');
  assert.match(await page.locator('#aiNote').textContent(),/套餐额度/);
});
