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
  const attachFrame=()=>{require('./xueyin-video-frame.cjs');require('./xueyin-document-frame.cjs');};
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
      recoverPlayback:details=>ipcRenderer.invoke('xy-playback-recover',details),
      recoverDocument:details=>ipcRenderer.invoke('xy-document-recover',details),
      playback:details=>ipcRenderer.send('xy-playback-observation',details),
      onCommand:listener=>{
        commandListeners.push(listener);
        while(pendingCommands.length)listener(pendingCommands.shift());
      },
    };
    const attach=()=>{
      ipcRenderer.send('xy-diagnostic','attach-start');
      try{require('./xueyin-content.cjs');ipcRenderer.send('xy-diagnostic','attach-done');}
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
