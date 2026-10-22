const {ipcRenderer}=require('electron');
const M=require('./icourse-core.cjs');
if(process.isMainFrame){
  const identity=ipcRenderer.sendSync('mooc-config');
  if(identity&&M.coursePage(location.href,identity))require('./icourse-agent.cjs').attach({identity,matches:M.coursePage,bridge:{
    state:()=>ipcRenderer.invoke('mooc-agent-state'),
    report:value=>ipcRenderer.invoke('mooc-observation',value),
    ended:value=>ipcRenderer.sendSync('mooc-ended',value),
    onCommand:callback=>ipcRenderer.on('mooc-pause',callback)
  }});
}
