const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {_electron}=require('playwright-core');
const C=require('./helpers/mock-course.cjs');
test('Electron compact native input passes site trust checks and switches 2.6 to 3.1',{timeout:90000},async t=>{
 const executablePath=process.env.ELECTRON_EXECUTABLE||require('electron');
 if(!fs.existsSync(executablePath)){t.skip('Electron executable is not installed');return;}
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'zhs-native-isolated-'));
 fs.mkdirSync(path.join(data,'zhihuishu-study'));
 fs.writeFileSync(path.join(data,'zhihuishu-study/state.json'),JSON.stringify({enabled:false,dailyState:{...C.emptyState(C.dayKey()),status:'paused',baselineInitialized:true,completionMarkerVersion:1,currentLesson:'2.6',baseline:['2.6']}}));
 const app=await _electron.launch({executablePath,args:['.','--background-input-experiment'],cwd:path.join(__dirname,'..'),env:{...process.env,ZH_STUDY_TEST_DATA_DIR:data}});
 assert.equal(await app.evaluate(({app})=>app.getPath('userData')),data);
 t.after(async()=>{app.process().kill();await app.close().catch(()=>{});});
 const html=`<html><body>
 <button>第二章: 实践与认识</button><div class="chapter-item current" id="old"><img class="finish-icon"><span>2.6</span> 如何实现自由？</div>
 <button onclick="const box=document.querySelector('#third');box.style.display='block';box.animate([{transform:'translateY(-40px)'},{transform:'translateY(0)'}],{duration:400})">第三章: 人类社会</button>
 <div id="third" style="display:none"><div class="chapter-item" id="next" onclick="document.querySelector('#old').classList.remove('current');this.classList.add('current');document.querySelector('video').src='https://wisdom-mooc.zhihuishu.com/native-next.webm';setTimeout(()=>document.querySelector('#quiz').style.display='block',2000)">3.1 社会如何发展？</div></div>
 <video muted src="https://wisdom-mooc.zhihuishu.com/native-test.webm" style="width:400px;height:250px"></video>
 <div role="dialog" id="reminder"><h2>课程提醒</h2><button onclick="document.querySelector('#reminder').style.display='none'">下次再说</button></div>
 <div role="dialog" id="quiz" style="display:none"><h2>AI随堂练习</h2><p>【判断题】</p><p>Isolated input fixture</p><label onclick="this.classList.add('selected')">A 正确</label><label onclick="this.classList.add('selected')">B 错误</label><button onclick="this.innerText='已提交'">提交作答</button><button class="close" onclick="document.querySelector('#quiz').style.display='none';window.quizClosed=true">关闭</button></div>
 <script>
 window.trustEvents=[];window.hoverEvents=0;document.addEventListener('mouseover',e=>{if(e.isTrusted)window.hoverEvents++;},true);
 document.addEventListener('click',e=>{window.trustEvents.push(e.isTrusted);if(!e.isTrusted||!window.hoverEvents){e.stopImmediatePropagation();location.href='https://www.zhihuishu.com/'}},true);
 </script></body></html>`;
 const page=await app.firstWindow();
 await page.waitForSelector('#courseSelect');
 await page.evaluate(async()=>{await courses.save({id:'mayuan',name:'模拟课程',platform:'mayuan',url:'https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=mock-course-alpha'});await refresh();showTab('study');});
 await app.evaluate(({session},{html,video})=>{
   globalThis.nativeTestHtml=html;globalThis.nativeTestVideo=video;
   session.fromPartition('persist:course').protocol.interceptBufferProtocol('https',(request,callback)=>callback(request.url.endsWith('.webm')?{mimeType:'video/webm',data:Buffer.from(globalThis.nativeTestVideo,'base64')}:{mimeType:'text/html',charset:'utf-8',data:Buffer.from(globalThis.nativeTestHtml)}));
 },{html,video:fs.readFileSync(path.join(__dirname,'fixtures/native-input.webm')).toString('base64')});
 await page.click('#moreButton');
 await page.click('#open');
 await page.click('#primaryAction');
 assert.equal(await page.evaluate(()=>study.windowPinned()),true,'widget starts pinned');
 assert.equal(await page.evaluate(()=>study.windowPinned(false)),false,'pin toggle releases the window');
 await app.evaluate(async({BrowserWindow})=>{
   const dashboard=BrowserWindow.getAllWindows()[0];
   globalThis.backgroundTestWindow=new BrowserWindow({width:240,height:160,title:'Background input test',webPreferences:{nodeIntegration:false}});
   await globalThis.backgroundTestWindow.loadURL('data:text/html,<h1>Foreground fixture</h1>');
   globalThis.backgroundTestWindow.focus();
   await new Promise(resolve=>setTimeout(resolve,300));
   globalThis.courseFocusCount=0;dashboard.on('focus',()=>globalThis.courseFocusCount++);
 });
 // WebContentsView is not a BrowserWindow; inspect its main-world state without accessing credentials.
 const snapshot=()=>app.evaluate(({webContents})=>{const c=webContents.getAllWebContents().find(c=>c.getURL().includes('wisdom-mooc'));return c?.executeJavaScript('({selected:!!document.querySelector("#next.current"),events:window.trustEvents,time:document.querySelector("video")?.currentTime,width:innerWidth,body:document.body?.innerText.slice(0,120)})');});
 let result;
 for(let n=0;n<20;n++){result=await snapshot();if(result?.selected&&result.time>=2)break;await new Promise(r=>setTimeout(r,500));}
 assert.equal(result.selected,true,JSON.stringify({result,state:JSON.parse(fs.readFileSync(path.join(data,'zhihuishu-study/state.json')))}));assert.ok(result.time>=2);assert.ok(result.events.length>=3);assert.ok(result.events.every(Boolean));
 const state=JSON.parse(fs.readFileSync(path.join(data,'zhihuishu-study/state.json'))).dailyState;
 assert.equal(state.currentLesson,'3.1');assert.equal(state.status,'running');
 let quizClosed=false;
 for(let n=0;n<24;n++){
   quizClosed=await app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getURL().includes('wisdom-mooc')).executeJavaScript('window.quizClosed===true'));
   if(quizClosed)break;await new Promise(r=>setTimeout(r,500));
 }
 assert.equal(quizClosed,true,'background quiz selection, submission and close must be confirmed');
 // Observe this application's focus events: the OS user may focus an unrelated application.
 assert.equal(await app.evaluate(()=>globalThis.courseFocusCount),0,'automatic input must not focus the course window');
 await app.evaluate(()=>{if(!globalThis.backgroundTestWindow.isDestroyed())globalThis.backgroundTestWindow.close();});
 assert.ok(result.width>=1220,'compact preview preserves desktop page width');
 assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('compact')),true);
 await page.click('#expandCourse');
 assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('compact')),false);
 await page.click('#expandCourse');
 assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('compact')),true);
 // The identical site guard rejects the legacy synthetic click.
 await app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getURL().includes('wisdom-mooc')).executeJavaScript('document.querySelector("#next").click()'));
 await new Promise(r=>setTimeout(r,1000));
 const trace=JSON.parse(fs.readFileSync(path.join(data,'zhihuishu-study/navigation-trace.json')));
 assert.ok(JSON.stringify(trace).includes('www.zhihuishu.com'));
});
