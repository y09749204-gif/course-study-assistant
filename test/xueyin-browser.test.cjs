const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const content=fs.readFileSync(path.join(__dirname,'../src/xueyin-content.cjs'),'utf8');
const frameContent=fs.readFileSync(path.join(__dirname,'../src/xueyin-video-frame.cjs'),'utf8');
const html=`<!doctype html><html><head><meta charset="utf-8"><style>
video{display:block;width:400px;height:220px;margin:20px}li{width:1150px;height:40px;cursor:pointer}
</style></head><body>
<div id="count">已完成任务点 0/3</div>
<ul><li id="videosRow" class="active">1.1 视频 <span id="pending">3</span></li><li id="quizRow">1.2 章节测验 <span>0</span></li></ul>
<div id="videoStage"><video id="v1"></video><video id="v2"></video><video id="v3"></video></div>
<div id="quizStage" hidden><h2>章节测验</h2><p id="quizStatus">待完成</p><p>题量：3</p>
<div class="question"><div>1 [单选题] 第一题</div><label>A 甲<input type="radio" name="q1"></label><label>B 乙<input type="radio" name="q1"></label></div>
<div class="question"><div>2 [多选题] 第二题</div><label>A 甲<input type="checkbox"></label><label>B 乙<input type="checkbox"></label></div>
<div class="question"><div>3 [简答题] 第三题</div><textarea></textarea></div>
<button id="save">暂时保存</button><button id="submit">提交</button></div>
</body></html>`;

async function setup(t,{stateFailures=0,directoryOnly=false,detailOnly=false,quizDetail=false,
  quizQuestionDetail=false,quizNestedDom=false,platformQuiz=false,platformTextLayout='',readingQuiz=false,readingFault='',readingFont=false,readingDelayed=false,submittedResult=false,gradedResult=false,gradeFault='',
  quizCardOnly=false,splitQuestionHead=false,quizCatalogResume=false,
  returningTask=false,returningSnapshot=false,returningGreenCheck=false,legacyGreenCheck=false,
  blockedCompletedGreen=false,blockedManual=false,iframeManual=false,iframeError=false,
  iframePlaybackError=false,iframeStalled=false,iframeMediaCode=0,
  blockedAfterTwo=false,blockedUnconfirmed=false,loadingDetail=false,cardLazy=false,
  noBodyAtStart=false,remoteCardsInIframe=false,remoteNoPlayer=false,delayedPlayer=false,neverReadyPlayer=false,
  remoteConditionOnly=false,staleCatalogIframe=false,cardAllComplete=false}={}){
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',
    body:(route.request().url().endsWith('/mock-chapter')||
      route.request().url().endsWith('/mooc-ans/knowledge/cards'))?
      '<!doctype html><html><body><div style="height:260px">'+
      (remoteConditionOnly?'<div class="task-condition">观看时长需达标</div>':'<span>任务点已完成</span>')+'</div>'+
      '<div style="height:260px">'+
      (remoteConditionOnly?'<div class="task-condition">观看时长需达标</div>':'<span style="display:block">任务点已完成</span>')+
      '<iframe id="second" src="https://mooc1.chaoxing.com/mock-player-second" style="display:block;width:400px;height:220px"></iframe></div>'+
      '<div style="height:260px">'+
      (remoteConditionOnly?'<div class="task-condition">观看时长需达标</div>':'<span style="display:block">任务点</span>')+
      '<iframe id="third" src="https://mooc1.chaoxing.com/mock-player-third" style="display:block;width:400px;height:220px"></iframe></div></body></html>':
      route.request().url().includes('/mock-player')?
      `<!doctype html><html><body><video style="width:400px;height:220px"></video>${
        iframeError?'<div>网络错误导致视频下载中途失败。</div>':
          iframePlaybackError?'<div>由于视频文件损坏或者该视频使用了你的浏览器不支持的功能，播放终止。</div>':''}</body></html>`:html}));
  await page.goto(gradedResult?'https://mooc1.xueyinonline.com/mooc-ans/work/selectWorkQuestionYiPiYue':quizQuestionDetail?
    'https://mooc1.xueyinonline.com/mooc-ans/work/doHomeWorkNew':
    'https://mooc2-ans.xueyinonline.com/mooc2-ans/knowledge/detail?courseid=11');
  await page.evaluate(({stateFailures,directoryOnly,detailOnly,quizDetail,quizQuestionDetail,quizNestedDom,quizCardOnly,splitQuestionHead,quizCatalogResume,returningTask,returningSnapshot,returningGreenCheck,legacyGreenCheck,blockedCompletedGreen,blockedManual,iframeManual,iframeError,iframePlaybackError,iframeStalled,iframeMediaCode,blockedAfterTwo,blockedUnconfirmed,loadingDetail,cardLazy,remoteCardsInIframe,staleCatalogIframe,cardAllComplete})=>{
    const state={status:'running',currentSection:'1.1',currentTask:null,completedTaskIds:[],submittedQuizzes:[],quizStatuses:{},sectionPending:{},platformDone:null,platformTotal:null};
    if(blockedManual||blockedAfterTwo||blockedUnconfirmed)state.status='blocked';
    if(blockedAfterTwo||blockedUnconfirmed){
      state.blockedReason='视频未开始播放，请检查播放器后手动恢复任务';
      state.currentTask='1.1/video/0';state.sectionPending={'1.1':2};
      state.platformDone=1;state.platformTotal=3;
      document.querySelector('#pending').textContent=blockedAfterTwo?'1':'2';
      document.querySelector('#count').textContent=`已完成任务点 ${blockedAfterTwo?2:1}/3`;
    }
    window.__state=state;window.__answers=[];window.__submits=0;
    window.__playCalls={};window.__observations=[];
    if(returningTask){
      state.sectionPending={'1.1':3};
      state.awaitingPlatform={section:'1.1',taskId:'1.1/video/0',returnedAt:new Date().toISOString()};
      document.querySelector('#pending').textContent='2';
      document.querySelector('#count').textContent='已完成任务点 1/3';
      if(returningSnapshot){if(returningSnapshot===true)state.awaitingPlatform.pendingBefore=3;state.sectionPending['1.1']=2;}
      if(returningSnapshot==='document'){state.currentTask='1.1/document/0';state.awaitingPlatform=null;document.querySelector('#pending').textContent='0';document.querySelector('#count').textContent='已完成任务点 2/3';}
    }
    if(returningGreenCheck||legacyGreenCheck){
      state.status='running';state.currentTask='1.1/video/1';
      state.completedTaskIds=['1.1/video/0'];state.sectionPending={'1.1':1};
      state.platformDone=3;state.platformTotal=3;
      state.awaitingPlatform={section:'1.1',taskId:'1.1/video/1',returnedAt:new Date().toISOString(),
        ...(returningGreenCheck?{platformDoneBefore:2}:{})};
      document.querySelector('#pending').remove();
      if(returningGreenCheck)document.querySelector('#videosRow').insertAdjacentHTML('beforeend',
        '<span class="complete-mark" style="display:inline-block;width:16px;height:16px;background:rgb(76,195,104)"></span>');
      document.querySelector('#count').textContent='已完成任务点 3/3';
    }
    if(blockedCompletedGreen){
      state.status='blocked';state.blockedReason='视频播放时间超过 30 秒未前进，请检查播放器';
      state.currentSection='1.2';state.currentTask='1.2/video/0';
      state.sectionPending={'1.2':1};state.platformDone=3;state.platformTotal=135;
      document.querySelector('#quizRow').textContent='1.2 视频与知识点';
      document.querySelector('#count').textContent='已完成任务点 4/135';
    }
    window.__stateReads=0;
    window.XyBridge={state:async()=>{
      window.__stateReads++;
      if(window.__stateReads<=stateFailures)throw Error('page bridge not ready');
      return {...state};
    },update:async patch=>Object.assign(state,patch),
      notify:async()=>{},playback:observation=>window.__observations.push(observation),
      answer:async question=>{window.__answers.push(question.type);
        (window.__requests??=[]).push(question);
        if(question.question.startsWith('阅读材料：'))return {type:'short',answer:`子题答复${window.__requests.length}`};
        return question.type==='single'?{type:'single',answer:1}:question.type==='multi'?{type:'multi',answer:[0,1]}:{type:'short',answer:'依法保护生态环境'};},
      onCommand:listener=>window.__command=listener};
    for(const video of document.querySelectorAll('video')){
      let time=0,paused=true;
      Object.defineProperties(video,{currentTime:{get:()=>time,set:value=>time=value},duration:{get:()=>100},
        paused:{get:()=>paused},playbackRate:{get:()=>1},ended:{get:()=>time>=100}});
      video.play=async()=>{window.__playCalls[video.id]=(window.__playCalls[video.id]||0)+1;paused=false};
      video.pause=()=>{paused=true};
      if(blockedManual&&video.id==='v1'){
        paused=false;setInterval(()=>{time+=1},500);
      }
    }
    document.querySelector('#quizRow').onclick=()=>{
      document.querySelector('#videosRow').className='';document.querySelector('#quizRow').className='active';
      document.querySelector('#videoStage').hidden=true;document.querySelector('#quizStage').hidden=false;
    };
    document.querySelector('#submit').onclick=event=>{
      window.__submits++;
      event.currentTarget.ownerDocument.querySelector('#quizStatus').textContent='已提交成功';
    };
    if(directoryOnly){
      document.querySelector('#videoStage').hidden=true;
      document.querySelector('#videosRow').className='';
      window.__lessonClicks=0;
      document.querySelector('#videosRow').onclick=()=>window.__lessonClicks++;
    }
    if(cardLazy){
      state.currentTask='1.1/video/0';state.sectionPending={'1.1':1};
      state.platformDone=2;state.platformTotal=3;
      document.querySelector('#pending').textContent='1';
      document.querySelector('#count').textContent='已完成任务点 2/3';
      const second=document.querySelector('#v2'),third=document.querySelector('#v3');
      const stage=document.querySelector('#videoStage');
      stage.innerHTML='<div style="height:280px"><span>任务点已完成</span></div>'+
        '<div style="height:280px"><span>任务点已完成</span><div id="second"></div></div>'+
        '<div style="height:280px"><span id="thirdMarker">任务点</span><div id="third"></div></div>';
      document.querySelector('#second').append(second);
      document.querySelector('#thirdMarker').scrollIntoView=()=>{
        window.__thirdScrolled=(window.__thirdScrolled||0)+1;
        document.querySelector('#third').append(third);
      };
      if(cardAllComplete)document.querySelector('#thirdMarker').textContent='任务点已完成';
    }
    if(remoteCardsInIframe){
      state.currentTask='1.1/video/0';state.sectionPending={'1.1':1};
      state.platformDone=2;state.platformTotal=3;
      document.querySelector('#pending').textContent='1';
      document.querySelector('#count').textContent='已完成任务点 2/3';
      document.querySelector('#videoStage').innerHTML=
        `<iframe id="chapter" src="https://mooc1.chaoxing.com/${staleCatalogIframe?
          'mooc-ans/knowledge/cards':'mock-chapter'}" style="width:700px;height:800px"></iframe>`;
    }
    if(staleCatalogIframe){
      window.process={isMainFrame:true};
      document.body.insertAdjacentHTML('beforeend',
        '<iframe src="https://mooc1.xueyinonline.com/mooc2-ans/mycourse/studentcourse" style="display:none"></iframe>');
    }
    if(loadingDetail){
      document.querySelector('#videoStage').hidden=true;
      document.body.insertAdjacentHTML('afterbegin','<div>返回课程　章节详情</div>');
      window.__lessonClicks=0;
      document.querySelector('#videosRow').onclick=()=>window.__lessonClicks++;
    }
    if(detailOnly)document.querySelector('ul').remove();
    if(iframeManual||iframeError||iframePlaybackError||iframeStalled||iframeMediaCode)document.querySelector('#videoStage').innerHTML=
      '<iframe id="player" src="https://mooc1.chaoxing.com/mock-player" style="width:400px;height:220px"></iframe>';
    if(quizDetail||quizQuestionDetail){
      state.currentSection='1.2';state.currentIsQuiz=true;
      document.querySelector('ul').remove();
      document.querySelector('#videoStage').hidden=true;
      document.querySelector('#quizStage').hidden=false;
      if(quizQuestionDetail)document.querySelector('#quizStage h2').remove();
      if(splitQuestionHead){
        for(const [index,question] of [...document.querySelectorAll('.question')].entries()){
          const title=question.firstElementChild;
          const kind=index===0?'单选题':index===1?'多选题':'简答题';
          title.innerHTML=`<span>${index+1}</span><span>[${kind}]</span><span>第${index+1}题</span>`;
        }
      }
      if(quizCardOnly){
        const stage=document.querySelector('#quizStage');
        const questions=[...stage.querySelectorAll('.question')];
        questions.forEach(node=>node.remove());
        const start=document.createElement('button');start.textContent='开始答题';
        start.onclick=()=>{window.__quizOpens=(window.__quizOpens||0)+1;
          start.remove();questions.forEach(node=>stage.insertBefore(node,stage.querySelector('#save')));};
        stage.insertBefore(start,stage.querySelector('#save'));
      }
    }
    if(quizCatalogResume){
      state.currentSection='1.2';state.currentIsQuiz=true;
      document.querySelector('#pending').remove();
      document.querySelector('#videosRow').insertAdjacentHTML('beforeend',
        '<span class="complete-mark" style="display:inline-block;width:16px;height:16px;background:rgb(76,195,104)"></span>');
      document.querySelector('#videosRow').className='';
      document.querySelector('#quizRow').className='active';
      document.querySelector('#videoStage').hidden=true;
      document.querySelector('#quizStage').hidden=true;
    }
    if(quizNestedDom){
      const frame=document.createElement('iframe');
      frame.style.cssText='display:block;width:900px;height:900px';
      document.body.append(frame);
      frame.contentDocument.body.append(document.querySelector('#quizStage'));
    }
  },{stateFailures,directoryOnly,detailOnly,quizDetail,quizQuestionDetail,quizNestedDom,quizCardOnly,splitQuestionHead,quizCatalogResume,returningTask,returningSnapshot,returningGreenCheck,legacyGreenCheck,blockedCompletedGreen,blockedManual,iframeManual,iframeError,iframePlaybackError,iframeStalled,iframeMediaCode,blockedAfterTwo,blockedUnconfirmed,loadingDetail,cardLazy,remoteCardsInIframe,staleCatalogIframe,cardAllComplete});
  if(remoteCardsInIframe){
    await page.frameLocator('#chapter').locator('#third').waitFor();
    for(const suffix of ['second','third']){
      const frame=page.frames().find(item=>item.url().endsWith('/mock-player-'+suffix));
      await frame.evaluate(({delayedPlayer,neverReadyPlayer})=>{
        const video=document.querySelector('video');let paused=true,time=0,timer=null;
        window.__plays=0;
        Object.defineProperties(video,{currentTime:{get:()=>time},duration:{get:()=>100},
          paused:{get:()=>paused},playbackRate:{get:()=>1},ended:{get:()=>false}});
        if(delayedPlayer){
          const wrapper=document.createElement('div');wrapper.className='video-js';
          video.replaceWith(wrapper);wrapper.append(video);
          const button=document.createElement('button');button.className='vjs-big-play-button';
          button.textContent='播放';wrapper.append(button);window.__ready=false;
          button.onclick=()=>{if(window.__plays>0)window.__ready=true;};
        }
        video.play=async()=>{window.__plays++;
          if(neverReadyPlayer||(delayedPlayer&&!window.__ready))throw new DOMException('initializing','AbortError');
          paused=false;
          if(!timer)timer=setInterval(()=>{if(!paused)time+=0.5},500)};
        video.pause=()=>{paused=true;window.__pauses=(window.__pauses||0)+1};
      },{delayedPlayer,neverReadyPlayer});
      await frame.addScriptTag({content:frameContent});
    }
    const chapter=page.frames().find(item=>
      item.url().endsWith('/mock-chapter')||item.url().endsWith('/mooc-ans/knowledge/cards'));
    await chapter.addScriptTag({content:frameContent});
    if(remoteNoPlayer)await chapter.evaluate(()=>document.querySelector('#third').remove());
  }
  if(iframeManual||iframeError||iframePlaybackError||iframeStalled||iframeMediaCode){
    await page.frameLocator('#player').locator('video').waitFor();
    const frame=page.frames().find(item=>item.url().endsWith('/mock-player'));
    await frame.evaluate(({hasError,stalled,mediaCode})=>{
      const video=document.querySelector('video');let time=0;
      Object.defineProperties(video,{currentTime:{get:()=>time},duration:{get:()=>100},
        paused:{get:()=>hasError&&!stalled},playbackRate:{get:()=>1},ended:{get:()=>false}});
      if(mediaCode)Object.defineProperty(video,'error',{get:()=>({code:mediaCode})});
      if(!hasError&&!stalled)setInterval(()=>time+=1,500);
    },{hasError:iframeError||iframePlaybackError||iframeStalled||!!iframeMediaCode,
      stalled:iframeStalled,mediaCode:iframeMediaCode});
    await frame.addScriptTag({content:frameContent});
  }
  if(noBodyAtStart)await page.evaluate(()=>{
    window.__detachedBody=document.body;
    document.body.remove();
  });
  if(platformQuiz||readingQuiz)await page.evaluate(()=>{
    const stage=document.querySelector('#quizStage');
    stage.innerHTML=`<h2>章节测验</h2><p id="quizStatus">待完成</p><p>题量：3</p>
      <div class="TiMu newTiMu" data="0"><div class="Zy_TItle"><i>1</i><div class="fontLabel"><span class="newZy_TItle">【单选题】</span><p>第一题</p></div></div><ul class="Zy_ulTop"><li role="radio" onclick="this.setAttribute('aria-checked','true')"><span class="num_option" data="A">A</span><a><p>甲</p></a></li><li role="radio" onclick="this.setAttribute('aria-checked','true')"><span class="num_option" data="B">B</span><a><p>乙</p></a></li></ul></div>
      <div class="TiMu newTiMu" data="1"><div class="Zy_TItle"><i>2</i><div class="fontLabel"><span class="newZy_TItle">【多选题】</span><p>第二题</p></div></div><ul class="Zy_ulTop"><li role="checkbox" onclick="this.setAttribute('aria-checked','true')"><span class="num_option_dx" data="A">A</span><a><p>甲</p></a></li><li role="checkbox" onclick="this.setAttribute('aria-checked','true')"><span class="num_option_dx" data="B">B</span><a><p>乙</p></a></li></ul></div>
      <div class="TiMu newTiMu" data="4"><div class="Zy_TItle"><i>3</i><div class="fontLabel"><span class="newZy_TItle">【简答题】</span><p>第三题</p></div></div><iframe style="width:500px;height:100px"></iframe><textarea id="answer3" style="display:none"></textarea></div>
      <a id="submit" role="button">提交</a>`;
    const body=stage.querySelector('iframe').contentDocument.body;
    body.contentEditable='true';body.innerHTML='<p><br></p>';
    stage.querySelector('#submit').onclick=()=>{window.__submits++;
      stage.querySelector('#quizStatus').textContent='已提交成功'};
  });
  if(platformTextLayout)await page.evaluate(({layout})=>{
    for(const block of document.querySelectorAll('.TiMu.newTiMu')){
      const container=block.querySelector('.fontLabel'),heading=container.querySelector('.newZy_TItle').cloneNode(true);
      const text=container.querySelector('p').textContent;
      container.replaceChildren(heading);
      if(layout==='direct')container.append(document.createTextNode(text));
      else{
        container.insertAdjacentHTML('beforeend','<p><br></p><div><p>'+text+'</p><p>后续段落。</p></div>');
      }
      for(const option of block.querySelectorAll('.Zy_ulTop li a')){
        const text=option.textContent;
        option.replaceChildren(document.createTextNode(text));
      }
    }
  },{layout:platformTextLayout});
  if(readingQuiz)await page.evaluate(({readingFault})=>{
    const parent=document.querySelector('.TiMu[data="4"]');
    parent.setAttribute('data','15');
    parent.innerHTML=`<div class="Zy_TItle"><div class="fontLabel"><span class="newZy_TItle">【阅读理解】</span><p>虚构案例开头。</p><p>虚构案例末尾的重要条件。</p></div></div><div class="clearfix"><div class="readComprehensionQues"><div class="readcomprehension_content">${[1,2,3].map(i=>`<div class="readCompreHensionItem"><input name="readCompreHension-childType" value="${readingFault==='type'&&i===2?'2':'4'}"><input name="readCompreHension-childId" value="child${i}"><div class="clear"><i class="index">(${i}) [简答题]</i><div class="clearfix"><p>虚构子题${i}</p></div></div><ul class="Zy_ulTk"><iframe style="width:500px;height:100px"></iframe><textarea id="answer-child${i}" hidden></textarea></ul></div>`).join('')}</div></div></div>`;
    for(const frame of parent.querySelectorAll('iframe'))frame.contentDocument.body.contentEditable='true';
    if(readingFault==='editor')parent.querySelector('textarea').remove();
  },{readingFault});
  if(readingDelayed)await page.evaluate(()=>{
    const editor=document.querySelector('.readCompreHensionItem iframe').contentDocument.body;
    editor.contentEditable='false';
    setTimeout(()=>{window.__answersBeforeEditor=window.__answers.length;editor.contentEditable='true';},3000);
  });
  if(readingFont)await page.evaluate(()=>{
    const source=document.querySelector('.TiMu[data="15"] .fontLabel > p');
    source.textContent='虚构长案例'.repeat(140);
    const nativeStyle=window.getComputedStyle;
    window.getComputedStyle=node=>node===source?{fontFamily:'font-cxsecret'}:nativeStyle(node);
    document.fonts.load=async()=>[];document.fonts.check=()=>true;
    window.XyBridge.ocr=async images=>{
      window.__ocrImages=images.length;
      return images.map((_,index)=>({confidence:.99,text:`案例识别片段${index+1}。`}));
    };
  });
  if(submittedResult)await page.evaluate(()=>{
    window.__state.status='submitting';
    window.__state.submissionIntent={section:'1.2',startedAt:new Date().toISOString()};
    document.querySelector('#quizStage').innerHTML='<h2>章节测验</h2><p>待批阅</p><div class="myAnswer">我的答案：B</div>';
  });
  if(gradedResult)await page.evaluate(({gradeFault})=>{
    document.querySelector('#quizStage').innerHTML='<div class="newTestTitle">章节测验<div class="testTit_status_complete">已完成</div></div><span class="achievement">本次成绩：50.0分</span><div class="myAnswer">我的答案：合成答复</div>';
    if(gradeFault==='score')document.querySelector('.achievement').remove();
    if(gradeFault==='answer')document.querySelector('.myAnswer').remove();
    if(gradeFault==='pending')document.querySelector('.testTit_status_complete').textContent='待完成';
    if(gradeFault==='intent')window.__state.submissionIntent.section='other-section';
  },{gradeFault});
  await page.addScriptTag({content});
  if(noBodyAtStart)await page.evaluate(()=>document.documentElement.append(window.__detachedBody));
  return page;
}

test('saved section still opens its title from the directory',async t=>{
  const page=await setup(t,{directoryOnly:true});
  await page.waitForFunction(()=>window.__lessonClicks>0,{timeout:7000});
  assert.equal(await page.evaluate(()=>window.__state.currentSection),'1.1');
});

test('blocked task observes manual playback without sending play commands',async t=>{
  const page=await setup(t,{blockedManual:true});
  await page.waitForFunction(()=>window.__observations.some(item=>item.playing),{timeout:7000});
  assert.equal(await page.evaluate(()=>window.__state.status),'blocked');
  assert.equal(await page.evaluate(()=>window.__playCalls.v1||0),0);
});

test('blocked task observes manual video inside an official iframe',async t=>{
  const page=await setup(t,{blockedManual:true,iframeManual:true});
  await page.waitForFunction(()=>window.__observations.some(item=>item.playing),{timeout:8000});
  assert.equal(await page.evaluate(()=>window.__state.status),'blocked');
  assert.equal(await page.evaluate(()=>window.__playCalls.v1||0),0);
});

test('loading chapter detail is not clicked repeatedly and times out safely',async t=>{
  const page=await setup(t,{loadingDetail:true});
  await page.waitForFunction(()=>window.__state.blockedReason?.includes('章节详情加载超过 20 秒'),
    null,{timeout:27000});
  assert.equal(await page.evaluate(()=>window.__lessonClicks),0);
  assert.equal(await page.evaluate(()=>window.__state.status),'blocked');
});

test('two platform-confirmed videos resume at the third video',async t=>{
  const page=await setup(t,{blockedAfterTwo:true});
  await page.waitForFunction(()=>window.__playCalls.v3>0,null,{timeout:8000});
  assert.equal(await page.evaluate(()=>window.__state.status),'running',
    await page.evaluate(()=>window.__state.blockedReason));
  assert.equal(await page.evaluate(()=>window.__state.platformDone),2);
  assert.deepEqual(await page.evaluate(()=>window.__state.completedTaskIds),
    ['1.1/video/0','1.1/video/1']);
  assert.equal(await page.evaluate(()=>window.__playCalls.v1||0),0);
  assert.equal(await page.evaluate(()=>window.__playCalls.v2||0),0);
});

test('completed video cards select the lazy third player instead of the visible second',async t=>{
  const page=await setup(t,{cardLazy:true});
  await page.waitForFunction(()=>window.__playCalls.v3>0,null,{timeout:8000});
  assert.ok(await page.evaluate(()=>window.__thirdScrolled)>0);
  assert.equal(await page.evaluate(()=>window.__playCalls.v2||0),0);
  assert.equal(await page.evaluate(()=>window.__state.currentTask),'1.1/video/2');
});

test('catalog pending count blocks when all visible cards appear complete',async t=>{
  const page=await setup(t,{cardLazy:true,cardAllComplete:true});
  await page.waitForFunction(()=>window.__state.status==='blocked',null,{timeout:7000});
  assert.match(await page.evaluate(()=>window.__state.blockedReason),/目录仍有未完成任务点/);
  assert.equal(await page.evaluate(()=>window.__playCalls.v2||0),0);
});

test('preload before body exists waits for the chapter instead of blocking',async t=>{
  const page=await setup(t,{cardLazy:true,noBodyAtStart:true});
  await page.waitForFunction(()=>window.__playCalls.v3>0,null,{timeout:8000});
  assert.equal(await page.evaluate(()=>window.__state.status),'running');
});

test('chapter iframe plays the pending third card without replaying the completed second',async t=>{
  const page=await setup(t,{remoteCardsInIframe:true});
  const third=page.frames().find(item=>item.url().endsWith('/mock-player-third'));
  const second=page.frames().find(item=>item.url().endsWith('/mock-player-second'));
  await page.waitForFunction(()=>window.__state.currentTask==='1.1/video/2',null,{timeout:10000});
  await third.waitForFunction(()=>window.__plays>0,null,{timeout:10000});
  assert.equal(await second.evaluate(()=>window.__plays),0);
});

test('nested player retries startup through platform control after initialization rejection',async t=>{
  const page=await setup(t,{remoteCardsInIframe:true,delayedPlayer:true});
  const third=page.frames().find(item=>item.url().endsWith('/mock-player-third'));
  await third.waitForFunction(()=>document.querySelector('video').currentTime>1,null,{timeout:12000});
  assert.ok(await third.evaluate(()=>window.__plays>=2));
  assert.equal(await page.evaluate(()=>window.__state.status),'running');
  const second=page.frames().find(item=>item.url().endsWith('/mock-player-second'));
  assert.equal(await second.evaluate(()=>window.__plays),0);
});

test('nested player failed startup attempts are bounded and pause cancels retries',async t=>{
  const page=await setup(t,{remoteCardsInIframe:true,neverReadyPlayer:true});
  const third=page.frames().find(item=>item.url().endsWith('/mock-player-third'));
  await third.waitForFunction(()=>window.__plays>=2,null,{timeout:12000});
  await page.evaluate(()=>document.querySelector('#chapter').contentWindow.postMessage({type:'xy-pause'},'*'));
  await page.waitForTimeout(300);
  const attempts=await third.evaluate(()=>window.__plays);
  await page.waitForTimeout(2400);
  assert.equal(await third.evaluate(()=>window.__plays),attempts);
  assert.ok(attempts<=9);
});

test('chapter status without a loaded player is not mistaken for a nonstandard speed',async t=>{
  const page=await setup(t,{remoteCardsInIframe:true,remoteNoPlayer:true});
  await page.waitForFunction(()=>window.__state.currentTask==='1.1/video/2',null,{timeout:8000});
  await page.waitForTimeout(2200);
  assert.equal(await page.evaluate(()=>window.__state.status),'running');
});

test('three task conditions and one pending catalog task select the third frame',async t=>{
  const page=await setup(t,{remoteCardsInIframe:true,remoteConditionOnly:true});
  const third=page.frames().find(item=>item.url().endsWith('/mock-player-third'));
  const second=page.frames().find(item=>item.url().endsWith('/mock-player-second'));
  await page.waitForFunction(()=>window.__state.currentTask==='1.1/video/2',null,{timeout:10000});
  await third.waitForFunction(()=>window.__plays>0,null,{timeout:10000});
  assert.equal(await second.evaluate(()=>window.__plays),0);
  await page.waitForTimeout(9500);
  assert.equal(await page.evaluate(()=>window.__state.status),'running',
    await page.evaluate(()=>window.__state.blockedReason));
  assert.equal(await second.evaluate(()=>window.__plays),0);
});

test('temporary loss of a chapter marker does not replay a completed video',async t=>{
  const page=await setup(t,{remoteCardsInIframe:true,remoteConditionOnly:true});
  const chapter=page.frames().find(item=>item.url().endsWith('/mock-chapter'));
  const third=page.frames().find(item=>item.url().endsWith('/mock-player-third'));
  const second=page.frames().find(item=>item.url().endsWith('/mock-player-second'));
  await page.waitForFunction(()=>window.__state.currentTask==='1.1/video/2',null,{timeout:10000});
  await third.waitForFunction(()=>document.querySelector('video').currentTime>=2,null,{timeout:10000});
  const before=await third.evaluate(()=>document.querySelector('video').currentTime);
  await chapter.evaluate(()=>document.querySelectorAll('.task-condition')[2].style.visibility='hidden');
  await chapter.evaluate(()=>{window.__pauseInputs=0;addEventListener('message',event=>{
    if(event.data?.type==='xy-pause'&&event.source===parent)window.__pauseInputs++;
  });});
  await page.waitForTimeout(4000);
  assert.equal(await page.evaluate(()=>window.__state.status),'running',
    await page.evaluate(()=>window.__state.blockedReason));
  assert.equal(await second.evaluate(()=>window.__plays),0);
  const after=await third.evaluate(()=>({time:document.querySelector('video').currentTime,
    paused:document.querySelector('video').paused,plays:window.__plays,pauses:window.__pauses}));
  assert.equal(await chapter.evaluate(()=>window.__pauseInputs),0);
  assert.ok(after.time>before+2,JSON.stringify({before,after,
    state:await page.evaluate(()=>window.__state),
    pauseInputs:await chapter.evaluate(()=>window.__pauseInputs)}));
});

test('a stale catalog iframe does not disable the visible chapter controller',async t=>{
  const page=await setup(t,{remoteCardsInIframe:true,remoteConditionOnly:true,staleCatalogIframe:true});
  const third=page.frames().find(item=>item.url().endsWith('/mock-player-third'));
  await page.waitForFunction(()=>window.__state.currentTask==='1.1/video/2',null,{timeout:10000});
  await third.waitForFunction(()=>window.__plays>0,null,{timeout:10000});
});

test('directory count decrease resumes navigation without replaying a video',async t=>{
  const page=await setup(t,{directoryOnly:true,blockedAfterTwo:true});
  await page.waitForFunction(()=>window.__lessonClicks>0,null,{timeout:8000});
  assert.equal(await page.evaluate(()=>window.__state.status),'running');
  assert.equal(await page.evaluate(()=>window.__state.sectionPending['1.1']),1);
  assert.equal(await page.evaluate(()=>window.__state.platformDone),2);
});

test('blocked task does not resume when the platform count has not changed',async t=>{
  const page=await setup(t,{blockedUnconfirmed:true});
  await page.waitForTimeout(2600);
  assert.equal(await page.evaluate(()=>window.__state.status),'blocked');
  assert.deepEqual(await page.evaluate(()=>window.__playCalls),{});
});

test('a stalled completed video resumes when the platform count and badge confirm it',async t=>{
  const page=await setup(t,{blockedCompletedGreen:true});
  await page.waitForFunction(()=>window.__state.sectionPending['1.2']===0,{timeout:7000});
  assert.ok((await page.evaluate(()=>window.__state.completedTaskIds)).includes('1.2/video/0'));
  assert.equal(await page.evaluate(()=>window.__state.platformDone),4);
  assert.equal(await page.evaluate(()=>window.__state.blockedReason),null);
});

test('blocked task reports video download failure from the player iframe',async t=>{
  const page=await setup(t,{blockedManual:true,iframeError:true});
  await page.waitForFunction(()=>window.__observations.some(item=>item.issue==='download-failed'),
    {timeout:8000});
  assert.equal(await page.evaluate(()=>window.__state.status),'blocked');
});

test('running task stops when the player reports a download failure',async t=>{
  const page=await setup(t,{iframeError:true});
  await page.waitForFunction(()=>window.__state.blockedReason?.includes('视频下载失败'),
    {timeout:8000});
  assert.equal(await page.evaluate(()=>window.__state.status),'blocked');
});

test('unsupported or corrupt player message stops the task without marking progress',async t=>{
  const page=await setup(t,{iframePlaybackError:true});
  await page.waitForFunction(()=>window.__state.blockedReason?.includes('播放器无法播放'));
  await page.waitForFunction(()=>window.__observations.some(item=>item.issue==='playback-failed'));
  assert.equal(await page.evaluate(()=>window.__state.status),'blocked');
  assert.deepEqual(await page.evaluate(()=>window.__state.completedTaskIds),[]);
  assert.ok((await page.evaluate(()=>window.__observations)).some(item=>item.issue==='playback-failed'));
});

test('stalled player is reported without crediting a blocked manual task',async t=>{
  const page=await setup(t,{blockedManual:true,iframeStalled:true});
  await page.waitForFunction(()=>window.__observations.some(item=>item.issue==='stalled'),
    null,{timeout:27000});
  assert.equal(await page.evaluate(()=>window.__state.status),'blocked');
  assert.deepEqual(await page.evaluate(()=>window.__state.completedTaskIds),[]);
});

test('running task pauses when video time stays frozen',async t=>{
  const page=await setup(t,{iframeStalled:true});
  await page.waitForFunction(()=>window.__state.blockedReason?.includes('30 秒未前进'),
    null,{timeout:37000});
  assert.equal(await page.evaluate(()=>window.__state.status),'blocked');
  assert.deepEqual(await page.evaluate(()=>window.__state.completedTaskIds),[]);
});

test('media error code from official video frame blocks without leaking a source URL',async t=>{
  const page=await setup(t,{iframeMediaCode:3});
  await page.waitForFunction(()=>window.__state.blockedReason?.includes('媒体错误（代码 3）'));
  assert.equal(await page.evaluate(()=>window.__state.status),'blocked');
  await page.waitForFunction(()=>window.__observations.some(item=>item.mediaErrorCode===3));
  assert.deepEqual(await page.evaluate(()=>window.__state.completedTaskIds),[]);
});

test('chapter quiz remains identifiable on a detail page without directory rows',async t=>{
  const page=await setup(t,{quizDetail:true});
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',{timeout:12000});
  assert.equal(await page.evaluate(()=>window.__submits),1);
});

test('returning from a video requires a reduced platform task count',async t=>{
  const page=await setup(t,{returningTask:true});
  await page.waitForFunction(()=>window.__state.awaitingPlatform===null,{timeout:7000});
  assert.ok((await page.evaluate(()=>window.__state.completedTaskIds)).includes('1.1/video/0'));
  assert.equal(await page.evaluate(()=>window.__state.platformDone),1);
});

test('a pending quiz card is opened once before looking for questions',async t=>{
  const page=await setup(t,{quizDetail:true,quizCardOnly:true});
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',
    null,{timeout:12000});
  assert.equal(await page.evaluate(()=>window.__quizOpens),1);
  assert.equal(await page.evaluate(()=>window.__submits),1);
});

test('quiz headings split across elements are parsed before submitting',async t=>{
  const page=await setup(t,{quizDetail:true,splitQuestionHead:true});
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',
    null,{timeout:12000});
  assert.equal(await page.evaluate(()=>window.__submits),1);
  assert.deepEqual(await page.evaluate(()=>window.__answers),['single','multi','short']);
});

test('resuming a saved quiz from the directory opens its detail before parsing',async t=>{
  const page=await setup(t,{quizCatalogResume:true});
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',
    null,{timeout:12000});
  assert.equal(await page.evaluate(()=>window.__submits),1);
});

test('embedded question frame parses all questions using its visible question count',async t=>{
  const page=await setup(t,{quizQuestionDetail:true});
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',
    null,{timeout:12000});
  assert.equal(await page.evaluate(()=>window.__submits),1);
});

test('quiz questions inside a readable nested iframe are submitted once',async t=>{
  const page=await setup(t,{quizQuestionDetail:true,quizNestedDom:true});
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',
    null,{timeout:12000});
  assert.equal(await page.evaluate(()=>window.__submits),1);
});

test('platform question blocks fill choices and rich text before one submission',async t=>{
  const page=await setup(t,{quizQuestionDetail:true,platformQuiz:true});
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',
    null,{timeout:12000});
  assert.equal(await page.evaluate(()=>window.__submits),1);
  assert.deepEqual(await page.evaluate(()=>window.__answers),['single','multi','short']);
  assert.equal(await page.evaluate(()=>document.querySelector('#answer3').value),'依法保护生态环境');
});

test('reading parent counts once and its three short children keep context and separate fields',async t=>{
  const page=await setup(t,{quizQuestionDetail:true,readingQuiz:true});
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',null,{timeout:12000});
  assert.equal(await page.evaluate(()=>window.__submits),1);
  const evidence=await page.evaluate(()=>({requests:window.__requests.slice(2),
    fields:[...document.querySelectorAll('.readCompreHensionItem textarea')].map(n=>n.value),
    editors:[...document.querySelectorAll('.readCompreHensionItem iframe')].map(n=>n.contentDocument.body.textContent)}));
  assert.equal(evidence.requests.length,3);
  evidence.requests.forEach((request,index)=>{
    assert.match(request.question,/虚构案例开头/);
    assert.match(request.question,/虚构案例末尾的重要条件/);
    assert.match(request.question,new RegExp(`子题：\\n虚构子题${index+1}$`));
  });
  assert.deepEqual(evidence.fields,['子题答复3','子题答复4','子题答复5']);
  assert.deepEqual(evidence.editors,evidence.fields);
});

for(const fault of ['type','editor'])test(`reading ${fault} mismatch pauses before answering or submission`,async t=>{
  const page=await setup(t,{quizQuestionDetail:true,readingQuiz:true,readingFault:fault});
  await page.waitForFunction(()=>window.__state.status==='blocked',null,{timeout:8000});
  assert.equal(await page.evaluate(()=>window.__submits),0);
  assert.deepEqual(await page.evaluate(()=>window.__answers),[]);
});

test('reading long secret-font context is decoded in ordered chunks once for all children',async t=>{
  const page=await setup(t,{quizQuestionDetail:true,readingQuiz:true,readingFont:true});
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',null,{timeout:12000});
  const evidence=await page.evaluate(()=>({count:window.__ocrImages,requests:window.__requests.slice(2),submits:window.__submits}));
  assert.ok(evidence.count>1);
  assert.equal(evidence.submits,1);
  for(const request of evidence.requests){
    assert.match(request.question,/案例识别片段1。/);
    assert.ok(request.question.includes(`案例识别片段${evidence.count}。`));
    assert.match(request.question,/虚构案例末尾的重要条件/);
  }
});

test('reading waits for the rich text frame to initialize before answering',async t=>{
  const page=await setup(t,{quizQuestionDetail:true,readingQuiz:true,readingDelayed:true});
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',null,{timeout:12000});
  assert.equal(await page.evaluate(()=>window.__answersBeforeEditor),0);
  assert.equal(await page.evaluate(()=>window.__submits),1);
});

test('a submitted result clears the pending intent without clicking submit again',async t=>{
  const page=await setup(t,{quizQuestionDetail:true,submittedResult:true});
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',
    null,{timeout:8000});
  assert.equal(await page.evaluate(()=>window.__state.submissionIntent),null);
  assert.equal(await page.evaluate(()=>window.__submits),0);
});

test('a green completed catalog mark clears the final pending task after return',async t=>{
  const page=await setup(t,{returningGreenCheck:true});
  await page.waitForFunction(()=>window.__state.awaitingPlatform===null,{timeout:7000});
  assert.equal(await page.evaluate(()=>window.__state.sectionPending['1.1']),0);
  assert.ok((await page.evaluate(()=>window.__state.completedTaskIds)).includes('1.1/video/1'));
  assert.equal(await page.evaluate(()=>window.__playCalls.v1||0),0);
});

test('the existing 1.1 pilot state recovers when its final badge has disappeared',async t=>{
  const page=await setup(t,{legacyGreenCheck:true});
  await page.waitForFunction(()=>window.__state.awaitingPlatform===null,{timeout:7000});
  assert.equal(await page.evaluate(()=>window.__state.sectionPending['1.1']),0);
  assert.equal(await page.evaluate(()=>window.__state.platformDone),3);
  await page.waitForFunction(()=>window.__state.currentSection==='1.2',{timeout:7000});
  assert.equal(await page.evaluate(()=>window.__playCalls.v1||0),0);
});

test('detail video starts with a saved section even without directory rows',async t=>{
  const page=await setup(t,{detailOnly:true});
  await page.waitForFunction(()=>window.__state.currentTask==='1.1/video/0',{timeout:7000});
  assert.equal(await page.evaluate(()=>document.querySelector('#v1').paused),false);
  await page.waitForTimeout(3000);
  assert.equal(await page.evaluate(()=>window.__playCalls.v1),1);
});

test('a short playback advance followed by pause is retried without a false start failure',async t=>{
  const page=await setup(t,{detailOnly:true});
  await page.waitForFunction(()=>window.__playCalls.v1>0,null,{timeout:7000});
  await page.evaluate(()=>{
    const video=document.querySelector('#v1');video.currentTime=3;video.pause();
  });
  await page.waitForFunction(()=>window.__playCalls.v1>=2,null,{timeout:7000});
  assert.equal(await page.evaluate(()=>window.__state.status),'running');
});

test('a video stalled past ninety percent returns to verify the platform',async t=>{
  const page=await setup(t,{detailOnly:true});
  await page.waitForFunction(()=>window.__state.currentTask==='1.1/video/0',{timeout:7000});
  await page.evaluate(()=>{
    document.querySelector('#v1').currentTime=95;
    const back=document.createElement('button');back.textContent='返回课程';
    back.onclick=()=>window.__returned=(window.__returned||0)+1;
    document.body.append(back);
  });
  await page.waitForFunction(()=>window.__returned>0,null,{timeout:13000});
  assert.equal(await page.evaluate(()=>window.__state.awaitingPlatform.taskId),'1.1/video/0');
  assert.deepEqual(await page.evaluate(()=>window.__state.completedTaskIds),[]);
});

test('course script retries state access after login navigation race',async t=>{
  const page=await setup(t,{stateFailures:2});
  await page.waitForFunction(()=>window.__state.currentTask==='1.1/video/0',{timeout:7000});
  assert.ok(await page.evaluate(()=>window.__stateReads)>=3);
});

test('three videos wait for platform counts, then quiz with zero catalog count submits once',async t=>{
  const page=await setup(t);
  await page.waitForFunction(()=>window.__state.currentTask==='1.1/video/0');
  await page.evaluate(()=>document.querySelector('#v1').currentTime=91);
  await page.waitForTimeout(1300);
  assert.deepEqual(await page.evaluate(()=>window.__state.completedTaskIds),[]);
  await page.evaluate(()=>{document.querySelector('#pending').textContent='2';document.querySelector('#count').textContent='已完成任务点 1/3';});
  await page.waitForFunction(()=>window.__state.currentTask==='1.1/video/1');
  await page.evaluate(()=>{document.querySelector('#pending').textContent='1';document.querySelector('#count').textContent='已完成任务点 2/3';});
  await page.waitForFunction(()=>window.__state.currentTask==='1.1/video/2');
  await page.evaluate(()=>{document.querySelector('#pending').textContent='0';document.querySelector('#count').textContent='已完成任务点 3/3';});
  await page.waitForFunction(()=>document.querySelector('#quizStage').hidden===false);
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',{timeout:12000});
  assert.equal(await page.evaluate(()=>window.__submits),1);
  assert.deepEqual(await page.evaluate(()=>window.__answers),['single','multi','short']);
});

test('an uncertain quiz answer blocks before any submission',async t=>{
  const page=await setup(t);
  await page.evaluate(()=>{
    window.XyBridge.answer=async()=>null;
    document.querySelector('#quizRow').click();
    window.__state.currentSection='1.2';
  });
  await page.waitForFunction(()=>window.__state.status==='blocked',{timeout:7000});
  assert.equal(await page.evaluate(()=>window.__submits),0);
  assert.equal(await page.evaluate(()=>!!window.__state.submissionIntent),false);
});

test('an unconfirmed submission keeps its intent and is never retried blindly',async t=>{
  const page=await setup(t);
  await page.evaluate(()=>{
    document.querySelector('#submit').onclick=()=>{window.__submits++;};
    document.querySelector('#quizRow').click();
    window.__state.currentSection='1.2';
  });
  await page.waitForFunction(()=>window.__state.status==='blocked'&&!!window.__state.submissionIntent,
    null,{timeout:38000});
  assert.equal(await page.evaluate(()=>window.__submits),1);
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(()=>window.__submits),1);
});


test('graded review route clears submission intent without answering or resubmitting',async t=>{
  const page=await setup(t,{quizQuestionDetail:true,submittedResult:true,gradedResult:true});
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',null,{timeout:8000});
  assert.equal(await page.evaluate(()=>window.__state.submissionIntent),null);
  assert.equal(await page.evaluate(()=>window.__submits),0);
  assert.deepEqual(await page.evaluate(()=>window.__answers),[]);
});

for(const fault of ['score','answer','pending','intent'])test(`graded review missing ${fault} evidence retains pending intent`,async t=>{
  const page=await setup(t,{quizQuestionDetail:true,submittedResult:true,gradedResult:true,gradeFault:fault});
  await page.waitForTimeout(2500);
  assert.equal(await page.evaluate(()=>window.__state.status),'submitting');
  assert.ok(await page.evaluate(()=>window.__state.submissionIntent));
  assert.equal(await page.evaluate(()=>window.__submits),0);
  assert.deepEqual(await page.evaluate(()=>window.__answers),[]);
});


for(const layout of ['direct','wrapped'])test(`platform ${layout} text keeps complete prompts and plain options`,async t=>{
  const page=await setup(t,{quizQuestionDetail:true,platformQuiz:true,platformTextLayout:layout});
  await page.waitForFunction(()=>window.__state.quizStatuses['1.2']==='submitted',null,{timeout:12000});
  const requests=await page.evaluate(()=>window.__requests);
  assert.equal(requests.length,3);
  assert.equal(requests[0].question,layout==='direct'?'第一题':'第一题 后续段落。');
  assert.deepEqual(requests[0].options,['甲','乙']);
  assert.equal(requests[1].question,layout==='direct'?'第二题':'第二题 后续段落。');
  assert.deepEqual(requests[1].options,['甲','乙']);
  assert.equal(await page.evaluate(()=>window.__submits),1);
});


test('playback watchdog resets after the same player reloads to an earlier position',async t=>{
  const page=await setup(t,{detailOnly:true});
  await page.waitForFunction(()=>window.__playCalls.v1>0);
  await page.evaluate(()=>document.querySelector('#v1').currentTime=70);
  await page.waitForTimeout(1500);
  await page.evaluate(()=>document.querySelector('#v1').currentTime=5);
  await page.waitForTimeout(1500);
  await page.evaluate(()=>{
    const realNow=Date.now;Date.now=()=>realNow()+31000;
    document.querySelector('#v1').currentTime=6;
  });
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(()=>window.__state.status),'running');
  assert.deepEqual(await page.evaluate(()=>window.__state.completedTaskIds),[]);
});

test('card heartbeats cannot refresh a missing child media sample',async t=>{
  const page=await setup(t,{remoteCardsInIframe:true});
  const third=page.frames().find(item=>item.url().endsWith('/mock-player-third'));
  await third.waitForFunction(()=>document.querySelector('video').currentTime>=2);
  await page.waitForFunction(()=>window.__observations.some(item=>item.positionSeconds>=2&&item.playing===true));
  await page.waitForTimeout(1500);
  await page.evaluate(()=>{window.XyBridge.state=async()=>window.__state;window.__command({type:'RUN'});});
  await page.waitForTimeout(1500);
  const completedBefore=await page.evaluate(()=>window.__state.completedTaskIds);
  await third.evaluate(()=>{
    const post=parent.postMessage.bind(parent);
    parent.postMessage=(data,...args)=>{if(data?.type!=='xy-video-status')post(data,...args);};
  });
  await page.evaluate(()=>{window.__state.status='paused';const realNow=Date.now;Date.now=()=>realNow()+31000;});
  await page.waitForTimeout(1800);
  await page.evaluate(()=>window.__state.status='running');
  await page.waitForFunction(()=>window.__state.status==='blocked');
  assert.equal(await page.evaluate(()=>window.__state.blockedReason),'无法读取视频播放状态，请检查播放器');
  assert.deepEqual(await page.evaluate(()=>window.__state.completedTaskIds),completedBefore);
});

test('fresh constant media time still triggers the thirty second stall watchdog',async t=>{
  const page=await setup(t,{detailOnly:true});
  await page.waitForFunction(()=>window.__playCalls.v1>0);
  await page.evaluate(()=>document.querySelector('#v1').currentTime=20);
  await page.waitForTimeout(1500);
  await page.evaluate(()=>{const realNow=Date.now;Date.now=()=>realNow()+31000;});
  await page.waitForFunction(()=>window.__state.status==='blocked');
  assert.match(await page.evaluate(()=>window.__state.blockedReason),/30 秒未前进/);
  assert.deepEqual(await page.evaluate(()=>window.__state.completedTaskIds),[]);
  await page.evaluate(()=>{window.__state.status='running';window.__command({type:'RUN'});});
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(()=>window.__state.status),'running');
  assert.equal(await page.evaluate(()=>document.querySelector('#v1').paused),false);
});


test('return verification uses its immutable pending snapshot after directory state updates',async t=>{
  const page=await setup(t,{returningTask:true,returningSnapshot:true});
  await page.waitForFunction(()=>window.__state.awaitingPlatform===null,null,{timeout:7000});
  assert.ok((await page.evaluate(()=>window.__state.completedTaskIds)).includes('1.1/video/0'));
  assert.equal(await page.evaluate(()=>window.__state.sectionPending['1.1']),2);
});


test('explicit video completion clears a legacy return intent while other tasks remain',async t=>{
  const page=await setup(t,{remoteCardsInIframe:true});
  const chapter=page.frames().find(item=>item.url().endsWith('/mock-chapter'));
  await page.waitForFunction(()=>window.__state.currentTask==='1.1/video/2');
  await page.evaluate(()=>window.__command({type:'PAUSE'}));
  await chapter.evaluate(()=>{
    const spans=[...document.querySelectorAll('span')];
    spans.find(e=>e.textContent==='任务点').textContent='任务点已完成';
  });
  await page.waitForTimeout(1500);
  await page.evaluate(()=>{
    window.__state.awaitingPlatform={section:'1.1',taskId:'1.1/video/2',
      returnedAt:new Date().toISOString(),platformDoneBefore:2};
    window.__state.status='running';window.__command({type:'RUN'});
  });
  await page.waitForFunction(()=>window.__state.awaitingPlatform===null,null,{timeout:7000});
  assert.ok((await page.evaluate(()=>window.__state.completedTaskIds)).includes('1.1/video/2'));
  assert.equal(await page.evaluate(()=>window.__state.sectionPending['1.1']),1);
  assert.equal(await page.evaluate(()=>window.__state.platformDone),2);
});


test('legacy return verification reopens its own section at most once without awarding progress',async t=>{
  const page=await setup(t,{returningTask:true,returningSnapshot:'legacy',directoryOnly:true});
  await page.waitForFunction(()=>window.__lessonClicks===1);
  await page.waitForTimeout(2500);
  assert.equal(await page.evaluate(()=>window.__lessonClicks),1);
  assert.equal(await page.evaluate(()=>window.__state.awaitingPlatform.verificationOpened),true);
  assert.deepEqual(await page.evaluate(()=>window.__state.completedTaskIds),[]);
});


test('catalog completion recovers a document task without replaying or inventing extra document IDs',async t=>{
  const page=await setup(t,{returningTask:true,returningSnapshot:'document',directoryOnly:true});
  await page.waitForFunction(()=>window.__state.completedTaskIds.includes('1.1/document/0'));
  assert.deepEqual(await page.evaluate(()=>window.__state.completedTaskIds.filter(id=>id.includes('/document/'))),['1.1/document/0']);
  assert.equal(await page.evaluate(()=>window.__state.sectionPending['1.1']),0);
  assert.equal(await page.evaluate(()=>window.__state.platformDone),2);
});

for(const accepted of [true,false,'cooldown'])test(`stalled playback ${accepted==='cooldown'?'waits for recovery cooldown':accepted?'requests normal reload without credit':'blocks when recovery budget is exhausted'}`,async t=>{
  const page=await setup(t,{detailOnly:true});
  await page.waitForFunction(()=>window.__playCalls.v1>0);
  await page.evaluate(accepted=>{
    window.recoveryCalls=[];XyBridge.recoverPlayback=async request=>{recoveryCalls.push(request);if(accepted==='cooldown'&&recoveryCalls.length===1)return {accepted:false,reason:'cooldown'};if(accepted)document.querySelector('#v1').currentTime=21;return accepted?{accepted:true}:{accepted:false,reason:'exhausted'};};
    document.querySelector('#v1').currentTime=20;
  },accepted);
  await page.waitForTimeout(1500);await page.evaluate(()=>{const realNow=Date.now;Date.now=()=>realNow()+31000;});
  await page.waitForFunction(()=>recoveryCalls.length>0,null,{timeout:6000});
  if(accepted){await page.waitForTimeout(2800);assert.equal(await page.evaluate(()=>__state.status),'running');assert.equal(await page.evaluate(()=>recoveryCalls.length),accepted==='cooldown'?2:1);}
  else{await page.waitForFunction(()=>__state.status==='blocked');assert.match(await page.evaluate(()=>__state.blockedReason),/重载 2 次/);}
  assert.deepEqual(await page.evaluate(()=>__state.completedTaskIds),[]);
  assert.equal(await page.evaluate(()=>recoveryCalls[0].positionSeconds),20);
});
