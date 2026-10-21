const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright-core');
async function waitStatus(page,predicate,timeout=20000){
  const deadline=Date.now()+timeout;let state;
  while(Date.now()<deadline){state=await page.evaluate(()=>mooc.status());if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,200));}
  throw Error('MOOC state timed out: '+JSON.stringify(state));
}
test('MOOC native view, profile switching and UI use an isolated mock course',{timeout:90000},async t=>{
  const root=path.join(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'mooc-native-isolated-'));
  const app=await _electron.launch({executablePath:process.env.ELECTRON_EXECUTABLE||require('electron'),args:['.'],cwd:root,env:{...process.env,ZH_STUDY_TEST_DATA_DIR:data}});
  t.after(()=>app.close());
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),data);
  const p=await app.firstWindow();await p.waitForFunction(()=>document.querySelector('#courseSelect')?.dataset.profiles);
  const fixture=fs.readFileSync(path.join(__dirname,'fixtures/native-input.webm')).toString('base64');
  await app.evaluate(({session},fixture)=>{
    session.fromPartition('persist:icourse').protocol.interceptBufferProtocol('https',(request,cb)=>{
      if(new URL(request.url).pathname==='/fixture.webm'){cb({mimeType:'video/webm',data:Buffer.from(fixture,'base64')});return;}
      cb({mimeType:'text/html',data:Buffer.from(`<!doctype html><html><body style="background:#f6f8fb;font:20px sans-serif"><h1>模拟 MOOC 课程</h1><p>模拟章节 · 视频 A</p><video src="/fixture.webm" muted loop style="width:640px;height:360px"></video><label><input type="checkbox" checked>自动播放下一视频</label><script>
        document.querySelector('video').addEventListener('ended',()=>{if(window.changed)return;window.changed=true;history.pushState({},'',location.href.replace('content/200','content/201').replace('unitId=400','unitId=401'));const v=document.querySelector('video');v.src='/fixture.webm?next';v.play();});
      </script></body></html>`)});
    });
  },fixture);
  await p.evaluate(()=>{showTab('settings');document.querySelector('#courseSettings').open=true;});
  await p.click('#profileNew');await p.fill('#profileName','模拟 MOOC');await p.selectOption('#profilePlatform','icourse');
  await p.fill('#profileUrl','https://www.icourse163.org/mooc/learn/MOCK-100/content/200?tid=300&unitId=400');await p.click('#profileSave');
  await p.waitForFunction(()=>document.querySelector('#profileNote').textContent.startsWith('已保存'));
  const id=await p.evaluate(()=>(courses.list()).then(v=>v.selectedId));
  await p.click('#tabStudy');await p.waitForFunction(()=>document.querySelector('#courseProvider').textContent==='中国大学 MOOC');
  assert.equal(await p.locator('#moocPanel').isVisible(),true);assert.equal(await p.locator('#environmentPanel').isVisible(),false);
  assert.equal(await p.locator('#primaryAction').textContent(),'开始');
  await p.click('#primaryAction');await waitStatus(p,s=>s.currentSection==='200');
  const mock=app.context().pages().find(page=>page.url().includes('/mooc/learn/MOCK-100/'));
  assert.ok(mock);await mock.evaluate(()=>{document.querySelector('video').loop=false;});
  await waitStatus(p,s=>s.currentSection==='201',30000);
  const state=await p.evaluate(()=>mooc.status());
  assert.equal(state.status,'running');assert.equal(state.platformDone,undefined);assert.ok(state.observedEnded.length>=1);
  assert.ok(state.seconds>=0);assert.equal((await p.evaluate(()=>study.status())).windowOpen,false);
  await p.click('#primaryAction');assert.equal((await p.evaluate(()=>mooc.status())).status,'paused');
  const file=path.join(data,'courses',id,'icourse-study/state.json');assert.ok(fs.existsSync(file));
  const snapshot=fs.readFileSync(file);await p.selectOption('#courseSelect','mayuan');
  await p.waitForFunction(()=>document.querySelector('#courseProvider').textContent==='智慧树');
  assert.equal((await p.evaluate(()=>mooc.status())).windowOpen,false);
  await p.selectOption('#courseSelect',id);await p.waitForFunction(()=>document.querySelector('#courseProvider').textContent==='中国大学 MOOC');
  assert.deepEqual(fs.readFileSync(file),snapshot);
  await p.evaluate(async()=>{await mooc.open();await refresh();});
  await waitStatus(p,s=>s.courseOnTarget);
  const reopened=app.context().pages().find(page=>page.url().includes('/mooc/learn/MOCK-100/'));
  await reopened.waitForSelector('video');await p.evaluate(()=>refresh());
  const directory=path.join(root,'.local-data');fs.mkdirSync(directory,{recursive:true});
  await reopened.screenshot({path:path.join(directory,'mooc-mock-preview.png')});
  const capture=async name=>{const encoded=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));fs.writeFileSync(path.join(directory,name),Buffer.from(encoded,'base64'));};
  await capture('mooc-mock-compact.png');
  await p.evaluate(async()=>{await study.setCourseExpanded(true);await refresh();});
  await capture('mooc-mock-expanded.png');
  assert.equal(fs.readFileSync(path.join(data,'courses.json'),'utf8').includes('icourse163.org'),false);
});
