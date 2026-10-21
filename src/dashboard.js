const el=id=>document.getElementById(id);
let current=null,environmentState=null,moocState=null,selected='mayuan',resizeRequest=0,refreshVersion=0,operationBusy=false,uiError='';
const platformNames={mayuan:'智慧树',xueyin:'学习通',icourse:'中国大学 MOOC'};
const activeData=()=>selected==='icourse'?moocState:selected==='xueyin'?environmentState:current;
const activeApi=()=>selected==='icourse'?mooc:selected==='xueyin'?environment:study;
let courseList=null,selectedProfile='mayuan',onboardingShown=false;
const labels={idle:'未开始',running:'进行中',paused:'已暂停',blocked:'需要处理',interrupted:'已中断',ended:'已结束',complete:'已完成',submitting:'提交中'};
const applyWidth=width=>{document.documentElement.style.setProperty('--sidebar-width',`${width}px`);el('divider').setAttribute('aria-valuenow',String(width));};
function closeMenu(focus=false){el('moreMenu').hidden=true;el('moreButton').setAttribute('aria-expanded','false');if(focus)el('moreButton').focus();}
function showTab(name){
  const settings=name==='settings';
  el('studyPanel').hidden=settings||selected!=='mayuan';el('environmentPanel').hidden=settings||selected!=='xueyin';
  el('moocPanel').hidden=settings||selected!=='icourse';
  el('taskPanel').hidden=settings;el('settingsPanel').hidden=!settings;
  el('xySettings').hidden=!!globalThis.courses||selected!=='xueyin';el('mayuanConfig').hidden=selected!=='mayuan';
  el('mayuanReview').hidden=selected!=='mayuan';el('environmentReview').hidden=selected!=='xueyin';
  el('moocReview').hidden=selected!=='icourse';
  el('tabSettings').setAttribute('aria-expanded',String(settings));closeMenu();el('sidebar').scrollTop=0;
}
function renderReview(data){
  const day=data.dailyState;
  const pending=(data.dailyHistory||[]).filter(item=>item.status==='complete'&&item.completed.length>=(item.goal?.minLessons||2)&&item.seconds>=(item.goal?.minMinutes||25)*60).at(-1);
  const review=pending?.platformReview;
  el('platform').textContent=review?.state==='confirmed'?'平台已计入':review?.state==='difference'?'平台数据有差异':review?.state==='login-required'?'成绩分析需登录':day.status==='complete'?'待次日核对':'待核对';
  el('history').textContent=pending?`${pending.day}：本地 ${pending.completed.length} 节、${Math.floor(pending.seconds/60)} 分钟；${review?.state==='confirmed'?'平台已记录时长和小节':review?.state==='difference'?'平台记录与本地不同，稍后自动复查':review?.state==='login-required'?'需要在课程会话中登录成绩分析':'等待平台数据'}`:day.status==='complete'?`今天 ${day.day}：本地 ${day.completed.length} 节、${Math.floor(day.seconds/60)} 分钟；明日自动核对`:'暂无达到本地目标的待核对日期';
  el('checkPlatform').disabled=data.reportConfigured===false;el('openScore').disabled=data.reportConfigured===false;
  const preview=data.platformPreview;
  el('platformNote').textContent=preview?.day===day.day&&preview.state==='observed'?`今日平台预览：${preview.habitDayPresent?`${preview.habitMinutes??'未显示'} 分钟`:'尚无当日时长'}${preview.courseEndDay&&preview.courseEndDay<day.day?`；课程截止 ${preview.courseEndDay}`:''}；正式核对以次日更新为准`:preview?.state==='login-required'?'成绩分析需要登录；请打开成绩分析完成登录':preview?.state==='unavailable'?'读取失败，请稍后重试':data.reportConfigured===false?'这门课程尚未配置成绩分析链接；请在课程配置中填写。':'';
}
function renderTask(){
  if(!current||!environmentState)return;
  const xy=selected==='xueyin',isMooc=selected==='icourse',data=activeData();if(!data)return;
  const state=xy||isMooc?data:data.dailyState;
  const issue=xy?data.playbackObservation?.issue:null;
  const manual=xy&&data.status==='blocked'&&data.playbackObservation?.playing===true;
  const failed=['download-failed','playback-failed','media-error'].includes(issue),stalled=issue==='stalled';
  const intent=xy&&!!data.submissionIntent;
  const warning=!!uiError||failed||stalled||['blocked','interrupted'].includes(state.status)||intent;
  const label=uiError?'操作失败':failed?'视频加载失败':stalled?'播放卡住':manual?'手动播放中':state.status==='complete'&&!xy&&!isMooc?'本地达标':labels[state.status]||state.status;
  el('badge').textContent=label;el('badge').title=label;
  el('badge').dataset.tone=warning?'warning':state.status==='complete'?'success':['running','submitting'].includes(state.status)?'active':'neutral';
  const section=xy?data.currentSection:isMooc&&data.courseOnTarget?(data.currentSection?`内容 ${data.currentSection}`:null):state.currentLessonConfirmed===true&&data.courseOnTarget?state.currentLesson:null;
  el('currentSection').textContent=section||'待确认';
  const videoIndex=xy?(/\/video\/(\d+)$/.exec(data.currentTask||'')?.[1]??null):null;
  const documentIndex=xy?(/\/document\/(\d+)$/.exec(data.currentTask||'')?.[1]??null):null;
  el('taskKind').textContent=xy&&data.currentIsQuiz?'章节测验':videoIndex!==null?`第 ${Number(videoIndex)+1} 段视频`:documentIndex!==null?`浏览第 ${Number(documentIndex)+1} 份文档`:'';
  let message=uiError||state.blockedReason||'';
  if(isMooc&&!message)message=data.waitingNext?'视频已自然结束，等待平台自动切换；完成情况请在平台核对。':'请在课程页勾选“自动播放下一视频”。正常速度续播；文档、测验和考试需手动处理。';
  if(stalled)message='视频时间超过 20 秒未前进。请检查播放器，或在 Chrome 继续观看；平台任务点待确认。';
  else if(failed)message=issue==='media-error'?`播放器报告媒体错误（代码 ${data.playbackObservation.mediaErrorCode||'未知'}）。请在 Chrome 核对同一视频。`:issue==='playback-failed'?'播放器无法播放，请在 Chrome 核对同一视频。':'视频下载失败，请展开课程手动切换线路或刷新。';
  else if(manual){
    const {positionSeconds:time,durationSeconds:duration}=data.playbackObservation;
    const progress=Number.isFinite(time)&&Number.isFinite(duration)?`（${Math.floor(time/60)} / ${Math.ceil(duration/60)} 分钟）`:'';
    message=`视频手动播放中${progress}；自动任务仍暂停。${message}`;
  }
  else if(!message){
    message=intent?'正在等待平台确认提交结果，请勿重复提交。':data.configured===false?'请先到设置页保存课程链接。':!data.windowOpen?'开始任务会打开课程；登录或验证码需在课程页完成。':!data.courseOnTarget?'课程正在登录或加载，请等待页面就绪。':state.status==='complete'?(xy?'平台已确认全课完成。':'已达到本地目标，平台记录待次日核对。'):!section?'当前小节待确认，正在读取平台状态。':state.status==='paused'?'任务已暂停，恢复后继续处理当前小节。':xy&&data.currentIsQuiz?'正在处理当前章节测验，请等待平台回报。':'按正常速度处理课程，完成情况以平台记录为准。';
  }
  el('detail').hidden=xy;el('xyDetail').hidden=!xy;
  el(xy?'xyDetail':'detail').textContent=message;
  el('taskInfo').classList.toggle('warning',warning);
  el('taskInfo').hidden=intent;
  const detailNode=el(xy?'xyDetail':'detail');
  const wasExpanded=el('taskInfo').classList.contains('expanded');
  el('taskInfo').classList.remove('expanded');
  const hasOverflow=message.length>75||detailNode.scrollHeight>detailNode.clientHeight;
  if(wasExpanded&&hasOverflow)el('taskInfo').classList.add('expanded');
  el('toggleDetail').hidden=!hasOverflow;
  if(!hasOverflow){el('taskInfo').classList.remove('expanded');el('toggleDetail').setAttribute('aria-expanded','false');el('toggleDetail').textContent='查看完整说明';}
  el('xyResolvePanel').hidden=!intent;
  el('primaryAction').textContent=intent||state.status==='submitting'?'等待提交确认':state.status==='running'?'暂停':state.status==='complete'?'查看课程':['paused','blocked','interrupted'].includes(state.status)?'恢复':'开始';
  el('primaryAction').disabled=operationBusy||intent||state.status==='submitting'||data.configured===false;
  el('taskFootnote').hidden=warning;
  el('courseSelect').disabled=operationBusy;
  el('open').disabled=operationBusy;el('end').disabled=operationBusy||intent||state.status==='submitting';
  el('refreshCourse').disabled=operationBusy||!data.windowOpen;el('closeCourse').disabled=operationBusy||!data.windowOpen;
}
async function refresh(){
  const version=++refreshVersion;
  try{
    const [data,xy,pinned,profiles]=await Promise.all([study.status(),environment.status(),study.windowPinned?study.windowPinned():true,globalThis.courses?courses.list():null]);
    if(version!==refreshVersion)return;
    current=data;environmentState=xy;
    moocState=profiles?.profiles.some(p=>p.platform==='icourse')&&globalThis.mooc?await mooc.status():null;
    if(version!==refreshVersion)return;
    if(profiles){
      const selectionChanged=selectedProfile!==profiles.selectedId;
      courseList=profiles;selectedProfile=profiles.selectedId;
      if(selectionChanged&&!el('settingsPanel').hidden&&el('profileEdit').dataset.new!=='true')loadProfile(selectedProfile);
      if(!onboardingShown){onboardingShown=true;if(!profiles.profiles.some(p=>p.configured)){showTab('settings');el('courseSettings').open=true;}}
      const profile=profiles.profiles.find(p=>p.id===selectedProfile);
      const platform=profile?.platform||'mayuan';
      if(selected!==platform){selected=platform;showTab(el('settingsPanel').hidden?'study':'settings');}
      const signature=JSON.stringify(profiles.profiles.map(p=>[p.id,p.name,p.platform]));
      if(el('courseSelect').dataset.profiles!==signature){
        for(const id of ['courseSelect','profileEdit']){
          const select=el(id),previous=select.value;select.replaceChildren(...profiles.profiles.map(p=>new Option(p.name+(id==='profileEdit'?` · ${platformNames[p.platform]}`:''),p.id)));select.value=profiles.profiles.some(p=>p.id===previous)?previous:selectedProfile;
        }
        el('courseSelect').dataset.profiles=signature;
        if(!el('profileName').value)loadProfile(selectedProfile);
      }
    }
    const activeCourse=xy.windowOpen&&!data.windowOpen?'xueyin':data.windowOpen&&!xy.windowOpen?'mayuan':null;
    if(!profiles&&activeCourse&&selected!==activeCourse){selected=activeCourse;showTab(el('settingsPanel').hidden?'study':'settings');}
    el('courseSelect').value=profiles?selectedProfile:selected;el('courseSelect').title=el('courseSelect').selectedOptions[0]?.textContent||'';
    el('pinWindow').setAttribute('aria-pressed',String(pinned));el('pinWindow').title=pinned?'取消置顶':'置顶窗口';el('pinWindow').setAttribute('aria-label',el('pinWindow').title);
    document.body.classList.toggle('compact',data.courseExpanded!==true);
    el('expandCourse').textContent=data.courseExpanded===true?'收起课程 ↙':'展开课程 ↗';
    if(!resizeRequest)applyWidth(data.sidebarWidth||360);
    el('lessons').textContent=String(data.dailyState.completed.length);el('minutes').textContent=String(Math.floor(data.dailyState.seconds/60));
    el('lessonGoal').textContent=`目标 ${data.goals?.minLessons||2} 节`;el('minuteGoal').textContent=`目标 ${data.goals?.minMinutes||25} 分钟`;
    el('xyCount').textContent=`${xy.platformDone??'—'} / ${xy.platformTotal??'—'}`;el('xyQuizzes').textContent=String((xy.submittedQuizzes||[]).length);
    el('moocEnded').textContent=String(moocState?.observedEnded?.length||0);el('moocMinutes').textContent=String(Math.floor((moocState?.seconds||0)/60));
    el('auto').checked=!!data.enabled;el('xyAuto').checked=!!xy.enabled;
    el('xyConfigNote').textContent=xy.configured?'课程链接已加密保存在本机':'尚未配置课程链接';
    const active=activeData()||data;
    el('courseProvider').textContent=platformNames[selected];el('courseDate').textContent=data.dailyState.day||'';
    const profileName=profiles?.profiles.find(p=>p.id===selectedProfile)?.name||(selected==='xueyin'?'学习通':'智慧树');
    el('webTitle').textContent=`${platformNames[selected]} · ${profileName}`;
    el('courseLocation').textContent=active.courseOnTarget?'课程已打开':active.windowOpen?'登录或加载中':'尚未打开';
    el('coursePlaceholder').hidden=!!active.windowOpen;el('backCourse').hidden=selected!=='mayuan'||!data.scoreRequested;
    el('openRight').textContent=`打开${profileName}课程`;
    renderReview(data);renderTask();
  }catch(error){if(version===refreshVersion){uiError=`读取失败：${error.message}`;renderTask();}}
}
async function selectCourse(course){
  if(course===selected)return;
  if(course==='xueyin'&&current?.windowOpen){await study.command('PAUSE');await study.closeCourse();}
  if(course==='mayuan'&&environmentState?.windowOpen){await environment.command('PAUSE');await environment.close();}
  selected=course;showTab(el('settingsPanel').hidden?'study':'settings');
}
async function run(work){
  if(operationBusy)return;
  operationBusy=true;uiError='';closeMenu();renderTask();
  try{await work();}catch(error){uiError=`操作失败：${error.message}`;}
  finally{operationBusy=false;await refresh();}
}
const openCourse=()=>activeApi().open();
el('courseSelect').onchange=event=>run(()=>globalThis.courses?courses.select(event.target.value):selectCourse(event.target.value));
el('open').onclick=()=>run(openCourse);el('openRight').onclick=()=>run(openCourse);
el('backCourse').onclick=()=>run(()=>study.open());
el('primaryAction').onclick=()=>run(()=>{
  const state=selected==='mayuan'?current.dailyState:activeData();if(!state)return;
  if(selected==='xueyin'&&environmentState.submissionIntent||state.status==='submitting')return;
  if(state.status==='complete')return openCourse();
  return activeApi().command(state.status==='running'?'PAUSE':selected==='mayuan'?'START':'RUN');
});
el('end').onclick=()=>run(()=>activeApi().command('END'));
el('refreshCourse').onclick=()=>run(()=>selected==='mayuan'?study.refreshCourse():activeApi().refresh());
el('closeCourse').onclick=()=>run(()=>selected==='mayuan'?study.closeCourse():activeApi().close());
el('auto').onchange=event=>run(()=>study.enable(event.target.checked));el('xyAuto').onchange=event=>run(()=>environment.enable(event.target.checked));
el('checkPlatform').onclick=()=>run(()=>study.platformReview());el('openScore').onclick=()=>run(()=>study.openScore());
el('tabStudy').onclick=()=>showTab('study');el('tabSettings').onclick=()=>{if(el('settingsPanel').hidden&&courseList)loadProfile(selectedProfile);showTab(el('settingsPanel').hidden?'settings':'study');};
el('xySubmitted').onclick=()=>run(()=>environment.resolveSubmission('submitted'));el('xyNotSubmitted').onclick=()=>run(()=>environment.resolveSubmission('not-submitted'));
el('xySaveUrl').onclick=async()=>{try{await environment.saveUrl(el('xyUrl').value);el('xyUrl').value='';await refresh();}catch(error){el('xyConfigNote').textContent=error.message;}};
el('saveAi').onclick=async()=>{try{const result=await study.aiSave({mode:el('mode').value,endpoint:el('endpoint').value,model:el('model').value,key:el('key').value});el('key').value='';el('aiNote').textContent=el('mode').value==='codex-plan'?'已保存 · 使用 ChatGPT 套餐额度':result.hasKey?'已保存 · Key 已加密':'已保存';}catch(error){el('aiNote').textContent=error.message;}};
el('clearKey').onclick=async()=>{try{await study.aiSave({mode:el('mode').value,endpoint:el('endpoint').value,model:el('model').value,clearKey:true});el('aiNote').textContent='Key 已清除';}catch(error){el('aiNote').textContent=error.message;}};
function updateAiMode(){
  const plan=el('mode').value==='codex-plan';el('endpoint').disabled=plan;el('key').disabled=plan;el('clearKey').disabled=plan;
  if(plan){if(!el('model').value.startsWith('gpt-'))el('model').value='gpt-6.1-sol';el('aiNote').textContent='复用本机 Codex 的 ChatGPT 登录；使用套餐额度，无需 API Key。';}
}
el('mode').onchange=updateAiMode;
study.aiGet().then(config=>{el('mode').value=config.mode||'off';el('endpoint').value=config.endpoint||'';el('model').value=config.model||'';el('aiNote').textContent=config.hasKey?'已保存加密 Key':'';updateAiMode();}).catch(error=>{el('aiNote').textContent=`读取设置失败：${error.message}`;});
el('toggleDetail').onclick=()=>{const expanded=el('taskInfo').classList.toggle('expanded');el('toggleDetail').setAttribute('aria-expanded',String(expanded));el('toggleDetail').textContent=expanded?'收起说明':'查看完整说明';};
const menuItems=()=>[...el('moreMenu').querySelectorAll('button')].filter(button=>!button.disabled);
function openMenu(focus=false){el('moreMenu').hidden=false;el('moreButton').setAttribute('aria-expanded','true');if(focus)menuItems()[0]?.focus();}
el('moreButton').onclick=()=>el('moreMenu').hidden?openMenu():closeMenu();
el('moreButton').onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();openMenu(true);}};
el('moreMenu').onkeydown=event=>{
  const items=menuItems(),index=items.indexOf(document.activeElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
  if(event.key==='Tab'){closeMenu(true);}
};
document.addEventListener('pointerdown',event=>{if(!el('moreMenu').contains(event.target)&&!el('moreButton').contains(event.target))closeMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!el('moreMenu').hidden){event.preventDefault();closeMenu(true);}});
el('pinWindow').onclick=()=>run(()=>study.windowPinned(el('pinWindow').getAttribute('aria-pressed')!=='true'));
el('expandCourse').onclick=()=>run(()=>study.setCourseExpanded(current?.courseExpanded!==true));
const divider=el('divider');
const resize=x=>{const request=++resizeRequest;void study.resizePane(x).then(width=>{if(request===resizeRequest)applyWidth(width);}).catch(()=>{});void environment.resizePane(x).catch(()=>{});if(moocState)void mooc.resizePane(x).catch(()=>{});};
divider.addEventListener('pointerdown',event=>{divider.setPointerCapture(event.pointerId);divider.dataset.dragging='true';event.preventDefault();});
divider.addEventListener('pointermove',event=>{if(divider.dataset.dragging==='true')resize(event.clientX);});
const endDrag=()=>{delete divider.dataset.dragging;resizeRequest=0;void refresh();};
divider.addEventListener('pointerup',endDrag);divider.addEventListener('pointercancel',endDrag);divider.addEventListener('lostpointercapture',endDrag);
divider.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();resize(Number(divider.getAttribute('aria-valuenow'))+(event.key==='ArrowRight'?20:-20));});
void refresh();setInterval(refresh,3000);

function loadProfile(id){
  const p=courseList?.profiles.find(p=>p.id===id);if(!p)return;
  el('profileEdit').value=id;el('profileEdit').dataset.new='false';el('profileName').value=p.name;el('profilePlatform').value=p.platform;el('profilePlatform').disabled=true;
  el('profileLessons').value=p.minLessons;el('profileMinutes').value=p.minMinutes;el('profileUrl').value='';el('profileScore').value='';el('profileGoals').hidden=p.platform!=='mayuan';el('profileChapterField').hidden=p.platform!=='xueyin';el('profileChapters').value=p.expectedChapters||'';el('profileNote').textContent='链接加密保存，不会回显。更换课程身份请新增课程。';
}
el('profileEdit').onchange=()=>loadProfile(el('profileEdit').value);
el('profilePlatform').onchange=()=>{el('profileGoals').hidden=el('profilePlatform').value!=='mayuan';el('profileChapterField').hidden=el('profilePlatform').value!=='xueyin';};
el('profileNew').onclick=()=>{el('profileEdit').dataset.new='true';el('profileEdit').selectedIndex=-1;el('profileName').value='';el('profileUrl').value='';el('profileScore').value='';el('profilePlatform').disabled=false;el('profileChapters').value='';el('profileNote').textContent='新增课程使用独立进度记录。请填写名称、平台和学习页面链接。';el('profileName').focus();};
el('profileSave').onclick=()=>run(async()=>{
  if(!globalThis.courses)return;
  try{const result=await courses.save({id:el('profileEdit').dataset.new==='true'?undefined:el('profileEdit').value,name:el('profileName').value,platform:el('profilePlatform').value,
    url:el('profileUrl').value,scoreUrl:el('profileScore').value,expectedChapters:Number(el('profileChapters').value),minLessons:Number(el('profileLessons').value),minMinutes:Number(el('profileMinutes').value)});
  courseList=result;selectedProfile=result.selectedId;loadProfile(selectedProfile);el('profileNote').textContent='已保存。原有记录保留，课程任务已暂停，可返回学习后开始。';}
  catch(error){el('profileNote').textContent=error.message;throw error;}
});
