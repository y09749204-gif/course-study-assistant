const SCORE_ORIGIN='https://stuonline.zhihuishu.com';
const SCORE_PATH='/stuonline/json/stuLearnReportNew/';
const COURSE_ID='',RECRUIT_ID='',REPORT_URL='';
function requireProfile(profile){
  if(!/^\d{1,20}$/.test(profile?.courseId||'')||!/^\d{1,20}$/.test(profile?.recruitId||''))throw Error('score-unconfigured');
}

const mapKey=day=>`${day.slice(5,7)}.${day.slice(8,10)}`;
const number=value=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>=0?parsed:null;
};

async function request(session,endpoint,profile){
  requireProfile(profile);
  const courseId=profile?.courseId||COURSE_ID,recruitId=profile?.recruitId||RECRUIT_ID;
  const response=await session.fetch(`${SCORE_ORIGIN}${SCORE_PATH}${endpoint}/`,{
    method:'POST',credentials:'include',redirect:'follow',
    headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:new URLSearchParams({courseId,recruitId,type:'l'}).toString(),
    signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Error('score-session-unavailable');
  const text=await response.text();
  if(text.length>2_000_000)throw Error('score-response-too-large');
  if(/^\s*</.test(text))throw Error('score-session-unavailable');
  try{return JSON.parse(text);}catch{throw Error('score-response-invalid');}
}

function summarize(habit,progress,day,lessonIds=[],profile){
  const recruitId=profile?.recruitId||RECRUIT_ID;
  if(String(habit?.recruitId)!==recruitId||String(progress?.recruitId)!==recruitId)
    return {state:'unavailable',reason:'course-mismatch'};
  if(progress?.studentId==null)
    return {state:'login-required',reason:'score-session-unavailable'};
  const record=habit.stuStudyRecord;
  const raw=habit.studentStudyMap?.[mapKey(day)];
  const values=typeof raw==='string'?raw.split(/[,，]/).map(number):[];
  const habitMinutes=values[0]??null;
  const chapters=progress.chapterOrLesson?.clList;
  const found=new Map();
  if(Array.isArray(chapters))for(const chapter of chapters){
    if(!Array.isArray(chapter.lessonTempDtos))continue;
    for(const lesson of chapter.lessonTempDtos){
      const id=`${chapter.chapterOrder}.${lesson.lessonOrder}`;
      found.set(id,number(lesson.watchStatus));
    }
  }
  const lessons=lessonIds.map(id=>({id,watchStatus:found.get(id)??null}));
  return {
    state:'observed',day,habitMinutes,habitDetail:values[1]??null,
    suggestedMinutes:number(record?.suggestTime)??25,
    habitDayPresent:raw!==undefined,
    lessonStatuses:lessons,
    courseEndDay:typeof habit.courseEndTime==='string'&&/^\d{8}$/.test(habit.courseEndTime)?
      habit.courseEndTime.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):null,
  };
}

async function readPlatformReview(session,day,lessonIds,profile){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Invalid review day');
  const [habit,progress]=await Promise.all([
    request(session,'loadStuHabit',profile),request(session,'loadStuLearingTab',profile),
  ]);
  return {...summarize(habit,progress,day,lessonIds,profile),checkedAt:new Date().toISOString()};
}

async function readPlatformReviewInPage(webContents,day,lessonIds,profile){
  requireProfile(profile);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Invalid review day');
  const script=`(async()=>{
    if(location.origin!==${JSON.stringify(SCORE_ORIGIN)})throw Error('score-page-origin');
    const body=new URLSearchParams({courseId:${JSON.stringify(profile?.courseId||COURSE_ID)},recruitId:${JSON.stringify(profile?.recruitId||RECRUIT_ID)},type:'l'});
    async function read(name){
      const response=await fetch(${JSON.stringify(SCORE_ORIGIN+SCORE_PATH)}+name+'/',{
        method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body});
      if(!response.ok)throw Error('score-session-unavailable');
      const text=await response.text();
      if(text.length>2000000||/^\\s*</.test(text))throw Error('score-response-invalid');
      return JSON.parse(text);
    }
    return Promise.all([read('loadStuHabit'),read('loadStuLearingTab')]);
  })()`;
  const [habit,progress]=await webContents.executeJavaScript(script);
  return {...summarize(habit,progress,day,lessonIds,profile),checkedAt:new Date().toISOString()};
}

async function primeScoreSession(session,profile){
  requireProfile(profile);
  if(!profile.url||new URL(profile.url).origin!==SCORE_ORIGIN)throw Error('score-unconfigured');
  const response=await session.fetch(profile?.url||REPORT_URL,{method:'GET',credentials:'include',redirect:'follow',
    signal:AbortSignal.timeout(15000)});
  return response.ok;
}

module.exports={readPlatformReview,readPlatformReviewInPage,primeScoreSession,REPORT_URL,summarize};
