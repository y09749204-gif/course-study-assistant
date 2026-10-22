const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {chromium}=require('playwright-core');
const C=require('./helpers/mock-course.cjs');
const core=readFileSync(join(__dirname,'../src/core.js'),'utf8')+';ZhsCore=ZhsCore.create('+JSON.stringify(C.profile)+');';
const content=readFileSync(join(__dirname,'../src/content.js'),'utf8');

test('startup expands the hidden selected lesson chapter instead of the saved chapter',async t=>{
 const catalog='<div id="chapterHeader">第一章:</div><ul id="chapterLessons"><li>1.1 已完成</li></ul>'+
   '<button onclick="document.querySelector(\'#third\').style.display=\'block\'">第三章:</button>'+
   '<div id="third" style="display:none"><div class="chapter-item current">3.5 当前课程</div></div>';
 const page=await setup(t,{pageHtml:html.replace(/<div id="chapterHeader">[\s\S]*?<\/ul>/,catalog),
   initialState:{...C.emptyState(C.dayKey()),baselineInitialized:true,completionMarkerVersion:1}});
 await page.waitForFunction(()=>window.__stored.dailyState.currentLesson==='3.5',null,{timeout:8000});
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'running');
});

test('new day navigation hint opens selected chapter without claiming the hinted lesson',async t=>{
 const catalog='<div id="chapterHeader">第一章:</div><ul id="chapterLessons"><li>1.1 已完成</li></ul>'+
   '<button onclick="document.querySelector(\'#third\').innerHTML=\'<div class=&quot;chapter-item current&quot;>3.6 实际课程</div>\'">第三章:</button><div id="third"></div>';
 const page=await setup(t,{pageHtml:html.replace(/<div id="chapterHeader">[\s\S]*?<\/ul>/,catalog),
   initialState:{...C.emptyState(C.dayKey()),navigationHint:'3.5',baselineInitialized:true,completionMarkerVersion:1}});
 await page.waitForFunction(()=>window.__stored.dailyState.currentLesson==='3.6',null,{timeout:8000});
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.currentLessonConfirmed),true);
});

for(const fullyCovered of [false,true])test(`lesson input ${fullyCovered?'stops on full cover':'uses exposed edge when center is covered'}`,async t=>{
 const catalog='<div id="chapterHeader">第一章:</div><div id="chapterLessons">'+
   '<div class="chapter-item current"><img class="finish-icon">1.1 已完成</div>'+
   '<div id="targetLesson" class="chapter-item" style="width:400px;height:90px" onclick="this.previousElementSibling.classList.remove(\'current\');this.classList.add(\'current\')">1.2 下一节</div></div>';
 const overlay=`<div id="cover" style="position:fixed;z-index:99;background:red"></div><script>
 const r=document.querySelector('#targetLesson').getBoundingClientRect();
 Object.assign(document.querySelector('#cover').style,{left:(r.left+${fullyCovered?0:120})+'px',top:r.top+'px',width:'${fullyCovered?400:160}px',height:'90px'});</script>`;
 const page=await setup(t,{pageHtml:html.replace(/<div id="chapterHeader">[\s\S]*?<\/ul>/,catalog).replace('</body>',overlay+'</body>'),
   initialState:{...C.emptyState(C.dayKey()),baselineInitialized:true,completionMarkerVersion:1,currentLesson:'1.1',baseline:['1.1']}});
 if(fullyCovered){
   await page.waitForFunction(()=>window.__stored.dailyState.status==='blocked',null,{timeout:5000});
   assert.equal(await page.evaluate(()=>window.__stored.dailyState.blockedReason),'操作目标被遮挡');
   assert.equal(await page.evaluate(()=>window.__stored.dailyState.currentLesson),'1.1');
 }else{
   await page.waitForFunction(()=>window.__stored.dailyState.currentLesson==='1.2',null,{timeout:5000});
   assert.equal(await page.evaluate(()=>window.__untrusted||false),false);
 }
});

test('saved lesson is not shown as current when no platform row is selected',async t=>{
 const page=await setup(t,{pageHtml:html.replace('class="active"','class="inactive"'),
   initialState:{...C.emptyState(C.dayKey()),baselineInitialized:true,completionMarkerVersion:1,currentLesson:'3.4'}});
 await page.waitForFunction(()=>window.__stored.dailyState.currentLessonConfirmed===false);
 assert.equal(await page.evaluate(()=>window.__plays||0),0);
 await page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+9000;});
 await page.waitForFunction(()=>window.__stored.dailyState.status==='blocked',null,{timeout:5000});
 assert.match(await page.evaluate(()=>window.__stored.dailyState.blockedReason),/未确认网站当前小节/);
});

test('directory selection without video source change does not confirm next lesson',async t=>{
 const catalog='<div id="chapterHeader">第一章:</div><ul id="chapterLessons">'+
   '<li class="active"><img class="finish-icon">1.1 已完成</li>'+
   '<li onclick="this.previousElementSibling.classList.remove(\'active\');this.classList.add(\'active\')">1.2 下一节</li></ul>';
 const page=await setup(t,{pageHtml:html.replace(/<div id="chapterHeader">[\s\S]*?<\/ul>/,catalog).replace('<video style=', '<video src="https://media.test/old.mp4" style='),
   initialState:{...C.emptyState(C.dayKey()),baselineInitialized:true,completionMarkerVersion:1,currentLesson:'1.1',baseline:['1.1']}});
 await page.waitForFunction(()=>window.__stored.dailyState.status==='blocked',null,{timeout:16000});
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.currentLesson),'1.1');
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.currentLessonConfirmed),false);
 assert.match(await page.evaluate(()=>window.__stored.dailyState.blockedReason),/视频切换未获平台确认/);
});

test('quiz waits for delayed type and option rendering',async t=>{
 const page=await setup(t);
 await page.evaluate(()=>{
   const quiz=document.querySelector('#quiz'),content=quiz.innerHTML;
   quiz.innerHTML='<h2 style="white-space:pre-line">AI\n随堂练习</h2>';quiz.style.display='block';
   setTimeout(()=>{
     quiz.innerHTML=content;
     for(const row of quiz.querySelectorAll('.answer-row'))row.onclick=()=>row.classList.add('selected');
     quiz.querySelector('#submit').onclick=()=>{window.__delayedSubmitted=true;quiz.style.display='none';};
   },1800);
 });
 await page.waitForFunction(()=>window.__delayedSubmitted===true,null,{timeout:8000});
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'running');
});

for(const cssLetters of [false,true])for(const typeLabel of ['【单选题】','（单选）','【单\n选题】'])test(`four-option quiz parses ${JSON.stringify(typeLabel)} with ${cssLetters?'CSS':'text'} letters`,async t=>{
 const page=await setup(t);
 await page.evaluate(({cssLetters,typeLabel})=>{
   const quiz=document.querySelector('#quiz');
   quiz.innerHTML='<h2>AI随堂练习</h2><p style="white-space:pre-line">1. '+typeLabel+' 所谓“观念上层建筑”，也就是指（）。</p>'+
     ['社会意识','社会意识形式','意识形态','价值观'].map((text,index)=>`<p class="answer-row"><span class="class-question-select">${cssLetters?'':String.fromCharCode(65+index)}</span><span>${text}</span></p>`).join('')+'<button id="newSubmit">提交作答</button>';
   for(const row of quiz.querySelectorAll('.answer-row'))row.onclick=()=>{row.querySelector('.class-question-select').classList.add('isSelect');};
   document.querySelector('#newSubmit').onclick=()=>{window.__submits=(window.__submits||0)+1;quiz.style.display='none';};
   if(cssLetters){const style=document.createElement('style');style.textContent='.class-question-select::before {content:"A"}';document.head.append(style);}
   quiz.style.display='block';document.querySelector('video').pause();
 },{cssLetters,typeLabel});
 await page.waitForFunction(()=>window.__submits===1,null,{timeout:6000});
 await page.waitForFunction(()=>window.__plays>=2,null,{timeout:5000});
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'running');
});

for(const emptyThird of [false,true])test(`text chapter headers skip expanded completed chapters${emptyThird?' and continue beyond completed chapter':''}`,async t=>{
  const catalog=`<div id="chapterHeader">第一章:</div><div id="chapterLessons">
    <div class="chapter-item current" id="lesson14"><img class="finish-icon">1.4 完成课程</div>
  </div>
  <div onclick="window.__wrongToggle=true"><span>第二章:</span></div>
  <div class="chapter-item"><img class="finish-icon">2.6 完成课程</div>
  <div onclick="document.querySelector('#third').style.display='block';window.__expanded=true"><span>第三章:</span><span>人类社会</span></div>
  <div id="third" style="display:none">
    <div class="chapter-item"><img class="finish-icon">3.1 完成课程</div>
    ${emptyThird?'':`<div class="chapter-item" onclick="document.querySelector('#lesson14').classList.remove('current');this.classList.add('current');window.__selectedLesson='3.2'">3.2 未开始课程</div>`}
  </div>
  <div onclick="document.querySelector('#fourth').style.display='block'"><span>第四章:</span></div>
  <div id="fourth" style="display:none"><div class="chapter-item" onclick="document.querySelector('#lesson14').classList.remove('current');this.classList.add('current');window.__selectedLesson='4.1'">4.1 未开始课程</div></div>`;
  const page=await setup(t,{pageHtml:html.replace(/<div id="chapterHeader">[\s\S]*?<\/ul>/,catalog),
    initialState:{...C.emptyState(C.dayKey()),currentLesson:'1.4',baselineInitialized:true,completionMarkerVersion:1,baseline:['1.4','2.6','3.1']}});
  const expected=emptyThird?'4.1':'3.2';
  await page.waitForFunction(expected=>window.__selectedLesson===expected,expected,{timeout:12000});
  assert.equal(await page.evaluate(()=>!!window.__wrongToggle),false);
  assert.equal(await page.evaluate(()=>!!window.__untrusted),false);
  await page.waitForFunction(expected=>window.__stored.dailyState.currentLesson===expected,expected);
  assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'running');
});

test('unconfirmed lesson click pauses without changing current lesson or clicking twice',async t=>{
 const catalog=`<button id="chapterHeader">第二章:</button><div id="chapterLessons">
 <div class="chapter-item current"><img class="finish-icon">2.6 如何实现自由？</div>
 <div class="chapter-item" onclick="window.clickCount=(window.clickCount||0)+1">3.1 社会如何发展？</div></div>`;
 const page=await setup(t,{pageHtml:html.replace(/<div id="chapterHeader">[\s\S]*?<\/ul>/,catalog),initialState:{...C.emptyState(C.dayKey()),status:'paused',currentLesson:'2.6',baselineInitialized:true,completionMarkerVersion:1,baseline:['2.6']}});
 await page.waitForFunction(()=>window.__stored.dailyState.status==='blocked',null,{timeout:16000});
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.currentLesson),'2.6');
 assert.equal(await page.evaluate(()=>window.clickCount),1);
});

test('submission timeout preserves intent and does not repeat on resume',async t=>{
 const page=await setup(t);
 await page.evaluate(()=>{document.querySelector('#submit').onclick=()=>window.submits=(window.submits||0)+1;document.querySelector('#quiz').style.display='block';});
 await page.waitForFunction(()=>window.__stored.dailyState.status==='blocked',null,{timeout:12000});
 await page.evaluate(()=>window.__receive({type:'START'},null,()=>{}));
 await page.waitForFunction(()=>window.__stored.dailyState.blockedReason?.includes('提交结果未确认'),null,{timeout:5000});
 assert.equal(await page.evaluate(()=>window.submits),1);
});

test('a stale submission intent is cleared before a later exercise appears',async t=>{
 const page=await setup(t,{initialState:{...C.emptyState(C.dayKey()),currentLesson:'1.1',submissionIntent:true}});
 await page.waitForFunction(()=>window.__stored.dailyState.submissionIntent===false);
 await page.evaluate(()=>{document.querySelector('#submit').onclick=()=>{window.submits=(window.submits||0)+1;document.querySelector('#quiz').style.display='none';};document.querySelector('#quiz').style.display='block';});
 await page.waitForFunction(()=>window.submits===1,null,{timeout:6000});
 await page.waitForFunction(()=>window.__stored.dailyState.submissionIntent===false);
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.submissionContext),null);
});

test('an unconfirmed old question does not block a different exercise',async t=>{
 const page=await setup(t);
 await page.evaluate(()=>{document.querySelector('#submit').onclick=()=>window.submits=(window.submits||0)+1;document.querySelector('#quiz').style.display='block';});
 await page.waitForFunction(()=>window.__stored.dailyState.status==='blocked',null,{timeout:12000});
 const context=await page.evaluate(()=>window.__stored.dailyState.submissionContext);
 assert.equal(context.key.length,64);assert.equal(context.lessonId,'1.1');
 assert.equal(JSON.stringify(context).includes('哲学'),false);
 await page.evaluate(()=>{document.querySelector('#quiz p:nth-child(3)').textContent='另一道不同的题目';document.querySelector('#submit').onclick=()=>{window.submits++;document.querySelector('#quiz').style.display='none';};window.__receive({type:'START'},null,()=>{});});
 await page.waitForFunction(()=>window.submits===2,null,{timeout:6000});
 await page.waitForFunction(()=>window.__stored.dailyState.submissionIntent===false);
});

test('input IPC timeout pauses with a specific reason',async t=>{
 const page=await setup(t);
 await page.evaluate(()=>{
   const original=chrome.runtime.sendMessage;
   chrome.runtime.sendMessage=message=>message.type==='INPUT_CLICK'?new Promise(()=>{}):original(message);
   document.querySelector('#reminder').style.display='block';
 });
 await page.waitForFunction(()=>window.__stored.dailyState.blockedReason?.includes('鼠标输入超时'),null,{timeout:10000});
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'blocked');
});

test('ready player with frozen time pauses instead of remaining running',async t=>{
 const page=await setup(t);
 await page.waitForTimeout(1600);
 await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+31000;});
 await page.waitForFunction(()=>window.__stored.dailyState.blockedReason?.includes('时间超过30秒未前进'),null,{timeout:5000});
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'blocked');
});

test('advancing playback is not mistaken for a stall',async t=>{
 const page=await setup(t);
 await page.evaluate(()=>setInterval(()=>{window.__videoTime=(window.__videoTime||0)+1;},500));
 await page.waitForTimeout(1600);
 await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+31000;});
 await page.waitForTimeout(2200);
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'running');
});
const url='https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=mock-course-alpha';
const html=`<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="chapterHeader">第一章:</div>
<ul id="chapterLessons"><li class="active">1.1 世界从哪里来?</li><li>1.2 世界为何物?</li></ul>
<video style="width:300px;height:180px"></video>
<div role="dialog" id="quiz" style="display:none;width:500px;height:350px">
  <h2>AI随堂练习</h2><p>1. [单选题]</p><p>哲学的基本问题是（ ）</p>
  <div class="answer-row" id="a"><span>A</span><span>唯物主义和唯心主义的关系</span></div>
  <div class="answer-row" id="b"><span>B</span><span>思维和存在的关系</span></div>
  <button id="submit">提交作答</button>
  <button id="close" class="modal-close" style="display:none">×</button>
</div>
<div role="dialog" id="reminder" style="display:none;width:500px;height:350px">
  <h2>课程提醒</h2><p>请先绑定公众号</p><div id="later"><span>下次再说</span></div>
</div></body></html>`;

async function setup(t,{pageHtml=html,initialState=null}={}){
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:pageHtml}));
  await page.goto(url);
  await page.exposeFunction('__nativeClick',async message=>{await page.mouse.click(message.x,message.y);return {accepted:true};});
  await page.evaluate(initialState=>{
    document.addEventListener('click',event=>{if(!event.isTrusted)window.__untrusted=true;},true);
    const stored=initialState?{dailyState:initialState}:{};window.__stored=stored;
    window.chrome={storage:{local:{get:async key=>({[key]:stored[key]}),set:async value=>Object.assign(stored,value)},
      onChanged:{addListener:()=>{}}},runtime:{onMessage:{addListener:fn=>window.__receive=fn},
        sendMessage:async message=>message.type==='INPUT_FOCUS'?{epoch:1}:message.type==='INPUT_CLICK'?window.__nativeClick(message):message.type==='ANSWER'?{index:1}:{owner:true}}};
    const video=document.querySelector('video');let paused=true;
    Object.defineProperties(video,{paused:{get:()=>paused},readyState:{get:()=>4},currentTime:{get:()=>window.__videoTime||0},
      playbackRate:{get:()=>1}});
    video.play=async()=>{paused=false;window.__plays=(window.__plays||0)+1};
    video.pause=()=>{paused=true};
    document.querySelector('#b').onclick=()=>{window.__choice='b';document.querySelector('#b').classList.add('selected');};
    document.querySelector('#submit').onclick=()=>document.querySelector('#quiz').style.display='none';
    document.querySelector('#later').onclick=()=>document.querySelector('#reminder').style.display='none';
    document.querySelector('#chapterHeader').onclick=()=>document.querySelector('#chapterLessons').style.display='block';
  },initialState);
  await page.addScriptTag({content:core});await page.addScriptTag({content});
  await page.evaluate(()=>window.__receive({type:'START'},null,()=>{}));
  await page.waitForFunction(()=>window.__stored.dailyState?.baselineInitialized,{timeout:5000});
  return page;
}

test('generic option rows are recognized and AI answer resumes video',async t=>{
  const page=await setup(t);
  await page.evaluate(()=>{document.querySelector('video').pause();document.querySelector('#quiz').style.display='block';});
  await page.waitForFunction(()=>window.__choice==='b',null,{timeout:5000});
  await page.waitForFunction(()=>document.querySelector('#quiz').style.display==='none',null,{timeout:5000});
  await page.waitForFunction(()=>window.__plays>=2,null,{timeout:5000});
  assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'running');
});

test('platform judgement selection marker on its letter confirms before submit',async t=>{
 const page=await setup(t);
 await page.evaluate(()=>{
   document.querySelector('#quiz p').textContent='1. [判断题]';
   document.querySelector('#a').lastElementChild.textContent='正确';
   document.querySelector('#b').lastElementChild.textContent='错误';
   const letter=document.querySelector('#b span');letter.className='class-question-select';
   document.querySelector('#b').onclick=()=>{letter.classList.add('isSelect');window.__choice='b';};
   document.querySelector('#submit').onclick=()=>{window.__submits=(window.__submits||0)+1;document.querySelector('#quiz').style.display='none';};
   document.querySelector('#quiz').style.display='block';document.querySelector('video').pause();
 });
 await page.waitForFunction(()=>window.__submits===1,null,{timeout:8000});
 await page.waitForFunction(()=>window.__plays>=2,null,{timeout:5000});
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'running');
 assert.equal(await page.evaluate(()=>!!window.__untrusted),false);
});

test('fixed quiz close escapes ancestor overflow without resubmitting',async t=>{
 const page=await setup(t);
 await page.evaluate(()=>{
   const quiz=document.querySelector('#quiz');quiz.classList.add('ai-class-exercise-dialog');
   const parent=document.createElement('div');parent.style.cssText='width:300px;height:160px;overflow:auto';
   document.body.append(parent);parent.append(quiz);
   quiz.style.cssText='position:fixed;left:400px;top:120px;width:500px;height:350px;display:block';
   const footer=document.createElement('div');footer.className='dialog-footer';quiz.append(footer);footer.append(document.querySelector('#submit'));
   document.querySelector('#submit').classList.add('is-finish');
   document.querySelector('#submit').onclick=()=>window.__unexpectedResubmit=true;
   const close=document.querySelector('#close');close.style.cssText='display:block;position:absolute;right:10px;top:10px';
   close.onclick=()=>{window.__fixedClosed=true;quiz.style.display='none';};
   document.querySelector('video').pause();
 });
 await page.waitForFunction(()=>window.__fixedClosed===true,null,{timeout:8000});
 await page.waitForFunction(()=>window.__plays>=2,null,{timeout:5000});
 assert.equal(await page.evaluate(()=>window.__unexpectedResubmit||false),false);
});

test('platform quiz waits for saved footer before closing and resumes without resubmission',async t=>{
 const page=await setup(t);
 await page.evaluate(()=>{
   const quiz=document.querySelector('#quiz');quiz.classList.add('ai-class-exercise-dialog');
   const footer=document.createElement('div');footer.className='dialog-footer';quiz.append(footer);footer.append(document.querySelector('#submit'));
   document.querySelector('#close').style.display='block';
   document.querySelector('#close').onclick=()=>{window.__closedBeforeSaved=!window.__saved;quiz.style.display='none';};
   document.querySelector('#submit').onclick=()=>{
     window.__submits=(window.__submits||0)+1;
     const result=document.createElement('span');result.className='correct-ops';result.textContent='正确答案：B';quiz.append(result);
     setTimeout(()=>{window.__saved=true;document.querySelector('#submit').classList.add('is-finish');},1200);
   };
   quiz.style.display='block';document.querySelector('video').pause();
 });
 await page.waitForFunction(()=>window.__closedBeforeSaved===false,null,{timeout:10000});
 assert.equal(await page.evaluate(()=>window.__submits),1);
});

test('platform auto-close during native close preparation resumes playback',async t=>{
 const page=await setup(t);
 await page.evaluate(()=>{
   const quiz=document.querySelector('#quiz');quiz.classList.add('ai-class-exercise-dialog');
   const footer=document.createElement('div');footer.className='dialog-footer';quiz.append(footer);footer.append(document.querySelector('#submit'));
   document.querySelector('#close').style.display='block';
   document.querySelector('#submit').onclick=()=>{
     window.__submits=(window.__submits||0)+1;document.querySelector('#submit').classList.add('is-finish');
     setTimeout(()=>{quiz.style.display='none';document.querySelector('#close').remove();},100);
   };
   quiz.style.display='block';document.querySelector('video').pause();
 });
 await page.waitForFunction(()=>window.__submits===1,null,{timeout:7000});
 await page.waitForFunction(()=>window.__plays>=2,null,{timeout:5000});
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'running');
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.submissionIntent),false);
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.submissionContext),null);
});

test('old quiz close race block recovers when its dialog is gone',async t=>{
 const page=await setup(t,{initialState:{...C.emptyState(C.dayKey()),status:'blocked',blockedReason:'操作目标已变化',
   currentLesson:'1.1',submissionIntent:true,submissionContext:{lessonId:'1.1',key:'old'}}});
 await page.waitForFunction(()=>window.__stored.dailyState.submissionIntent===false);
 await page.waitForFunction(()=>window.__plays>=1);
 assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'running');
});

test('fallback preserves an already selected platform option without toggling it',async t=>{
 const page=await setup(t);
 await page.evaluate(()=>{
   const original=chrome.runtime.sendMessage;chrome.runtime.sendMessage=message=>message.type==='ANSWER'?Promise.resolve({index:null}):original(message);
   document.querySelector('#a span').className='class-question-select isSelect';
   document.querySelector('#a').onclick=()=>window.__retoggled=true;
   document.querySelector('#submit').onclick=()=>{window.__submitted=true;document.querySelector('#quiz').style.display='none';};
   document.querySelector('#quiz').style.display='block';
 });
 await page.waitForFunction(()=>window.__submitted===true,null,{timeout:8000});
 assert.equal(await page.evaluate(()=>!!window.__retoggled),false);
});

test('manually answered unknown quiz recovers from blocked state',async t=>{
  const page=await setup(t);
  await page.evaluate(()=>{
    document.querySelector('video').pause();
    document.querySelector('#quiz').style.display='block';
    document.querySelector('#quiz p').textContent='1. [多选题]';
  });
  await page.waitForFunction(()=>window.__stored.dailyState?.status==='blocked',null,{timeout:15000});
  await page.evaluate(()=>document.querySelector('#quiz').style.display='none');
  await page.waitForFunction(()=>window.__stored.dailyState?.status==='running',null,{timeout:15000});
  await page.waitForFunction(()=>window.__plays>=2,null,{timeout:15000});
  assert.equal(await page.evaluate(()=>window.__stored.dailyState.blockedReason),null);
});

test('judgement quiz is answered and its submitted result closes before playback resumes',async t=>{
  const page=await setup(t);
  await page.evaluate(()=>{
    document.querySelector('video').pause();
    document.querySelector('#quiz p').textContent='1. [判断题]';
    document.querySelector('#a').lastElementChild.textContent='正确';
    document.querySelector('#b').lastElementChild.textContent='错误';
    document.querySelector('#close').style.display='block';
    document.querySelector('#close').onclick=()=>document.querySelector('#quiz').style.display='none';
    document.querySelector('#submit').onclick=()=>{
      document.querySelector('#submit').textContent='已提交';
      const result=document.createElement('p');result.textContent='正确答案：B';
      document.querySelector('#quiz').append(result);
    };
    document.querySelector('#quiz').style.display='block';
  });
  await page.waitForFunction(()=>window.__choice==='b',null,{timeout:5000});
  await page.waitForFunction(()=>document.querySelector('#quiz').style.display==='none',null,{timeout:5000});
  await page.waitForFunction(()=>window.__plays>=2,null,{timeout:5000});
  assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'running');
});

test('already submitted judgement quiz closes without choosing or submitting again',async t=>{
  const page=await setup(t);
  await page.evaluate(()=>{
    document.querySelector('video').pause();
    document.querySelector('#quiz p').textContent='1. [判断题]';
    document.querySelector('#submit').textContent='已提交';
    document.querySelector('#submit').onclick=()=>window.__resubmitted=true;
    const icon=document.createElement('img');icon.className='header-icon';
    icon.style.cssText='display:block;width:22px;height:22px';
    icon.onclick=()=>document.querySelector('#quiz').style.display='none';
    document.querySelector('#quiz').append(icon);
    const result=document.createElement('p');result.textContent='正确答案：A';
    document.querySelector('#quiz').append(result);
    document.querySelector('#quiz').style.display='block';
  });
  await page.waitForFunction(()=>document.querySelector('#quiz').style.display==='none',null,{timeout:5000});
  await page.waitForFunction(()=>window.__plays>=2,null,{timeout:5000});
  assert.equal(await page.evaluate(()=>window.__resubmitted||false),false);
});

test('course reminder is dismissed with later and playback resumes',async t=>{
  const page=await setup(t);
  await page.evaluate(()=>{
    document.querySelector('video').pause();
    document.querySelector('#reminder').style.display='block';
  });
  await page.waitForFunction(()=>document.querySelector('#reminder').style.display==='none',null,{timeout:5000});
  await page.waitForFunction(()=>window.__plays>=2,null,{timeout:5000});
  assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'running');
});

test('submitted quiz is cleared before expanding a collapsed chapter',async t=>{
  const page=await setup(t);
  await page.evaluate(()=>{
    document.querySelector('video').pause();
    document.querySelector('#chapterLessons').style.display='none';
    document.querySelector('#submit').textContent='已提交';
    document.querySelector('#close').style.display='block';
    document.querySelector('#close').onclick=()=>document.querySelector('#quiz').style.display='none';
    const result=document.createElement('p');result.textContent='正确答案：A';
    document.querySelector('#quiz').append(result);
    document.querySelector('#quiz').style.display='block';
  });
  await page.waitForFunction(()=>document.querySelector('#quiz').style.display==='none',null,{timeout:5000});
  await page.waitForFunction(()=>document.querySelector('#chapterLessons').style.display==='block',null,{timeout:5000});
  await page.waitForFunction(()=>window.__plays>=2,null,{timeout:5000});
  assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'running');
});

test('platform checkmark is completion; switch from checked current row to unmarked lesson',async t=>{
  const catalog=`<div id="chapterHeader">第一章:</div><div id="chapterLessons">
    <div class="chapter-item" id="lesson11"><img class="finish-icon"><span class="item-num">1.1</span> 世界从哪里来?</div>
    <div class="chapter-item" id="lesson12"><img class="finish-icon"><span class="item-num">1.2</span> 世界为何物?</div>
    <div class="chapter-item current" id="lesson13"><svg></svg><span class="item-num">1.3</span> 世界如何统一?</div>
    <div class="chapter-item" id="lesson14"><span class="item-num">1.4</span> 何为联系?</div>
  </div>`;
  const pageHtml=html.replace(/<div id="chapterHeader">[\s\S]*?<\/ul>/,catalog);
  const initialState={...C.emptyState(C.dayKey()),status:'interrupted',baselineInitialized:true,
    currentLesson:'1.1'};
  const page=await setup(t,{pageHtml,initialState});
  await page.waitForFunction(()=>window.__stored.dailyState?.completionMarkerVersion===1,null,{timeout:5000});
  assert.deepEqual(await page.evaluate(()=>window.__stored.dailyState.baseline),['1.1','1.2']);
  await page.evaluate(()=>{
    document.querySelector('#lesson14').onclick=()=>{window.__selectedLesson='1.4';document.querySelector('#lesson13').classList.remove('current');document.querySelector('#lesson14').classList.add('current');};
    document.querySelector('#lesson13 svg').remove();
    const icon=document.createElement('img');icon.className='finish-icon';
    document.querySelector('#lesson13').prepend(icon);
  });
  await page.waitForFunction(()=>window.__selectedLesson==='1.4',null,{timeout:5000});
  assert.deepEqual(await page.evaluate(()=>window.__stored.dailyState.completed),['1.3']);
});

test('completed last lesson expands the next chapter and selects its first lesson',async t=>{
  const catalog=`<button id="chapterHeader">第二章: 实践与认识</button><div id="chapterLessons">
    <div class="chapter-item current" id="lesson26"><img class="finish-icon"><span>2.6</span> 如何实现自由？</div>
  </div>
  <button id="nextChapter" onclick="document.querySelector('#chapter3Lessons').style.display='block';window.__expanded=true">第三章: 人类社会</button>
  <div id="chapter3Lessons" style="display:none">
    <div class="chapter-item" id="lesson31" onclick="window.__selectedLesson='3.1';document.querySelector('#lesson26').classList.remove('current');this.classList.add('current')"><span>3.1</span> 社会如何发展？</div>
  </div>`;
  const pageHtml=html.replace(/<div id="chapterHeader">[\s\S]*?<\/ul>/,catalog);
  const initialState={...C.emptyState(C.dayKey()),status:'blocked',blockedReason:'目录内没有下一节未开始课程',baselineInitialized:true,
    completionMarkerVersion:1,currentLesson:'2.6',baseline:['2.1','2.2','2.3','2.4','2.5']};
  const page=await setup(t,{pageHtml,initialState});
  await page.waitForFunction(()=>window.__selectedLesson==='3.1',null,{timeout:5000});
  assert.equal(await page.evaluate(()=>window.__expanded),true);
  assert.equal(await page.evaluate(()=>!!window.__untrusted),false);
  await page.waitForFunction(()=>window.__stored.dailyState.currentLesson==='3.1');
  assert.equal(await page.evaluate(()=>window.__stored.dailyState.currentLesson),'3.1');
  assert.equal(await page.evaluate(()=>window.__stored.dailyState.status),'running');
});

for(const variant of ['valid','duplicate','out-of-range','uncertain','unconfirmed'])test(`multiple-choice popup ${variant}`,async t=>{
 const page=await setup(t);
 await page.evaluate(variant=>{
   const quiz=document.querySelector('#quiz');
   quiz.innerHTML='<h2>AI随堂练习</h2><p>1. 【多选题】 模拟题目请选择符合条件的项目</p>'+['甲','乙','丙','丁'].map((text,i)=>`<p class="answer-row"><span class="class-question-select ${i===1?'isSelect':''}">${String.fromCharCode(65+i)}</span><span>${text}</span></p>`).join('')+'<button id="multiSubmit">提交作答</button>';
   window.multiSubmits=0;window.multiInputs=[];
   for(const row of quiz.querySelectorAll('.answer-row'))row.onclick=()=>{if(variant!=='unconfirmed')row.querySelector('span').classList.toggle('isSelect');};
   quiz.querySelector('button').onclick=()=>{multiSubmits++;window.multiSelection=[...quiz.querySelectorAll('.answer-row')].map((r,i)=>r.querySelector('.isSelect')?i:null).filter(i=>i!==null);quiz.style.display='none';};
   const original=chrome.runtime.sendMessage;
   chrome.runtime.sendMessage=async message=>{
     if(message.type!=='ANSWER')return original(message);
     multiInputs.push(message.questionType);
     if(variant==='uncertain')return {error:'uncertain'};
     return {type:'multi',answer:variant==='duplicate'?[0,0]:variant==='out-of-range'?[0,4]:[0,2]};
   };
   quiz.style.display='block';document.querySelector('video').pause();
 },variant);
 if(variant==='valid'){
   await page.waitForFunction(()=>multiSubmits===1,null,{timeout:10000});
   assert.deepEqual(await page.evaluate(()=>multiSelection),[0,2]);
   assert.deepEqual(await page.evaluate(()=>multiInputs),['multi']);
   assert.equal(await page.evaluate(()=>__stored.dailyState.submissionIntent),false);
 }else{
   await page.waitForFunction(()=>__stored.dailyState?.status==='blocked',null,{timeout:10000});
   assert.equal(await page.evaluate(()=>multiSubmits),0);
   assert.equal(await page.evaluate(()=>__stored.dailyState.fallbackCount||0),0);
 }
 assert.equal(await page.evaluate(()=>window.__untrusted||false),false);
});
