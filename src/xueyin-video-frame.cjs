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
