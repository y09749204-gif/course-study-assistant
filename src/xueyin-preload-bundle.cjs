const {ipcRenderer}=require('electron');
const officialHost=host=>['xueyinonline.com','chaoxing.com'].some(domain=>host===domain||host.endsWith('.'+domain));
if(location.protocol==='https:'&&officialHost(location.hostname)){
  try{
    const origin=location.origin;
    for(const [key,value] of ipcRenderer.sendSync('xy-auth-restore',origin))
      if(sessionStorage.getItem(key)===null)sessionStorage.setItem(key,value);
    let previous='';
    const snapshot=()=>{
      try{
        const entries=Array.from({length:sessionStorage.length},(_,i)=>{
          const key=sessionStorage.key(i);return [key,sessionStorage.getItem(key)];
        });
        const serialized=JSON.stringify(entries);
        if(serialized!==previous){ipcRenderer.sendSync('xy-auth-snapshot',{origin,entries});previous=serialized;}
      }catch{}
    };
    setInterval(snapshot,1000);
    addEventListener('pagehide',snapshot);
  }catch{}
  const chapterCards=location.pathname==='/mooc-ans/knowledge/cards';
  const quizWork=location.pathname==='/ananas/modules/work/index.html';
  const quizQuestions=['/mooc-ans/work/doHomeWorkNew','/mooc-ans/work/selectWorkQuestionYiPiYue'].includes(location.pathname);
  const attachFrame=()=>{runFrame();runDocumentFrame();};
  if(process.isMainFrame||location.pathname==='/mooc2-ans/mycourse/studentcourse'||
    chapterCards||quizWork||quizQuestions){
    if(process.isMainFrame)ipcRenderer.send('xy-diagnostic','preload-main');
    const commandListeners=[];
    const pendingCommands=[];
    ipcRenderer.on('xy-command',(_event,message)=>{
      if(!commandListeners.length)pendingCommands.push(message);
      else for(const listener of commandListeners)listener(message);
    });
    globalThis.XyBridge={
      state:()=>ipcRenderer.invoke('xy-state-get'),
      update:patch=>ipcRenderer.invoke('xy-state-update',patch),
      answer:question=>ipcRenderer.invoke('xy-answer',question),
      ocr:images=>ipcRenderer.invoke('xy-quiz-ocr',images),
      notify:message=>ipcRenderer.invoke('xy-notify',message),
      report:phase=>ipcRenderer.send('xy-diagnostic',phase),
      catalogDiagnostic:details=>ipcRenderer.send('xy-catalog-diagnostic',details),
      returnToCourse:()=>ipcRenderer.invoke('xy-document-return'),
      scroll:details=>ipcRenderer.invoke('xy-document-scroll',details),
      playback:details=>ipcRenderer.send('xy-playback-observation',details),
      onCommand:listener=>{
        commandListeners.push(listener);
        while(pendingCommands.length)listener(pendingCommands.shift());
      },
    };
    const attach=()=>{
      ipcRenderer.send('xy-diagnostic','attach-start');
      try{runContent();ipcRenderer.send('xy-diagnostic','attach-done');}
      catch(error){
        ipcRenderer.send('xy-diagnostic','attach-failed');
        const message=String(error?.message||'unknown').replace(/https?:\/\/\S+/g,'[url]')
          .replace(/[a-f0-9]{20,}/gi,'[id]').slice(0,180);
        const frame=String(error?.stack||'').match(/(?:xueyin-content|xueyin-preload)\.cjs:\d+:\d+/)?.[0]||'';
        ipcRenderer.send('xy-diagnostic-error',{name:String(error?.name||'Error').slice(0,40),message,frame});
      }
    };
    attach();
    if(chapterCards)attachFrame();
  }else attachFrame();
}

function runContent(){
(() => {
  const bridge=globalThis.XyBridge;
  const chapterCardFrame=location.pathname==='/mooc-ans/knowledge/cards';
  const quizWorkFrame=location.pathname==='/ananas/modules/work/index.html';
  const quizReviewFrame=location.pathname==='/mooc-ans/work/selectWorkQuestionYiPiYue';
  const quizQuestionFrame=location.pathname==='/mooc-ans/work/doHomeWorkNew'||quizReviewFrame;
  const quizFrame=chapterCardFrame||quizWorkFrame||quizQuestionFrame;
  if(!bridge||!(location.pathname.includes('/mooc2-ans/')||
    location.pathname==='/mycourse/studentstudy'||quizFrame))return;
  try{bridge.report?.('content-entry');}catch{}
  let state=null,busy=false,started=false,lastNavigation=Date.now(),lastVideoProgress=Date.now(),lastTime=0,
    playRequestedAt=0,playAttempts=0,navigationPending=null,lastControllerReport=0,
    chapterFrameSeen=null,chapterWaitSince=0,quizWait=null;
  const reportController=phase=>{
    if(Date.now()-lastControllerReport<10000)return;
    lastControllerReport=Date.now();
    try{bridge.report?.(phase);}catch{}
  };
  const frameStatus=new WeakMap();
  const knownChapterCards=new WeakMap();
  const priorPlayback=new WeakMap();
  const visible=node=>{try{
    if(!node)return false;
    const style=node.ownerDocument?.defaultView?.getComputedStyle(node);
    const rect=node.getBoundingClientRect();
    return !!style&&style.display!=='none'&&style.visibility!=='hidden'&&
      rect.width>0&&rect.height>0;
  }catch{return false;}};
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const now=()=>new Date().toISOString();
  const pauseAll=()=>{
    for(const video of document.querySelectorAll('video'))try{video.pause();}catch{}
    for(const frame of document.querySelectorAll('iframe'))try{frame.contentWindow.postMessage({type:'xy-pause'},'*');}catch{}
  };
  const save=async patch=>{state={...state,...patch};await bridge.update(patch);};
  const block=async reason=>{
    pauseAll();started=false;
    await save({status:'blocked',blockedReason:reason.slice(0,180),lastObservedAt:now()});
    await bridge.notify(reason);
  };
  const platformCount=()=>{
    const source=document.body?.innerText||'';
    const match=source.match(/(?:已完成|已学习|已完成的)任务点\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/)||
      source.match(/(?:已完成|已学习)\s*(\d+)\s*个?\s*\/\s*(\d+)\s*个?任务点/);
    const prose=source.match(/(?:共|开放学习的)\s*(\d+)\s*个任务点[^。\n]{0,60}?(?:已完成|已学习)了?\s*(\d+)\s*个/);
    if(!match&&!prose)return null;
    const done=Number(match?.[1]??prose[2]),total=Number(match?.[2]??prose[1]);
    return total>0&&done<=total?{done,total}:null;
  };
  const sectionId=value=>/^(\d+\.\d+)(?=\s|$)/.exec(clean(value))?.[1]||null;
  const green=value=>{
    const match=/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value||'');
    if(!match)return false;
    const [,red,channel,blue]=match.map(Number);
    return channel>=95&&channel>red*1.2&&channel>blue*1.12;
  };
  const completedCatalogRow=node=>{
    const bounds=node.getBoundingClientRect();
    return [...node.querySelectorAll('i,svg,span,[class*=icon]')].some(icon=>{
      const rect=icon.getBoundingClientRect();
      if(!visible(icon)||rect.width>42||rect.height>42)return false;
      // The platform's course catalog puts its explicit completion icon on
      // the right; generic color heuristics remain limited to the left gutter.
      if(icon.classList.contains('icon_Completed')||
        icon.classList.contains('catalog_state')&&icon.classList.contains('icon_yiwanc'))return true;
      if(rect.left>bounds.left+85)return false;
      const style=getComputedStyle(icon);
      return green(style.color)||green(style.backgroundColor)||green(style.fill)||
        green(style.stroke)||/(?:complete|finish|success|wancheng|yiwancheng)/i.test(String(icon.className));
    });
  };
  function catalog(){
    const found=new Map();
    const nodes=document.querySelectorAll('li,.chapter_item,[role=treeitem]');
    for(const node of nodes){
      if(!visible(node))continue;
      const lines=(node.innerText||'').trim().split('\n').map(clean).filter(Boolean);
      if(lines.length>3||lines.join(' ').length>130)continue;
      const id=sectionId(lines[0]);if(!id)continue;
      const rect=node.getBoundingClientRect();
      if(rect.height>90)continue;
      const text=lines.join(' '),quiz=/章节测验/.test(text);
      const raw=clean(node.innerText||'');
      const countMatch=raw.match(/(?:^|\s)(\d{1,3})\s*$/);
      const pending=!quiz&&completedCatalogRow(node)?0:countMatch?Number(countMatch[1]):null;
      const active=/active|selected|current/i.test(String(node.className))||
        node.getAttribute('aria-current')==='true';
      const existing=found.get(id);
      if(!existing||(pending!==null&&existing.pending===null)||
        (node.tagName==='LI'&&existing.node.tagName!=='LI'))
        found.set(id,{id,node,title:text,quiz,pending,active});
    }
    return [...found.values()].sort((a,b)=>{
      const [ax,ay]=a.id.split('.').map(Number),[bx,by]=b.id.split('.').map(Number);
      return ax-bx||ay-by;
    });
  }
  const catalogDiagnostic=()=>{
    const all=[...document.querySelectorAll('li,a,[role=treeitem],[class*=catalog],[class*=chapter]')];
    const samples=all.filter(node=>/^1\.1(?:\s|$)/.test(clean(node.innerText||''))).slice(0,8)
      .map(node=>{const rect=node.getBoundingClientRect();return {
        tag:node.tagName,classes:String(node.className).slice(0,100),
        width:Math.round(rect.width),height:Math.round(rect.height),
        lines:(node.innerText||'').trim().split('\n').length,
        chars:clean(node.innerText||'').length,visible:visible(node),
        start:clean(node.innerText||'').slice(0,90),
      };});
    const iframes=[...document.querySelectorAll('iframe')].slice(0,4).map(frame=>{
      try{const url=new URL(frame.src);return {host:url.hostname,path:url.pathname.slice(0,100)}}
      catch{return {host:'',path:''}}
    });
    return {candidateCount:all.length,sectionInBody:/1\.1\s*2026/.test(document.body?.innerText||''),
      iframeCount:document.querySelectorAll('iframe').length,videoCount:taskVideos().length,iframes,samples};
  };
  function chapterCount(){
    const names=new Set();
    for(const node of document.querySelectorAll('li,a,[role=treeitem],[class*=catalog],[class*=chapter]')){
      if(!visible(node))continue;
      const first=clean((node.innerText||'').split('\n')[0]);
      const match=/^(?:\d+\s*)?(第[一二三四五六七八九十百\d]+章)\s*([^\n]{0,40})/.exec(first);
      if(match)names.add(match[1]+' '+match[2]);
    }
    return names.size;
  }
  function currentSection(rows){
    return rows.find(row=>row.active)?.id||state?.currentSection||null;
  }
  function taskVideos(){
    const pageWidth=document.documentElement.clientWidth;
    return [...document.querySelectorAll('video,iframe')].filter(node=>{
      if(!visible(node))return false;
      const rect=node.getBoundingClientRect();
      return rect.width>=260&&rect.height>=150&&rect.left<pageWidth*.78;
    });
  }
  function videoCards(){
    if(!document.body)return [];
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    const markers=[];let node;
    while((node=walker.nextNode())){
      const label=clean(node.textContent);
      if(!/^(?:任务点已完成|任务点)$/.test(label))continue;
      const element=node.parentElement,rect=element?.getBoundingClientRect();
      if(!rect||!visible(element)||rect.left>=document.documentElement.clientWidth*.78)continue;
      markers.push({element,rect,complete:label==='任务点已完成'});
    }
    markers.sort((a,b)=>a.rect.top-b.rect.top);
    const videos=taskVideos();
    return markers.map((marker,index)=>{
      const bottom=markers[index+1]?.rect.top??Infinity;
      const media=videos.find(item=>{
        const top=item.getBoundingClientRect().top;
        return top>=marker.rect.top&&top<bottom;
      })||null;
      return {...marker,media};
    });
  }
  const videoCardDiagnostic=()=>({
    cards:videoCards().slice(0,8).map(card=>({
      complete:card.complete,top:Math.round(card.rect.top),hasMedia:!!card.media,
      mediaTag:card.media?.tagName||'',
    })),
    media:taskVideos().slice(0,8).map(item=>({
      tag:item.tagName,top:Math.round(item.getBoundingClientRect().top),
    })),
    frames:[...document.querySelectorAll('iframe')].slice(0,8).map(frame=>{
      const report=frameStatus.get(frame),rect=frame.getBoundingClientRect();
      let host='',path='';
      try{const url=new URL(frame.src);
        if(url.protocol==='https:'&&['xueyinonline.com','chaoxing.com'].some(domain=>
          url.hostname===domain||url.hostname.endsWith('.'+domain))){
          host=url.hostname;path=url.pathname;
        }
      }catch{}
      return {top:Math.round(rect.top),width:Math.round(rect.width),
        reported:!!report,cardCount:report?.cards?.length||0,
        pending:report?.cards?.filter(card=>!card.complete).length||0,
        media:report?.cards?.map(card=>!!card.hasMedia)||[],
        host,path,childFrames:report?.childFrames||0,
        position:report?.currentTime??null,paused:report?.paused??null,
        mediaSampleAge:report?.mediaReceivedAt?Date.now()-report.mediaReceivedAt:null,
        rate:report?.rate??null,childVideoStatusAge:report?.childVideoStatusAge??null,
        playError:report?.playError??null,startAttempts:report?.startAttempts??0,
        children:report?.children||[],
        markerSamples:report?.markerSamples||[]};
    }),
  });
  const frameData=node=>{
    const report=frameStatus.get(node);
    return report&&Date.now()-report.receivedAt<5000?report:null;
  };
  const videoData=node=>{
    if(!node)return null;
    if(node.tagName==='VIDEO')return {currentTime:node.currentTime,duration:node.duration,
      paused:node.paused,rate:node.playbackRate,ended:node.ended,
      mediaErrorCode:node.error?.code??null,readyState:node.readyState,
      networkState:node.networkState};
    const received=frameStatus.get(node);
    return received&&Date.now()-received.mediaReceivedAt<5000?received:null;
  };
  addEventListener('message',event=>{
    if(!['xy-video-status','xy-card-status','xy-document-status','xy-document-wheel'].includes(event.data?.type))return;
    try{const host=new URL(event.origin).hostname;
      if(!['xueyinonline.com','chaoxing.com'].some(domain=>host===domain||host.endsWith('.'+domain)))return;
    }catch{return;}
    const frame=[...document.querySelectorAll('iframe')].find(node=>node.contentWindow===event.source);
    if(frame){
      const prior=frameStatus.get(frame)||{};
      if(event.data.type==='xy-document-wheel'){
        if(quizFrame||state?.status!=='running'||!/\/document\/\d+$/.test(state.currentTask||''))return;
        const {x,y,amount}=event.data,r=frame.getBoundingClientRect();
        if(![x,y,amount].every(Number.isFinite)||amount<=0||amount>1000)return;
        void bridge.scroll?.({x:r.left+x,y:r.top+y,amount}).catch(()=>{});return;
      }
      if(event.data.type==='xy-document-status'){
        const tasks=event.data.tasks;
        if(!Array.isArray(tasks)||tasks.length>64||!tasks.every(t=>typeof t?.complete==='boolean'))return;
        frameStatus.set(frame,{...prior,documentReport:{stage:event.data.stage,tasks,index:event.data.index,receivedAt:Date.now()}});
        return;
      }
      frameStatus.set(frame,{...(event.data.type==='xy-card-status'?prior:{}),...event.data,
        ...(event.data.type==='xy-card-status'?{
          currentTime:prior.currentTime,duration:prior.duration,paused:prior.paused,
          rate:prior.rate,ended:prior.ended,mediaErrorCode:prior.mediaErrorCode,
          readyState:prior.readyState,networkState:prior.networkState,error:prior.error,
          playError:prior.playError,startAttempts:prior.startAttempts,
        }:{}),documentReport:prior.documentReport,mediaReceivedAt:event.data.type==='xy-video-status'?Date.now():prior.mediaReceivedAt,
        receivedAt:Date.now()});
    }
  });
  function observePlayback(){
    const nowMs=Date.now();let playing=null,issue=null,sample=null;
    for(const node of taskVideos()){
      const progress=videoData(node);
      if(progress&&!sample)sample=progress;
      if(['download-failed','playback-failed'].includes(progress?.error))issue=progress.error;
      else if(Number.isInteger(progress?.mediaErrorCode)&&progress.mediaErrorCode>0)issue='media-error';
      if(!progress||!Number.isFinite(progress.currentTime))continue;
      const previous=priorPlayback.get(node);
      const advancing=!progress.paused&&previous&&nowMs-previous.at<5000&&
        progress.currentTime>previous.time+0.1;
      const lastAdvancedAt=advancing?nowMs:
        previous&&nowMs-previous.at<5000?previous.lastAdvancedAt:nowMs;
      priorPlayback.set(node,{time:progress.currentTime,at:nowMs,lastAdvancedAt});
      if(advancing){playing=progress;break;}
      if(!progress.paused&&!progress.ended&&nowMs-lastAdvancedAt>20000)issue='stalled';
    }
    bridge.playback?.({playing:!!playing,issue:playing?null:issue,
      positionSeconds:playing?.currentTime??null,
      durationSeconds:Number.isFinite(playing?.duration)?playing.duration:null,
      mediaErrorCode:sample?.mediaErrorCode??null,
      readyState:sample?.readyState??null,networkState:sample?.networkState??null});
  }
  const clickNext=async rows=>{
    const body=document.body?.innerText||'';
    const section=currentSection(rows);
    const completedSection=rows.some(row=>row.id===section&&!row.quiz&&row.pending===0);
    if(completedSection)navigationPending=null;
    if(!completedSection&&!navigationPending&&body.includes('章节详情')&&body.includes('返回课程'))
      navigationPending={section:state.currentSection,at:Date.now()};
    if(navigationPending){
      if(Date.now()-navigationPending.at>20000){
        bridge.catalogDiagnostic?.(catalogDiagnostic());
        await block('章节详情加载超过 20 秒，无法读取视频；请检查右侧页面');
      }
      return;
    }
    if(Date.now()-lastNavigation<3000)return;
    const quizStatuses=state.quizStatuses||{};
    const next=rows.find(row=>{
      if(row.quiz)return !['submitted','content-only'].includes(quizStatuses[row.id]);
      return row.pending!==null&&row.pending>0;
    });
    if(!next){
      bridge.catalogDiagnostic?.({...catalogDiagnostic(),rows:rows.slice(0,8).map(row=>({
        id:row.id,quiz:row.quiz,pending:row.pending,active:row.active,
        start:row.title.slice(0,90)}))});
      const count=platformCount();
      const quizzes=rows.filter(row=>row.quiz);
      if(count&&count.done===count.total&&state.expectedChapterCount>=(state.configuredChapterCount||32)&&
        new Set([...(state.submittedQuizzes||[]),...Object.keys(quizStatuses).filter(id=>quizStatuses[id]==='content-only')]).size>=(state.configuredChapterCount||32)&&quizzes.length>=(state.configuredChapterCount||32)&&
        quizzes.every(row=>['submitted','content-only'].includes(quizStatuses[row.id]))){
        await save({status:'complete',blockedReason:null,platformDone:count.done,
          platformTotal:count.total,quizScanComplete:true,lastObservedAt:now()});
        await bridge.notify('课程视频任务点与章节测验已完成');
      }else if(count&&count.done<count.total)await block('目录中仍有未完成任务点，但无法定位下一项');
      else if(count&&count.done===count.total)await block('视频任务点已齐，但无法确认所有章节测验均已提交');
      return;
    }
    lastNavigation=Date.now();navigationPending={section:next.id,at:lastNavigation};
    await save({currentSection:next.id,currentTask:null,currentIsQuiz:next.quiz,
      sectionPending:{...(state.sectionPending||{}),[next.id]:next.pending},lastObservedAt:now()});
    (next.node.querySelector('a.clicktitle')||next.node).click();
  };
  async function verifyReturnedTask(rows){
    const waiting=state.awaitingPlatform;if(!waiting)return false;
    const row=rows.find(item=>item.id===waiting.section);
    const before=waiting.pendingBefore??state.sectionPending?.[waiting.section];
    const taskIndex=/\/video\/(\d+)$/.exec(waiting.taskId)?.[1];
    const localCards=videoCards();
    const targets=taskVideos();
    if(targets.length===1&&targets[0].tagName==='IFRAME'){
      try{targets[0].contentWindow.postMessage({type:'xy-inspect',
        pending:state.sectionPending?.[waiting.section]},'*');}catch{}
    }
    const reportedCards=localCards.length?localCards:
      targets.length===1?frameData(targets[0])?.cards:null;
    const explicitVideoComplete=!waiting.catalogRefreshRequested&&state.currentSection===waiting.section&&taskIndex!==undefined&&
      reportedCards?.[Number(taskIndex)]?.complete===true;
    const documentIndex=/\/document\/(\d+)$/.exec(waiting.taskId)?.[1];
    const documentReport=targets.length===1?frameStatus.get(targets[0])?.documentReport:null;
    const explicitDocumentComplete=state.currentSection===waiting.section&&row&&documentIndex!==undefined&&
      (waiting.documentConfirmed===true||documentReport&&Date.now()-documentReport.receivedAt<5000&&
        documentReport.tasks[Number(documentIndex)]?.complete===true);
    const count=platformCount();
    const lastPointWithoutNumber=row&&row.pending===null&&before===1&&count&&
      (Number.isInteger(waiting.platformDoneBefore)?count.done>waiting.platformDoneBefore:
        waiting.section==='1.1'&&waiting.taskId==='1.1/video/1'&&count.done===3);
    if(explicitVideoComplete||explicitDocumentComplete||row&&Number.isInteger(before)&&
      (Number.isInteger(row.pending)&&row.pending<before||lastPointWithoutNumber)){
      const doneIds=[...new Set([...(state.completedTaskIds||[]),waiting.taskId])];
      await save({awaitingPlatform:null,completedTaskIds:doneIds,currentTask:null,
        sectionPending:{...(state.sectionPending||{}),[waiting.section]:
          lastPointWithoutNumber?0:row?.pending??state.sectionPending?.[waiting.section]},
        platformDone:count?.done??state.platformDone,platformTotal:count?.total??state.platformTotal,
        lastObservedAt:now()});
      return false;
    }
    // A legacy intent may have lost its count baseline. Reopen the original
    // section once to inspect that video's own completion marker.
    if(row&&!reportedCards?.length&&!waiting.verificationOpened){
      await save({awaitingPlatform:{...waiting,verificationOpened:true,returnedAt:now()}});
      (row.node.querySelector('a.clicktitle')||row.node).click();
      return true;
    }
    if(Date.now()-Date.parse(waiting.returnedAt)>15000){
      bridge.catalogDiagnostic?.({...catalogDiagnostic(),rows:rows.slice(0,8).map(item=>({
        id:item.id,quiz:item.quiz,pending:item.pending,active:item.active,
        start:item.title.slice(0,90)}))});
      await block(documentIndex!==undefined?`${waiting.section} 的文档完成尚待平台核对`:
        `${waiting.section} 的视频已结束，但目录任务点未减少`);
    }
    return true;
  }
  async function processDocuments(rows){
    const target=taskVideos().find(node=>node.tagName==='IFRAME'&&
      Date.now()-(frameStatus.get(node)?.documentReport?.receivedAt||0)<5000);
    const report=target&&frameStatus.get(target).documentReport;
    if(!report?.tasks.length)return false;
    const id=currentSection(rows);if(!id)return false;
    const index=report.tasks.findIndex(task=>!task.complete);
    const current=new RegExp(`^${id.replace('.', '\\.')}\\/document\\/\\d+$`).test(state.currentTask||'');
    const doneIds=new Set(state.completedTaskIds||[]);
    report.tasks.forEach((task,i)=>{if(task.complete)doneIds.add(`${id}/document/${i}`);});
    if(doneIds.size>(state.completedTaskIds||[]).length)await save({completedTaskIds:[...doneIds]});
    if(index<0){
      if(!current)return false;
      const back=[...document.querySelectorAll('a,button,[role=button],span')]
        .find(node=>visible(node)&&clean(node.innerText)==='返回课程'&&node.getBoundingClientRect().width<250);
      const link=back?.closest('a,button,[role=button]')||back?.parentElement;
      if(!link&&!bridge.returnToCourse){await block('文档已浏览，但未找到返回课程入口以核对任务点');return true;}
      await save({awaitingPlatform:{section:id,taskId:state.currentTask,
        pendingBefore:state.sectionPending?.[id],platformDoneBefore:state.platformDone,
        documentConfirmed:true,returnedAt:now()}});
      if(bridge.returnToCourse)void bridge.returnToCourse().catch(()=>{});
      else link.click();
      return true;
    }
    if(['unsupported','unconfirmed','stalled'].includes(report.stage)){
      bridge.catalogDiagnostic?.({documentReading:{stage:report.stage,index,total:report.tasks.length}});
      await block(report.stage==='stalled'?'文档滚动超过 20 秒未前进，请展开课程检查阅读器':report.stage==='unsupported'?'文档阅读器未加载或不支持，请展开课程检查':
        '文档已浏览至末页，但平台未确认完成；请展开课程核对');return true;
    }
    const taskId=`${id}/document/${index}`;
    if(state.currentTask!==taskId)await save({currentTask:taskId,lastObservedAt:now()});
    if(report.stage==='idle'){
      // Both drivers share the chapter frame. Stop its video driver before
      // starting the reader so video initialization cannot scroll it away.
      target.contentWindow.postMessage({type:'xy-pause'},'*');
      target.contentWindow.postMessage({type:'xy-read-document'},'*');
    }
    return true;
  }
  async function processVideo(rows){
    const id=currentSection(rows),row=rows.find(item=>item.id===id);
    if(!id)return false;
    const cards=videoCards(),cardMode=cards.length>0;
    const videos=cardMode?cards.map(card=>card.media):taskVideos();
    if(!videos.length)return false;
    const doneIds=new Set(state.completedTaskIds||[]);
    const pendingMap={...(state.sectionPending||{})};
    const count=platformCount();
    const previous=pendingMap[id];
    const observed=row?.pending??null;
    const confirmedPending=Number.isInteger(observed)?observed:previous;
    const freshCards=!cardMode&&videos.length===1?frameData(videos[0])?.cards:null;
    const knownCards=!cardMode&&videos.length===1?knownChapterCards.get(videos[0]):null;
    const sameInventory=knownCards?.section===id&&knownCards.pending===confirmedPending;
    const useFresh=Array.isArray(freshCards)&&freshCards.length&&
      (!sameInventory||freshCards.length>=knownCards.cards.length);
    if(useFresh)
      knownChapterCards.set(videos[0],{section:id,pending:confirmedPending,cards:freshCards});
    const remoteCards=useFresh?freshCards:sameInventory?knownCards.cards:[];
    const remoteMode=remoteCards.length>0;
    const chapterFrame=!cardMode&&videos.length===1&&videos[0]?.tagName==='IFRAME'&&
      (()=>{try{return new URL(videos[0].src).pathname==='/mooc-ans/knowledge/cards';}
        catch{return false;}})();
    if(remoteMode){chapterFrameSeen=null;chapterWaitSince=0;}
    if(chapterFrame&&!remoteMode){
      if(chapterFrameSeen!==videos[0]){
        chapterFrameSeen=videos[0];chapterWaitSince=Date.now();playRequestedAt=0;
      }
      if(Date.now()-chapterWaitSince>20000){
        bridge.catalogDiagnostic?.(videoCardDiagnostic());
        await block('章节视频卡片加载超过 20 秒，无法确认待播放项');
      }else if(!playRequestedAt||Date.now()-playRequestedAt>3000){
        playRequestedAt=Date.now();
        try{videos[0].contentWindow.postMessage({type:'xy-play',
          pending:Number.isInteger(confirmedPending)?confirmedPending:null},'*');}catch{}
      }
      return true;
    }
    if(remoteMode){
      for(const [position,card] of remoteCards.entries()){
        if(card.evidence==='job-marker'&&!card.complete&&confirmedPending>0)
          doneIds.delete(`${id}/video/${position}`);
        if(card.complete)doneIds.add(`${id}/video/${position}`);
      }
      if(doneIds.size!==(state.completedTaskIds||[]).length||
        (state.completedTaskIds||[]).some(task=>!doneIds.has(task)))
        await save({completedTaskIds:[...doneIds],lastObservedAt:now()});
    }else if(cardMode){
      for(const [position,card] of cards.entries())
        if(card.complete)doneIds.add(`${id}/video/${position}`);
      if(doneIds.size>(state.completedTaskIds||[]).length)
        await save({completedTaskIds:[...doneIds],lastObservedAt:now()});
    }else if(!remoteMode&&Number.isInteger(confirmedPending)&&confirmedPending>=0&&confirmedPending<=videos.length){
      const confirmed=videos.length-confirmedPending;
      for(let position=0;position<confirmed;position++)doneIds.add(`${id}/video/${position}`);
      if(doneIds.size>(state.completedTaskIds||[]).length)
        await save({completedTaskIds:[...doneIds],lastObservedAt:now()});
    }
    if(Number.isInteger(observed)&&Number.isInteger(previous)&&observed<previous){
      if(observed>videos.length&&!cardMode&&!remoteMode){
        const activeIndex=videos.findIndex((_,index)=>!doneIds.has(`${id}/video/${index}`));
        if(activeIndex>=0)doneIds.add(`${id}/video/${activeIndex}`);
      }
      await save({completedTaskIds:[...doneIds],currentTask:null,
        platformDone:count?.done??state.platformDone,platformTotal:count?.total??state.platformTotal,
        sectionPending:{...pendingMap,[id]:observed},lastObservedAt:now()});
    }else if(Number.isInteger(observed)&&previous!==observed){
      await save({sectionPending:{...pendingMap,[id]:observed}});
    }
    const index=remoteMode?remoteCards.findIndex(card=>!card.complete):
      videos.findIndex((_,position)=>cardMode?!cards[position].complete:
        !doneIds.has(`${id}/video/${position}`));
    if(index<0){
      if(Number.isInteger(confirmedPending)&&confirmedPending>0){
        const documents=frameData(videos[0])?.pendingDocuments;
        if(remoteMode&&documents===0&&remoteCards.every(card=>card.complete&&card.evidence==='job-marker')&&bridge.returnToCourse){
          const finishedTask=new RegExp(`^${id.replace('.', '\\.')}\\/video\\/\\d+$`).test(state.currentTask||'')?
            state.currentTask:`${id}/video/${remoteCards.length-1}`;
          await save({currentTask:finishedTask,awaitingPlatform:{section:id,taskId:finishedTask,
            pendingBefore:confirmedPending,platformDoneBefore:count?.done??state.platformDone,
            catalogRefreshRequested:true,returnedAt:now()}});
          void bridge.returnToCourse().catch(()=>{});return true;
        }
        bridge.catalogDiagnostic?.(videoCardDiagnostic());
        await block(Number.isInteger(documents)&&documents>0?
          `本节视频已完成，剩余 ${documents} 份文档任务；请展开课程阅读，完成后恢复`:
          '目录仍有未完成任务点，但当前页面未找到待播放卡片');
      }else await clickNext(rows);
      return true;
    }
    navigationPending=null;
    const target=remoteMode?videos[0]:videos[index],taskId=`${id}/video/${index}`;
    if(state.currentTask!==taskId){lastTime=0;lastVideoProgress=Date.now();playRequestedAt=0;playAttempts=0;
      await save({currentTask:taskId,lastObservedAt:now()});}
    if(!target){
      cards[index].element.scrollIntoView({block:'center',behavior:'instant'});
      if(Date.now()-lastVideoProgress>15000){
        bridge.catalogDiagnostic?.(videoCardDiagnostic());
        await block('待完成视频卡片已找到，但播放器尚未加载；请检查右侧页面');
      }
      return true;
    }
    for(const node of videos){
      if(node===target)continue;
      if(!node)continue;
      if(node.tagName==='VIDEO')node.pause();
      else try{node.contentWindow.postMessage({type:'xy-pause'},'*');}catch{}
    }
    if(!remoteMode)target.scrollIntoView({block:'center',behavior:'instant'});
    const progress=videoData(target);
    if(progress?.error==='download-failed'){
      await block('视频下载失败，请在右侧手动切换线路或刷新');return true;
    }
    if(progress?.error==='playback-failed'){
      await block('播放器无法播放此视频，请在 Chrome 打开同一视频核对');return true;
    }
    if(Number.isInteger(progress?.mediaErrorCode)&&progress.mediaErrorCode>0){
      await block(`播放器发生媒体错误（代码 ${progress.mediaErrorCode}），请在 Chrome 继续观看`);return true;
    }
    if(Number.isFinite(progress?.rate)&&progress.rate!==1){
      await block('视频不是正常速度，请恢复 1 倍速');return true;
    }
    if(target.tagName==='VIDEO'){
      if(target.playbackRate!==1){await block('视频不是正常速度，请恢复 1 倍速');return true;}
    }
    if(remoteMode&&!remoteCards[index].hasMedia){
      if(Date.now()-lastVideoProgress>15000){
        await block('待完成视频卡片已找到，但播放器尚未加载；请检查右侧页面');
      }
      return true;
    }
    // Reloading a player can move its time backwards without changing the task ID.
    // Start a new observation baseline; only platform evidence can award completion.
    if(Number.isFinite(progress?.currentTime)&&progress.currentTime<lastTime-0.1){
      lastTime=progress.currentTime;lastVideoProgress=Date.now();playRequestedAt=0;playAttempts=0;
    }
    if(Number.isFinite(progress?.currentTime)&&progress.currentTime>lastTime+0.1){
      lastTime=progress.currentTime;lastVideoProgress=Date.now();playRequestedAt=0;playAttempts=0;
    }
    // Inventory heartbeats say nothing about whether the media is paused or advancing.
    if(!progress&&frameStatus.get(target)?.mediaReceivedAt){
      if(Date.now()-lastVideoProgress>30000){
        bridge.catalogDiagnostic?.(videoCardDiagnostic());
        await block('无法读取视频播放状态，请检查播放器');
      }
      return true;
    }
    if(!progress?.ended&&(progress?.paused??true)){
      if(!playRequestedAt){
        if(playAttempts>=3){
          bridge.catalogDiagnostic?.(videoCardDiagnostic());
          await block('视频多次暂停且无法持续播放，请检查播放器');return true;
        }
        playAttempts++;
        playRequestedAt=Date.now();
        if(target.tagName==='VIDEO')void target.play().catch(()=>{});
        else try{target.contentWindow.postMessage({type:'xy-play',
          pending:Number.isInteger(confirmedPending)?confirmedPending:null},'*');}catch{}
      }else if(Date.now()-playRequestedAt>8000){
        bridge.catalogDiagnostic?.(videoCardDiagnostic());
        await block(progress?.playError==='NotAllowedError'?'浏览器拒绝自动播放，请在右侧点一次播放':
          '视频未开始播放，请检查播放器后手动恢复任务');return true;
      }
    }
    if(progress){
      const quietFor=Date.now()-lastVideoProgress;
      const reachedThreshold=Number.isFinite(progress.currentTime)&&
        Number.isFinite(progress.duration)&&progress.duration>0&&
        progress.currentTime>=progress.duration*.9;
      if((progress.ended&&quietFor>5000)||(reachedThreshold&&quietFor>8000)){
        const back=[...document.querySelectorAll('a,button,[role=button],span')]
          .find(node=>visible(node)&&clean(node.innerText)==='返回课程'&&
            node.getBoundingClientRect().width<250);
        const link=back?.closest('a,button,[role=button]')||back?.parentElement;
        if(!link){await block('视频达到完成门槛，但未找到返回课程入口以核对任务点');return true;}
        await save({awaitingPlatform:{section:id,taskId,returnedAt:now(),
          platformDoneBefore:count?.done??state.platformDone,
          pendingBefore:confirmedPending},lastObservedAt:now()});
        link.click();return true;
      }
      if(!progress.paused&&!progress.ended&&quietFor>30000){
        bridge.catalogDiagnostic?.({...videoCardDiagnostic(),playbackWatchdog:{
          position:progress.currentTime,previousPosition:lastTime,quietFor,
          readyState:progress.readyState,networkState:progress.networkState,
          mediaSampleAge:target.tagName==='VIDEO'?0:Date.now()-frameStatus.get(target).mediaReceivedAt}});
        await block('视频播放时间超过 30 秒未前进，请检查播放器或在 Chrome 继续观看');return true;
      }
    }else if(Date.now()-lastNavigation>20000&&Date.now()-lastVideoProgress>30000){
      await block('无法读取视频播放状态，请检查播放器');return true;
    }
    return true;
  }
  const quizDocuments=()=>{
    const roots=[document];
    for(let index=0;index<roots.length&&roots.length<8;index++){
      for(const frame of roots[index].querySelectorAll('iframe')){
        if(!visible(frame)||frame.getBoundingClientRect().width<300)continue;
        try{const child=frame.contentDocument;
          if(child?.body&&!roots.includes(child))roots.push(child);
        }catch{}
      }
    }
    return roots;
  };
  const questionMarkers=(root=document)=>{
    const platform=[...root.querySelectorAll('.TiMu.newTiMu .Zy_TItle')].filter(visible);
    if(platform.length)return platform;
    let elements=[];
    try{elements=[...root.querySelectorAll('div,p,span,li,h1,h2,h3,h4,strong,b')];}
    catch{return [];}
    const combined=elements
      .filter(element=>{
        if(!visible(element))return false;
        const label=clean(element.innerText||'');
        return label.length<500&&/^\d+\s*\[(?:单选题|多选题|简答题)\]/.test(label)&&
          (label.match(/\d+\s*\[(?:单选题|多选题|简答题)\]/g)||[]).length===1;
      });
    return combined.filter(element=>!combined.some(other=>
      other!==element&&element.contains(other)))
      .sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
  };
  function questionBlock(marker,type){
    let node=marker;
    for(let depth=0;node&&depth<7;depth++,node=node.parentElement){
      const text=clean(node.innerText||'');
      const markers=(text.match(/\d+\s*\[(?:单选题|多选题|简答题)\]/g)||[]).length;
      if(markers>1)break;
      if(type==='short'&&node.querySelector('[contenteditable=true],textarea'))return node;
      if(type!=='short'&&[...node.querySelectorAll('label,[role=radio],[role=checkbox],li')]
        .filter(item=>/^[A-H](?:\s|[.、])/.test(clean(item.innerText))).length>=2)return node;
    }
    return null;
  }
  function assessment(){
    const roots=quizDocuments();
    const body=roots.map(root=>root.body?.innerText||'').join('\n');
    const platformRoot=roots.find(root=>root.querySelector('.TiMu.newTiMu'));
    if(platformRoot){
      const blocks=[...platformRoot.querySelectorAll('.TiMu.newTiMu')].filter(visible);
      const total=Number(/题量\s*[:：]\s*(\d+)/.exec(body)?.[1]||0);
      if(!total||blocks.length!==total)return {error:`测验显示 ${total} 题，但只识别 ${blocks.length} 题`};
      const questions=[];
      for(const [index,block] of blocks.entries()){
        if(block.getAttribute('data')==='15'){
          if(clean(block.querySelector('.newZy_TItle')?.textContent)!=='【阅读理解】')
            return {error:`第 ${index+1} 题阅读理解标题无法确认`};
          const parts=[...block.querySelectorAll(':scope > .Zy_TItle .fontLabel > p')]
            .map(node=>({node,text:clean(node.textContent)})).filter(part=>part.text);
          const context={parts};
          const children=[...block.querySelectorAll('.readCompreHensionItem')];
          if(!parts.length||!children.length)return {error:`第 ${index+1} 题阅读理解内容不完整`};
          const usedIds=new Set();
          for(const [childIndex,child] of children.entries()){
            const id=`${index+1}.${childIndex+1}`;
            const type=child.querySelector('input[name="readCompreHension-childType"]')?.value;
            const childId=child.querySelector('input[name="readCompreHension-childId"]')?.value;
            const label=clean(child.querySelector(':scope > .clear > .index')?.textContent);
            if(type!=='4'||label.replace(/\s/g,'')!==`(${childIndex+1})[简答题]`||
              !childId||usedIds.has(childId))return {error:`第 ${id} 子题题型或编号无法确认`};
            usedIds.add(childId);
            const promptNode=child.querySelector(':scope > .clear > div > p');
            const prompt=clean(promptNode?.textContent);
            const frames=[...child.querySelectorAll('iframe')];
            const fields=[...child.querySelectorAll('textarea[id^="answer"]')];
            let editor;try{editor=frames.length===1?frames[0].contentDocument?.body:null;}catch{}
            if(!prompt||frames.length!==1||fields.length!==1||!fields[0].id.endsWith(childId))
              return {error:`第 ${id} 子题题干或输入框无法确认`};
            if(!editor?.isContentEditable)
              return {error:`第 ${id} 子题输入框加载超时`,waiting:true};
            questions.push({id,kind:'short',prompt,promptNode,options:[],editor,
              answerField:fields[0],block:child,platform:true,readingContext:context});
          }
          continue;
        }
        const kind={'0':'single','1':'multi','4':'short'}[block.getAttribute('data')];
        const heading=clean(block.querySelector('.newZy_TItle')?.textContent);
        if(!kind||heading!=={'single':'【单选题】','multi':'【多选题】','short':'【简答题】'}[kind])
          return {error:`第 ${index+1} 题题型无法识别`};
        const promptNode=block.querySelector('.Zy_TItle .fontLabel');
        const promptRaw=clean(promptNode?.innerText||promptNode?.textContent)
          .replace(/^【(?:单选题|多选题|简答题)】/, '').trim();
        if(!promptRaw)return {error:`第 ${index+1} 题题干为空`};
        const options=[];
        if(kind!=='short'){
          for(const node of block.querySelectorAll(`.Zy_ulTop li[role=${kind==='single'?'radio':'checkbox'}]`)){
            const letter=node.querySelector('.num_option,.num_option_dx')?.getAttribute('data');
            const textNode=node.querySelector('a');
            const optionText=clean(textNode?.innerText||textNode?.textContent);
            if(!/^[A-H]$/.test(letter||'')||!optionText)
              return {error:`第 ${index+1} 题选项无法识别`};
            options.push({letter,text:optionText,node,textNode});
          }
          if(options.length<2||new Set(options.map(option=>option.letter)).size!==options.length)
            return {error:`第 ${index+1} 题选项数量异常`};
        }
        const editor=kind==='short'?[...block.querySelectorAll('iframe')]
          .map(frame=>{try{return frame.contentDocument?.body;}catch{return null;}})
          .find(node=>node?.isContentEditable):null;
        if(kind==='short'&&!editor)return {error:`第 ${index+1} 题输入框无法识别`};
        const answerField=kind==='short'?block.querySelector('textarea[id^="answer"]'):null;
        if(kind==='short'&&!answerField)return {error:`第 ${index+1} 题答案字段无法识别`};
        questions.push({id:String(index+1),kind,prompt:promptRaw,promptNode,
          options,editor,answerField,block,platform:true});
      }
      return {questions,root:platformRoot,platform:true};
    }
    const source=roots.find(root=>questionMarkers(root).length>0);
    const markers=source?questionMarkers(source):[];
    if(!quizQuestionFrame&&(!/章节测验/.test(body)||
      !/(?:待完成|题量\s*[:：]|提交)/.test(body)))return null;
    if(!markers.length)return null;
    const questions=[];
    for(const [index,marker] of markers.entries()){
      const head=clean(marker.innerText||marker.textContent);
      const kind=/\[单选题\]/.test(head)?'single':/\[多选题\]/.test(head)?'multi':'short';
      const block=questionBlock(marker,kind);
      if(!block)return {error:`第 ${index+1} 题无法识别`};
      const prompt=head.replace(/^\d+\s*\[(?:单选题|多选题|简答题)\]\s*/,'');
      if(!prompt)return {error:`第 ${index+1} 题题干为空`};
      const options=[];
      if(kind!=='short'){
        const found=new Map();
        for(const node of block.querySelectorAll('label,[role=radio],[role=checkbox],li')){
          if(!visible(node))continue;
          const value=clean(node.innerText||'');
          const match=/^([A-H])(?:\s|[.、])\s*(.+)$/.exec(value);
          if(match&&!found.has(match[1]))found.set(match[1],{text:match[2],node});
        }
        for(const [letter,item] of [...found.entries()].sort((a,b)=>a[0].localeCompare(b[0])))
          options.push({...item,letter});
        if(options.length<2)return {error:`第 ${index+1} 题选项无法识别`};
      }
      const editor=kind==='short'?block.querySelector('[contenteditable=true],textarea'):null;
      questions.push({id:String(index+1),kind,prompt,options,editor,block});
    }
    const total=Number(/题量\s*[:：]\s*(\d+)/.exec(body)?.[1]||0);
    if(quizQuestionFrame&&!total)return {error:'测验未显示题量，无法确认全部题目'};
    if(total&&total!==questions.length)return {error:`测验显示 ${total} 题，但只识别 ${questions.length} 题`};
    return {questions,root:source};
  }
  const markQuiz=async(id,result)=>{
    const statuses={...(state.quizStatuses||{}),[id]:result};
    const submitted=[...new Set([...(state.submittedQuizzes||[]),...(result==='submitted'?[id]:[])])];
    await save({quizStatuses:statuses,submittedQuizzes:submitted,submissionIntent:null,
      currentTask:null,status:'running',blockedReason:null,lastObservedAt:now()});
  };
  function quizDiagnostic(){
    const body=document.body?.innerText||'';
    const roots=quizDocuments();
    return {...catalogDiagnostic(),quiz:{
      section:state.currentSection,hasQuizTitle:/章节测验/.test(body),
      hasPending:/待完成/.test(body),markerCount:roots.reduce((sum,root)=>
        sum+questionMarkers(root).length,0),
      readableDocuments:roots.length,
      documents:roots.slice(0,4).map(root=>{
        let nodes=[];try{nodes=[...root.querySelectorAll('div,p,span,li,h1,h2,h3,h4,strong,b')];}
        catch{}
        return {intro:clean(root.body?.innerText||'').slice(0,180),
          headingSamples:nodes.filter(node=>visible(node)&&
            /单选题|多选题|简答题/.test(node.innerText||'')&&
            clean(node.innerText).length<220).slice(-8)
            .map(node=>({tag:node.tagName,classes:String(node.className).slice(0,60),
              text:clean(node.innerText).slice(0,100)}))};
      }),
      buttonLabels:[...document.querySelectorAll('button,a,[role=button]')]
        .filter(visible).map(node=>clean(node.innerText))
        .filter(label=>/^(?:开始答题|进入测验|开始测验|去完成|继续答题)$/.test(label)).slice(0,6),
    }};
  }
  async function readPlatformQuizText(parsed){
    if(!parsed.platform)return true;
    const entries=[],contexts=new Set();
    for(const question of parsed.questions){
      if(question.readingContext&&!contexts.has(question.readingContext)){
        contexts.add(question.readingContext);
        for(const part of question.readingContext.parts)
          entries.push({owner:part,key:'text',node:part.node,raw:part.text});
      }
      entries.push({owner:question,key:'prompt',node:question.promptNode,raw:question.prompt});
      for(const option of question.options)
        entries.push({owner:option,key:'text',node:option.textNode,raw:option.text});
    }
    const images=[];
    for(const entry of entries){
      const font=getComputedStyle(entry.node).fontFamily;
      if(!font.includes('font-cxsecret')){entry.decoded=entry.raw;continue;}
      await document.fonts.load('28px font-cxsecret',entry.raw);
      if(!document.fonts.check('28px font-cxsecret',entry.raw))return false;
      const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
      canvas.width=1700;
      context.font='28px font-cxsecret, sans-serif';
      const lines=[];let line='';
      for(const character of entry.raw){
        if(context.measureText(line+character).width>1630&&line){lines.push(line);line='';}
        line+=character;
      }
      if(line)lines.push(line);
      if(!lines.length||lines.length>60)return false;
      entry.chunks=[];
      for(let offset=0;offset<lines.length;offset+=3){
        const chunk=lines.slice(offset,offset+3);
        canvas.height=20+chunk.length*42;
        context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
        context.fillStyle='#000';context.font='28px font-cxsecret, sans-serif';
        context.textBaseline='top';
        chunk.forEach((text,index)=>context.fillText(text,15,10+index*42));
        images.push({entry,data:canvas.toDataURL('image/png').split(',')[1]});
      }
    }
    if(images.length>48)return false;
    const result=images.length?await bridge.ocr?.(images.map(image=>image.data)):[];
    if(!Array.isArray(result)||result.length!==images.length)return false;
    for(const [index,image] of images.entries()){
      const row=result[index];
      if(!row||row.confidence<0.86||!clean(row.text))return false;
      image.entry.chunks.push(clean(row.text));
    }
    for(const entry of entries){
      if(entry.chunks)entry.decoded=entry.chunks.join('');
      if(!entry.decoded)return false;
      entry.owner[entry.key]=entry.key==='prompt'?entry.decoded.replace(/^【(?:单选题|多选题|简答题)】/,'').trim():entry.decoded;
      if(!entry.owner[entry.key])return false;
    }
    for(const question of parsed.questions){
      if(question.readingContext){
        question.prompt=`阅读材料：\n${question.readingContext.parts.map(part=>part.text).join('\n')}\n子题：\n${question.prompt}`;
        if(question.prompt.length>1600)return false;
      }
    }
    return true;
  }
  async function processQuiz(rows){
    const id=currentSection(rows),row=rows.find(item=>item.id===id);
    if(!(row?.quiz??state.currentIsQuiz))return false;
    // Some catalog entries named "chapter quiz" are completed reading cards,
    // not assessment forms. Require both the platform completion icon and a
    // loaded, same-origin static card before skipping; never count a submission.
    if(!quizFrame&&row){
      const completed=row.node.querySelector('.posCatalog_select .icon_Completed');
      const frame=document.querySelector('iframe[src*="/mooc-ans/knowledge/cards"]');
      let card;try{card=frame?.contentDocument;}catch{}
      const editable=card&&[...card.querySelectorAll('input,textarea,[contenteditable=true]')].some(visible);
      const start=card&&[...card.querySelectorAll('a,button,input,[role=button]')]
        .some(node=>visible(node)&&/开始|答题|提交/.test(clean(node.innerText||node.value)));
      if(completed&&visible(completed)&&card?.readyState==='complete'&&card.querySelector('.wrap')&&
        clean(card.body?.innerText)&&!editable&&!start&&
        !card.querySelector('iframe,video,.ans-job-icon,.ans-attach-ct,.TiMu,form')&&
        !state.submissionIntent){
        await save({quizStatuses:{...(state.quizStatuses||{}),[id]:'content-only'},
          currentTask:null,currentIsQuiz:false,lastObservedAt:now()});
        navigationPending=null;
        if(document.body.innerText.includes('章节详情')){
          const back=[...document.querySelectorAll('a,button,[role=button],span')]
            .find(node=>visible(node)&&clean(node.innerText)==='返回课程'&&node.getBoundingClientRect().width<250);
          const link=back?.closest('a,button,[role=button]')||back?.parentElement;
          if(!link){await block('静态练习已核对，但未找到返回课程入口');return true;}
          navigationPending={section:id,at:Date.now()};link.click();return true;
        }
        await clickNext(rows);return true;
      }
    }
    if(state.quizStatuses?.[id]==='submitted'&&quizQuestionFrame){
      if(!navigationPending){
        let root=document;
        try{root=window.top.document;}catch{}
        const back=[...root.querySelectorAll('a,button,[role=button],span')]
          .find(node=>visible(node)&&clean(node.innerText)==='返回课程'&&
            node.getBoundingClientRect().width<250);
        const link=back?.closest('a,button,[role=button]')||back?.parentElement;
        if(link){navigationPending={section:id,at:Date.now()};link.click();}
      }
      return true;
    }
    if(state.currentTask?.startsWith(`${id}/video/`))await save({currentTask:null});
    const cardText=document.body?.innerText||'';
    if(!quizFrame&&document.querySelector('iframe[src*="/mooc-ans/knowledge/cards"]')){
      state=await bridge.state();
      if(state.quizStatuses?.[id]==='submitted'&&!navigationPending){
        const back=[...document.querySelectorAll('a,button,[role=button],span')]
          .find(node=>visible(node)&&clean(node.innerText)==='返回课程'&&
            node.getBoundingClientRect().width<250);
        const link=back?.closest('a,button,[role=button]')||back?.parentElement;
        if(link){navigationPending={section:id,at:Date.now()};link.click();}
      }
      return true;
    }
    if(chapterCardFrame&&document.querySelector('iframe[src*="/ananas/modules/work/index.html"]'))
      return true;
    if(quizWorkFrame&&document.querySelector('iframe[src*="/mooc-ans/api/work"]'))
      return true;
    if(!quizQuestionFrame&&!/章节详情/.test(cardText)&&!/题量\s*[:：]/.test(cardText)&&
      !/待完成/.test(cardText)){navigationPending=null;return false;}
    if(/(?:任务点已完成|测验已提交|已提交成功)/.test(cardText)&&!/待完成/.test(cardText)){
      navigationPending=null;quizWait=null;
      if(state.quizStatuses?.[id]!=='submitted')await markQuiz(id,'submitted');
      await clickNext(rows);return true;
    }
    if(state.submissionIntent){await block('上次章节测验提交状态未确认，请先核对');return true;}
    const parsed=assessment();
    if(!parsed){
      if(!quizWait||quizWait.section!==id)quizWait={section:id,at:Date.now(),opened:false};
      if(!quizWait.opened){
        const starts=[...document.querySelectorAll('button,a,[role=button]')]
          .filter(node=>visible(node)&&/^(?:开始答题|进入测验|开始测验|去完成|继续答题)$/.test(clean(node.innerText)));
        if(starts.length===1){quizWait.opened=true;starts[0].click();}
      }
      if(Date.now()-quizWait.at>20000){
        bridge.catalogDiagnostic?.(quizDiagnostic());
        await block('章节测验卡片已打开，但 20 秒内未出现可识别题目；请检查右侧页面');
      }
      return true;
    }
    if(parsed.waiting){
      if(!quizWait||quizWait.section!==id||!quizWait.editor)quizWait={section:id,at:Date.now(),editor:true};
      if(Date.now()-quizWait.at>20000)await block(parsed.error);
      return true;
    }
    navigationPending=null;quizWait=null;
    if(parsed.error){await block(parsed.error);return true;}
    if(!await readPlatformQuizText(parsed)){
      await block('测验文字无法可靠识别，请检查页面字体或本机 OCR');return true;
    }
    const answers=[];
    for(const question of parsed.questions){
      const response=await bridge.answer({type:question.kind,question:question.prompt,
        options:question.options.map(item=>item.text)});
      if(!response||response.type!==question.kind){
        const reasons={'uncertain':'AI 表示答案不确定','invalid-answer':'AI 返回答案格式不符合要求',
          'http-error':'AI 接口返回错误','timeout':'AI 请求超时','network-error':'AI 接口连接失败',
          'not-configured':'AI 接口未配置','invalid-question':'题干或选项不符合接口要求','invalid-endpoint':'AI 接口地址不符合要求',
          'codex-unavailable':'本机 Codex 程序不可用','codex-login-required':'请先在 Codex 登录 ChatGPT',
          'codex-model-unavailable':'套餐暂不支持所选 GPT 模型，请核对 AI 设置',
          'codex-limit':'ChatGPT 套餐额度暂不可用，请稍后恢复'};
        await block(`第 ${question.id} 题 ${reasons[response?.error]||'AI 无法判断'}`);return true;
      }
      answers.push(response);
    }
    for(const [index,question] of parsed.questions.entries()){
      const answer=answers[index].answer;
      if(question.kind==='short'){
        const editor=question.editor;
        if(!editor){await block(`第 ${question.id} 题输入框无法识别`);return true;}
        if(question.platform){
          editor.focus();editor.textContent=answer;
          editor.dispatchEvent(new editor.ownerDocument.defaultView.Event('input',{bubbles:true}));
          question.answerField.value=answer;
          question.answerField.dispatchEvent(new Event('input',{bubbles:true}));
          question.answerField.dispatchEvent(new Event('change',{bubbles:true}));
          if(clean(editor.textContent)!==clean(answer)||
            clean(question.answerField.value)!==clean(answer)){
            await block(`第 ${question.id} 题填写失败`);return true;
          }
        }else{
          editor.focus();
          if(editor.tagName==='TEXTAREA')editor.value=answer;
          else editor.textContent=answer;
          editor.dispatchEvent(new editor.ownerDocument.defaultView.Event('input',{bubbles:true}));
          if(clean(editor.value||editor.textContent)!==clean(answer)){
            await block(`第 ${question.id} 题填写失败`);return true;
          }
        }
      }else{
        const indices=question.kind==='single'?[answer]:answer;
        for(const choice of indices)question.options[choice].node.click();
        if(indices.some(choice=>{
          const node=question.options[choice].node;
          const control=node.querySelector('input');
          return question.platform?node.getAttribute('aria-checked')!=='true':
            control?!control.checked:!/(checked|selected|active)/i.test(String(node.className));
        })){await block(`第 ${question.id} 题选项状态无法确认`);return true;}
      }
    }
    const submit=[...parsed.root.querySelectorAll('button,a[role=button],[role=button]')].find(node=>
      visible(node)&&clean(node.innerText)==='提交');
    if(!submit){await block('章节测验提交按钮无法识别');return true;}
    await save({submissionIntent:{section:id,startedAt:now()},status:'submitting',lastObservedAt:now()});
    submit.click();
    const deadline=Date.now()+30000;
    let confirmed=false;
    while(Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,400));
      const roots=quizDocuments();
      const text=roots.map(root=>root.body?.innerText||'').join('\n');
      if(parsed.platform&&!confirmed){
        let popupDocument=null;
        try{popupDocument=window.top.document;}catch{}
        const popup=popupDocument?.querySelector('#workpop');
        const content=clean(popup?.querySelector('#popcontent')?.innerText);
        const button=popup?.querySelector('#popok');
        if(popup&&visible(popup)){
          if(content!=='确认提交？'||clean(button?.innerText)!=='提交'){
            await block('提交确认框显示未完成题目或异常提示；不会自动确认');return true;
          }
          confirmed=true;button.click();
        }
      }
      const confirm=roots.flatMap(root=>[...root.querySelectorAll(
        '[role=dialog] button,.ant-modal button,.el-dialog button')])
        .find(node=>visible(node)&&/^(确认提交|确定提交|确定)$/.test(clean(node.innerText)));
      if(confirm)confirm.click();
      if(/(?:提交成功|已提交|任务点已完成)/.test(text)&&!/待完成/.test(text)){
        await markQuiz(id,'submitted');await clickNext(rows);return true;
      }
    }
    await block('章节测验提交结果未确认；不会自动重复提交');
    return true;
  }
  async function tick(){
    if(quizFrame){
      try{state=await bridge.state();}catch{return;}
      if(!state.currentIsQuiz)return;
    }
    if(!started||busy||!state||state.status!=='running'){
      reportController('tick-idle');return;
    }
    if(globalThis.process?.isMainFrame&&
      document.querySelector('iframe[src*="/mooc2-ans/mycourse/studentcourse"]')&&
      !document.querySelector('iframe[src*="/mooc-ans/knowledge/cards"]')){
      reportController('tick-skipped');return;
    }
    reportController('tick-active');
    busy=true;
    try{
      const rows=catalog(),count=platformCount();
      const chapters=chapterCount();
      if(chapters>(state.expectedChapterCount||0))await save({expectedChapterCount:chapters});
      if(count&&(count.done!==state.platformDone||count.total!==state.platformTotal))
        await save({platformDone:count.done,platformTotal:count.total,lastObservedAt:now()});
      const completedDocument=/^(\d+\.\d+)\/document\/\d+$/.exec(state.currentTask||'');
      const completedDocumentRow=completedDocument&&rows.find(row=>row.id===completedDocument[1]);
      const onDocumentDetail=taskVideos().some(node=>Date.now()-(frameStatus.get(node)?.documentReport?.receivedAt||0)<5000);
      if(!onDocumentDetail&&completedDocumentRow?.pending===0&&state.sectionPending?.[completedDocument[1]]>0){
        await save({completedTaskIds:[...new Set([...(state.completedTaskIds||[]),state.currentTask])],
          currentTask:null,sectionPending:{...state.sectionPending,[completedDocument[1]]:0},
          platformDone:count?.done??state.platformDone,platformTotal:count?.total??state.platformTotal});
      }
      if(await verifyReturnedTask(rows))return;
      if(await processQuiz(rows))return;
      if(await processDocuments(rows))return;
      if(await processVideo(rows))return;
      if(rows.length){await clickNext(rows);return;}
      if(Date.now()-lastNavigation>15000){bridge.catalogDiagnostic?.(catalogDiagnostic());await block('无法读取课程章节目录');}
    }catch(error){
      bridge.catalogDiagnostic?.({runtimeError:{
        name:String(error?.name||'Error').slice(0,40),
        message:String(error?.message||'unknown').replace(/https?:\/\/\S+/g,'[url]')
          .replace(/[a-f0-9]{20,}/gi,'[id]').slice(0,120),
        frame:String(error?.stack||'').match(/xueyin-content\.cjs:\d+:\d+/)?.[0]||'',
      }});
      await block('页面结构变化或网络错误，请检查当前任务');
    }
    finally{busy=false;}
  }
  async function recoverConfirmedVideo(){
    if(started||busy||!state||state.currentIsQuiz||state.status!=='blocked'||!state.currentTask||
      !/^(?:视频|播放器|学习通要求图形验证码)/.test(state.blockedReason||''))return;
    if(globalThis.process?.isMainFrame&&
      document.querySelector('iframe[src*="/mooc2-ans/mycourse/studentcourse"]')&&
      !document.querySelector('iframe[src*="/mooc-ans/knowledge/cards"]'))return;
    const id=state.currentSection,match=new RegExp(`^${id?.replace('.', '\\.')}\\/video\\/(\\d+)$`).exec(state.currentTask);
    if(!match)return;
    const videos=taskVideos(),row=catalog().find(item=>item.id===id);
    const previous=state.sectionPending?.[id],pending=row?.pending;
    const count=platformCount();
    const finalBadgeCleared=row&&pending===null&&previous===1&&count&&
      Number.isInteger(state.platformDone)&&count.done>state.platformDone;
    if(!Number.isInteger(previous)||!finalBadgeCleared&&
      (!Number.isInteger(pending)||pending<0||pending>=previous))return;
    if(!finalBadgeCleared&&videos.length&&
      (pending>videos.length||Number(match[1])>=videos.length-pending))return;
    busy=true;
    try{
      const doneIds=new Set(state.completedTaskIds||[]);
      if(finalBadgeCleared)doneIds.add(state.currentTask);
      else for(let index=0;index<videos.length-pending;index++)doneIds.add(`${id}/video/${index}`);
      await save({completedTaskIds:[...doneIds],currentTask:null,status:'running',
        blockedReason:null,sectionPending:{...state.sectionPending,[id]:finalBadgeCleared?0:pending},
        platformDone:count?.done??state.platformDone,platformTotal:count?.total??state.platformTotal,
        lastObservedAt:now()});
      started=true;lastVideoProgress=Date.now();playRequestedAt=0;
    }finally{busy=false;}
    void tick();
  }
  async function recoverSubmittedQuiz(){
    if(!quizQuestionFrame||busy)return;
    try{
      state=await bridge.state();
      const id=state.submissionIntent?.section;
      if(!id||state.currentSection!==id||!['submitting','blocked'].includes(state.status))return;
      const body=document.body?.innerText||'';
      const pendingReview=/章节测验\s*待批阅/.test(body)&&/我的答案[:：]/.test(body);
      const title=document.querySelector('.newTestTitle');
      const complete=title?.querySelector('.testTit_status_complete');
      const score=document.querySelector('.achievement');
      const graded=quizReviewFrame&&title&&/章节测验/.test(title.textContent)&&
        visible(complete)&&clean(complete.textContent)==='已完成'&&visible(score)&&
        /本次成绩\s*[:：]?\s*\d+(?:\.\d+)?\s*分/.test(clean(score.textContent))&&
        [...document.querySelectorAll('.myAnswer')].some(node=>visible(node));
      if((!pendingReview&&!graded)||/待完成/.test(body))return;
      busy=true;
      await markQuiz(id,'submitted');started=true;
      void tick();
    }catch{}finally{busy=false;}
  }
  async function watchNewTasks(){
    if(!state||state.status!=='complete'||busy)return;
    const count=platformCount();
    if(count&&(count.total!==state.platformTotal||count.done<count.total)){
      started=false;
      await save({status:'interrupted',platformDone:count.done,platformTotal:count.total,
        blockedReason:'平台新增或恢复了未完成任务点，请继续学习',quizScanComplete:false,lastObservedAt:now()});
    }
  }
  let retryTimer=null;
  const bootstrap=async()=>{
    clearTimeout(retryTimer);
    try{
      state=await bridge.state();
      try{bridge.report?.('state-ready');}catch{}
      started=state.status==='running';
      try{bridge.report?.(started?'bootstrap-running':'bootstrap-idle');}catch{}
      if(started)void tick();
    }catch{
      retryTimer=setTimeout(bootstrap,1000);
    }
  };
  bridge.onCommand(message=>{
    if(message?.type==='RUN'){
      lastTime=0;lastVideoProgress=Date.now();playRequestedAt=0;playAttempts=0;
      started=true;void bootstrap();
    }
    else if(['PAUSE','END'].includes(message?.type)){started=false;pauseAll();}
  });
  void bootstrap();
  setInterval(()=>{void recoverSubmittedQuiz();void recoverConfirmedVideo();void tick();void watchNewTasks();},1200);
  setInterval(observePlayback,1500);
})();

}
function runFrame(){
const officialOrigin=origin=>{
  try{const host=new URL(origin).hostname;return ['xueyinonline.com','chaoxing.com'].some(domain=>host===domain||host.endsWith('.'+domain));}
  catch{return false;}
};
const visible=node=>node&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0;
let active=false,lastPlayTarget=null,pendingCount=null,lastChildVideoStatusAt=0,
  stableCards=[],lastAttemptAt=0,startAttempts=0,lastPlayError=null,lastChildPaused=true;
const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
function cards(){
  if(!document.body)return [];
  // A job container identifies its own video task. Aggregate chapter counts
  // include documents and may arrive before/after the live video marker.
  const jobs=[...document.querySelectorAll('.ans-attach-ct')].filter(container=>
    visible(container)&&container.querySelector('video,iframe[src*="/ananas/modules/video/index.html"]')&&
    (container.querySelector('.ans-job-icon,.task-condition')||container.classList.contains('ans-job-finished')));
  if(jobs.length){
    stableCards=jobs.map(element=>({element,top:element.getBoundingClientRect().top,
      media:element.querySelector('video,iframe[src*="/ananas/modules/video/index.html"]'),
      complete:element.classList.contains('ans-job-finished'),evidence:'job-marker'}));
    return stableCards;
  }
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const markers=[];let text;
  while((text=walker.nextNode())){
    const label=clean(text.textContent),element=text.parentElement;
    if(!/^(?:任务点已完成|任务点)$/.test(label)||!visible(element))continue;
    markers.push({element,top:element.getBoundingClientRect().top,
      complete:label==='任务点已完成'});
  }
  if(Number.isInteger(pendingCount)){
    const conditions=[...document.querySelectorAll('.task-condition')].filter(visible);
    // The platform hides the condition banner once a video's job is finished.
    for(const container of document.querySelectorAll('.ans-attach-ct.ans-job-finished')){
      if(visible(container)&&container.querySelector('video,iframe[src*="/ananas/modules/video/index.html"]')&&
        !conditions.some(element=>element.closest('.ans-attach-ct')===container))conditions.push(container);
    }
    conditions.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top);
    const pdfTasks=[...document.querySelectorAll('.ans-attach-ct')].filter(container=>
      visible(container)&&visible(container.querySelector('.ans-job-icon'))&&
      container.querySelector('iframe[src*="/ananas/modules/pdf/index.html"]')).length;
    const mixedTasks=pendingCount>conditions.length&&pendingCount<=conditions.length+pdfTasks&&
      conditions.length>0&&conditions.every(element=>element.closest('.ans-attach-ct')
        ?.querySelector('video,iframe[src*="/ananas/modules/video/index.html"]'));
    if(conditions.length>markers.length&&pendingCount>=0&&
      (pendingCount<=conditions.length||mixedTasks)){
      markers.length=0;
      conditions.forEach((element,index)=>markers.push({element,
        top:element.getBoundingClientRect().top,
        // A mixed inventory cannot infer video completion from the overall
        // pending count. Start the explicitly marked video and wait for the
        // platform's own completion marker; PDF tasks are never counted here.
        complete:element.closest('.ans-attach-ct')?.classList.contains('ans-job-finished')||
          !mixedTasks&&index<conditions.length-pendingCount}));
    }
  }
  markers.sort((a,b)=>a.top-b.top);
  const media=[...document.querySelectorAll('video,iframe')].filter(visible);
  const found=markers.map((marker,index)=>({
    ...marker,media:media.find(item=>{
      const top=item.getBoundingClientRect().top;
      return top>=marker.top&&top<(markers[index+1]?.top??Infinity);
    })||null,
  }));
  if(stableCards.length>found.length&&stableCards.every(card=>
    card.element.isConnected&&(!card.media||card.media.isConnected)))return stableCards;
  stableCards=found;
  return found;
}
function pendingDocuments(){
  return [...document.querySelectorAll('.ans-attach-ct')].filter(container=>
    visible(container)&&container.querySelector('iframe[src*="/ananas/modules/pdf/index.html"]')&&
    visible(container.querySelector('.ans-job-icon'))&&!container.classList.contains('ans-job-finished')).length;
}
function markerSamples(){
  if(!document.body)return [];
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const samples=[];let node;
  while((node=walker.nextNode())&&samples.length<8){
    const value=clean(node.textContent);
    if(!value.includes('任务点')||value.length>100)continue;
    const element=node.parentElement;
    samples.push({text:value.slice(0,50),tag:element?.tagName||'',
      className:String(element?.className||'').slice(0,60),
      top:Math.round(element?.getBoundingClientRect().top||0)});
  }
  return samples;
}
function playSelected(){
  const list=cards(),pending=list.find(card=>!card.complete);
  if(list.length){
    if(!pending)return;
    const target=pending.media;
    if(!target){
      if(lastPlayTarget!==pending.element){
        pending.element.scrollIntoView({block:'center',behavior:'instant'});
        lastPlayTarget=pending.element;
      }
      return;
    }
    const changed=lastPlayTarget!==target;
    if(changed){lastPlayTarget=target;lastAttemptAt=0;startAttempts=0;lastPlayError=null;
      target.scrollIntoView({block:'center',behavior:'instant'});}
    if(target.tagName==='VIDEO'){
      startVideo(target);
    }else if((changed||lastChildPaused)&&startAttempts<3&&Date.now()-lastAttemptAt>=2000){
      lastAttemptAt=Date.now();startAttempts++;
      try{target.contentWindow.postMessage({type:'xy-play'},'*');}catch{}
    }
    return;
  }
  const video=[...document.querySelectorAll('video')].find(visible);
  if(video){
    if(lastPlayTarget!==video){lastPlayTarget=video;lastAttemptAt=0;startAttempts=0;lastPlayError=null;}
    startVideo(video);
  }else{
    if(lastPlayTarget!==document.documentElement){
      lastPlayTarget=document.documentElement;lastAttemptAt=0;startAttempts=0;
    }
    if(lastChildPaused&&startAttempts<3&&Date.now()-lastAttemptAt>=2000){
      lastAttemptAt=Date.now();startAttempts++;
      relay({type:'xy-play',pending:pendingCount});
    }
  }
}
function startVideo(video){
  if(video.playbackRate!==1||!video.paused||video.ended||startAttempts>=3||Date.now()-lastAttemptAt<2000)return;
  lastAttemptAt=Date.now();startAttempts++;
  const control=video.closest('.video-js')?.querySelector('.vjs-big-play-button');
  // Initialize the platform player through its own start control before requesting media play.
  if(control&&visible(control)&&getComputedStyle(control).visibility!=='hidden')control.click();
  void video.play().then(()=>{lastPlayError=null;}).catch(error=>{
    lastPlayError=['NotAllowedError','NotSupportedError','AbortError'].includes(error?.name)?error.name:'other';
  });
}
function relay(message){
  for(const frame of document.querySelectorAll('iframe')){
    try{if(visible(frame))frame.contentWindow.postMessage(message,'*');}catch{}
  }
}
addEventListener('message',event=>{
  if(['xy-video-status','xy-card-status'].includes(event.data?.type)&&
    event.source!==parent&&officialOrigin(event.origin)){
    if(event.data.type==='xy-video-status'){lastChildVideoStatusAt=Date.now();lastChildPaused=event.data.paused!==false;}
    const list=cards();
    try{parent.postMessage({...event.data,
      pendingDocuments:pendingDocuments(),
      cards:list.length?list.map(card=>({complete:card.complete,hasMedia:!!card.media,evidence:card.evidence})):event.data.cards,
      markerSamples:markerSamples().length?markerSamples():event.data.markerSamples},'*');}catch{}
    return;
  }
  if(event.source!==parent||!officialOrigin(event.origin)||!['xy-play','xy-pause','xy-inspect'].includes(event.data?.type))return;
  if(Number.isInteger(event.data.pending))pendingCount=event.data.pending;
  if(event.data.type==='xy-inspect')return;
  active=event.data.type==='xy-play';
  lastPlayTarget=null;
  lastAttemptAt=0;startAttempts=0;lastPlayError=null;
  if(active)playSelected();
  else{
    for(const video of document.querySelectorAll('video'))try{video.pause();}catch{}
    relay({type:'xy-pause'});
  }
});
setInterval(()=>{
  if(active)playSelected();
  const list=cards(),selected=list.find(card=>!card.complete)?.media;
  const video=selected?.tagName==='VIDEO'?selected:
    [...document.querySelectorAll('video')].find(visible);
  const message=document.body?.innerText||'';
  const downloadFailed=/网络错误导致视频下载中途失败/.test(message);
  const playbackFailed=/视频文件损坏或者该视频使用了你的浏览器不支持的功能/.test(message);
  const samples=markerSamples();
  if(!video&&!list.length&&!samples.length&&!downloadFailed&&!playbackFailed)return;
  if(video&&active&&video.playbackRate!==1){video.pause();active=false;}
  const status={type:!video&&list.length&&!downloadFailed&&!playbackFailed?
    'xy-card-status':'xy-video-status',
    currentTime:video?.currentTime??null,
    duration:video?.duration??null,paused:video?.paused??true,
    rate:video?.playbackRate??null,ended:video?.ended??false,
    mediaErrorCode:video?.error?.code??null,
    readyState:video?.readyState??null,networkState:video?.networkState??null,
    playError:lastPlayError,startAttempts,
    error:downloadFailed?'download-failed':playbackFailed?'playback-failed':null,
    pendingDocuments:pendingDocuments(),
    cards:list.map(card=>({complete:card.complete,hasMedia:!!card.media,evidence:card.evidence})),
    markerSamples:samples,childFrames:document.querySelectorAll('iframe').length,
    childVideoStatusAge:lastChildVideoStatusAt?Date.now()-lastChildVideoStatusAt:null,
    children:[...document.querySelectorAll('iframe')].slice(0,6).map(frame=>{
      const rect=frame.getBoundingClientRect();let host='',path='';
      try{const url=new URL(frame.src);if(url.protocol==='https:'){
        host=url.hostname;
        if(officialOrigin(url.origin))path=url.pathname.slice(0,100);
      }}catch{}
      return {host,path,top:Math.round(rect.top),width:Math.round(rect.width)};
    })};
  try{parent.postMessage(status,'*');}catch{}
},1000);

}
function runDocumentFrame(){
(() => {
  const official=origin=>{try{const host=new URL(origin).hostname;return ['chaoxing.com','xueyinonline.com'].some(d=>host===d||host.endsWith('.'+d));}catch{return false;}};
  const chapter=location.pathname==='/mooc-ans/knowledge/cards';
  const wrapper=location.pathname==='/ananas/modules/pdf/index.html';
  const reader=location.pathname.startsWith('/screen/v2/');
  if(!chapter&&!wrapper&&!reader)return;
  let active=false,target=null,startedAt=0,lastStep=0,stage='idle',childStage=null,lastPosition=0,progressAt=0;
  const tasks=()=>[...document.querySelectorAll('.ans-attach-ct')].filter(e=>
    e.querySelector('.ans-job-icon')&&e.querySelector('iframe[src*="/ananas/modules/pdf/index.html"]'));
  const complete=e=>e.classList.contains('ans-job-finished');
  const send=(frame,data)=>{try{frame?.contentWindow.postMessage(data,'*');}catch{}};
  const report=data=>{try{parent.postMessage(data,'*');}catch{}};
  const stop=()=>{
    active=false;stage='idle';
    for(const f of document.querySelectorAll('iframe'))send(f,{type:'xy-pause'});
  };
  addEventListener('message',event=>{
    if(!official(event.origin))return;
    if(event.source===parent){
      if(event.data?.type==='xy-pause'){stop();return;}
      if(event.data?.type!=='xy-read-document')return;
      if(!active){active=true;startedAt=Date.now();lastStep=0;stage='loading';target=null;childStage=null;lastPosition=0;progressAt=Date.now();}
      return;
    }
    if(!['xy-document-progress','xy-document-wheel'].includes(event.data?.type))return;
    const child=[...document.querySelectorAll('iframe')].find(f=>f.contentWindow===event.source);
    if(!child)return;
    if(chapter){
      if(!active)return;
      if(child!==target?.querySelector('iframe[src*="/ananas/modules/pdf/index.html"]'))return;
      if(event.data.type==='xy-document-wheel'){
        // Layout changes or a previously initialized video may have moved
        // this job outside the main viewport. Re-establish the input target.
        target.scrollIntoView({block:'center',behavior:'instant'});
        const r=child.getBoundingClientRect();report({...event.data,x:r.left+event.data.x,y:r.top+event.data.y});return;
      }
      childStage=event.data.stage;
      if(['unsupported','unconfirmed','stalled'].includes(childStage))stage=childStage;
      else if(childStage==='end'&&stage!=='waiting'){stage='waiting';startedAt=Date.now();}
      else if(childStage==='browsing')stage='browsing';
    }else if(wrapper){
      if(!active||child!==target)return;
      if(event.data.type==='xy-document-wheel'){
        const r=child.getBoundingClientRect();report({...event.data,x:r.left+event.data.x,y:r.top+event.data.y});return;
      }
      childStage=event.data.stage;
      report({type:'xy-document-progress',stage:childStage});
    }
  });
  setInterval(()=>{
    if(chapter){
      const list=tasks(),next=list.find(e=>!complete(e));
      if(active){
        if(!next){send(target?.querySelector('iframe'),{type:'xy-pause'});stage='complete';active=false;}
        else if(next!==target){
          if(target)send(target.querySelector('iframe'),{type:'xy-pause'});
          target=next;stage='loading';childStage=null;startedAt=Date.now();
          target.scrollIntoView({block:'center',behavior:'instant'});
          send(target.querySelector('iframe[src*="/ananas/modules/pdf/index.html"]'),{type:'xy-read-document'});
        }else if(stage==='loading'){
          send(target.querySelector('iframe[src*="/ananas/modules/pdf/index.html"]'),{type:'xy-read-document'});
          if(Date.now()-startedAt>20000)stage='unsupported';
        }else if(stage==='waiting'&&Date.now()-startedAt>15000)stage='unconfirmed';
      }
      if(active&&['unsupported','unconfirmed','stalled'].includes(stage)){
        active=false;send(target?.querySelector('iframe'),{type:'xy-pause'});
      }
      report({type:'xy-document-status',stage,tasks:list.map(e=>({complete:complete(e)})),
        index:target?list.indexOf(target):null});
      return;
    }
    if(!active)return;
    if(wrapper){
      const candidates=[...document.querySelectorAll('iframe')].filter(f=>{
        const r=f.getBoundingClientRect();
        try{return r.width>=260&&r.height>=150&&official(new URL(f.src,location.href).origin);}catch{return false;}
      });
      const frame=candidates.length===1?candidates[0]:null;
      if(frame){target=frame;send(frame,{type:'xy-read-document'});}
      if(!childStage&&Date.now()-startedAt>20000)report({type:'xy-document-progress',stage:'unsupported'});
      return;
    }
    // Use the reader's real scrolling surface; its own scroll handlers report progress.
    const images=[...document.querySelectorAll('.fileBox img')];
    const root=document.scrollingElement;
    if(!root||!images.length||images.filter(e=>{const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;}).some(e=>!e.complete||e.naturalWidth===0)){
      if(Date.now()-startedAt>20000)report({type:'xy-document-progress',stage:'unsupported'});
      return;
    }
    if(root.scrollTop!==lastPosition){lastPosition=root.scrollTop;progressAt=Date.now();}
    if(stage==='browsing'&&Date.now()-progressAt>20000){report({type:'xy-document-progress',stage:'stalled'});return;}
    if(Date.now()-lastStep<3000)return;
    lastStep=Date.now();
    if(stage==='loading'){
      window.scrollTo({top:0,behavior:'instant'});stage='browsing';
      // Loading and layout time must not consume the reader's progress budget.
      lastPosition=root.scrollTop;progressAt=Date.now();
    }else if(root.scrollTop+root.clientHeight>=root.scrollHeight-3){stage='end';}
    else report({type:'xy-document-wheel',x:innerWidth/2,y:innerHeight/2,amount:Math.max(80,root.clientHeight*.85)});
    report({type:'xy-document-progress',stage});
  },1000);
})();

}
