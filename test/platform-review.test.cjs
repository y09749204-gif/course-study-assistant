const test=require('node:test');
const assert=require('node:assert/strict');
const {readPlatformReview,readPlatformReviewInPage,summarize}=require('../src/platform-review.cjs');

const profile={courseId:'111',recruitId:'222'};
const habit={recruitId:222,courseEndTime:'20261031',stuStudyRecord:{suggestTime:25},
  studentStudyMap:{'09.29':'27,1'}};
const progress={recruitId:222,studentId:123,ssd:{studentId:null},chapterOrLesson:{clList:[
  {chapterOrder:1,lessonTempDtos:[{lessonOrder:3,watchStatus:1}]},
  {chapterOrder:2,lessonTempDtos:[{lessonOrder:1,watchStatus:1}]},
]}};

test('extracts only the requested day and lessons from an authenticated score response',()=>{
  assert.deepEqual(summarize(habit,progress,'2026-09-29',['1.3','2.1'],profile),{
    state:'observed',day:'2026-09-29',habitMinutes:27,habitDetail:1,
    suggestedMinutes:25,habitDayPresent:true,
    lessonStatuses:[{id:'1.3',watchStatus:1},{id:'2.1',watchStatus:1}],
    courseEndDay:'2026-10-31',
  });
});

test('anonymous score responses cannot confirm platform credit',()=>{
  const anonymous={...progress,studentId:null};
  assert.deepEqual(summarize(habit,anonymous,'2026-09-29',['1.3'],profile),{
    state:'login-required',reason:'score-session-unavailable',
  });
});

test('missing dated habit data stays unknown',()=>{
  const result=summarize(habit,progress,'2026-09-30',['1.3'],profile);
  assert.equal(result.habitDayPresent,false);
  assert.equal(result.habitMinutes,null);
});

test('reads fixed first-party score endpoints using the course session',async()=>{
  const seen=[];
  const session={fetch:async(url,init)=>{
    seen.push({url,init});
    const body=url.includes('loadStuHabit')?habit:progress;
    return {ok:true,text:async()=>JSON.stringify(body)};
  }};
  const result=await readPlatformReview(session,'2026-09-29',['1.3'],profile);
  assert.equal(result.state,'observed');
  assert.equal(seen.length,2);
  assert.ok(seen.every(x=>x.url.startsWith('https://stuonline.zhihuishu.com/stuonline/json/stuLearnReportNew/')));
  assert.ok(seen.every(x=>x.init.credentials==='include'));
  assert.ok(seen.every(x=>x.init.method==='POST'));
  assert.ok(seen.every(x=>new URLSearchParams(x.init.body).get('recruitId')==='222'));
});

test('reads score data from the authenticated score page context',async()=>{
  const scripts=[];
  const page={executeJavaScript:async script=>{scripts.push(script);return [habit,progress];}};
  const result=await readPlatformReviewInPage(page,'2026-09-29',['1.3','2.1'],profile);
  assert.equal(result.state,'observed');
  assert.equal(result.habitMinutes,27);
  assert.equal(scripts.length,1);
  assert.match(scripts[0],/location\.origin/);
  assert.match(scripts[0],/loadStuHabit/);
  assert.match(scripts[0],/loadStuLearingTab/);
});
