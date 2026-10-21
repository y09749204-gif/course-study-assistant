const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const C=require('./core.js'),X=require('./xueyin-core.cjs'),M=require('./icourse-core.cjs');
const {REPORT_URL}=require('./platform-review.cjs');
const defaults=()=>({selectedId:'mayuan',byPlatform:{mayuan:'mayuan',xueyin:'xueyin'},profiles:[
  {id:'mayuan',platform:'mayuan',name:'智慧树课程',legacy:true,minLessons:2,minMinutes:25},
  {id:'xueyin',platform:'xueyin',name:'学习通课程',legacy:true,minLessons:2,minMinutes:25,expectedChapters:0}]});
function validateUrl(platform,value){
  const u=new URL(value);if(u.username||u.password)throw Error('课程链接不能包含登录凭据');
  if(platform==='xueyin')return X.validateLaunchURL(value).url;
  if(platform==='icourse')return M.validateLaunchURL(value).url;
  if(platform!=='mayuan')throw Error('不支持的课程平台');
  if(u.protocol!=='https:'||u.hostname!=='wisdom-mooc.zhihuishu.com'||u.pathname!=='/study/index'||
    !/^[A-Za-z0-9_-]{8,128}$/.test(u.searchParams.get('recruitAndCourseId')||''))throw Error('请使用智慧树课程学习页面链接');
  return u.href;
}
function scoreConfig(value){
  if(!value)return null;const u=new URL(value);
  if(u.origin!=='https://stuonline.zhihuishu.com'||u.pathname!=='/stuonline/stuLearnReportNew/index'||
    !/^\d{1,20}$/.test(u.searchParams.get('courseId')||'')||!/^\d{1,20}$/.test(u.searchParams.get('recruitId')||''))throw Error('成绩分析链接格式不正确');
  return {courseId:u.searchParams.get('courseId'),recruitId:u.searchParams.get('recruitId'),url:u.href};
}
function createProfiles(data,safeStorage){
  const file=path.join(data,'courses.json');
  const read=()=>{try{const v=JSON.parse(fs.readFileSync(file,'utf8'));if(v.version!==1||!Array.isArray(v.profiles)||v.profiles.length>50)throw Error('课程配置文件无效');
    const ids=new Set();for(const p of v.profiles){if(!/^(mayuan|xueyin|[a-f0-9]{8}-[a-f0-9-]{27})$/.test(p.id)||ids.has(p.id)||!['mayuan','xueyin','icourse'].includes(p.platform)||p.legacy&&!['mayuan','xueyin'].includes(p.id)||['mayuan','xueyin'].includes(p.id)&&p.platform!==p.id)throw Error('课程配置文件无效');ids.add(p.id);}
    if(!ids.has(v.selectedId)||!v.byPlatform||['mayuan','xueyin'].some(platform=>!v.profiles.some(p=>p.id===v.byPlatform[platform]&&p.platform===platform)))throw Error('课程选择无效');return v;}catch(e){if(e.code==='ENOENT')return {version:1,...defaults()};throw Error('课程配置无法读取，已停止使用默认配置覆盖');}};
  const write=v=>{fs.mkdirSync(data,{recursive:true});fs.writeFileSync(file+'.pending',JSON.stringify(v),'utf8');fs.renameSync(file+'.pending',file);};
  const get=id=>{const p=read().profiles.find(p=>p.id===id);if(!p)throw Error('课程不存在');return p;};
  const dataFor=p=>p.legacy?data:path.join(data,'courses',p.id);
  const secretFile=p=>p.platform==='xueyin'?path.join(dataFor(p),'xueyin-study','course-url.bin'):path.join(data,'course-config',p.id+'.bin');
  const secrets=p=>{try{const value=safeStorage.decryptString(fs.readFileSync(secretFile(p)));return p.platform==='xueyin'?{url:value}:JSON.parse(value);}catch(e){if(e.code==='ENOENT')return {};throw Error('课程链接解密失败，请检查本机加密存储');}};
  const list=()=>{const v=read();return {...v,profiles:v.profiles.map(p=>({...p,configured:!!secrets(p).url}))};};
  const config=p=>{const s=secrets(p);return {...p,url:s.url,courseId:s.url&&p.platform==='mayuan'?new URL(s.url).searchParams.get('recruitAndCourseId'):null,report:scoreConfig(s.scoreUrl)};};
  const save=input=>{
    const v=read(),old=input.id?get(input.id):null,platform=old?.platform||input.platform;
    if(!['mayuan','xueyin','icourse'].includes(platform)||old&&input.platform&&input.platform!==old.platform)throw Error('课程平台不能更换，请新增课程');
    const name=String(input.name||'').replace(/\s+/g,' ').trim();if(!name||name.length>40)throw Error('课程名称需为 1–40 个字符');
    const minLessons=Number(input.minLessons??old?.minLessons??2),minMinutes=Number(input.minMinutes??old?.minMinutes??25);
    if(!Number.isInteger(minLessons)||minLessons<1||minLessons>100||!Number.isInteger(minMinutes)||minMinutes<1||minMinutes>480)throw Error('每日目标需为 1–100 节、1–480 分钟');
    if(!old&&v.profiles.length>=50)throw Error('最多保存 50 门课程');
    const expectedChapters=platform==='xueyin'?Number(input.expectedChapters??old?.expectedChapters??0):0;
    if(platform==='xueyin'&&(!Number.isInteger(expectedChapters)||expectedChapters<1||expectedChapters>500))throw Error('请填写学习通课程总章数（1–500），用于完成核对');
    const p={expectedChapters,id:old?.id||randomUUID(),platform,name,legacy:old?.legacy||false,minLessons,minMinutes};
    const previous=old?secrets(old):{},url=input.url?validateUrl(platform,input.url):previous.url;
    if(!url)throw Error('新增课程需要学习页面链接');
    const identity=value=>platform==='icourse'?M.validateLaunchURL(value).identity:platform==='xueyin'?X.validateLaunchURL(value).identity:{id:new URL(value).searchParams.get('recruitAndCourseId')};
    if(previous.url){const a=identity(previous.url),b=identity(url);
      if(JSON.stringify(a)!==JSON.stringify(b))throw Error('课程身份不同，请新增课程以保留原有记录');}
    const scoreUrl=input.scoreUrl?scoreConfig(input.scoreUrl).url:previous.scoreUrl;
    if(!safeStorage.isEncryptionAvailable())throw Error('本机加密存储不可用');
    const target=secretFile(p);fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target+'.pending',safeStorage.encryptString(platform==='xueyin'?url:JSON.stringify({url,scoreUrl})));fs.renameSync(target+'.pending',target);
    v.profiles=old?v.profiles.map(item=>item.id===p.id?p:item):[...v.profiles,p];write(v);return p;
  };
  const select=id=>{const p=get(id),v=read();v.selectedId=id;v.byPlatform[p.platform]=id;write(v);return p;};
  return {list,get,config,dataFor,save,select};
}
function scope(ipcMain,host){
  const handlers=[],listeners=[],windowListeners=[];
  const ipc={handle:(n,f)=>{ipcMain.handle(n,f);handlers.push(n);},on:(n,f)=>{ipcMain.on(n,f);listeners.push([n,f]);}};
  const window=new Proxy(host,{get(target,key){if(key==='on')return (n,f)=>{target.on(n,f);windowListeners.push([n,f]);return window;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  return {ipc,window,dispose:()=>{handlers.forEach(n=>ipcMain.removeHandler(n));listeners.forEach(([n,f])=>ipcMain.removeListener(n,f));windowListeners.forEach(([n,f])=>host.removeListener(n,f));}};
}
function createCourseRuntime({profiles,ipcMain,host,factory,onChange,supportedPlatforms=['mayuan','xueyin']}){
  const active={};
  // Profile storage can precede adapter implementation. Never dispatch a new
  // platform to an existing adapter or mutate the selection before this guard.
  const assertPlatform=p=>{if(!supportedPlatforms.includes(p.platform))throw Error('该平台播放适配器尚未启用');};
  const assertSwitch=()=>{if(Object.values(active).some(item=>item.controller.status().submissionIntent||item.controller.status().status==='submitting'))throw Error('存在待核对提交，请先核对再切换课程');};
  const pause=()=>{assertSwitch();for(const item of Object.values(active)){const s=item.controller.status();if((s.dailyState?.status||s.status)==='running')item.controller.command('PAUSE');item.controller.close();}};
  const install=p=>{const old=active[p.platform],expanded=old?.controller.status().courseExpanded||false;old?.controller.stop();old?.scope.dispose();const s=scope(ipcMain,host);const controller=factory(p,s.ipc,s.window);controller.setExpanded(expanded);active[p.platform]={profile:p,scope:s,controller};onChange(p.platform,controller);return controller;};
  return {init:()=>{const v=profiles.list();assertPlatform(profiles.get(v.selectedId));for(const platform of supportedPlatforms)if(v.byPlatform[platform])install(profiles.get(v.byPlatform[platform]));},
    list:profiles.list,claim:id=>profiles.select(id),
    select:id=>{const p=profiles.get(id);assertPlatform(p);
      const pending=Object.values(active).filter(item=>item.controller.status().submissionIntent||item.controller.status().status==='submitting');
      if(pending.length){if(pending.some(item=>item.profile.id!==id))throw Error('存在待核对提交，请先核对再切换课程');
        for(const item of Object.values(active).filter(item=>item.profile.id!==id)){const s=item.controller.status();if((s.dailyState?.status||s.status)==='running')item.controller.command('PAUSE');item.controller.close();}
        profiles.select(id);return profiles.list();}
      pause();profiles.select(id);if(active[p.platform]?.profile.id!==id)install(p);return profiles.list();},
    save:input=>{assertPlatform(input.id?profiles.get(input.id):input);assertSwitch();pause();const p=profiles.save(input);profiles.select(p.id);install(p);return profiles.list();}};
}
module.exports={createProfiles,createCourseRuntime,validateUrl,scoreConfig};
