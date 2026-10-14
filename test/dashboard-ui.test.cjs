const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright-core');
const {previewLayout}=require('../src/course-preview.cjs');
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});});
test.after(async()=>{await browser?.close();});
async function setup(t,width=400,height=582){
  const context=await browser.newContext({viewport:{width,height}});t.after(()=>context.close());
  const page=await context.newPage();
  await page.addInitScript(()=>{
    window.calls=[];
    window.m={windowOpen:false,courseOnTarget:false,enabled:false,sidebarWidth:360,courseExpanded:false,
      dailyState:{day:'2026-10-13',status:'idle',completed:Array(14).fill('example'),seconds:1800,currentLesson:'3.4',currentLessonConfirmed:true},dailyHistory:[]};
    window.x={windowOpen:true,courseOnTarget:true,configured:true,enabled:false,status:'running',currentSection:'12.1',currentTask:'12.1/video/0',platformDone:18,platformTotal:135,submittedQuizzes:Array(11).fill('example')};
    window.study={status:async()=>structuredClone(m),windowPinned:async value=>{if(value!==undefined){calls.push(['pin',value]);window.pinned=value;}return window.pinned??true;},
      command:async value=>{calls.push(['m-command',value]);m.dailyState.status=value==='PAUSE'?'paused':value==='END'?'ended':'running';},
      open:async()=>{calls.push(['m-open']);m.windowOpen=true;m.courseOnTarget=true;},closeCourse:async()=>{calls.push(['m-close']);m.windowOpen=false;},
      refreshCourse:async()=>calls.push(['m-refresh']),enable:async value=>calls.push(['m-auto',value]),
      setCourseExpanded:async value=>{m.courseExpanded=value;calls.push(['expand',value]);},
      resizePane:async value=>{m.sidebarWidth=Math.max(300,Math.min(480,value));return m.sidebarWidth;},
      aiGet:async()=>({mode:'codex-plan',model:'gpt-6.1-sol'}),aiSave:async data=>{calls.push(['ai-save',data.mode]);return {hasKey:false};},
      platformReview:async()=>calls.push(['review']),openScore:async()=>calls.push(['score'])};
    window.environment={status:async()=>structuredClone(x),
      command:async value=>{calls.push(['x-command',value]);x.status=value==='PAUSE'?'paused':value==='END'?'ended':'running';},
      open:async()=>{calls.push(['x-open']);x.windowOpen=true;x.courseOnTarget=true;},close:async()=>{calls.push(['x-close']);x.windowOpen=false;},
      refresh:async()=>calls.push(['x-refresh']),enable:async value=>calls.push(['x-auto',value]),resizePane:async()=>{},
      resolveSubmission:async value=>{calls.push(['resolve',value]);x.submissionIntent=null;x.status='paused';},
      saveUrl:async()=>{calls.push(['save-url']);x.configured=true;}};
  });
  await page.goto('file:///'+path.join(__dirname,'../src/dashboard.html').replace(/\\/g,'/'));
  await page.waitForFunction(()=>document.querySelector('#primaryAction').textContent==='暂停');
  await page.evaluate(()=>{
    const mock=document.createElement('div');mock.textContent='模拟课程\n正常速度播放';mock.style.cssText='position:absolute;top:36px;left:0;right:0;bottom:0;display:grid;place-content:center;text-align:center;white-space:pre-line;line-height:2;color:#8b97a8;background:linear-gradient(150deg,#f7f9fc,#e9edf3);font-size:14px';
    document.querySelector('#coursePane').append(mock);window.mockPreview=mock;
  });
  return page;
}
async function patch(page,value){await page.evaluate(async value=>{Object.assign(x,value);await refresh();},value);}
const imagePath=name=>path.join(os.tmpdir(),`course-ui-${name}.png`);

test('states have one badge, a contextual primary action and preserved submit protection',async t=>{
  const p=await setup(t);
  assert.equal(await p.locator('#currentSection').textContent(),'12.1');
  assert.equal(await p.locator('#taskKind').textContent(),'第 1 段视频');
  await p.screenshot({path:imagePath('running')});
  for(const [status,label] of [['idle','开始'],['paused','恢复'],['blocked','恢复'],['interrupted','恢复'],['complete','查看课程']]){
    await patch(p,{status,blockedReason:status==='blocked'?'AI 请求超时，请恢复任务。':null});
    assert.equal(await p.locator('#primaryAction').textContent(),label);
    assert.equal(await p.locator('#primaryAction').isDisabled(),false);
  }
  await patch(p,{status:'submitting',submissionIntent:{section:'12.1'}});
  assert.equal(await p.locator('#primaryAction').isDisabled(),true);
  assert.equal(await p.locator('#end').isDisabled(),true);
  assert.equal(await p.locator('#xyResolvePanel').isVisible(),true);
  assert.ok((await p.locator('#primaryAction').boundingBox()).y+(await p.locator('#primaryAction').boundingBox()).height<=350);
  await p.screenshot({path:imagePath('submission')});
  await p.locator('#xySubmitted').click();
  assert.equal(await p.locator('#primaryAction').textContent(),'恢复');
  assert.deepEqual(await p.evaluate(()=>calls.filter(c=>c[0]==='resolve')),[['resolve','submitted']]);
  await patch(p,{status:'running',windowOpen:true,courseOnTarget:false});
  assert.match(await p.locator('#xyDetail').textContent(),/登录或加载/);
  await patch(p,{status:'blocked',courseOnTarget:true,blockedReason:'学习通要求图形验证码'});
  assert.match(await p.locator('#xyDetail').textContent(),/验证码/);
});

test('pause, resume, course switch and menu actions reuse existing IPC',async t=>{
  const p=await setup(t);
  await p.locator('#primaryAction').click();assert.equal(await p.locator('#primaryAction').textContent(),'恢复');
  await p.locator('#primaryAction').click();assert.equal(await p.locator('#primaryAction').textContent(),'暂停');
  assert.deepEqual(await p.evaluate(()=>calls.slice(0,2)),[['x-command','PAUSE'],['x-command','RUN']]);
  await p.selectOption('#courseSelect','mayuan');
  await p.waitForFunction(()=>document.querySelector('#courseSelect').value==='mayuan');
  assert.deepEqual(await p.evaluate(()=>calls.slice(-2)),[['x-command','PAUSE'],['x-close']]);
  assert.equal(await p.locator('#lessons').textContent(),'14');
  assert.equal(await p.locator('#minutes').textContent(),'30');
  await p.locator('#moreButton').click();await p.locator('#open').click();
  assert.equal(await p.locator('#moreMenu').isVisible(),false);
  await p.locator('#primaryAction').click();
  assert.deepEqual(await p.evaluate(()=>calls.slice(-2)),[['m-open'],['m-command','START']]);
  await p.locator('#pinWindow').click();assert.equal(await p.locator('#pinWindow').getAttribute('aria-pressed'),'false');
});

test('minimum and expanded layouts preserve native course geometry and visible controls',async t=>{
  const p=await setup(t,360);
  for(const width of [360,400]){
    await p.setViewportSize({width,height:582});
    const pane=await p.locator('#coursePane').boundingBox(),toolbar=await p.locator('.course-toolbar').boundingBox();
    const native=previewLayout([width,582]);
    assert.equal(pane.x,12);assert.equal(pane.y,350);assert.equal(toolbar.y+toolbar.height,native.bounds.y);
    assert.equal(pane.width,native.bounds.width);
    const action=await p.locator('#primaryAction').boundingBox();assert.ok(action.y+action.height<=350);
    const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
  }
  await p.locator('#expandCourse').click();await p.setViewportSize({width:1600,height:862});
  await p.evaluate(()=>mockPreview.style.top='52px');
  const pane=await p.locator('#coursePane').boundingBox(),toolbar=await p.locator('.course-toolbar').boundingBox();
  const native=previewLayout([1600,862],360,true);
  assert.equal(pane.x,native.bounds.x);assert.equal(toolbar.height,native.bounds.y);
  await p.screenshot({path:imagePath('expanded')});
  await p.locator('#divider').focus();await p.keyboard.press('ArrowRight');
  await p.waitForFunction(()=>document.querySelector('#divider').getAttribute('aria-valuenow')==='380');
  assert.equal((await p.locator('#coursePane').boundingBox()).x,384);
});

test('menus stay above the native view and support keyboard and outside dismissal',async t=>{
  const p=await setup(t,360);
  await p.locator('#moreButton').focus();await p.keyboard.press('ArrowDown');
  assert.equal(await p.evaluate(()=>document.activeElement.id),'open');
  const box=await p.locator('#moreMenu').boundingBox();assert.ok(box.y+box.height<350);
  await p.keyboard.press('ArrowDown');assert.equal(await p.evaluate(()=>document.activeElement.id),'refreshCourse');
  await p.keyboard.press('Escape');assert.equal(await p.locator('#moreMenu').isVisible(),false);
  assert.equal(await p.evaluate(()=>document.activeElement.id),'moreButton');
  await p.locator('#moreButton').click();await p.locator('#currentSection').click();
  assert.equal(await p.locator('#moreMenu').isVisible(),false);
});

test('long errors expand in the controller and settings groups remain usable',async t=>{
  const p=await setup(t);
  const reason='AI 请求超时。'+ '请检查网络后恢复当前任务，平台进度尚未确认。'.repeat(8);
  await patch(p,{status:'blocked',blockedReason:reason});
  assert.equal(await p.locator('#taskInfo').evaluate(n=>n.classList.contains('warning')),true);
  assert.ok((await p.locator('#primaryAction').boundingBox()).y+(await p.locator('#primaryAction').boundingBox()).height<=350);
  await p.screenshot({path:imagePath('error')});
  await p.locator('#toggleDetail').click();assert.equal(await p.locator('#xyDetail').textContent(),reason);
  assert.equal(await p.locator('#toggleDetail').getAttribute('aria-expanded'),'true');
  await patch(p,{blockedReason:reason});
  assert.equal(await p.locator('#toggleDetail').getAttribute('aria-expanded'),'true');
  await p.locator('#toggleDetail').click();
  await p.setViewportSize({width:360,height:582});
  await patch(p,{blockedReason:'视频下载失败，请展开课程手动切换线路后恢复任务，平台任务点待确认。'});
  assert.equal(await p.locator('#toggleDetail').isVisible(),true);
  assert.ok((await p.locator('#primaryAction').boundingBox()).y+(await p.locator('#primaryAction').boundingBox()).height<=350);
  await p.locator('#tabSettings').click();
  assert.equal(await p.locator('#taskPanel').isVisible(),false);
  assert.equal(await p.locator('#endpoint').isDisabled(),true);
  await p.screenshot({path:imagePath('settings')});
  await p.locator('#courseSettings summary').click();await p.locator('#xyUrl').fill('https://example.test/course');
  await p.locator('#xySaveUrl').click();assert.equal(await p.locator('#xyUrl').inputValue(),'');
  await p.locator('#tabStudy').click();assert.equal(await p.locator('#taskPanel').isVisible(),true);
});
