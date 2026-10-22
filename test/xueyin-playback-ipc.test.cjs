const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {createXueyinStudy}=require('../src/xueyin-study.cjs');

test('course iframe diagnostics and document wheel input enforce source, status and bounds',async t=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'xy-playback-ipc-'));
  t.after(()=>{
    const resolved=fs.realpathSync(data),relative=path.relative(fs.realpathSync(os.tmpdir()),resolved);
    assert.match(relative,/^xy-playback-ipc-[^\\/]+$/);
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  const courseUrl='https://mooc2-ans.xueyinonline.com/mooc2-ans/mycourse/stu?courseid=11&clazzid=22&cpi=33&enc=test';
  fs.mkdirSync(path.join(data,'xueyin-study'),{recursive:true});
  fs.writeFileSync(path.join(data,'xueyin-study','course-url.bin'),Buffer.from(courseUrl));
  const listeners=new Map();
  const handlers=new Map();
  const ipcMain={on:(name,fn)=>listeners.set(name,fn),
    handle:(name,fn)=>handlers.set(name,fn)};
  const hostWindow=new EventEmitter();
  Object.assign(hostWindow,{contentView:{addChildView:()=>{},removeChildView:()=>{}},
    getContentSize:()=>[1200,900],isDestroyed:()=>false,show:()=>{},focus:()=>{}});
  let view,recoveryReloads=0;const wheelCommands=[],navigation=[];let bounds,zoom=1;
  class WebContentsView{
    constructor(){
      const contents=new EventEmitter();
      const mainFrame={url:courseUrl,framesInSubtree:[]};
      Object.assign(contents,{mainFrame,getURL:()=>courseUrl,isDestroyed:()=>false,
        setWindowOpenHandler:()=>{},send:()=>{},close:()=>{},reload:()=>{recoveryReloads++;},loadURL:async url=>{navigation.push(url);},
        getZoomFactor:()=>zoom,setZoomFactor:value=>{zoom=value;},
        debugger:{isAttached:()=>false,attach:()=>{},sendCommand:async(name,detail)=>wheelCommands.push({name,detail})}});
      this.webContents=contents;view=this;
    }
    setBounds(value){bounds=value;}
    getBounds(){return bounds;}
  }
  const controller=createXueyinStudy({WebContentsView,hostWindow,ipcMain,
    Notification:{isSupported:()=>false},safeStorage:{isEncryptionAvailable:()=>true,
      decryptString:value=>value.toString(),encryptString:value=>Buffer.from(value)},
    data,trusted:()=>true,mayuanStatus:()=>({enabled:false,dailyState:{status:'idle'}})});
  t.after(()=>controller.stop());
  controller.open();view.webContents.emit('did-finish-load');
  const main=view.webContents.mainFrame;
  const child={url:'https://mooc2-ans.xueyinonline.com/mooc2-ans/mycourse/studentcourse',parent:main};
  const cards={url:'https://mooc1.xueyinonline.com/mooc-ans/knowledge/cards',parent:child};
  assert.equal(handlers.get('xy-state-get')({sender:view.webContents,senderFrame:cards}).status,'idle');
  const quiz={url:'https://mooc1.xueyinonline.com/ananas/modules/work/index.html',parent:cards};
  assert.equal(handlers.get('xy-state-get')({sender:view.webContents,senderFrame:quiz}).status,'idle');
  const review={url:'https://mooc1.xueyinonline.com/mooc-ans/work/selectWorkQuestionYiPiYue',parent:quiz};
  assert.equal(handlers.get('xy-state-get')({sender:view.webContents,senderFrame:review}).status,'idle');
  assert.throws(()=>handlers.get('xy-state-get')({sender:view.webContents,senderFrame:{...review,url:'https://mooc1.xueyinonline.com/mooc-ans/work/unrelated'}}),/Untrusted/);

  const questions={url:'https://mooc1.xueyinonline.com/mooc-ans/work/doHomeWorkNew',parent:quiz};
  assert.equal(handlers.get('xy-state-get')({sender:view.webContents,senderFrame:questions}).status,'idle');
  assert.throws(()=>handlers.get('xy-state-get')({sender:view.webContents,
    senderFrame:{url:'https://mooc1.xueyinonline.com/other',parent:child}}),
  /Untrusted course page/);
  assert.deepEqual(controller.status().pageDiagnostics.rejectedFramePaths,
    ['/mooc2-ans/mycourse/stu','/mooc2-ans/mycourse/studentcourse','/other']);
  const event={sender:view.webContents,senderFrame:child};
  listeners.get('xy-playback-observation')(event,{playing:false,issue:'playback-failed',
    positionSeconds:689,mediaErrorCode:3,readyState:2,networkState:2,
    secret:'do not store'});
  const status=controller.status();
  assert.equal(status.playbackObservation.issue,'playback-failed');
  assert.equal(status.playbackObservation.mediaErrorCode,3);
  assert.deepEqual({...status.pageDiagnostics.mediaFailure,at:undefined},{
    issue:'playback-failed',mediaErrorCode:3,readyState:2,networkState:2,at:undefined});
  assert.equal(JSON.stringify(status).includes('do not store'),false);
  listeners.get('xy-playback-observation')({sender:view.webContents,senderFrame:{
    url:'https://mooc2-ans.xueyinonline.com/other',parent:main}},
  {playing:true,issue:null});
  assert.equal(controller.status().playbackObservation.issue,'playback-failed');

  controller.command('RUN');
  const rootEvent={sender:view.webContents,senderFrame:main};
  handlers.get('xy-state-update')(rootEvent,{currentTask:'1.1/document/0'});
  const point={x:bounds.width/zoom/2,y:bounds.height/zoom/2,amount:300};
  assert.equal((await handlers.get('xy-document-scroll')(event,point)).accepted,false);
  assert.equal((await handlers.get('xy-document-scroll')(rootEvent,{...point,x:-1})).accepted,false);
  assert.equal((await handlers.get('xy-document-scroll')(rootEvent,point)).accepted,true);
  assert.equal(wheelCommands.length,2);
  assert.equal(wheelCommands[1].detail.type,'mouseWheel');
  assert.equal(wheelCommands[1].detail.deltaY,300*zoom);
  assert.equal((await handlers.get('xy-document-scroll')(rootEvent,point)).accepted,false);
  controller.command('PAUSE');
  assert.equal((await handlers.get('xy-document-scroll')(rootEvent,point)).accepted,false);
  assert.deepEqual(controller.status().completedTaskIds,[]);
  assert.equal((await handlers.get('xy-document-return')(rootEvent)).accepted,false);
  controller.command('RUN');
  handlers.get('xy-state-update')(rootEvent,{currentSection:'1.1',awaitingPlatform:{section:'1.1',taskId:'1.1/document/0'}});
  assert.equal((await handlers.get('xy-document-return')(event)).accepted,false);
  assert.equal((await handlers.get('xy-document-return')(rootEvent)).accepted,true);
  assert.equal(navigation.at(-1),courseUrl);
  handlers.get('xy-state-update')(rootEvent,{awaitingPlatform:{section:'1.1',taskId:'1.1/video/0'}});
  assert.equal((await handlers.get('xy-document-return')(rootEvent)).accepted,true);
  handlers.get('xy-state-update')(rootEvent,{awaitingPlatform:{section:'1.1',taskId:'1.1/quiz/0'}});
  assert.equal((await handlers.get('xy-document-return')(rootEvent)).accepted,false);

  listeners.get('xy-catalog-diagnostic')(rootEvent,{documentReading:{stage:'unsupported',reason:'reader-frame-timeout',index:0,total:2,question:'not diagnostic data'}});
  assert.deepEqual(controller.status().pageDiagnostics.catalog.documentReading,{stage:'unsupported',reason:'reader-frame-timeout',index:0,total:2});
  const stateFile=path.join(data,'xueyin-study','state.json');
  handlers.get('xy-state-update')(rootEvent,{status:'running',currentIsQuiz:false,currentSection:'1.1',currentTask:'1.1/video/0',awaitingPlatform:null,submissionIntent:null});
  const recovery={taskId:'1.1/video/0',positionSeconds:25};
  const recover=detail=>handlers.get('xy-playback-recover')(rootEvent,detail);
  assert.equal(handlers.get('xy-playback-recover')(event,recovery).accepted,false);
  assert.equal(recover({...recovery,taskId:'1.2/video/0'}).accepted,false);
  assert.equal(recover({...recovery,positionSeconds:NaN}).accepted,false);
  const beforeRecovery=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  for(const patch of [{currentIsQuiz:true},{submissionIntent:{section:'1.1'}},{awaitingPlatform:{section:'1.1'}},{currentSection:'1.2'}]){
    fs.writeFileSync(stateFile,JSON.stringify({...beforeRecovery,...patch}));assert.equal(recover(recovery).accepted,false);
  }
  fs.writeFileSync(stateFile,JSON.stringify(beforeRecovery));
  controller.command('PAUSE');assert.equal(recover(recovery).accepted,false);controller.command('RUN');
  assert.equal(recover(recovery).accepted,true);assert.equal(recoveryReloads,1);
  assert.equal(recover(recovery).reason,'cooldown');assert.equal(recoveryReloads,1);
  const persisted=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  assert.equal(persisted.playbackRecovery.attempts,1);
  persisted.playbackRecovery.at=new Date(Date.now()-61000).toISOString();fs.writeFileSync(stateFile,JSON.stringify(persisted));
  assert.equal(recover(recovery).accepted,true);assert.equal(recoveryReloads,2);
  assert.equal(recover(recovery).reason,'exhausted');assert.equal(recoveryReloads,2);
  assert.deepEqual(controller.status().completedTaskIds,[]);
  assert.deepEqual(controller.status().submittedQuizzes,[]);
  handlers.get('xy-state-update')(rootEvent,{currentTask:'1.1/document/0'});
  assert.equal(recover({taskId:'1.1/document/0',positionSeconds:25}).accepted,false);
  const documentRequest={taskId:'1.1/document/0',reason:'resource-timeout'};
  const recoverDocument=detail=>handlers.get('xy-document-recover')(rootEvent,detail);
  assert.equal(handlers.get('xy-document-recover')(event,documentRequest).accepted,false);
  assert.equal(recoverDocument({...documentRequest,reason:'unconfirmed'}).accepted,false);
  assert.equal(recoverDocument({...documentRequest,taskId:'1.1/document/1'}).accepted,false);
  const documentBefore=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  for(const patch of [{status:'paused'},{currentIsQuiz:true},{submissionIntent:{section:'1.1'}},{awaitingPlatform:{section:'1.1'}},{currentSection:'1.2'},{currentTask:'1.1/video/0'}]){
    fs.writeFileSync(stateFile,JSON.stringify({...documentBefore,...patch}));assert.equal(recoverDocument(documentRequest).accepted,false);
  }
  fs.writeFileSync(stateFile,JSON.stringify(documentBefore));
  assert.equal(recoverDocument(documentRequest).accepted,true);assert.equal(recoveryReloads,3);
  assert.equal(recoverDocument(documentRequest).reason,'cooldown');
  const documentRetry=JSON.parse(fs.readFileSync(stateFile,'utf8'));documentRetry.documentRecovery.at=new Date(Date.now()-61000).toISOString();fs.writeFileSync(stateFile,JSON.stringify(documentRetry));
  assert.equal(recoverDocument(documentRequest).accepted,true);assert.equal(recoveryReloads,4);
  assert.equal(recoverDocument(documentRequest).reason,'exhausted');assert.equal(recoveryReloads,4);
  assert.deepEqual(controller.status().completedTaskIds,[]);
  const expired=new Date(Date.now()-60000).toISOString();
  fs.writeFileSync(stateFile,JSON.stringify({status:'blocked',
    blockedReason:'1.1 的视频已结束，但目录任务点未减少',
    awaitingPlatform:{section:'1.1',taskId:'1.1/video/2',returnedAt:expired}}));
  controller.command('RUN');
  const resumed=controller.status();
  assert.equal(resumed.status,'running');
  assert.ok(Date.parse(resumed.awaitingPlatform.returnedAt)>Date.parse(expired));

  // A diagnostic IPC must not crash the main process when the disk fills up.
  const originalWrite=fs.writeFileSync;
  let pauseSent=false;
  view.webContents.send=(_channel,message)=>{if(message.type==='PAUSE')pauseSent=true;};
  try{
    fs.writeFileSync=(file,...args)=>{
      if(file===stateFile+'.pending')throw Object.assign(Error('disk full'),{code:'ENOSPC'});
      return originalWrite(file,...args);
    };
    assert.doesNotThrow(()=>listeners.get('xy-diagnostic')({sender:view.webContents,senderFrame:main},'tick-active'));
    assert.equal(controller.status().status,'blocked');
    assert.equal(controller.status().storageError,'ENOSPC');
    assert.equal(pauseSent,true);
    controller.command('RUN');
    assert.equal(controller.status().status,'blocked');
  }finally{fs.writeFileSync=originalWrite;}
  assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).status,'running');
  controller.command('RUN');
  assert.equal(controller.status().status,'running');
});
