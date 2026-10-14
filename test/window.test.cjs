const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const C=require('./helpers/mock-course.cjs');
const {createZhihuishuStudy}=require('../src/study.cjs');

test('quiz parser diagnostic excludes question content and private fields',async t=>{
 const {controller,children,handlers,stateFile}=fixture(t);controller.command('START');const c=children[0].webContents;
 await handlers.get('zhs-runtime-message')({sender:c,senderFrame:c.mainFrame},{type:'QUIZ_DIAGNOSTIC',reason:'recognized',optionCount:4,controlCount:4,question:'private-question',cookie:'private-cookie'});
 const raw=fs.readFileSync(path.join(path.dirname(stateFile),'quiz-parser-diagnostic.json'),'utf8');
 assert.equal(raw.includes('private'),false);assert.equal(JSON.parse(raw).optionCount,4);
});

test('native IPC rejects other frames, stale pages, duplicate actions and invalid coordinates',async t=>{
 const {controller,children,handlers}=fixture(t);controller.command('START');
 const c=children[0].webContents,call=handlers.get('zhs-runtime-message');
 const e={sender:c,senderFrame:c.mainFrame};
 const {epoch}=await call(e,{type:'INPUT_FOCUS'});
 const click={type:'INPUT_CLICK',epoch,kind:'lesson',actionId:'1',x:50,y:80,width:1236,height:848};
 await assert.rejects(()=>call({sender:c,senderFrame:{url:C.COURSE_URL}},click),/Untrusted/);
 assert.equal((await call(e,{...click,x:1236})).accepted,false);
 assert.equal((await call(e,{...click,kind:'arbitrary'})).accepted,false);
 assert.equal((await call(e,click)).accepted,true);
 assert.equal(c.inputs.length,3);
 assert.equal((await call(e,click)).accepted,false);
 c.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false,url:C.COURSE_URL});
 assert.equal((await call(e,{...click,actionId:'2'})).accepted,false);
 assert.equal(c.inputs.length,3);
 controller.command('PAUSE');
 assert.equal((await call(e,{...click,epoch:epoch+1,actionId:'3'})).accepted,false);
});

test('manual Start does not rearm the one-return-per-startup budget',t=>{
 const {controller,children}=fixture(t);controller.command('START');const c=children[0].webContents;
 c.url='https://www.zhihuishu.com/';c.emit('did-navigate',null,c.url);c.emit('did-finish-load');
 c.url='https://www.zhihuishu.com/';controller.command('START');controller.command('START');
 assert.equal(c.loads.length,2);assert.equal(controller.status().dailyState.status,'blocked');
});

test('playback diagnostic stores only bounded media fields',async t=>{
 const {controller,children,handlers,stateFile}=fixture(t);controller.command('START');
 const c=children[0].webContents;
 await handlers.get('zhs-runtime-message')({sender:c,senderFrame:c.mainFrame},{type:'PLAYBACK_DIAGNOSTIC',lessonId:'1.4',readyState:4,time:27.9,duration:1068,paused:false,hidden:false,errorCode:0,cookie:'private-value',url:'private-url'});
 const raw=fs.readFileSync(path.join(path.dirname(stateFile),'playback-diagnostic.json'),'utf8');
 assert.equal(raw.includes('private'),false);assert.equal(JSON.parse(raw).time,28);
});

function fixture(t,initial={},courseSession=null){
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'zhs-window-test-'));
  t.after(()=>{
    const target=fs.realpathSync(data),base=fs.realpathSync(os.tmpdir());
    if(!target.startsWith(base+path.sep))throw Error('Temporary path outside expected directory');
    fs.rmSync(target,{recursive:true});
  });
  const stateFile=path.join(data,'zhihuishu-study','state.json');
  fs.mkdirSync(path.dirname(stateFile),{recursive:true});
  fs.writeFileSync(stateFile,JSON.stringify(initial));
  const children=[];
  class Host extends EventEmitter{
    contentView={addChildView:view=>children.push(view),removeChildView:view=>children.splice(children.indexOf(view),1)};
    getContentSize(){return [1600,900];}
    isDestroyed(){return false;}
    show(){}focus(){}
  }
  class CourseContents extends EventEmitter{
    url='';destroyed=false;sent=[];loads=[];
    isDestroyed(){return this.destroyed;}
    getURL(){return this.url;}
    loadURL(url){this.url=url;this.loads.push(url);return Promise.resolve();}
    setWindowOpenHandler(handler){this.popupHandler=handler;}
    isLoadingMainFrame(){return false;}
    send(channel,message){this.sent.push({channel,message});}
    focus(){}
    sendInputEvent(event){this.inputs ||= [];this.inputs.push(event);}
    get mainFrame(){return this.frame ||= {url:C.COURSE_URL};}
    reload(){}
    close(){this.destroyed=true;this.emit('destroyed');}
  }
  class WebContentsView{
    webContents=new CourseContents();
    setBounds(bounds){this.bounds=bounds;}
  }
  const handlers=new Map();
  const ipcMain={handle:(name,handler)=>handlers.set(name,handler),on:()=>{}};
  const controller=createZhihuishuStudy({WebContentsView,hostWindow:new Host(),ipcMain,
    Notification:{isSupported:()=>false},safeStorage:{isEncryptionAvailable:()=>false},
    data,profile:C.profile,answer:async()=>({index:null}),trusted:()=>true,courseSession});
  controller.setExpanded(true);
  t.after(()=>controller.stop());
  const ready=contents=>handlers.get('zhs-runtime-message')({sender:contents,senderFrame:contents.mainFrame},{type:'PAGE_READY',lessonId:'2.3'});
  return {controller,children,handlers,stateFile,ready};
}

test('disabled startup keeps course closed and preserves interrupted progress',t=>{
  const state={...C.emptyState(C.dayKey()),status:'running',seconds:354,completed:['1.2']};
  const {controller,children}=fixture(t,{enabled:false,dailyState:state});
  assert.equal(children.length,0);
  assert.equal(controller.status().dailyState.status,'interrupted');
  assert.equal(controller.status().dailyState.seconds,354);
  assert.deepEqual(controller.status().dailyState.completed,['1.2']);
});

test('course embeds once, resizes in place and closes without losing progress',t=>{
  const {controller,children,handlers,stateFile}=fixture(t);
  controller.open();controller.open();
  assert.equal(children.length,1);
  assert.equal(children[0].bounds.x,364);
  assert.equal(children[0].bounds.y,52);
  assert.equal(handlers.get('zhs-pane-width')({},460),460);
  assert.equal(children[0].bounds.x,464);
  const view=children[0];
  controller.command('START');
  assert.equal(controller.status().dailyState.status,'running');
  handlers.get('zhs-close')({});
  assert.equal(children.length,0);
  assert.equal(view.webContents.isDestroyed(),true);
  assert.equal(controller.status().dailyState.status,'interrupted');
  assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).dailyState.status,'interrupted');
  controller.open();
  assert.equal(children.length,1);
  controller.close();
  assert.equal(children.length,0);
});

test('score analysis opens in the same embedded view and returns to the course',t=>{
  const {controller,children}=fixture(t);
  controller.openScore();
  assert.equal(children.length,1);
  assert.equal(controller.status().scoreRequested,true);
  assert.match(children[0].webContents.getURL(),/^https:\/\/stuonline\.zhihuishu\.com\/stuonline\/stuLearnReportNew\/index\?/);
  controller.open();
  assert.equal(children.length,1);
  assert.equal(controller.status().scoreRequested,false);
  assert.equal(children[0].webContents.getURL(),C.COURSE_URL);
});

test('official course popups stay in the embedded session',t=>{
  const {controller,children}=fixture(t);
  controller.open();
  const contents=children[0].webContents;
  assert.deepEqual(contents.popupHandler({url:'https://passport.zhihuishu.com/login'}),{action:'deny'});
  assert.equal(contents.getURL(),'https://passport.zhihuishu.com/login');
  assert.deepEqual(contents.popupHandler({url:C.COURSE_URL}),{action:'deny'});
  assert.equal(contents.getURL(),C.COURSE_URL);
  assert.deepEqual(contents.popupHandler({url:'http://passport.zhihuishu.com/login'}),{action:'deny'});
  assert.equal(contents.getURL(),C.COURSE_URL);
});

test('returning from login to the configured course clears the stale navigation block',t=>{
  const {controller,children,ready}=fixture(t);
  controller.command('START');
  const contents=children[0].webContents;
  contents.url='https://passport.zhihuishu.com/login';
  contents.emit('did-navigate',null,contents.url);
  assert.equal(controller.status().dailyState.status,'blocked');
  contents.url=C.COURSE_URL;
  contents.emit('did-finish-load');
  assert.equal(controller.status().dailyState.status,'blocked');
  ready(contents);
  assert.equal(controller.status().dailyState.status,'running');
  assert.equal(controller.status().dailyState.blockedReason,null);
  assert.deepEqual(contents.sent.at(-1),{channel:'zhs-command',message:{type:'START'}});
});

test('unexpected homepage redirects once and resumes the same daily progress after course loads',t=>{
  const {controller,children,stateFile,ready}=fixture(t);
  controller.command('START');
  const contents=children[0].webContents;
  const before={...controller.status().dailyState,seconds:111.78,currentLesson:'2.3',completed:['2.2']};
  fs.writeFileSync(stateFile,JSON.stringify({dailyState:before}));
  contents.emit('did-finish-load');
  contents.url='https://www.zhihuishu.com/';
  contents.emit('did-navigate',null,contents.url);
  assert.equal(controller.status().dailyState.status,'blocked');
  contents.emit('did-finish-load');
  assert.deepEqual(contents.loads,[C.COURSE_URL,C.COURSE_URL]);
  assert.equal(controller.status().dailyState.status,'blocked');
  contents.emit('did-finish-load');
  assert.equal(controller.status().dailyState.status,'blocked');
  ready(contents);
  const resumed=controller.status().dailyState;
  assert.equal(resumed.status,'running');
  assert.equal(resumed.seconds,before.seconds);
  assert.equal(resumed.currentLesson,before.currentLesson);
  assert.deepEqual(resumed.completed,before.completed);
  assert.deepEqual(contents.sent.at(-1),{channel:'zhs-command',message:{type:'START'}});
});

test('homepage redirect loop stops after one automatic return',t=>{
  const {controller,children,ready}=fixture(t);
  controller.command('START');
  const contents=children[0].webContents;
  contents.emit('did-finish-load');
  contents.url='https://www.zhihuishu.com/';
  contents.emit('did-navigate',null,contents.url);
  contents.emit('did-finish-load');
  contents.url='https://www.zhihuishu.com/';
  contents.emit('did-finish-load');
  assert.equal(contents.loads.length,2);
  assert.equal(controller.status().dailyState.status,'blocked');
  assert.match(controller.status().dailyState.blockedReason,/仍停在首页/);
  controller.close();
  controller.open();
  const reopened=children.at(-1).webContents;
  reopened.emit('did-finish-load');
  assert.equal(controller.status().dailyState.status,'blocked');
  ready(reopened);
  assert.equal(controller.status().dailyState.status,'running');
  assert.equal(controller.status().dailyState.blockedReason,null);
});

test('Open course explicitly navigates an existing homepage back to the lesson',t=>{
  const {controller,children,handlers,ready}=fixture(t);
  controller.command('START');
  const contents=children[0].webContents;
  contents.url='https://www.zhihuishu.com/';
  contents.emit('did-navigate',null,contents.url);
  handlers.get('zhs-open')({});
  assert.equal(contents.loads.at(-1),C.COURSE_URL);
  contents.emit('did-finish-load');
  assert.equal(controller.status().dailyState.status,'blocked');
  ready(contents);
  assert.equal(controller.status().dailyState.status,'running');
});

test('login page waits for manual sign-in while Start from homepage navigates back',t=>{
  const {controller,children,ready}=fixture(t);
  controller.command('START');
  const contents=children[0].webContents;
  contents.url='https://passport.zhihuishu.com/login';
  contents.emit('did-navigate',null,contents.url);
  contents.emit('did-finish-load');
  controller.command('START');
  assert.equal(contents.loads.length,1);
  contents.url='https://www.zhihuishu.com/';
  controller.command('START');
  assert.equal(contents.loads.at(-1),C.COURSE_URL);
  assert.equal(controller.status().dailyState.status,'blocked');
  assert.match(controller.status().dailyState.blockedReason,/正在返回/);
  contents.emit('did-finish-load');
  assert.equal(controller.status().dailyState.status,'blocked');
  ready(contents);
  assert.equal(controller.status().dailyState.status,'running');
});

test('returning to the course does not bypass a quiz block or a manual pause',t=>{
  const {controller,children,stateFile}=fixture(t);
  controller.open();
  const contents=children[0].webContents;
  for(const status of ['blocked','paused']){
    const state={...C.emptyState(C.dayKey()),status,blockedReason:'弹题题型或选项无法识别'};
    fs.writeFileSync(stateFile,JSON.stringify({dailyState:state}));
    contents.emit('did-finish-load');
    assert.equal(controller.status().dailyState.status,status);
  }
  assert.equal(contents.sent.length,0);
});

test('automatic review updates only an eligible prior-day record',async t=>{
  const prior=C.dayKey(new Date(Date.now()-86400_000));
  const habit={recruitId:222,stuStudyRecord:{suggestTime:25},
    studentStudyMap:{[`${prior.slice(5,7)}.${prior.slice(8,10)}`]:'27,1'}};
  const progress={recruitId:222,studentId:1,ssd:{studentId:null},chapterOrLesson:{clList:[
    {chapterOrder:1,lessonTempDtos:[{lessonOrder:3,watchStatus:1}]},
    {chapterOrder:2,lessonTempDtos:[{lessonOrder:1,watchStatus:1}]},
  ]}};
  const session={fetch:async url=>({ok:true,text:async()=>JSON.stringify(
    url.includes('loadStuHabit')?habit:progress)})};
  const old={...C.emptyState(prior),status:'complete',completed:['1.3','2.1'],seconds:1600};
  const {controller,stateFile}=fixture(t,{enabled:false,dailyHistory:[old]},session);
  await controller.review(true);
  const saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  assert.equal(saved.dailyHistory[0].platformReview.state,'confirmed');
  assert.equal(saved.dailyHistory[0].platformReview.habitMinutes,27);
  assert.equal(saved.dailyHistory[0].platformConfirmed,true);
  assert.equal(saved.dailyState,undefined);
});

test('completed videos alone do not confirm a day missing from the habit record',async t=>{
  const prior=C.dayKey(new Date(Date.now()-86400_000));
  const habit={recruitId:222,courseEndTime:'20260928',stuStudyRecord:{suggestTime:25},studentStudyMap:{}};
  const progress={recruitId:222,studentId:1,chapterOrLesson:{clList:[
    {chapterOrder:1,lessonTempDtos:[{lessonOrder:3,watchStatus:1}]},
    {chapterOrder:2,lessonTempDtos:[{lessonOrder:1,watchStatus:1}]},
  ]}};
  const session={fetch:async url=>({ok:true,text:async()=>JSON.stringify(
    url.includes('loadStuHabit')?habit:progress)})};
  const old={...C.emptyState(prior),status:'complete',completed:['1.3','2.1'],seconds:1600};
  const {controller,stateFile}=fixture(t,{enabled:false,dailyHistory:[old]},session);
  await controller.review(true);
  const result=JSON.parse(fs.readFileSync(stateFile,'utf8')).dailyHistory[0];
  assert.equal(result.platformReview.state,'difference');
  assert.equal(result.platformReview.videoConfirmedCount,2);
  assert.equal(result.platformReview.habitDayPresent,false);
  assert.equal(result.platformConfirmed,null);
});
