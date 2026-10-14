const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {createLifecycleLog}=require('../src/lifecycle-log.cjs');
function fixture(t){
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'zhs-exit-log-'));
  t.after(()=>{const resolved=fs.realpathSync(data);assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true});});
  const app=new EventEmitter(),processEvents=new EventEmitter();
  const start=()=>createLifecycleLog(data,{app,processEvents,version:'0.1.0'});
  const read=name=>JSON.parse(fs.readFileSync(path.join(data,'zhihuishu-study',name),'utf8'));
  return {app,processEvents,start,read,data};
}
test('closed window and clean quit are distinguishable from an interrupted session',async t=>{
  const f=fixture(t),logger=f.start(),window=new EventEmitter();logger.watchWindow(window);
  window.emit('close',{defaultPrevented:false});window.emit('closed');
  f.app.emit('before-quit',{});f.app.emit('will-quit',{defaultPrevented:false});f.app.emit('quit',{},0);
  f.processEvents.emit('exit',0);await Promise.resolve();f.start();
  const events=f.read('lifecycle-log.json').map(x=>x.event);
  assert.ok(events.includes('window-closed'));assert.ok(events.includes('quit'));
  assert.equal(events.includes('previous-exit-unconfirmed'),false);
  f.start();assert.equal(f.read('lifecycle-log.json').at(-2).event,'previous-exit-unconfirmed');
});
test('canceled quit remains unclean and crash details exclude sensitive fields',async t=>{
  const f=fixture(t);f.start();const event={defaultPrevented:false};
  f.app.emit('will-quit',event);event.defaultPrevented=true;await Promise.resolve();
  assert.equal(f.read('lifecycle-session.json').clean,false);
  f.app.emit('render-process-gone',{},null,{reason:'crashed',exitCode:9,url:'secret',cookie:'secret'});
  f.app.emit('child-process-gone',{}, {reason:'oom',type:'GPU',name:'secret'});
  f.processEvents.emit('uncaughtExceptionMonitor',new Error('secret-token'));
  const raw=JSON.stringify(f.read('lifecycle-log.json'));assert.equal(raw.includes('secret'),false);
  assert.ok(raw.includes('renderer-gone'));assert.ok(raw.includes('uncaught-exception'));
  assert.equal(f.processEvents.listenerCount('uncaughtException'),0);
});
test('bounded log and failed filesystem writes do not prevent app operation',t=>{
  const f=fixture(t),logger=f.start();for(let i=0;i<205;i++)logger.record('before-quit');
  assert.equal(f.read('lifecycle-log.json').length,200);
  const invalid=path.join(f.data,'file');fs.writeFileSync(invalid,'x');
  assert.doesNotThrow(()=>createLifecycleLog(invalid,{app:new EventEmitter(),processEvents:new EventEmitter()}));
});
