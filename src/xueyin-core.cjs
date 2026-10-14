const OFFICIAL_HOSTS=['xueyinonline.com','chaoxing.com'];
const isOfficialHost=host=>OFFICIAL_HOSTS.some(domain=>host===domain||host.endsWith('.'+domain));
const allowedOrigin=value=>{
  try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value&&isOfficialHost(url.hostname);}catch{return false;}
};
const allowedDomain=value=>typeof value==='string'&&isOfficialHost(value.replace(/^\./,''));

function validateLaunchURL(value){
  const url=new URL(String(value||'').trim());
  if(url.protocol!=='https:'||!['mooc2-ans.xueyinonline.com','mooc2-ans.chaoxing.com'].includes(url.hostname)||
    url.pathname!=='/mooc2-ans/mycourse/stu')throw Error('请粘贴学习通课程的学习页面链接');
  const fields=['courseid','clazzid','cpi','enc'];
  if(fields.some(key=>!url.searchParams.get(key)))throw Error('课程链接缺少必要参数');
  return {url:url.href,identity:{courseid:url.searchParams.get('courseid'),clazzid:url.searchParams.get('clazzid')}};
}

function isStudyPage(value,identity){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||!isOfficialHost(url.hostname)||
      !(url.pathname.includes('/mooc2-ans/')||url.pathname==='/mycourse/studentstudy'))return false;
    const courseId=url.searchParams.get('courseid')||url.searchParams.get('courseId');
    const clazzId=url.searchParams.get('clazzid')||url.searchParams.get('clazzId');
    return (!courseId||courseId===identity.courseid)&&(!clazzId||clazzId===identity.clazzid);
  }catch{return false;}
}

const emptyState=()=>({enabled:false,status:'idle',blockedReason:null,day:null,
  currentSection:null,currentTask:null,platformDone:null,platformTotal:null,
  currentIsQuiz:false,
  completedTaskIds:[],submittedQuizzes:[],quizStatuses:{},submissionIntent:null,
  awaitingPlatform:null,
  lastObservedAt:null,startedAt:null,sectionPending:{},quizScanComplete:false,expectedChapterCount:0,
  pageDiagnostics:{}});
const localDay=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const localHour=(date=new Date())=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(date));
const shouldAutoRun=(state,mayuan,date=new Date())=>state.enabled&&localHour(date)>=6&&
  !['complete','paused','blocked','submitting','ended'].includes(state.status)&&mayuan?.status!=='running';
const taskCount=text=>{
  const source=String(text||'');
  const match=source.match(/(?:已完成|已学习|已完成的)任务点\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/)||
    source.match(/(?:已完成|已学习)\s*(\d+)\s*个?\s*\/\s*(\d+)\s*个?任务点/);
  const prose=source.match(/(?:共|开放学习的)\s*(\d+)\s*个任务点[^。\n]{0,60}?(?:已完成|已学习)了?\s*(\d+)\s*个/);
  if(!match&&!prose)return null;
  const done=Number(match?.[1]??prose[2]),total=Number(match?.[2]??prose[1]);
  return total>0&&done<=total?{done,total}:null;
};
module.exports={isOfficialHost,allowedOrigin,allowedDomain,validateLaunchURL,isStudyPage,
  emptyState,localDay,localHour,shouldAutoRun,taskCount};
