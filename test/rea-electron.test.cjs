const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {_electron}=require('playwright-core');
const {inspect}=require('../scripts/rea-inspect.cjs');
test('existing REA observes isolated Electron course through opt-in CDP',{timeout:120000},async t=>{
 if(!process.env.REA_ENTRY||!process.env.ELECTRON_EXECUTABLE){t.skip('Local REA and Electron paths required');return;}
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'zhs-rea-isolated-'));
 const app=await _electron.launch({executablePath:process.env.ELECTRON_EXECUTABLE||require('electron'),args:['.','--rea-diagnostics'],
 cwd:path.join(__dirname,'..'),env:{...process.env,ZH_STUDY_TEST_DATA_DIR:data}});
 t.after(()=>app.close());
 const page=await app.firstWindow();await page.waitForSelector('#open');
 await page.evaluate(async()=>{await courses.save({id:'mayuan',name:'模拟课程',platform:'mayuan',url:'https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=mock-course-alpha'});await refresh();showTab('study');});
 await app.evaluate(({session})=>session.fromPartition('persist:course').protocol.interceptBufferProtocol('https',(_request,callback)=>callback({mimeType:'text/html',data:Buffer.from('<html><body><h1>Isolated course fixture</h1></body></html>')})));
 await page.click('#open');
 await new Promise(resolve=>setTimeout(resolve,1000));
 const value=await inspect();
 assert.equal(value.host,'wisdom-mooc.zhihuishu.com');assert.ok(value.domNodes>0);
 assert.ok(!JSON.stringify(value).includes('Isolated course fixture'));
});
