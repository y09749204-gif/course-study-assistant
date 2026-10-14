const {ipcRenderer}=require('electron');
if(location.protocol==='https:'&&(location.hostname==='zhihuishu.com'||location.hostname.endsWith('.zhihuishu.com'))){
  try{
    const origin=location.origin;
    for(const [key,value] of ipcRenderer.sendSync('zhs-auth-restore',origin))
      if(sessionStorage.getItem(key)===null)sessionStorage.setItem(key,value);
    let previous='';
    const snapshot=()=>{
      try{
        const entries=Array.from({length:sessionStorage.length},(_,i)=>{
          const key=sessionStorage.key(i);return [key,sessionStorage.getItem(key)];
        });
        const current=JSON.stringify(entries);
        if(current!==previous){
          ipcRenderer.sendSync('zhs-auth-snapshot',{origin,entries});
          previous=current;
        }
      }catch{}
    };
    setInterval(snapshot,1000);
    addEventListener('pagehide',snapshot);
  }catch{}
}
if(process.isMainFrame){
require('./core.js');
const courseConfig=ipcRenderer.sendSync('zhs-course-config');
if(courseConfig)globalThis.ZhsCore=globalThis.ZhsCore.create(courseConfig);

const storageListeners=[];
const messageListeners=[];
const pending=[];
globalThis.chrome={
  storage:{
    local:{
      get:keys=>ipcRenderer.invoke('zhs-storage-get',keys),
      set:value=>ipcRenderer.invoke('zhs-storage-set',value),
    },
    onChanged:{addListener:listener=>storageListeners.push(listener)},
  },
  runtime:{
    sendMessage:message=>ipcRenderer.invoke('zhs-runtime-message',message),
    onMessage:{addListener:listener=>{
      messageListeners.push(listener);
      while(pending.length) listener(pending.shift(),null,()=>{});
    }},
  },
};
ipcRenderer.on('zhs-storage-changed',(_event,changes)=>{
  for(const listener of storageListeners) listener(changes,'local');
});
ipcRenderer.on('zhs-command',(_event,message)=>{
  if(!messageListeners.length) pending.push(message);
  else for(const listener of messageListeners) listener(message,null,()=>{});
});
if(new URL(location.href).searchParams.get('recruitAndCourseId')===globalThis.ZhsCore.COURSE_ID){
  const attach=()=>require('./content.js');
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',attach,{once:true});
  else attach();
}
}
