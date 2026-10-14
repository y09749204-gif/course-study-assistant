const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright-core');
test('clean public first launch opens configuration and only loads a user-configured mock course',{timeout:45000},async t=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'public-onboarding-'));
  const app=await _electron.launch({executablePath:process.env.ELECTRON_EXECUTABLE||require('electron'),args:['.'],cwd:path.join(__dirname,'..'),env:{...process.env,ZH_STUDY_TEST_DATA_DIR:data}});
  t.after(async()=>{await app.close().catch(()=>{});});
  const page=await app.firstWindow();await page.waitForFunction(()=>document.querySelector('#profileEdit').options.length===2);
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),data);
  assert.equal(await app.evaluate(({app})=>app.getPath('sessionData')),data);
  assert.equal(await page.locator('#settingsPanel').isVisible(),true);
  assert.equal(await page.locator('#courseSettings').getAttribute('open'),'');
  assert.equal(await page.evaluate(()=>(courses.list()).then(v=>v.profiles.some(p=>p.configured))),false);
  assert.equal(await page.evaluate(()=>(study.status()).then(v=>v.windowOpen)),false);
  await page.evaluate(()=>showTab('study'));assert.equal(await page.locator('#primaryAction').isDisabled(),true);
  await page.evaluate(()=>showTab('settings'));
  const artifacts=path.join(__dirname,'..','.local-data','test-artifacts');fs.mkdirSync(artifacts,{recursive:true});
  await page.screenshot({path:path.join(artifacts,'first-launch.png')});
  await app.evaluate(({session})=>session.fromPartition('persist:course').protocol.interceptBufferProtocol('https',(_r,cb)=>cb({mimeType:'text/html',data:Buffer.from('<h1>Mock course</h1>')})));
  await page.evaluate(async()=>{await courses.save({id:'mayuan',name:'模拟课程',platform:'mayuan',url:'https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=mock-course-alpha'});await refresh();showTab('study');await study.open();});
  const media=await app.evaluate(async({BrowserWindow})=>{
    for(let attempt=0;attempt<100;attempt++){
      const view=BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents?.getURL().startsWith('https:'));
      if(view)return {muted:view.webContents.isAudioMuted(),host:new URL(view.webContents.getURL()).hostname};
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    return null;
  });
  assert.deepEqual(media,{muted:true,host:'wisdom-mooc.zhihuishu.com'});
  assert.equal(fs.readFileSync(path.join(data,'courses.json'),'utf8').includes('mock-course-alpha'),false);
  await page.screenshot({path:path.join(artifacts,'mock-course.png')});
});
