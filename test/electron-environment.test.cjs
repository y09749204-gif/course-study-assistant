const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const { _electron }=require('playwright-core');

test('single Electron window switches courses and encrypts its private URL',async t=>{
  const executablePath=process.env.ELECTRON_EXECUTABLE||require('electron');
  if(!fs.existsSync(executablePath)){t.skip('Electron executable is not installed in this worktree');return;}
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'xy-study-isolated-'));
  const app=await _electron.launch({executablePath,
    args:['.'],cwd:path.join(__dirname,'..'),
    env:{...process.env,ZH_STUDY_TEST_DATA_DIR:data}});
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),data);
  t.after(async()=>{app.process().kill();await app.close().catch(()=>{});});
  await app.evaluate(({session})=>session.fromPartition('persist:xueyin').protocol.interceptBufferProtocol('https',(_r,cb)=>cb({mimeType:'text/html',data:Buffer.from('<p>Mock course</p>')})));
  const page=await app.firstWindow();
  await page.waitForSelector('#courseSelect');
  assert.equal((await app.windows()).length,1);
  await page.selectOption('#courseSelect','xueyin');
  assert.equal(await page.locator('#courseSelect').inputValue(),'xueyin');
  assert.equal(await page.locator('#coursePlaceholder').isVisible(),true);
  await page.evaluate(()=>showTab('settings'));
  const secret='https://mooc2-ans.xueyinonline.com/mooc2-ans/mycourse/stu?courseid=11&clazzid=22&cpi=33&enc=local-secret';
  await page.evaluate(()=>document.querySelector('#courseSettings').open=true);
  await page.waitForFunction(()=>document.querySelector('#profilePlatform').value==='xueyin');
  await page.fill('#profileChapters','2');
  await page.fill('#profileUrl',secret);
  await page.click('#profileSave');
  await page.waitForFunction(()=>document.querySelector('#profileNote').textContent.includes('已保存'));
  assert.equal(await page.locator('#profileUrl').inputValue(),'');
  const encrypted=fs.readFileSync(path.join(data,'xueyin-study','course-url.bin'));
  assert.equal(encrypted.includes(Buffer.from('local-secret')),false);
  await page.click('#tabStudy');
  await page.click('#moreButton');
  await page.click('#open');
  await page.waitForFunction(async()=> (await environment.status()).windowOpen);
  assert.equal((await page.locator('#xyDetail').innerText()).includes('操作失败'),false);
  assert.equal((await page.evaluate(()=>environment.status())).windowOpen,true);
  await page.selectOption('#courseSelect','mayuan');
  assert.equal(await page.locator('#courseSelect').inputValue(),'mayuan');
});
