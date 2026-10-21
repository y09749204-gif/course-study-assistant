const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createIcourseStudy}=require('../src/icourse-study.cjs');
const url='https://www.icourse163.org/mooc/learn/MOCK-100/content/200?tid=300&unitId=400';
function setup(){
  const handlers=new Map(),listeners=new Map(),views=[],data=fs.mkdtempSync(path.join(os.tmpdir(),'mooc-controller-isolated-'));
  let clock=1000,claims=0;
  class View{constructor(options){this.options=options;views.push(this);this.webContents=new EventEmitter();Object.assign(this.webContents,{
    mainFrame:{url:''},isDestroyed:()=>false,getURL:()=>this.webContents.mainFrame.url,send:()=>{},setAudioMuted:()=>{},setZoomFactor:()=>{},
    setWindowOpenHandler:()=>{},loadURL:async value=>{this.webContents.mainFrame.url=value;},close:()=>{},reload:()=>{},isLoadingMainFrame:()=>false
  });}setBounds(value){this.bounds=value;}}
  const host=new EventEmitter();Object.assign(host,{isDestroyed:()=>false,getContentSize:()=>[400,620],contentView:{addChildView:()=>{},removeChildView:()=>{}},show:()=>{},focus:()=>{}});
  const controller=createIcourseStudy({WebContentsView:View,hostWindow:host,data,profile:{url},courseSession:{},trusted:e=>e.control===true,
    claimCourse:()=>claims++,now:()=>clock,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:(name,fn)=>listeners.set(name,fn)}});
  const event=()=>({sender:views.at(-1).webContents,senderFrame:views.at(-1).webContents.mainFrame});
  const state=()=>handlers.get('mooc-agent-state')(event());
  const report=(value={})=>handlers.get('mooc-observation')(event(),{epoch:state().epoch,unit:'200:400',issue:'playing',time:1,rate:1,paused:false,seeking:false,...value});
  return {controller,views,host,handlers,listeners,data,state,event,report,advance:ms=>clock+=ms,claims:()=>claims};
}
test('MOOC controller isolates records and uses unchanged compact and expanded bounds',()=>{
  const s=setup();s.controller.open();assert.equal(s.claims(),1);
  assert.deepEqual(s.views[0].bounds,{x:12,y:386,width:376,height:180});
  assert.equal(s.views[0].options.webPreferences.nodeIntegration,false);
  assert.equal(s.views[0].options.webPreferences.contextIsolation,true);
  s.controller.setExpanded(true);assert.equal(s.views[0].bounds.y,52);
  assert.equal(s.controller.status().status,'idle');
  s.controller.command('RUN');s.controller.command('PAUSE');
  assert.ok(fs.existsSync(path.join(s.data,'icourse-study/state.json')));
  s.controller.stop();assert.equal(s.host.listenerCount('resize'),0);
});
test('MOOC observations reject foreign frames, stale epochs, seeks and suspended intervals',()=>{
  const s=setup();s.controller.command('RUN');const stale=s.state().epoch;
  assert.throws(()=>s.handlers.get('mooc-observation')({sender:{},senderFrame:{}},{}),/Untrusted/);
  assert.equal(s.report(),true);s.advance(1000);s.report({time:2});assert.equal(s.controller.status().seconds,1);
  s.advance(1000);s.report({time:100});assert.equal(s.controller.status().seconds,1);
  s.advance(9000);s.report({time:109});assert.equal(s.controller.status().seconds,1);
  s.controller.command('PAUSE');assert.equal(s.report({epoch:stale,time:110}),false);
  assert.equal(s.controller.status().status,'paused');
  s.controller.command('RUN');assert.equal(s.report({epoch:stale,time:111}),false);
  assert.equal(s.report({unit:'other:unit'}),false);
  s.controller.stop();
});
test('natural video end is a local observation and never confirms course completion',()=>{
  const s=setup();s.controller.command('RUN');s.report({issue:'waiting-next',ended:true});s.report({issue:'waiting-next',ended:true});
  assert.equal(s.controller.status().observedEnded.length,1);
  assert.equal(s.controller.status().status,'running');assert.equal(s.controller.status().platformDone,undefined);
  s.report({issue:'next-unconfirmed'});assert.equal(s.controller.status().status,'blocked');
  assert.match(s.controller.status().blockedReason,/未自动切换/);
  s.controller.stop();
});
test('course navigation invalidates observations and pauses on a different offering',()=>{
  const s=setup();s.controller.command('RUN');const wc=s.views[0].webContents,epoch=s.state().epoch;
  wc.mainFrame.url=url.replace('tid=300','tid=301');wc.emit('did-navigate');
  assert.equal(s.controller.status().status,'blocked');assert.equal(s.controller.status().courseOnTarget,false);
  assert.throws(()=>s.handlers.get('mooc-agent-state')(s.event()),/Untrusted/);
  wc.mainFrame.url=url;s.controller.command('RUN');assert.notEqual(s.state().epoch,epoch);
  s.controller.close();assert.equal(s.controller.status().windowOpen,false);
});
test('opening after login returns from the course introduction to the configured learning page',()=>{
  const s=setup();s.controller.open();const wc=s.views[0].webContents;
  wc.mainFrame.url='https://www.icourse163.org/course/MOCK-100';wc.emit('did-navigate');
  assert.equal(s.controller.status().courseOnTarget,false);
  s.controller.open();assert.equal(wc.getURL(),url);assert.equal(s.controller.status().courseOnTarget,true);
  s.controller.stop();
});
test('MOOC reopens the last observed unit within the same configured offering',()=>{
  const s=setup();s.controller.command('RUN');
  const next=url.replace('content/200','content/201').replace('unitId=400','unitId=401');
  const wc=s.views[0].webContents;wc.mainFrame.url=next;wc.emit('did-navigate-in-page');s.report({unit:'201:401'});
  s.controller.close();s.controller.open();assert.equal(s.views.at(-1).webContents.getURL(),next);
  s.controller.stop();
});
