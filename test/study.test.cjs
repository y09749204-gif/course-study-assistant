const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('./helpers/mock-course.cjs');
const {coursePage,nextSix}=require('../src/study.cjs');

test('only the configured Zhihuishu course URL is accepted',()=>{
  assert.equal(coursePage(C.COURSE_URL,C.COURSE_ID),true);
  assert.equal(coursePage('https://example.com/study/index?recruitAndCourseId='+C.COURSE_ID),false);
  assert.equal(coursePage('https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=other'),false);
});
test('new complete lessons and 25 normal minutes must both be met',()=>{
  let state={...C.emptyState('2026-09-28'),status:'running',baseline:['1.5']};
  state=C.markCompleted(state,'1.5');
  assert.deepEqual(state.completed,[]);
  state=C.markCompleted(C.markCompleted(state,'1.1'),'1.2');
  assert.equal(C.meetsGoal(state),false);
  state={...state,seconds:1499};
  state=C.creditPlayback(state,10,11,1,1);
  assert.equal(C.meetsGoal(state),true);
  assert.equal(C.creditPlayback(state,11,40,1,1).seconds,1500);
  assert.equal(C.creditPlayback(state,11,12,1,1.5).seconds,1500);
});
test('next unstarted lesson skips completed and partial progress',()=>{
  assert.equal(C.nextUnstartedLesson([
    {id:'1.1',complete:true,unstarted:false},
    {id:'1.2',complete:false,unstarted:false},
    {id:'1.3',complete:false,unstarted:true},
  ]).id,'1.3');
});
test('missed 06:00 check runs when app starts later',()=>{
  const early=new Date('2026-09-27T21:59:00Z');
  const later=new Date('2026-09-27T23:00:00Z');
  assert.equal(C.shouldStart(true,null,early),false);
  assert.equal(C.shouldStart(true,null,later),true);
  assert.equal(C.shouldStart(true,{day:C.dayKey(later),status:'complete'},later),false);
});
test('next scheduled check is in the future',()=>{
  const next=nextSix();
  assert.ok(next>Date.now());
  assert.ok(next-Date.now()<=24*60*60*1000);
});
