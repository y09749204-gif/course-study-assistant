const {app,BrowserWindow,WebContentsView,ipcMain,Notification,safeStorage,session,screen}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {createZhihuishuStudy}=require('./study.cjs');
const {createXueyinStudy}=require('./xueyin-study.cjs');
const {answerAssessment:answerAssessmentQuestion}=require('./assessment-ai.cjs');
const X=require('./xueyin-core.cjs');
const {createProfiles,createCourseRuntime}=require('./course-profiles.cjs');
const {createSessionCookieBackup}=require('./session-cookies.cjs');
const {createLifecycleLog}=require('./lifecycle-log.cjs');
const {createAssessmentCache}=require('./assessment-cache.cjs');
const {answerCodex}=require('./codex-assessment.cjs');

const {runtimeData}=require('./runtime-data.cjs');
const runtime=runtimeData({appData:app.getPath('appData'),root:path.join(__dirname,'..')});
const isolatedData=runtime.isolated?runtime.directory:null;
app.setName(isolatedData?'网课学习助手（开发）':'网课学习助手');
if(isolatedData)fs.mkdirSync(isolatedData,{recursive:true});
// Only an explicit diagnostic launch opens a loopback CDP endpoint for REA.
if(process.argv.includes('--rea-diagnostics')){
  const port=Number(process.env.ZH_REA_PORT||9339);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid diagnostic port');
  app.commandLine.appendSwitch('remote-debugging-address','127.0.0.1');
  app.commandLine.appendSwitch('remote-debugging-port',String(port));
}
app.setPath('userData',runtime.directory);
fs.mkdirSync(runtime.directory,{recursive:true});
app.setPath('sessionData',runtime.directory);
const gotLock=app.requestSingleInstanceLock();
let dashboard=null,controller=null,environmentController=null,cookieBackup=null,xyCookieBackup=null,cookieTimer=null,cookieWatchers=[],storageFlushed=false,storageFlushStarted=false;
if(!gotLock) app.quit();
else {
  const lifecycle=createLifecycleLog(app.getPath('userData'),{app,version:app.getVersion()});
  app.on('second-instance',()=>{dashboard?.show();dashboard?.focus();});
  app.whenReady().then(async()=>{
    const data=app.getPath('userData');
    const courseSession=session.fromPartition('persist:course');
    const xySession=session.fromPartition('persist:xueyin');
    cookieBackup=createSessionCookieBackup(path.join(data,'zhihuishu-study','session-cookies.bin'),
      safeStorage,courseSession.cookies);
    xyCookieBackup=createSessionCookieBackup(path.join(data,'xueyin-study','session-cookies.bin'),
      safeStorage,xySession.cookies,X.allowedDomain);
    await Promise.all([cookieBackup.restore(),xyCookieBackup.restore()]);
    cookieWatchers=[cookieBackup.watch(),xyCookieBackup.watch()];
    cookieTimer=setInterval(()=>{void Promise.allSettled([cookieBackup.capture(),xyCookieBackup.capture()]);},10000);
    const aiFile=path.join(data,'ai.json');
    const trusted=event=>event.sender===dashboard?.webContents&&event.senderFrame===event.sender.mainFrame;
    const readAi=()=>{try{return JSON.parse(fs.readFileSync(aiFile,'utf8'));}catch{return {mode:'off',endpoint:'',model:''};}};
    const writeAi=value=>{
      fs.mkdirSync(data,{recursive:true});
      const pending=aiFile+'.pending';
      fs.writeFileSync(pending,JSON.stringify(value),'utf8');fs.renameSync(pending,aiFile);
    };
    const publicAi=()=>{const {mode,endpoint,model}=readAi();return {mode,endpoint,model,hasKey:!!readAi().encryptedKey};};
    if(process.argv.includes('--use-codex-plan-ai'))
      writeAi({...readAi(),mode:'codex-plan',model:'gpt-6.1-sol'});
    const answer=async ({question,options})=>{
      const config=readAi();
      if(config.mode==='codex-plan'){
        const result=await answerCodex({type:'single',question,options},config);
        return {index:result?.answer??null};
      }
      if(config.mode!=='compatible'||!config.endpoint||!config.model)return {index:null};
      const endpoint=new URL(config.endpoint);
      if(endpoint.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(endpoint.hostname))return {index:null};
      let key='';
      if(config.mode==='compatible'&&config.encryptedKey&&safeStorage.isEncryptionAvailable())
        key=safeStorage.decryptString(Buffer.from(config.encryptedKey,'base64'));
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',
        ...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({model:config.model,temperature:0,
          messages:[{role:'system',content:'Answer this single-choice question. Return only a zero-based option index as a single digit. If uncertain, return -1.'},
            {role:'user',content:JSON.stringify({question,options})}]}),signal:AbortSignal.timeout(15000)});
      if(!response.ok)return {index:null};
      const body=await response.json();
      const raw=String(body.choices?.[0]?.message?.content||'').trim();
      const index=/^-?\d+$/.test(raw)?Number(raw):null;
      return {index:Number.isInteger(index)&&index>=0&&index<options.length?index:null};
    };
    const cachedAssessmentAnswer=createAssessmentCache((input,config,key,fetchImpl,diagnose)=>
      config.mode==='codex-plan'?answerCodex(input,config,'',fetchImpl,diagnose):
        answerAssessmentQuestion(input,config,key,fetchImpl,diagnose));
    const answerAssessment=async input=>{
      const config=readAi();let key='';
      if(config.mode==='compatible'&&config.encryptedKey&&safeStorage.isEncryptionAvailable())
        key=safeStorage.decryptString(Buffer.from(config.encryptedKey,'base64'));
      let reason='invalid-answer';
      const diagnose=detail=>{
        reason=detail.reason;
        try{
          const directory=path.join(data,'xueyin-study');fs.mkdirSync(directory,{recursive:true});
          fs.writeFileSync(path.join(directory,'assessment-ai-diagnostic.json'),JSON.stringify({at:new Date().toISOString(),
            type:['single','multi','short'].includes(input.type)?input.type:null,reason,
            ...(Number.isFinite(detail.elapsedMs)?{elapsedMs:Math.max(0,Math.round(detail.elapsedMs))}:{}),
            cached:detail.cached===true,
            ...(['json-syntax','schema','answer-range','answer-type','answer-length','truncated'].includes(detail.failureKind)?{failureKind:detail.failureKind}:{}),
            ...(Number.isInteger(detail.attempt)?{attempt:detail.attempt}:{}),
            ...(['transport','quota','auth','schema','model','unknown'].includes(detail.providerFailure)?{providerFailure:detail.providerFailure}:{}),
            ...(Number.isInteger(detail.exitCode)?{exitCode:detail.exitCode}:{}),
            ...(['starting','thread-ready','requesting','answering','completed','reconnecting'].includes(detail.phase)?{phase:detail.phase}:{}),
            ...(Number.isInteger(detail.eventCount)?{eventCount:Math.min(10000,Math.max(0,detail.eventCount))}:{}),
            ...(Number.isInteger(detail.networkRetries)?{networkRetries:Math.min(10000,Math.max(0,detail.networkRetries))}:{}),
            ...(Number.isInteger(detail.outputLength)?{outputLength:detail.outputLength}:{}),
            ...(['stop','length'].includes(detail.finishReason)?{finishReason:detail.finishReason}:{}),
            ...(Number.isInteger(detail.httpStatus)?{httpStatus:detail.httpStatus}:{})}),'utf8');
        }catch{}
      };
      try{return await cachedAssessmentAnswer(input,config,key,fetch,diagnose)||{error:reason};}
      catch{diagnose({reason:'invalid-answer'});return {error:reason};}
    };
    ipcMain.handle('zhs-ai-get',event=>{if(!trusted(event))throw Error('Untrusted window');return publicAi();});
    ipcMain.handle('zhs-ai-save',(event,input)=>{
      if(!trusted(event))throw Error('Untrusted window');
      const mode=input?.mode;
      if(!['off','compatible','codex-plan'].includes(mode))throw Error('Invalid AI mode');
      const endpoint=String(input.endpoint||'').trim(),model=String(input.model||'').trim();
      if(endpoint){const url=new URL(endpoint);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error('AI endpoint must use HTTPS or localhost');}
      const old=readAi();let encryptedKey=old.encryptedKey||'';
      if(input.clearKey)encryptedKey='';
      else if(input.key){if(!safeStorage.isEncryptionAvailable())throw Error('Secure key storage unavailable');
        encryptedKey=safeStorage.encryptString(String(input.key)).toString('base64');}
      writeAi({mode,endpoint,model,encryptedKey});return publicAi();
    });
    const area=screen.getPrimaryDisplay().workArea;
    dashboard=new BrowserWindow({width:400,height:620,minWidth:360,minHeight:620,alwaysOnTop:true,
      x:Math.max(area.x,area.x+area.width-424),y:Math.max(area.y,area.y+area.height-644),title:app.getName(),
      webPreferences:{preload:path.join(__dirname,'dashboard-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false}});
    if(isolatedData)dashboard.on('page-title-updated',event=>{event.preventDefault();dashboard.setTitle(app.getName());});
    dashboard.removeMenu();
    lifecycle.watchWindow(dashboard);
    dashboard.loadFile(path.join(__dirname,'dashboard.html'));
    const claimCourse=owner=>{
      if(owner==='mayuan')environmentController?.preempt();
      else if(owner==='xueyin'){
        if(controller?.status().dailyState.status==='running')controller.command('PAUSE');
        controller?.close();
      }
    };
    const profiles=createProfiles(data,safeStorage);
    const courseRuntime=createCourseRuntime({profiles,ipcMain,host:dashboard,
      factory:(profile,scopedIpc,scopedHost)=>{
        const options={WebContentsView,hostWindow:scopedHost,ipcMain:scopedIpc,Notification,safeStorage,
          data:profiles.dataFor(profile),trusted,profile:profiles.config(profile),
          claimCourse:()=>{courseRuntime.claim(profile.id);claimCourse(profile.platform);}};
        return profile.platform==='mayuan'?
          createZhihuishuStudy({...options,answer,answerTyped:answerAssessment,courseSession,backgroundInput:process.argv.includes('--background-input-experiment')}):
          createXueyinStudy({...options,answer:answerAssessment,courseSession:xySession,mayuanStatus:()=>controller?.status()});
      },onChange:(platform,value)=>{if(platform==='mayuan')controller=value;else environmentController=value;}});
    courseRuntime.init();
    ipcMain.handle('courses-list',event=>{if(!trusted(event))throw Error('Untrusted window');return courseRuntime.list();});
    ipcMain.handle('courses-select',(event,id)=>{if(!trusted(event)||typeof id!=='string')throw Error('Invalid course');return courseRuntime.select(id);});
    ipcMain.handle('courses-save',(event,input)=>{if(!trusted(event)||!input||typeof input!=='object')throw Error('Invalid course');return courseRuntime.save(input);});
    let compactPosition=null;
    ipcMain.handle('course-expanded',(event,value)=>{
      if(!trusted(event)||typeof value!=='boolean')throw Error('Invalid course view');
      if(value)compactPosition=dashboard.getPosition();
      controller.setExpanded(value);environmentController.setExpanded(value);
      dashboard.setSize(value?1600:400,value?900:620);
      if(value)dashboard.center();
      else if(compactPosition)dashboard.setPosition(...compactPosition);
      return value;
    });
    ipcMain.handle('window-pinned',(event,value)=>{
      if(!trusted(event)||value!==undefined&&typeof value!=='boolean')throw Error('Invalid window preference');
      if(value!==undefined)dashboard.setAlwaysOnTop(value);
      return dashboard.isAlwaysOnTop();
    });
    if(process.argv.includes('--resume-mayuan-once')){
      try{controller.command('START');}catch{}
    }else if(process.argv.includes('--resume-environment-once')){
      try{environmentController.command('RUN');}catch{}
    }else if(process.argv.includes('--open-environment-once')){
      try{environmentController.open();}catch{}
    }
  });
  app.on('before-quit',event=>{
    if(storageFlushed)return;
    event.preventDefault();
    if(storageFlushStarted)return;
    storageFlushStarted=true;
    clearInterval(cookieTimer);
    for(const stopWatching of cookieWatchers)stopWatching();
    const courseSession=session.fromPartition('persist:course');
    void Promise.allSettled([cookieBackup?.capture(),xyCookieBackup?.capture()]).then(()=>{
      for(const partition of ['persist:course','persist:xueyin'])session.fromPartition(partition).flushStorageData();
      return Promise.allSettled(['persist:course','persist:xueyin'].map(partition=>
        session.fromPartition(partition).cookies.flushStore()));
    })
      .catch(()=>{}).finally(()=>{
      storageFlushed=true;environmentController?.stop();controller?.stop();app.quit();
    });
  });
  app.on('window-all-closed',()=>app.quit());
}
