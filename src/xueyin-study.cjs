const fs=require('node:fs');
const path=require('node:path');
const X=require('./xueyin-core.cjs');
const {createAuthSession}=require('./auth-session.cjs');
const {recognizeQuizImages}=require('./quiz-ocr.cjs');
const {createAtomicState}=require('./atomic-state.cjs');
const {previewLayout}=require('./course-preview.cjs');

function createXueyinStudy({WebContentsView,hostWindow,ipcMain,Notification,safeStorage,data,trusted,
  courseSession,answer,claimCourse,mayuanStatus,profile=null}){
  const courseLabel=profile?.name||'学习通',loginReason=`请在右侧登录并进入${profile?.name||'学习通'}课程`;
  const dir=path.join(data,'xueyin-study'),stateFile=path.join(dir,'state.json');
  const linkFile=path.join(dir,'course-url.bin');
  const auth=createAuthSession(path.join(dir,'auth-session.bin'),safeStorage,X.allowedOrigin);
  let view=null,sidebarWidth=360,timer=null,seenTarget=false,playbackObservation=null,
    lastMediaFailure='',courseExpanded=false,documentDebuggerOwned=false;
  const hasView=()=>!!view&&!view.webContents.isDestroyed();
  const contents=()=>hasView()?view.webContents:null;
  const sendCommand=message=>{
    if(!hasView())return;
    contents().send('xy-command',message);
    const main=contents().mainFrame;
    for(const frame of main?.framesInSubtree||[])if(frame!==main){
      try{frame.send('xy-command',message);}catch{}
    }
  };
  const storage=createAtomicState(stateFile,X.emptyState,{onFailure:()=>{
    sendCommand({type:'PAUSE'});
    notice('学习状态无法保存，任务已暂停。请释放磁盘空间后恢复。');
  }});
  const read=storage.read,write=storage.write;
  const update=patch=>write({...read(),...patch});
  const config=()=>{try{
    if(!safeStorage.isEncryptionAvailable())return null;
    return X.validateLaunchURL(safeStorage.decryptString(fs.readFileSync(linkFile)));
  }catch{return null;}};
  const status=()=>{const state=read();return {...state,configured:!!config(),windowOpen:hasView(),courseExpanded,
    playbackObservation:playbackObservation&&Date.now()-playbackObservation.receivedAt<5000?
      playbackObservation:null,
    courseOnTarget:!!(hasView()&&seenTarget&&config()&&X.isStudyPage(contents().getURL(),config().identity))};};
  const layout=()=>{if(!hasView()||hostWindow.isDestroyed())return;
    const preview=previewLayout(hostWindow.getContentSize(),sidebarWidth,courseExpanded);
    view.setBounds(preview.bounds);contents().setZoomFactor?.(preview.zoom);
  };
  hostWindow.on('resize',layout);
  const notice=message=>{if(Notification.isSupported())new Notification({title:`${profile?.name||'学习通'}学习`,body:message}).show();};
  const trustedFrame=event=>{
    try{return event.sender===contents()&&X.allowedOrigin(new URL(event.senderFrame.url).origin);}catch{return false;}
  };
  const trustedCourse=event=>{
    try{
      if(!seenTarget||!trustedFrame(event)||
        !X.isStudyPage(event.sender.mainFrame.url,config()?.identity||{}))return false;
      if(event.senderFrame===event.sender.mainFrame)return true;
      const chain=[];let frame=event.senderFrame;
      while(frame&&frame!==event.sender.mainFrame&&chain.length<5){
        const url=new URL(frame.url);
        if(!X.allowedOrigin(url.origin))return false;
        chain.unshift(url);frame=frame.parent;
      }
      if(frame!==event.sender.mainFrame)return false;
      if(chain[0]?.pathname==='/mooc2-ans/mycourse/studentcourse'){
        if(chain[0].origin!==new URL(event.sender.mainFrame.url).origin)return false;
        chain.shift();
      }
      const paths=chain.map(url=>url.pathname);
      return paths.length===0||
        ['/mooc-ans/knowledge/cards',
          '/mooc-ans/knowledge/cards,/ananas/modules/work/index.html',
          '/mooc-ans/knowledge/cards,/ananas/modules/work/index.html,/mooc-ans/work/doHomeWorkNew',
          '/mooc-ans/knowledge/cards,/ananas/modules/work/index.html,/mooc-ans/work/selectWorkQuestionYiPiYue']
          .includes(paths.join(','));
    }catch{return false;}
  };
  const open=()=>{
    const target=config();
    if(!target)throw Error(`请先在设置中保存${courseLabel}课程链接`);
    claimCourse?.('xueyin');
    if(hasView()){hostWindow.show();hostWindow.focus();return view;}
    seenTarget=false;playbackObservation=null;lastMediaFailure='';
    update({pageDiagnostics:{}});
    view=new WebContentsView({webPreferences:{preload:path.join(__dirname,'xueyin-preload-bundle.cjs'),
      partition:'persist:xueyin',contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:true,sandbox:false}});
    view.webContents.setAudioMuted?.(true);
    hostWindow.contentView.addChildView(view);layout();
    const targetView=view;
    view.webContents.setWindowOpenHandler(({url})=>{
      try{const parsed=new URL(url);if(X.isOfficialHost(parsed.hostname)&&parsed.protocol==='https:')
        void targetView.webContents.loadURL(url).catch(()=>{});
      else if(parsed.protocol==='https:')void require('electron').shell.openExternal(url);
      }catch{}
      return {action:'deny'};
    });
    view.webContents.on('will-navigate',(event,url)=>{try{if(new URL(url).protocol!=='https:')event.preventDefault();}catch{event.preventDefault();}});
    view.webContents.on('did-finish-load',()=>{
      if(!hasView()||view!==targetView)return;
      targetView.webContents.setAudioMuted?.(true);
      layout();
      const current=config(),url=contents().getURL();
      const previousPath=read().pageDiagnostics?.currentPage?.path;
      try{const parsed=new URL(url);update({pageDiagnostics:{...(read().pageDiagnostics||{}),
        currentPage:{host:parsed.hostname,path:parsed.pathname.slice(0,120),
          courseIdMatches:parsed.searchParams.get('courseid')===current?.identity.courseid||
            parsed.searchParams.get('courseId')===current?.identity.courseid,
          clazzIdMatches:parsed.searchParams.get('clazzid')===current?.identity.clazzid||
            parsed.searchParams.get('clazzId')===current?.identity.clazzid}}});}catch{}
      const challenge=(()=>{try{return new URL(url).pathname==='/antispiderShowVerify.ac';}
        catch{return false;}})();
      const accountError=(()=>{try{return new URL(url).pathname==='/mooc-ans/mycourse/changeCapter';}
        catch{return false;}})();
      if(challenge){
        if(read().status==='running')update({status:'blocked',
          blockedReason:'学习通要求图形验证码，请在右侧手动完成验证'});
      }else if(accountError){
        if(read().status==='running')update({status:'blocked',
          blockedReason:'学习通页面显示“用户不存在”；请重新进入课程并检查登录'});
      }else if(current&&X.isStudyPage(url,current.identity)){
        if(new URL(url).searchParams.get('courseid')===current.identity.courseid)seenTarget=true;
        const state=read();
        if(state.status==='blocked'&&state.blockedReason===loginReason){
          if(previousPath==='/antispiderShowVerify.ac')
            update({blockedReason:'学习通要求图形验证码，请在右侧手动完成验证'});
          else if(previousPath==='/mooc-ans/mycourse/changeCapter')
            update({blockedReason:'学习通页面显示“用户不存在”；请重新进入课程并检查登录'});
          else update({status:'running',blockedReason:null});
        }
        if(read().status==='running')sendCommand({type:'RUN'});
      }else if(read().status==='running')update({status:'blocked',blockedReason:loginReason});
    });
    view.webContents.on('preload-error',()=>{
      update({pageDiagnostics:{...(read().pageDiagnostics||{}),preloadError:true}});
    });
    view.webContents.on('destroyed',()=>{
      if(view!==targetView)return;view=null;
      if(read().status==='running')update({status:'interrupted',blockedReason:'课程页面已关闭'});
    });
    void view.webContents.loadURL(target.url).catch(()=>{
      if(read().status==='running')update({status:'blocked',blockedReason:'课程页面加载失败'});
    });
    return view;
  };
  const close=()=>{
    if(!hasView())return status();
    const old=view;view=null;seenTarget=false;
    if(!hostWindow.isDestroyed())hostWindow.contentView.removeChildView(old);
    if(documentDebuggerOwned){try{old.webContents.debugger.detach();}catch{}documentDebuggerOwned=false;}
    old.webContents.close();
    if(read().status==='running')update({status:'interrupted',blockedReason:'课程页面已关闭'});
    return status();
  };
  const command=type=>{
    const current=read();
    if(type==='RUN'){
      if(!storage.recover())return status();
      if(!config())throw Error(`请先在设置中保存${courseLabel}课程链接`);
      if(current.submissionIntent)throw Error('上次测验提交结果未确认，请先核对');
      if(current.status==='complete')return status();
      if(mayuanStatus?.().dailyState?.status==='running')throw Error('智慧树每日任务正在运行');
      update({status:'running',blockedReason:null,day:X.localDay(),startedAt:current.startedAt||new Date().toISOString(),
        ...(current.status==='blocked'&&current.awaitingPlatform?{
          awaitingPlatform:{...current.awaitingPlatform,verificationOpened:false,returnedAt:new Date().toISOString()}}:{})});
      if(storage.failed())return status();
      const target=open();
      if(X.isStudyPage(target.webContents.getURL(),config().identity))sendCommand({type});
    }else if(type==='PAUSE'||type==='END'){
      update({status:type==='PAUSE'?'paused':'ended',blockedReason:null});
      sendCommand({type});
    }
    return status();
  };
  const preempt=()=>{
    if(read().status==='running'){
      update({status:'interrupted',blockedReason:'智慧树每日任务优先'});
      sendCommand({type:'PAUSE'});
    }
    close();
  };
  const checkDue=()=>{
    const state=read(),mayuanSnapshot=mayuanStatus?.(),mayuan=mayuanSnapshot?.dailyState;
    if(X.localHour()>=6&&mayuanSnapshot?.enabled&&mayuan?.status==='idle'){
      if(state.status==='running')preempt();
      return;
    }
    if(X.shouldAutoRun(state,mayuan)&&config()){
      if(state.status!=='running')try{command('RUN');}catch{}
      else if(!hasView())try{open();}catch{}
    }
  };
  ipcMain.handle('xy-status',event=>{if(!trusted(event))throw Error('Untrusted window');return status();});
  ipcMain.handle('xy-course-url-save',(event,value)=>{
    if(!trusted(event))throw Error('Untrusted window');
    const parsed=X.validateLaunchURL(value);
    const previous=config();
    if(previous&&JSON.stringify(previous.identity)!==JSON.stringify(parsed.identity))throw Error('课程身份不同，请新增课程以保留原有记录');
    if(!safeStorage.isEncryptionAvailable())throw Error('本机加密存储不可用');
    fs.mkdirSync(dir,{recursive:true});
    const pending=linkFile+'.pending';fs.writeFileSync(pending,safeStorage.encryptString(parsed.url));
    fs.renameSync(pending,linkFile);return status();
  });
  ipcMain.handle('xy-open',event=>{if(!trusted(event))throw Error('Untrusted window');open();return status();});
  ipcMain.handle('xy-close',event=>{if(!trusted(event))throw Error('Untrusted window');return close();});
  ipcMain.handle('xy-refresh',event=>{if(!trusted(event))throw Error('Untrusted window');if(hasView())contents().reload();return status();});
  ipcMain.handle('xy-command',(event,type)=>{if(!trusted(event)||!['RUN','PAUSE','END'].includes(type))throw Error('Invalid command');return command(type);});
  ipcMain.handle('xy-enable',(event,enabled)=>{if(!trusted(event)||typeof enabled!=='boolean')throw Error('Invalid setting');update({enabled});if(enabled)checkDue();return status();});
  ipcMain.handle('xy-pane-width',(event,width)=>{
    if(!trusted(event)||!Number.isFinite(width))throw Error('Invalid pane width');
    const [clientWidth]=hostWindow.getContentSize();
    sidebarWidth=Math.round(Math.min(480,Math.max(300,Math.min(width,clientWidth-724))));layout();return sidebarWidth;
  });
  ipcMain.on('xy-auth-restore',(event,origin)=>{event.returnValue=trustedFrame(event)&&origin===new URL(event.senderFrame.url).origin?auth.restore(origin):[];});
  ipcMain.on('xy-auth-snapshot',(event,payload)=>{event.returnValue=!!payload&&trustedFrame(event)&&
    payload.origin===new URL(event.senderFrame.url).origin&&auth.snapshot(payload.origin,payload.entries);});
  ipcMain.on('xy-diagnostic',(event,phase)=>{
    if(!trustedFrame(event))return;
    const main=event.senderFrame===event.sender.mainFrame;
    if(['preload-main','attach-start','attach-done','attach-failed','content-entry','state-ready'].includes(phase)){
      if(main)update({pageDiagnostics:{...(read().pageDiagnostics||{}),[phase]:true}});
      return;
    }
    if(!['bootstrap-running','bootstrap-idle','tick-active','tick-idle','tick-skipped'].includes(phase))return;
    const controller=main?'main':'child';
    const path=new URL(event.senderFrame.url).pathname.slice(0,100);
    const prior=read().pageDiagnostics||{};
    update({pageDiagnostics:{...prior,controllers:{...(prior.controllers||{}),
      [controller]:{phase,path,at:new Date().toISOString()}}}});
  });
  ipcMain.on('xy-diagnostic-error',(event,detail)=>{
    if(!trustedFrame(event)||event.senderFrame!==event.sender.mainFrame)return;
    if(!detail||typeof detail.name!=='string'||typeof detail.message!=='string')return;
    update({pageDiagnostics:{...(read().pageDiagnostics||{}),attachError:
      `${detail.name.slice(0,40)}: ${detail.message.slice(0,180)}`,
      attachFrame:typeof detail.frame==='string'?detail.frame.slice(0,80):''}});
  });
  ipcMain.on('xy-catalog-diagnostic',(event,detail)=>{
    if(!trustedCourse(event)||!detail||typeof detail!=='object')return;
    if(detail.runtimeError&&typeof detail.runtimeError==='object'){
      const error=detail.runtimeError;
      update({pageDiagnostics:{...(read().pageDiagnostics||{}),runtimeError:{
        name:String(error.name||'Error').slice(0,40),
        message:String(error.message||'unknown').slice(0,120),
        frame:String(error.frame||'').slice(0,80),
      }}});
      return;
    }
    const samples=Array.isArray(detail.samples)?detail.samples.slice(0,8).map(item=>({
      tag:String(item.tag||'').slice(0,16),classes:String(item.classes||'').slice(0,100),
      width:Number(item.width)||0,height:Number(item.height)||0,
      lines:Number(item.lines)||0,chars:Number(item.chars)||0,visible:!!item.visible,
      start:String(item.start||'').slice(0,90),
    })):[];
    const rows=Array.isArray(detail.rows)?detail.rows.slice(0,8).map(item=>({
      id:String(item.id||'').slice(0,10),quiz:!!item.quiz,
      pending:Number.isInteger(item.pending)?item.pending:null,active:!!item.active,
      start:String(item.start||'').slice(0,90),
    })):[];
    update({pageDiagnostics:{...(read().pageDiagnostics||{}),catalog:{
      documentReading:detail.documentReading?{
        stage:['idle','loading','browsing','waiting','complete','unsupported','unconfirmed','stalled'].includes(detail.documentReading.stage)?detail.documentReading.stage:null,
        reason:['resource-loading','resource-timeout','reader-frame-timeout','chapter-frame-timeout'].includes(detail.documentReading.reason)?detail.documentReading.reason:null,
        index:Number.isInteger(detail.documentReading.index)?Math.min(63,Math.max(0,detail.documentReading.index)):null,
        total:Number.isInteger(detail.documentReading.total)?Math.min(64,Math.max(0,detail.documentReading.total)):null,
      }:null,
      candidateCount:Number(detail.candidateCount)||0,sectionInBody:!!detail.sectionInBody,
      iframeCount:Number(detail.iframeCount)||0,videoCount:Number(detail.videoCount)||0,
      iframes:Array.isArray(detail.iframes)?detail.iframes.slice(0,4).map(item=>({
        host:String(item.host||'').slice(0,100),path:String(item.path||'').slice(0,100)})):[],samples,rows,
      cards:Array.isArray(detail.cards)?detail.cards.slice(0,8).map(item=>({
        complete:!!item.complete,top:Number(item.top)||0,hasMedia:!!item.hasMedia,
        mediaTag:['VIDEO','IFRAME'].includes(item.mediaTag)?item.mediaTag:''})):[],
      media:Array.isArray(detail.media)?detail.media.slice(0,8).map(item=>({
        tag:['VIDEO','IFRAME'].includes(item.tag)?item.tag:'',top:Number(item.top)||0})):[],
      frames:Array.isArray(detail.frames)?detail.frames.slice(0,8).map(item=>({
        top:Number(item.top)||0,width:Number(item.width)||0,reported:!!item.reported,
        cardCount:Number(item.cardCount)||0,pending:Number(item.pending)||0,
        media:Array.isArray(item.media)?item.media.slice(0,8).map(Boolean):[],
        host:String(item.host||'').slice(0,100),path:String(item.path||'').slice(0,100),
        childFrames:Number(item.childFrames)||0,
        position:Number.isFinite(item.position)?Math.min(Math.max(item.position,0),86400):null,
        paused:typeof item.paused==='boolean'?item.paused:null,
        rate:Number.isFinite(item.rate)?item.rate:null,
        playError:['NotAllowedError','NotSupportedError','AbortError','other'].includes(item.playError)?item.playError:null,
        startAttempts:Number.isInteger(item.startAttempts)?Math.min(Math.max(item.startAttempts,0),3):0,
        childVideoStatusAge:Number.isFinite(item.childVideoStatusAge)?
          Math.min(Math.max(item.childVideoStatusAge,0),86400000):null,
        children:Array.isArray(item.children)?item.children.slice(0,6).map(child=>({
          host:String(child.host||'').slice(0,100),path:String(child.path||'').slice(0,100),
          top:Number(child.top)||0,width:Number(child.width)||0,
        })):[],
        markerSamples:Array.isArray(item.markerSamples)?item.markerSamples.slice(0,8).map(sample=>({
          text:String(sample.text||'').slice(0,50),tag:String(sample.tag||'').slice(0,15),
          className:String(sample.className||'').slice(0,60),top:Number(sample.top)||0,
        })):[],
      })):[],quiz:detail.quiz&&typeof detail.quiz==='object'?{
        section:String(detail.quiz.section||'').slice(0,10),
        hasQuizTitle:!!detail.quiz.hasQuizTitle,hasPending:!!detail.quiz.hasPending,
        markerCount:Number(detail.quiz.markerCount)||0,
        readableDocuments:Number(detail.quiz.readableDocuments)||0,
        documents:Array.isArray(detail.quiz.documents)?detail.quiz.documents.slice(0,4)
          .map(doc=>({intro:String(doc.intro||'').slice(0,180),
            headingSamples:Array.isArray(doc.headingSamples)?doc.headingSamples.slice(0,8)
              .map(sample=>({tag:String(sample.tag||'').slice(0,15),
                classes:String(sample.classes||'').slice(0,60),
                text:String(sample.text||'').slice(0,100)})):[]})):[],
        buttonLabels:Array.isArray(detail.quiz.buttonLabels)?detail.quiz.buttonLabels.slice(0,6)
          .map(value=>String(value).slice(0,20)):[],
      }:null}}});
  });
  ipcMain.on('xy-playback-observation',(event,detail)=>{
    if(!trustedCourse(event)||!detail||typeof detail.playing!=='boolean')return;
    const position=detail.positionSeconds,duration=detail.durationSeconds;
    const bounded=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max?value:null;
    playbackObservation={playing:detail.playing,
      issue:['download-failed','playback-failed','stalled','media-error'].includes(detail.issue)?detail.issue:null,
      positionSeconds:Number.isFinite(position)&&position>=0?Math.min(position,86400):null,
      durationSeconds:Number.isFinite(duration)&&duration>0?Math.min(duration,86400):null,
      mediaErrorCode:bounded(detail.mediaErrorCode,1,4),
      readyState:bounded(detail.readyState,0,4),networkState:bounded(detail.networkState,0,3),
      receivedAt:Date.now()};
    if(playbackObservation.issue){
      const failure={issue:playbackObservation.issue,mediaErrorCode:playbackObservation.mediaErrorCode,
        readyState:playbackObservation.readyState,networkState:playbackObservation.networkState};
      const fingerprint=JSON.stringify(failure);
      if(fingerprint!==lastMediaFailure){lastMediaFailure=fingerprint;
        update({pageDiagnostics:{...(read().pageDiagnostics||{}),mediaFailure:{...failure,at:new Date().toISOString()}}});}
    }
  });
  ipcMain.handle('xy-state-get',event=>{
    if(!trustedCourse(event)){
      if(trustedFrame(event)){
        const paths=[];let frame=event.senderFrame;
        while(frame&&paths.length<6){
          try{paths.unshift(new URL(frame.url).pathname.slice(0,100));}catch{paths.unshift('[invalid]');}
          if(frame===event.sender.mainFrame)break;
          frame=frame.parent;
        }
        update({pageDiagnostics:{...(read().pageDiagnostics||{}),stateRejected:true,
          rejectedFramePaths:paths}});
      }
      throw Error('Untrusted course page');
    }
    if(event.senderFrame===event.sender.mainFrame&&read().currentIsQuiz){
      const frames=[event.sender.mainFrame,...(event.sender.mainFrame.framesInSubtree||[])];
      const frameTree=[...new Set(frames)].slice(0,24).map(frame=>{
        const describe=value=>{try{const url=new URL(value);return {
          host:url.hostname.slice(0,80),path:url.pathname.slice(0,100)};}
        catch{return {host:'',path:'[invalid]'};}};
        return {...describe(frame.url),parent:frame.parent?describe(frame.parent.url).path:null};
      });
      const prior=read().pageDiagnostics||{};
      if(JSON.stringify(prior.frameTree)!==JSON.stringify(frameTree))
        update({pageDiagnostics:{...prior,frameTree}});
    }
    update({pageDiagnostics:{...(read().pageDiagnostics||{}),stateAccepted:true}});
    return {...read(),configuredChapterCount:profile?.expectedChapters||0};
  });
  ipcMain.handle('xy-state-update',(event,patch)=>{
    if(!trustedCourse(event)||!patch||typeof patch!=='object')throw Error('Invalid state update');
    const allowed=['status','blockedReason','currentSection','currentTask','currentIsQuiz','platformDone','platformTotal',
      'completedTaskIds','submittedQuizzes','quizStatuses','submissionIntent','lastObservedAt','quizScanComplete','sectionPending','expectedChapterCount'];
    allowed.push('awaitingPlatform');
    if(Object.keys(patch).some(key=>!allowed.includes(key)))throw Error('Invalid state fields');
    if(patch.status!==undefined&&!['running','blocked','complete','submitting'].includes(patch.status))throw Error('Invalid status');
    if(patch.platformDone!==undefined&&(!Number.isInteger(patch.platformDone)||patch.platformDone<0||patch.platformDone>10000))throw Error('Invalid count');
    if(patch.platformTotal!==undefined&&(!Number.isInteger(patch.platformTotal)||patch.platformTotal<0||patch.platformTotal>10000))throw Error('Invalid total');
    if(JSON.stringify(patch).length>12000)throw Error('State update too large');
    if(patch.status==='complete'&&(!Number.isInteger(patch.platformDone)||
      patch.platformDone!==patch.platformTotal||patch.quizScanComplete!==true))
      throw Error('Full completion needs platform task and quiz confirmation');
    return update(patch);
  });
  let lastDocumentWheelAt=0;
  ipcMain.handle('xy-playback-recover',(event,detail)=>{
    const current=read();
    if(!trustedCourse(event)||event.senderFrame!==contents().mainFrame||
      current.status!=='running'||current.currentIsQuiz||current.submissionIntent||current.awaitingPlatform||
      !/^\d+\.\d+\/video\/\d+$/.test(current.currentTask||'')||
      !current.currentTask.startsWith(`${current.currentSection}/video/`)||
      detail?.taskId!==current.currentTask||!Number.isFinite(detail.positionSeconds)||
      detail.positionSeconds<0||detail.positionSeconds>86400)return {accepted:false};
    const day=X.localDay(),previous=current.playbackRecovery;
    const same=previous?.day===day&&previous.taskId===current.currentTask;
    const attempts=same&&Number.isInteger(previous.attempts)?Math.max(0,previous.attempts):0;
    if(attempts>=2)return {accepted:false,reason:'exhausted'};
    if(same&&Date.now()-Date.parse(previous.at)<60000)return {accepted:false,reason:'cooldown'};
    update({playbackRecovery:{day,taskId:current.currentTask,attempts:attempts+1,
      at:new Date().toISOString(),positionSeconds:Math.round(detail.positionSeconds)}});
    if(storage.failed())return {accepted:false};
    // Reload through the platform's normal entry. Never seek or award progress.
    try{contents().reload();return {accepted:true};}
    catch{return {accepted:false,reason:'reload-failed'};}
  });
  ipcMain.handle('xy-document-scroll',async(event,detail)=>{
    if(!trustedCourse(event)||event.senderFrame!==contents().mainFrame||
      read().status!=='running'||!/\/document\/\d+$/.test(read().currentTask||''))return {accepted:false};
    const {x,y,amount}=detail||{},zoom=contents().getZoomFactor()||1,bounds=view.getBounds();
    if(![x,y,amount].every(Number.isFinite)||x<0||y<0||x>=bounds.width/zoom||y>=bounds.height/zoom||
      amount<=0||amount>1000||Date.now()-lastDocumentWheelAt<1500)return {accepted:false};
    lastDocumentWheelAt=Date.now();
    const debuggerApi=contents().debugger;
    if(!debuggerApi.isAttached()){debuggerApi.attach('1.3');documentDebuggerOwned=true;}
    await debuggerApi.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    if(read().status!=='running')return {accepted:false};
    await debuggerApi.sendCommand('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY:amount*zoom});
    return {accepted:true};
  });
  ipcMain.handle('xy-document-return',async event=>{
    const current=read(),target=config();
    if(!trustedCourse(event)||event.senderFrame!==contents().mainFrame||!target||current.status!=='running'||
      !/\/(?:document|video)\/\d+$/.test(current.awaitingPlatform?.taskId||'')||
      current.awaitingPlatform.section!==current.currentSection)return {accepted:false};
    if(documentDebuggerOwned){try{contents().debugger.detach();}catch{}documentDebuggerOwned=false;}
    await contents().loadURL(target.url);
    return {accepted:true};
  });
  ipcMain.handle('xy-answer',async(event,question)=>{if(!trustedCourse(event))throw Error('Untrusted course page');return answer(question);});
  ipcMain.handle('xy-quiz-ocr',async(event,images)=>{
    if(!trustedCourse(event)||new URL(event.senderFrame.url).pathname!=='/mooc-ans/work/doHomeWorkNew')
      throw Error('Untrusted quiz page');
    return recognizeQuizImages(images);
  });
  ipcMain.handle('xy-resolve-submission',(event,outcome)=>{
    if(!trusted(event)||!['submitted','not-submitted'].includes(outcome))throw Error('Invalid outcome');
    const current=read(),id=current.submissionIntent?.section;
    if(!id)throw Error('没有待核对的提交');
    if(outcome==='submitted')update({submissionIntent:null,status:'paused',blockedReason:null,
      submittedQuizzes:[...new Set([...(current.submittedQuizzes||[]),id])],
      quizStatuses:{...(current.quizStatuses||{}),[id]:'submitted'}});
    else update({submissionIntent:null,status:'paused',blockedReason:null});
    return status();
  });
  ipcMain.handle('xy-notify',(event,message)=>{if(!trustedCourse(event))throw Error('Untrusted course page');notice(String(message||'').slice(0,180));return true;});
  timer=setInterval(checkDue,30000);
  checkDue();
  hostWindow.on('closed',()=>close());
  return {open,close,command,preempt,checkDue,status,setExpanded:value=>{courseExpanded=value;layout();},stop:()=>{clearInterval(timer);close();}};
}
module.exports={createXueyinStudy};
