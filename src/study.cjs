const fs=require('node:fs');
const path=require('node:path');
const BaseCore=require('./core.js');
const C=BaseCore;
const {officialOrigin,createAuthSession}=require('./auth-session.cjs');
const {createNavigationTrace}=require('./navigation-trace.cjs');
const {readPlatformReview,readPlatformReviewInPage,primeScoreSession,REPORT_URL}=require('./platform-review.cjs');

const courseHost='wisdom-mooc.zhihuishu.com';
const coursePage=(url,courseId=C.COURSE_ID)=>{
  try{const parsed=new URL(url);return parsed.protocol==='https:'&&parsed.hostname===courseHost&&
    parsed.pathname.startsWith('/study/')&&parsed.searchParams.get('recruitAndCourseId')===courseId;}
  catch{return false;}
};
const courseHomepage=url=>{
  try{
    const parsed=new URL(url);
    return parsed.protocol==='https:'&&parsed.hostname==='www.zhihuishu.com'&&
      ['/', '/index', '/index.html'].includes(parsed.pathname);
  }catch{return false;}
};
const courseSessionPopup=url=>{
  try{
    const parsed=new URL(url);
    return parsed.protocol==='https:'&&
      (officialOrigin(parsed.origin)||parsed.hostname==='hike-teaching-center.polymas.com');
  }catch{return false;}
};
const nextSix=()=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',hour12:false,
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit'}).formatToParts(new Date())
    .filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
  const today=Date.UTC(parts.year,parts.month-1,parts.day,6)-8*3600_000;
  return today>Date.now()?today:today+86400_000;
};

const {previewLayout,inputPoint}=require('./course-preview.cjs');
function createZhihuishuStudy({WebContentsView,hostWindow,ipcMain,Notification,safeStorage,data,answer,answerTyped,trusted,courseSession,claimCourse,backgroundInput=false,profile=null}){
  const C=BaseCore.create(profile);
  const courseLabel=profile?.name||'智慧树课程';
  const isCourse=url=>coursePage(url,C.COURSE_ID);
  const report=profile?.report;
  const reportUrl=profile?(report?.url||null):REPORT_URL;
  const file=path.join(data,'zhihuishu-study','state.json');
  const trace=createNavigationTrace(path.join(data,'zhihuishu-study','navigation-trace.json'));
  const auth=createAuthSession(path.join(data,'zhihuishu-study','auth-session.bin'),safeStorage);
  let courseView=null;
  let scoreRequested=false;
  let recoveryAttempted=false,awaitingReady=false,inputEpoch=0;
  let paneBounds=null;const inputActions=new Set();
  let sidebarWidth=360,courseExpanded=false,paneZoom=1;
  let timer=null;
  let platformTimer=null,reviewInFlight=null;
  const hasCourse=()=>!!courseView&&!courseView.webContents.isDestroyed();
  const courseContents=()=>hasCourse()?courseView.webContents:null;
  const layout=()=>{
    if(!hasCourse()||hostWindow.isDestroyed())return;
    const preview=previewLayout(hostWindow.getContentSize(),sidebarWidth,courseExpanded);
    paneBounds=preview.bounds;paneZoom=preview.zoom;
    courseView.setBounds(paneBounds);
    courseContents().setZoomFactor?.(paneZoom);
    paneZoom=courseContents().getZoomFactor?.()||paneZoom;
  };
  hostWindow.on('resize',layout);
  const read=()=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {};}};
  const write=value=>{
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const pending=file+'.pending';
    fs.writeFileSync(pending,JSON.stringify(value),'utf8');
    fs.renameSync(pending,file);
    if(hasCourse()){
      const changes=Object.fromEntries(Object.entries(value).map(([key,newValue])=>[key,{newValue}]));
      courseContents().send('zhs-storage-changed',changes);
    }
  };
  const update=patch=>write({...read(),...patch});
  const status=()=>{
    const saved=read();
    const dailyState=saved.dailyState?.day===C.dayKey()?saved.dailyState:C.emptyState(C.dayKey());
    return {enabled:!!saved.enabled,dailyState,
      dailyHistory:saved.dailyHistory||[],platformPreview:saved.platformPreview||null,windowOpen:hasCourse(),
      courseOnTarget:hasCourse()&&isCourse(courseContents().getURL()),scoreRequested,sidebarWidth,courseExpanded,goals:dailyState.goal||{minLessons:profile?.legacy?2:C.MIN_LESSONS,minMinutes:profile?.legacy?25:C.MIN_SECONDS/60},configured:!!C.COURSE_URL,reportConfigured:!!reportUrl};
  };
  const notice=message=>{if(Notification.isSupported())new Notification({title:'智慧树每日学习',body:message}).show();};
  const trustedCourse=event=>event.sender===courseContents()&&
    event.senderFrame===event.sender.mainFrame&&isCourse(event.senderFrame.url);
  const trustedOfficial=(event,origin)=>{
    if(event.sender!==courseContents()||!officialOrigin(origin))return false;
    try{return new URL(event.senderFrame.url).origin===origin;}catch{return false;}
  };
  const returnToCourse=()=>{
    if(!hasCourse()||scoreRequested)return;
    if(recoveryAttempted){
      const current=read().dailyState;
      if(current?.day===C.dayKey())update({dailyState:{...current,status:'blocked',blockedReason:`自动返回${courseLabel}课程后仍停在首页，请检查登录状态`}});
      return;
    }
    recoveryAttempted=true;
    trace.record('app-retry-course',C.COURSE_URL,{from:courseContents().getURL()});
    void courseContents().loadURL(C.COURSE_URL).catch(()=>{
      const current=read().dailyState;
      if(current?.day===C.dayKey()&&current.status==='blocked')
        update({dailyState:{...current,blockedReason:`无法返回${courseLabel}课程，请检查网络或登录状态`}});
    });
  };
  const open=(targetUrl=C.COURSE_URL)=>{
    if(!targetUrl)throw Error('请先在课程配置中保存学习页面链接');
    claimCourse?.('mayuan');
    if(hasCourse()){
      if(scoreRequested!==(targetUrl===reportUrl)){
        scoreRequested=targetUrl===reportUrl;
        void courseContents().loadURL(targetUrl).catch(()=>{});
      }
      hostWindow.show();hostWindow.focus();return courseView;
    }
    scoreRequested=targetUrl===reportUrl;
    courseView=new WebContentsView({webPreferences:{preload:path.join(__dirname,'course-preload.cjs'),
        partition:'persist:course',contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:true,sandbox:false}});
    courseView.webContents.setAudioMuted?.(true);
    hostWindow.contentView.addChildView(courseView);
    layout();
    const view=courseView;
    view.webContents.setWindowOpenHandler(({url,disposition})=>{
      trace.record('popup-request',url,{from:view.webContents.getURL(),disposition});
      if(courseSessionPopup(url))void view.webContents.loadURL(url).catch(()=>{});
      else if(/^https:\/\//.test(url))void require('electron').shell.openExternal(url);
      return {action:'deny'};
    });
    view.webContents.on('will-navigate',(event,url)=>{
      trace.record('page-navigation',url,{from:view.webContents.getURL(),initiator:event.initiator?.url,mainFrame:event.isMainFrame});
      if(!/^https:\/\//.test(url))event.preventDefault();
    });
    view.webContents.on('did-start-navigation',details=>{
      if(details.isMainFrame){inputEpoch++;inputActions.clear();if(!details.isSameDocument)awaitingReady=false;}
      if(details.isMainFrame)trace.record('navigation-start',details.url,
        {from:view.webContents.getURL(),initiator:details.initiator?.url,mainFrame:true});
    });
    view.webContents.on('did-redirect-navigation',details=>{
      if(details.isMainFrame)trace.record('server-redirect',details.url,
        {from:view.webContents.getURL(),initiator:details.initiator?.url,mainFrame:true});
    });
    view.webContents.on('did-frame-navigate',(_event,url,httpResponseCode,_status,isMainFrame)=>{
      if(isMainFrame)trace.record('navigation-complete',url,{mainFrame:true,httpStatus:httpResponseCode});
    });
    const markLeftCourse=url=>{
      try{
        const parsed=new URL(url);
        const diagnostic={host:parsed.hostname,path:parsed.hostname===courseHost?parsed.pathname:null,
          queryKeys:[...parsed.searchParams.keys()],courseIdMatches:parsed.searchParams.get('recruitAndCourseId')===C.COURSE_ID,
          isCourse:isCourse(url),observedAt:new Date().toISOString()};
        fs.mkdirSync(path.dirname(file),{recursive:true});
        fs.writeFileSync(path.join(path.dirname(file),'navigation.json'),JSON.stringify(diagnostic),'utf8');
      }catch{}
      if(isCourse(url))return;
      const current=read().dailyState;
      if(current?.day===C.dayKey()&&current.status==='running')
        update({dailyState:{...current,status:'blocked',blockedReason:`课程页面已离开${courseLabel}课程，请完成登录后手动恢复`}});
    };
    view.webContents.on('did-navigate',(_event,url)=>markLeftCourse(url));
    view.webContents.on('did-finish-load',()=>{
      if(!hasCourse()||courseView!==view)return;
      view.webContents.setAudioMuted?.(true);
      layout();
      const url=view.webContents.getURL();
      markLeftCourse(url);
      if(scoreRequested&&url.startsWith(reportUrl.split('?')[0])){void review(true);return;}
      if(!isCourse(url)){
        const current=read().dailyState;
        if(!scoreRequested&&courseHomepage(url)&&current?.day===C.dayKey()&&
            current.status==='blocked'&&
            /^课程(?:页面|窗口)已离开.+课程/.test(current.blockedReason||'')){
          if(!recoveryAttempted)returnToCourse();
          else update({dailyState:{...current,blockedReason:`自动返回${courseLabel}课程后仍停在首页，请检查登录状态`}});
        }
        return;
      }
      const current=read().dailyState;
      if(current?.day===C.dayKey()&&current.status==='blocked'&&
          (/^课程(?:页面|窗口)已离开.+课程/.test(current.blockedReason||'')||
           current.blockedReason===`正在返回${courseLabel}课程，请稍候`||
           current.blockedReason===`自动返回${courseLabel}课程后仍停在首页，请检查登录状态`||
           current.blockedReason==='智慧树登录已失效'))
        {awaitingReady=true;view.webContents.send('zhs-command',{type:'PROBE_READY'});}
      if(status().dailyState.status==='running')
        view.webContents.send('zhs-command',{type:'START'});
    });
    view.webContents.on('destroyed',()=>{
      if(courseView!==view)return;
      courseView=null;
      awaitingReady=false;inputEpoch++;inputActions.clear();
      const saved=read(),current=saved.dailyState;
      if(current?.day===C.dayKey()&&current.status==='running')
        update({dailyState:{...current,status:'interrupted',blockedReason:'课程页面已关闭'}});
    });
    trace.record('app-open-course',targetUrl);
    void view.webContents.loadURL(targetUrl).catch(()=>{});
    return view;
  };
  const close=()=>{
    if(!hasCourse())return status();
    const view=courseView;
    courseView=null;
    scoreRequested=false;
    awaitingReady=false;inputEpoch++;inputActions.clear();
    if(!hostWindow.isDestroyed())hostWindow.contentView.removeChildView(view);
    view.webContents.close();
    const current=read().dailyState;
    if(current?.day===C.dayKey()&&current.status==='running')
      update({dailyState:{...current,status:'interrupted',blockedReason:'课程页面已关闭'}});
    return status();
  };
  const openScore=()=>{
    if(!reportUrl)throw Error('请先配置这门课程的成绩分析链接');
    if(read().dailyState?.day===C.dayKey()&&read().dailyState.status==='running')
      throw Error('请先暂停当前学习任务，再打开成绩分析');
    open(reportUrl);
    return status();
  };
  const command=type=>{
    const saved=read(),day=C.dayKey();
    if(type==='START'){
      if(hasCourse()&&!isCourse(courseContents().getURL())&&
          !courseContents().isLoadingMainFrame()){
        const homepage=courseHomepage(courseContents().getURL());
        const current=saved.dailyState?.day===day?saved.dailyState:C.emptyState(day);
        update({dailyState:{...current,status:'blocked',blockedReason:
          homepage?`正在返回${courseLabel}课程，请稍候`:`请先在右侧课程页登录并回到${courseLabel}课程`}});
        if(homepage)returnToCourse();
        return status();
      }
      let dailyState=saved.dailyState?.day===day?saved.dailyState:C.emptyState(day);
      if(dailyState.status==='complete')return status();
      const lastLesson=dailyState.currentLesson||dailyState.navigationHint||saved.dailyState?.currentLesson||saved.dailyHistory?.at(-1)?.currentLesson;
      dailyState={...dailyState,navigationHint:/^\d+\.\d+$/.test(lastLesson||'')?lastLesson:null,status:'running',currentLessonConfirmed:false,blockedReason:null,startedAt:dailyState.startedAt||new Date().toISOString()};
      update({dailyState});
      const target=open();
      if(isCourse(target.webContents.getURL()))target.webContents.send('zhs-command',{type});
    }else{
      if(saved.dailyState?.day===day)update({dailyState:{...saved.dailyState,status:type==='PAUSE'?'paused':'ended'}});
      if(hasCourse()&&isCourse(courseContents().getURL()))
        courseContents().send('zhs-command',{type});
    }
    return status();
  };
  const checkDue=()=>{
    const saved=read(),day=C.dayKey();
    if(saved.dailyState?.day&&saved.dailyState.day!==day&&!saved.dailyHistory?.some(item=>item.day===saved.dailyState.day))
      update({dailyHistory:[...(saved.dailyHistory||[]),saved.dailyState].slice(-30)});
    const current=read();
    if(!current.enabled){
      if(current.dailyState?.day===day&&current.dailyState.status==='running')
        update({dailyState:{...current.dailyState,status:'interrupted',blockedReason:'应用上次关闭，点击开始／恢复继续'}});
      return;
    }
    if(C.shouldStart(true,current.dailyState))command('START');
    else if(current.dailyState?.day===day&&current.dailyState.status==='interrupted')command('START');
    else if(current.dailyState?.day===day&&current.dailyState.status==='running')open();
    else if(current.dailyState?.day===day&&current.dailyState.status==='blocked'&&
      (current.dailyState.blockedReason?.startsWith('弹题')||
       current.dailyState.blockedReason?.startsWith('课程提醒')||
       current.dailyState.blockedReason?.startsWith('未识别到课程小节目录')||
       current.dailyState.blockedReason?.startsWith('课程页面已离开')||
       current.dailyState.blockedReason?.startsWith('课程窗口已离开')))open();
  };
  const review=force=>{
    if(!reportUrl)return Promise.resolve({...status(),platformPreview:{state:'unconfigured'}});
    if(reviewInFlight)return reviewInFlight;
    const saved=read(),today=C.dayKey();
    const eligible=(saved.dailyHistory||[]).filter(item=>item.day<today&&item.status==='complete'&&C.meetsGoal(item));
    const target=eligible.at(-1)||(force?saved.dailyState:null);
    if(!target?.day||!courseSession)return Promise.resolve(status());
    const previous=target.day===today?saved.platformPreview:target.platformReview;
    if(!force&&previous?.state==='confirmed')return Promise.resolve(status());
    if(!force&&previous?.checkedAt&&Date.now()-Date.parse(previous.checkedAt)<3*3600_000)
      return Promise.resolve(status());
    reviewInFlight=(async()=>{
      let observation;
      try{
        const scorePage=scoreRequested&&hasCourse()&&courseContents().getURL().startsWith(reportUrl.split('?')[0]);
        observation=scorePage?
          await readPlatformReviewInPage(courseContents(),target.day,target.completed||[],report):
          await readPlatformReview(courseSession,target.day,target.completed||[],report);
        if(observation.state==='login-required'){
          await primeScoreSession(courseSession,report);
          observation=scorePage?
            await readPlatformReviewInPage(courseContents(),target.day,target.completed||[],report):
            await readPlatformReview(courseSession,target.day,target.completed||[],report);
        }
      }
      catch(error){observation={state:error.message==='score-session-unavailable'?'login-required':'unavailable',
        reason:error.message==='score-session-unavailable'?'score-session-unavailable':'score-request-failed',
        checkedAt:new Date().toISOString()};}
      let result=observation;
      if(target.day<today&&observation.state==='observed'){
        const videoCount=observation.lessonStatuses.filter(item=>item.watchStatus===1).length;
        result={...observation,videoConfirmedCount:videoCount,videoRequiredCount:target.completed.length,
          state:observation.habitDayPresent&&observation.habitMinutes>=observation.suggestedMinutes&&
            videoCount===target.completed.length?'confirmed':'difference'};
      }
      const current=read();
      if(target.day===today)update({platformPreview:result});
      else update({dailyHistory:(current.dailyHistory||[]).map(item=>item.day===target.day?
        {...item,platformReview:result,platformConfirmed:result.state==='confirmed'?true:null}:item)});
      return status();
    })().finally(()=>{reviewInFlight=null;});
    return reviewInFlight;
  };
  const schedule=()=>{
    clearTimeout(timer);
    timer=setTimeout(()=>{checkDue();schedule();},Math.max(1000,nextSix()-Date.now()));
  };
  ipcMain.on('zhs-course-config',event=>{event.returnValue=event.sender===courseContents()?{courseId:C.COURSE_ID,url:C.COURSE_URL,minLessons:C.MIN_LESSONS,minMinutes:C.MIN_SECONDS/60}:null;});
  ipcMain.handle('zhs-status',event=>{if(!trusted(event))throw Error('Untrusted window');return status();});
  ipcMain.handle('zhs-open',event=>{
    if(!trusted(event))throw Error('Untrusted window');
    const atHomepage=hasCourse()&&!scoreRequested&&courseHomepage(courseContents().getURL());
    open();
    if(atHomepage)returnToCourse();
    return status();
  });
  ipcMain.handle('zhs-open-score',event=>{if(!trusted(event))throw Error('Untrusted window');return openScore();});
  ipcMain.handle('zhs-refresh',event=>{
    if(!trusted(event))throw Error('Untrusted window');
    if(hasCourse())courseContents().reload();
    return status();
  });
  ipcMain.handle('zhs-close',event=>{if(!trusted(event))throw Error('Untrusted window');return close();});
  ipcMain.handle('zhs-pane-width',(event,width)=>{
    if(!trusted(event)||!Number.isFinite(width))throw Error('Invalid pane width');
    const [clientWidth]=hostWindow.getContentSize();
    sidebarWidth=Math.round(Math.min(480,Math.max(300,Math.min(width,clientWidth-724))));
    layout();
    return sidebarWidth;
  });
  ipcMain.handle('zhs-command',(event,type)=>{if(!trusted(event)||!['START','PAUSE','END'].includes(type))throw Error('Invalid command');return command(type);});
  ipcMain.handle('zhs-enable',(event,enabled)=>{if(!trusted(event)||typeof enabled!=='boolean')throw Error('Invalid setting');update({enabled});if(enabled)checkDue();return status();});
  ipcMain.handle('zhs-platform-review',event=>{if(!trusted(event))throw Error('Untrusted window');return review(true);});
  ipcMain.handle('zhs-storage-get',(event,keys)=>{
    if(!trustedCourse(event))throw Error('Untrusted course page');
    const saved=read(),names=Array.isArray(keys)?keys:[keys];
    return Object.fromEntries(names.filter(key=>key==='dailyState').map(key=>[key,saved[key]]));
  });
  ipcMain.on('zhs-auth-restore',(event,origin)=>{
    event.returnValue=trustedOfficial(event,origin)?auth.restore(origin):[];
  });
  ipcMain.on('zhs-auth-snapshot',(event,payload)=>{
    event.returnValue=!!payload&&trustedOfficial(event,payload.origin)&&
      auth.snapshot(payload.origin,payload.entries);
  });
  ipcMain.handle('zhs-storage-set',(event,value)=>{
    if(!trustedCourse(event)||!value||Object.keys(value).some(key=>key!=='dailyState'))throw Error('Invalid storage write');
    update(value);return null;
  });
  ipcMain.handle('zhs-runtime-message',async(event,message)=>{
    if(!trustedCourse(event)||!message||typeof message.type!=='string')throw Error('Untrusted course page');
    if(message.type==='IS_OWNER')return {owner:true};
    if(message.type==='CLICK_DIAGNOSTIC'){
      const rect=value=>Array.isArray(value)?value.slice(0,4).map(n=>Number.isFinite(n)?Math.max(-100000,Math.min(100000,Math.round(n))):null):[];
      const tag=value=>/^[A-Z]{1,15}$/.test(value||'')?value:'';
      const overflow=value=>['visible','hidden','clip','auto','scroll'].includes(value)?value:'';
      const diagnostic={at:new Date().toISOString(),kind:['chapter','lesson','reminder','quiz-option','quiz-submit','quiz-close'].includes(message.kind)?message.kind:'',exposed:message.exposed===true,
        target:{tag:tag(message.target?.tag),rect:rect(message.target?.rect)},clipped:rect(message.clipped),
        hit:{tag:tag(message.hit?.tag),related:message.hit?.related===true},
        ancestors:Array.isArray(message.ancestors)?message.ancestors.slice(0,10).map(item=>({tag:tag(item.tag),rect:rect(item.rect),overflowX:overflow(item.overflowX),overflowY:overflow(item.overflowY)})):[]};
      try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(path.join(path.dirname(file),'click-diagnostic.json'),JSON.stringify(diagnostic),'utf8');}catch{}
      return {ok:true};
    }
    if(message.type==='PLAYBACK_DIAGNOSTIC'){
      const diagnostic={at:new Date().toISOString(),
        lessonId:/^\d+\.\d+$/.test(message.lessonId||'')?message.lessonId:null,
        selectedLessonId:/^\d+\.\d+$/.test(message.selectedLessonId||'')?message.selectedLessonId:null,
        selectionConfirmed:message.selectionConfirmed===true,
        readyState:Number.isInteger(message.readyState)&&message.readyState>=0&&message.readyState<=4?message.readyState:null,
        time:Number.isFinite(message.time)&&message.time>=0?Math.round(message.time):null,
        duration:Number.isFinite(message.duration)&&message.duration>=0?Math.round(message.duration):null,
        errorCode:[0,1,2,3,4].includes(message.errorCode)?message.errorCode:null,
        paused:message.paused===true,hidden:message.hidden===true};
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(path.join(path.dirname(file),'playback-diagnostic.json'),JSON.stringify(diagnostic),'utf8');
      return {ok:true};
    }
    if(message.type==='QUIZ_DIAGNOSTIC'){
      const bounded=value=>Number.isInteger(value)&&value>=0&&value<=100?value:null;
      const diagnostic={at:new Date().toISOString(),parserVersion:3,
        reason:['missing-type','unsupported-type','missing-question','invalid-option-count','recognized'].includes(message.reason)?message.reason:'invalid',
        optionCount:bounded(message.optionCount),controlCount:bounded(message.controlCount)};
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(path.join(path.dirname(file),'quiz-parser-diagnostic.json'),JSON.stringify(diagnostic),'utf8');
      return {ok:true};
    }
    if(message.type==='INPUT_FOCUS'){
      if(read().dailyState?.status!=='running')return {epoch:null};
      if(!backgroundInput){hostWindow.show();hostWindow.focus();courseContents().focus();}
      return {epoch:inputEpoch};
    }
    if(message.type==='INPUT_CLICK'){
      const kinds=['chapter','lesson','reminder','quiz-option','quiz-submit','quiz-close'];
      const point=inputPoint(message,paneBounds,paneZoom);
      const invalid=read().dailyState?.status!=='running'||message.epoch!==inputEpoch||
        !kinds.includes(message.kind)||typeof message.actionId!=='string'||message.actionId.length>32||
        inputActions.has(message.actionId)||!paneBounds||
        !Number.isInteger(message.x)||!Number.isInteger(message.y)||
        !point;
      if(invalid)return {accepted:false,reason:'页面或输入目标已变化，请恢复后重试'};
      inputActions.add(message.actionId);
      const contents=courseContents();
      if(!backgroundInput){hostWindow.show();hostWindow.focus();contents.focus();}
      contents.sendInputEvent({type:'mouseMove',...point});
      contents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
      contents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
      trace.record('input-action',contents.getURL(),{action:message.kind,result:'sent'});
      return {accepted:true};
    }
    if(message.type==='INPUT_RESULT'){
      trace.record('input-result',courseContents().getURL(),{action:message.kind,result:message.result});
      return {ok:true};
    }
    if(message.type==='PAGE_READY'){
      if(!awaitingReady||!/^\d+\.\d+$/.test(message.lessonId||''))return {resumed:false};
      const current=read().dailyState;
      if(current?.day!==C.dayKey()||current.status!=='blocked'||!/^课程(?:页面|窗口)已离开|^正在返回.+课程|^自动返回.+课程|^智慧树登录已失效/.test(current.blockedReason||''))return {resumed:false};
      awaitingReady=false;
      update({dailyState:{...current,status:'running',blockedReason:null}});
      trace.record('page-ready',courseContents().getURL());
      courseContents().send('zhs-command',{type:'START'});
      return {resumed:true};
    }
    if(message.type==='NOTIFY'){notice(String(message.message||'').slice(0,180));return {ok:true};}
    if(message.type==='ANSWER')return message.questionType==='multi'?
      answerTyped?.({type:'multi',question:message.question,options:message.options})||{error:'unsupported-type'}:
      answer({question:message.question,options:message.options});
    throw Error('Invalid message');
  });
  checkDue();schedule();
  void review(false);
  platformTimer=setInterval(()=>{checkDue();void review(false);},3600_000);
  hostWindow.on('closed',()=>{close();});
  return {open,openScore,close,status,command,review,setExpanded:value=>{courseExpanded=value;inputEpoch++;layout();},stop:()=>{clearTimeout(timer);clearInterval(platformTimer);close();}};
}

module.exports={createZhihuishuStudy,coursePage,nextSix};
