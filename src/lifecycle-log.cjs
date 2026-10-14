const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

// Only fixed event names and bounded diagnostic fields reach disk. Never serialize errors,
// command lines, URLs or Electron event objects, which can contain private information.
function createLifecycleLog(data,{app,processEvents=process,version}={}){
  const directory=path.join(data,'zhihuishu-study');
  const file=path.join(directory,'lifecycle-log.json');
  const marker=path.join(directory,'lifecycle-session.json');
  const session=randomUUID();
  const events=new Set(['startup','previous-exit-unconfirmed','window-close','window-closed',
    'before-quit','will-quit','quit','process-exit','uncaught-exception',
    'renderer-gone','child-process-gone','renderer-unresponsive','renderer-responsive']);
  const reasons=new Set(['clean-exit','abnormal-exit','killed','crashed','oom',
    'launch-failed','integrity-failure']);
  const types=new Set(['Browser','GPU','Utility','Renderer','Zygote','Sandbox helper','Pepper Plugin','Pepper Plugin Broker']);
  const write=(target,value)=>{
    fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(target+'.pending',JSON.stringify(value),'utf8');
    fs.renameSync(target+'.pending',target);
  };
  const record=(event,detail={})=>{
    if(!events.has(event))return;
    try{
      const entry={at:new Date().toISOString(),session,event,
        ...(reasons.has(detail.reason)?{reason:detail.reason}:{}),
        ...(types.has(detail.type)?{type:detail.type}:{}),
        ...(Number.isInteger(detail.exitCode)?{exitCode:detail.exitCode}:{}),
        ...(Number.isInteger(detail.code)?{code:detail.code}:{}),
        ...(typeof detail.defaultPrevented==='boolean'?{defaultPrevented:detail.defaultPrevented}:{}),
        ...(event==='startup'&&typeof version==='string'&&/^[\w.+-]{1,64}$/.test(version)?{version}:{})};
      let previous=[];
      try{const loaded=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(loaded))previous=loaded;}catch{}
      write(file,[...previous.slice(-199),entry]);
    }catch{} // Logging must never stop startup or shutdown.
  };
  try{
    const previous=JSON.parse(fs.readFileSync(marker,'utf8'));
    if(previous.clean===false)record('previous-exit-unconfirmed');
  }catch{}
  record('startup');
  try{write(marker,{session,clean:false});}catch{}
  app.on('before-quit',()=>record('before-quit'));
  app.on('will-quit',event=>{
    record('will-quit');
    // Wait until every listener has run before deciding whether shutdown was canceled.
    queueMicrotask(()=>{
      if(event.defaultPrevented)return;
      try{write(marker,{session,clean:true});}catch{}
    });
  });
  app.on('quit',(_event,code)=>{
    record('quit',{code});
    try{write(marker,{session,clean:true});}catch{}
  });
  app.on('render-process-gone',(_event,_contents,details)=>record('renderer-gone',details));
  app.on('child-process-gone',(_event,details)=>record('child-process-gone',details));
  // Monitor does not intercept the exception or change Node's normal crash behavior.
  processEvents.on('uncaughtExceptionMonitor',()=>record('uncaught-exception'));
  processEvents.on('exit',code=>record('process-exit',{code}));
  return {record,watchWindow(window){
    window.on('close',event=>{
      record('window-close');
      queueMicrotask(()=>record('window-close',{defaultPrevented:!!event.defaultPrevented}));
    });
    window.on('closed',()=>record('window-closed'));
    window.on('unresponsive',()=>record('renderer-unresponsive'));
    window.on('responsive',()=>record('renderer-responsive'));
  }};
}

module.exports={createLifecycleLog};
