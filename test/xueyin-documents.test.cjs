const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const source=fs.readFileSync(path.join(__dirname,'../src/xueyin-document-frame.cjs'),'utf8');
const content=fs.readFileSync(path.join(__dirname,'../src/xueyin-content.cjs'),'utf8');
async function setup(t,{confirm=true,controller=false}={}){
  const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});t.after(()=>b.close());
  const p=await b.newPage();
  const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="280" height="340"><rect width="280" height="340" fill="white"/></svg>');
  await p.route('**/*',r=>{
    const url=new URL(r.request().url());let body;
    if(url.pathname==='/blank')body='<html></html>';
    else if(url.pathname==='/mooc-ans/knowledge/cards')body=`${[1,2].map(i=>`<div class="ans-attach-ct"><div class="ans-job-icon">Task</div><iframe style="width:500px;height:280px" src="https://mooc1.chaoxing.com/ananas/modules/pdf/index.html?mock=${i}"></iframe></div>`).join('')}<script>setInterval(()=>parent.postMessage({type:'xy-video-status',currentTime:100,duration:100,paused:true,ended:true,cards:[{complete:true,hasMedia:true}],pendingDocuments:document.querySelectorAll('.ans-attach-ct:not(.ans-job-finished)').length},'*'),400);addEventListener('message',e=>{if(e.data?.type!=='mock-platform-read')return;const f=[...document.querySelectorAll('iframe')].find(f=>f.contentWindow===e.source);f?.closest('.ans-attach-ct').classList.add('ans-job-finished');});</script>`;
    else if(url.pathname.includes('/pdf/'))body=`<iframe style="width:480px;height:260px" src="https://mooc1.chaoxing.com/blank"></iframe><script>const readerFrame=document.querySelector('iframe');readerFrame.onload=()=>{if(!window.redirected){window.redirected=true;readerFrame.contentWindow.location.href='https://p.ananas.chaoxing.com/screen/v2/mock-${url.searchParams.get('mock')}';}};addEventListener('message',e=>{if(e.data?.type==='mock-platform-read'&&e.source===document.querySelector('iframe').contentWindow)parent.postMessage(e.data,'*');});</script>`;
    else if(url.pathname.startsWith('/screen/v2/'))body=`<div class="fileBox"><img src="${image}"><img src="${image}"></div><script>addEventListener('scroll',()=>{const r=document.scrollingElement;if(${confirm}&&r.scrollTop+r.clientHeight>=r.scrollHeight-3)parent.postMessage({type:'mock-platform-read'},'*');});</script>`;
    else body='<div id="count">已完成任务点 0/2</div><ul><li class="active" style="height:40px">1.1 文档 <span>2</span></li></ul><button id="back">返回课程</button><iframe id="cards" style="width:700px;height:550px" src="https://mooc1.chaoxing.com/mooc-ans/knowledge/cards"></iframe>';
    return r.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  await p.goto('https://mooc1.chaoxing.com/mycourse/studentstudy');
  await p.waitForFunction(()=>document.querySelector('#cards').contentDocument?.readyState==='complete');
  for(const f of p.frames().filter(f=>f!==p.mainFrame())){
    await f.waitForLoadState('domcontentloaded');
    await f.addScriptTag({content:source});
  }
  await p.exposeFunction('__normalWheel',async({x,y,amount})=>{await p.mouse.move(x,y);await p.mouse.wheel(0,amount);return {accepted:true};});
  await p.evaluate(()=>{
    window.reports=[];addEventListener('message',e=>{if(e.data?.type==='xy-document-status')reports.push(e.data);});
    window.__state={status:'running',currentSection:'1.1',currentTask:null,sectionPending:{'1.1':2},completedTaskIds:[],submittedQuizzes:[],quizStatuses:{},platformDone:0,platformTotal:2};
    window.XyBridge={scroll:detail=>__normalWheel(detail),state:async()=>({...__state}),update:async patch=>Object.assign(__state,patch),notify:async()=>{},onCommand:f=>window.command=f};
    document.querySelector('#back').onclick=()=>{window.returned=true;document.querySelector('#count').textContent='已完成任务点 2/2';document.querySelector('li span').textContent='0';document.querySelector('#cards').remove();};
  });
  if(controller)await p.addScriptTag({content});
  else await p.evaluate(()=>{addEventListener('message',e=>{if(e.data?.type==='xy-document-wheel'){const r=document.querySelector('#cards').getBoundingClientRect();void __normalWheel({...e.data,x:r.left+e.data.x,y:r.top+e.data.y});}});document.querySelector('#cards').contentWindow.postMessage({type:'xy-read-document'},'*');});
  return p;
}
test('normal document scrolling waits for platform marks, records both documents and returns',async t=>{
  const p=await setup(t,{controller:true});
  await p.waitForFunction(()=>window.returned,null,{timeout:60000});
  assert.deepEqual(await p.evaluate(()=>__state.completedTaskIds),['1.1/document/0','1.1/document/1']);
  assert.equal(await p.evaluate(()=>reports.at(-1).tasks.every(t=>t.complete)),true);
});
test('reading to the end without a platform mark remains unconfirmed',async t=>{
  const p=await setup(t,{confirm:false});
  await p.waitForFunction(()=>reports.some(r=>r.stage==='unconfirmed'),null,{timeout:45000});
  assert.equal(await p.evaluate(()=>reports.at(-1).tasks.some(t=>t.complete)),false);
  assert.deepEqual(await p.evaluate(()=>__state.completedTaskIds),[]);
});
test('pause cancels document scrolling throughout nested reader frames',async t=>{
  const p=await setup(t,{confirm:false});
  const f=p.frames().find(f=>f.url().endsWith('/mock-1'));
  await f.waitForFunction(()=>document.scrollingElement.scrollTop>0,null,{timeout:12000});
  await p.evaluate(()=>document.querySelector('#cards').contentWindow.postMessage({type:'xy-pause'},'*'));
  await p.waitForTimeout(1500);
  const before=await f.evaluate(()=>document.scrollingElement.scrollTop);
  await p.waitForTimeout(4500);
  assert.equal(await f.evaluate(()=>document.scrollingElement.scrollTop),before);
  assert.equal(await p.evaluate(()=>reports.at(-1).stage),'idle');
});
