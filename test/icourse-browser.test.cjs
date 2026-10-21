const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {attach}=require('../src/icourse-agent.cjs');
const coreSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/icourse-core.cjs'),'utf8');
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});});
test.after(async()=>{await browser?.close();});
async function setup(t){
  const p=await browser.newPage();t.after(()=>p.close());
  await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<video style="width:320px;height:180px"></video><label><input type="checkbox" checked>自动播放下一视频</label>'}));
  await p.goto('https://www.icourse163.org/mooc/learn/MOCK-100/content/200?tid=300&unitId=400');
  await p.evaluate(()=>{
    window.state={status:'running',epoch:1};window.reports=[];window.paused=true;window.time=0;window.ended=false;window.source='mock-a';
    const v=document.querySelector('video');Object.defineProperties(v,{paused:{get:()=>paused},ended:{get:()=>ended},readyState:{get:()=>4},currentTime:{get:()=>time},currentSrc:{get:()=>source}});
    v.play=async()=>{paused=false;window.plays=(window.plays||0)+1;};v.pause=()=>{paused=true;};
    window.bridge={state:async()=>({...state}),onCommand:fn=>window.pauseCommand=fn,report:async value=>{reports.push(value);if(['no-video','next-unconfirmed','stalled'].includes(value.issue))state.status='blocked';return true;}};
  });
  await p.addScriptTag({content:`window.MockMoocCore=(()=>{const module={exports:{}};${coreSource};return module.exports;})();`});
  await p.addScriptTag({content:`(${attach.toString()})({bridge:window.bridge,identity:{course:'MOCK-100',term:'300'},matches:MockMoocCore.coursePage});`});
  await p.waitForFunction(()=>reports.some(r=>r.issue==='playing'));
  return p;
}
test('MOOC uses normal muted playback and follows native unit navigation',async t=>{
  const p=await setup(t);assert.equal(await p.evaluate(()=>document.querySelector('video').muted),true);
  assert.equal(await p.evaluate(()=>document.querySelector('video').playbackRate),1);
  await p.evaluate(()=>{ended=true;time=10;});await p.waitForFunction(()=>reports.some(r=>r.issue==='waiting-next'));
  await p.evaluate(()=>{history.pushState({},'',location.href.replace('content/200','content/201').replace('unitId=400','unitId=401'));source='mock-b';time=0;ended=false;paused=true;});
  await p.waitForFunction(()=>reports.some(r=>r.issue==='playing'&&r.unit==='201:401'));
  assert.equal(await p.evaluate(()=>state.status),'running');
  assert.equal(await p.evaluate(()=>reports.some(r=>r.issue==='complete')),false);
  await p.evaluate(()=>{state.status='paused';pauseCommand();});assert.equal(await p.evaluate(()=>paused),true);
});
test('MOOC stops when the platform does not advance after a natural end',async t=>{
  const p=await setup(t);await p.evaluate(()=>{ended=true;});await p.waitForFunction(()=>reports.some(r=>r.issue==='waiting-next'));
  await p.evaluate(()=>{const original=Date.now;Date.now=()=>original()+31000;});
  await p.waitForFunction(()=>state.status==='blocked');assert.equal(await p.evaluate(()=>reports.at(-1).issue),'next-unconfirmed');
});
