const fs=require('node:fs');
const path=require('node:path');

function safeLocation(value){
  try{
    const url=new URL(value);
    const host=/(^|\.)zhihuishu\.com$/.test(url.hostname)||url.hostname==='hike-teaching-center.polymas.com'
      ?url.hostname:'external';
    const route=url.hostname==='wisdom-mooc.zhihuishu.com'&&url.pathname==='/study/index'?'study-index':
      url.hostname==='www.zhihuishu.com'&&['/','/index','/index.html'].includes(url.pathname)?'home':'other';
    return {host,route};
  }catch{return {host:'invalid',route:'other'};}
}

function createNavigationTrace(file){
  const record=(kind,url,extra={})=>{
    try{
      const entry={at:new Date().toISOString(),kind,target:safeLocation(url),
        ...(extra.from?{from:safeLocation(extra.from)}:{}),
        ...(extra.initiator?{initiator:safeLocation(extra.initiator)}:{}),
        ...(['chapter','lesson','reminder','quiz-option','quiz-submit','quiz-close'].includes(extra.action)?{action:extra.action}:{}),
        ...(['sent','confirmed','timeout'].includes(extra.result)?{result:extra.result}:{}),
        ...(typeof extra.mainFrame==='boolean'?{mainFrame:extra.mainFrame}:{}),
        ...(Number.isInteger(extra.httpStatus)?{httpStatus:extra.httpStatus}:{}),
        ...(['default','foreground-tab','background-tab','new-window','other'].includes(extra.disposition)
          ?{disposition:extra.disposition}:{})};
      let previous=[];
      try{const loaded=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(loaded))previous=loaded;}catch{}
      const pending=file+'.pending';
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(pending,JSON.stringify([...previous.slice(-59),entry]),'utf8');
      fs.renameSync(pending,file);
    }catch{}
  };
  return {record};
}

module.exports={safeLocation,createNavigationTrace};
