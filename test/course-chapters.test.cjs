const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
test('a two-chapter learning course uses its configured completion requirement',async t=>{
  const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});t.after(()=>b.close());const p=await b.newPage();
  await p.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<p>已完成任务点 2/2</p><h3>第一章 模拟章节</h3><ul><li>1.2 章节测验</li></ul><h3>第二章 模拟章节</h3><ul><li>2.2 章节测验</li></ul>'}));
  await p.goto('https://mooc2-ans.xueyinonline.com/mooc2-ans/mycourse/stu');
  await p.evaluate(()=>{window.s={status:'running',currentSection:'2.2',currentIsQuiz:true,configuredChapterCount:2,expectedChapterCount:2,quizStatuses:{'1.2':'submitted','2.2':'submitted'},submittedQuizzes:['1.2','2.2']};window.XyBridge={state:async()=>s,update:async v=>Object.assign(s,v),onCommand:()=>{},notify:async()=>{},report:()=>{},catalogDiagnostic:()=>{}};});
  await p.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../src/xueyin-content.cjs'),'utf8')});
  await p.waitForFunction(()=>s.status==='complete',null,{timeout:7000});assert.equal(await p.evaluate(()=>s.quizScanComplete),true);
});
