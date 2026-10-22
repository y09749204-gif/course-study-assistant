const path=require('node:path');
const M=require('./icourse-core.cjs');
const {createAtomicState}=require('./atomic-state.cjs');
const {previewLayout}=require('./course-preview.cjs');
const reasons={
  interaction:'课程页有交互弹窗，请先完成登录、验证或题目后恢复',
  'no-video':'未找到唯一的视频播放器；文档、测验等内容请先在课程页处理',
  loading:'视频加载超过 30 秒，请检查网络后恢复',
  'media-error':'播放器报告媒体错误，请在课程页检查后恢复',
  stalled:'视频时间超过 30 秒未前进，请检查播放器后恢复',
  autoplay:'浏览器阻止自动播放，请在课程页点一次播放后恢复',
  'next-unconfirmed':'平台未自动切换下一视频，请检查是否勾选“自动播放下一视频”；本地未确认课程完成'
};
function createIcourseStudy({WebContentsView,hostWindow,ipcMain,data,trusted,profile,claimCourse,courseSession,now=Date.now}){
  const config=M.validateLaunchURL(profile.url);
  let view=null,expanded=false,sidebarWidth=360,epoch=0,previous=null;
  const hasView=()=>!!view&&!view.webContents.isDestroyed();
  const target=()=>hasView()&&M.coursePage(view.webContents.getURL(),config.identity);
  const pausePage=()=>{previous=null;if(hasView())view.webContents.send('mooc-pause');};
  const storage=createAtomicState(path.join(data,'icourse-study','state.json'),()=>({status:'idle',seconds:0,observedEnded:[],currentSection:null,blockedReason:null}),{onFailure:pausePage});
  const update=patch=>storage.write({...storage.read(),...patch});
  const resumeURL=()=>{
    const saved=storage.read().resumeUnit,numeric=value=>/^\d{1,20}$/.test(value||'');
    if(!saved||!numeric(saved.content)||saved.unit!==null&&!numeric(saved.unit)||saved.chapter!==null&&!numeric(saved.chapter))return config.url;
    const u=new URL(config.url);u.pathname=u.pathname.replace(/\/content\/\d+\/?$/,'/content/'+saved.content);
    for(const [key,value] of [['unitId',saved.unit],['chapterId',saved.chapter]]){u.searchParams.delete(key);if(value!==null)u.searchParams.set(key,value);}
    return M.validateLaunchURL(u.href).url;
  };
  if(storage.read().status==='running')update({status:'interrupted',blockedReason:'应用上次关闭，点击恢复继续'});
  const status=()=>({...storage.read(),configured:true,windowOpen:hasView(),courseOnTarget:!!target(),courseExpanded:expanded,sidebarWidth});
  const layout=()=>{if(!hasView()||hostWindow.isDestroyed())return;const p=previewLayout(hostWindow.getContentSize(),sidebarWidth,expanded);view.setBounds(p.bounds);view.webContents.setZoomFactor(p.zoom);};
  hostWindow.on('resize',layout);
  const trustedCourse=event=>event.sender===view?.webContents&&event.senderFrame===event.sender.mainFrame&&M.coursePage(event.senderFrame.url,config.identity);
  const block=reason=>{epoch++;pausePage();update({status:'blocked',blockedReason:reason});};
  const close=()=>{
    epoch++;pausePage();
    if(storage.read().status==='running')update({status:'paused',blockedReason:null});
    if(hasView()){const old=view;view=null;if(!hostWindow.isDestroyed())hostWindow.contentView.removeChildView(old);old.webContents.close();}
    return status();
  };
  const open=()=>{
    claimCourse?.();
    if(hasView()){
      if(!target()&&!view.webContents.isLoadingMainFrame()){
        epoch++;previous=null;void view.webContents.loadURL(resumeURL()).catch(()=>block('课程页面加载失败，请检查网络后刷新'));
      }
      hostWindow.show();hostWindow.focus();return status();
    }
    view=new WebContentsView({webPreferences:{preload:path.join(__dirname,'icourse-preload.cjs'),
      session:courseSession,contextIsolation:true,nodeIntegration:false,sandbox:false}});
    const wc=view.webContents;wc.setAudioMuted(true);hostWindow.contentView.addChildView(view);layout();
    const official=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='icourse163.org'||u.hostname.endsWith('.icourse163.org')||u.hostname==='163.com'||u.hostname.endsWith('.163.com'));}catch{return false;}};
    wc.setWindowOpenHandler(()=>({action:'deny'}));
    wc.on('will-navigate',(event,url)=>{if(!official(url)){event.preventDefault();block('登录跳转目标尚未验证，请先在官网核对登录入口');}});
    wc.on('did-navigate',()=>{epoch++;previous=null;if(!target()&&storage.read().status==='running')block('请在课程页登录并回到已配置的 MOOC 课程后恢复');});
    wc.on('did-navigate-in-page',()=>{epoch++;previous=null;});
    wc.on('render-process-gone',()=>block('课程页面进程已退出，请关闭课程后重新打开'));
    wc.on('did-fail-load',(_e,code,_text,_url,isMain)=>{if(isMain&&code!==-3)block('课程页面加载失败，请检查网络后刷新');});
    void wc.loadURL(resumeURL()).catch(()=>block('课程页面加载失败，请检查网络后刷新'));
    return status();
  };
  const command=type=>{
    if(!['RUN','PAUSE','END'].includes(type))throw Error('Invalid MOOC command');
    epoch++;pausePage();
    if(type==='RUN'){
      if(!storage.recover())return status();
      open();update({status:'running',blockedReason:null});
      if(!target()&&!view.webContents.isLoadingMainFrame())block('请在课程页登录并回到已配置的 MOOC 课程后恢复');
    }else update({status:type==='END'?'ended':'paused',blockedReason:null});
    return status();
  };
  const control=fn=>(event,...args)=>{if(!trusted(event))throw Error('Untrusted window');return fn(...args);};
  ipcMain.handle('mooc-status',control(status));ipcMain.handle('mooc-open',control(open));
  ipcMain.handle('mooc-close',control(close));ipcMain.handle('mooc-command',control(command));
  ipcMain.handle('mooc-refresh',control(()=>{epoch++;pausePage();if(hasView())view.webContents.reload();return status();}));
  ipcMain.handle('mooc-pane-width',control(width=>{if(!Number.isFinite(width))throw Error('Invalid pane width');sidebarWidth=Math.round(Math.max(300,Math.min(480,width,hostWindow.getContentSize()[0]-724)));layout();return sidebarWidth;}));
  ipcMain.on('mooc-config',event=>{event.returnValue=trustedCourse(event)?config.identity:null;});
  ipcMain.handle('mooc-agent-state',event=>{if(!trustedCourse(event))throw Error('Untrusted course');return {status:storage.read().status,epoch};});
  const observe=(event,message)=>{
    if(!trustedCourse(event))throw Error('Untrusted course');
    const state=storage.read();
    if(state.status!=='running'||message?.epoch!==epoch)return false;
    const u=new URL(event.senderFrame.url),unit=[u.pathname.split('/').at(-1),u.searchParams.get('unitId')||''].join(':');
    const resumeUnit={content:M.validateLaunchURL(u.href).contentId,unit:u.searchParams.get('unitId'),chapter:u.searchParams.get('chapterId')};
    if(message.unit!==unit)return false;
    if(Object.hasOwn(reasons,message.issue)){block(reasons[message.issue]);return false;}
    if(message.issue==='waiting-next'&&message.ended===true){
      previous=null;
      update({currentSection:unit.split(':')[0],resumeUnit,blockedReason:null,waitingNext:true,
        observedEnded:[...new Set([...state.observedEnded,unit])].slice(-1000)});return true;
    }
    if(message.issue!=='playing'||!Number.isFinite(message.time)||message.time<0||message.rate!==1)return false;
    const stamp=now(),elapsed=previous?(stamp-previous.at)/1000:0,delta=previous?message.time-previous.time:0;
    const credit=previous?.unit===unit&&message.paused===false&&message.seeking===false&&elapsed>0&&elapsed<=3&&delta>0&&delta<=elapsed+1?Math.min(delta,elapsed):0;
    previous={unit,time:message.time,at:stamp};
    update({seconds:state.seconds+credit,currentSection:unit.split(':')[0],resumeUnit,waitingNext:false,blockedReason:null});return true;
  };
  ipcMain.handle('mooc-observation',observe);
  ipcMain.on('mooc-ended',(event,message)=>{
    try{event.returnValue=observe(event,{...message,issue:'waiting-next',ended:true});}catch{event.returnValue=false;}
  });
  return {status,open,close,command,preempt:()=>{command('PAUSE');close();},setExpanded:value=>{expanded=!!value;layout();},stop:()=>{close();hostWindow.removeListener('resize',layout);}};
}
module.exports={createIcourseStudy};
