const fs=require('node:fs');
const path=require('node:path');

const allowedDomain=domain=>typeof domain==='string'&&
  (domain.replace(/^\./,'')==='zhihuishu.com'||domain.replace(/^\./,'').endsWith('.zhihuishu.com'));

function createSessionCookieBackup(file,safeStorage,cookies,domainAllowed=allowedDomain){
  let captureQueue=Promise.resolve();
  const captureNow=async()=>{
    if(!safeStorage.isEncryptionAvailable())return {saved:false,count:0};
    const entries=(await cookies.get({session:true})).filter(cookie=>domainAllowed(cookie.domain))
      .slice(0,100).map(cookie=>({name:cookie.name,value:cookie.value,domain:cookie.domain,
        hostOnly:!!cookie.hostOnly,path:cookie.path||'/',secure:!!cookie.secure,
        httpOnly:!!cookie.httpOnly,sameSite:cookie.sameSite}));
    const payload=JSON.stringify(entries);
    if(payload.length>128_000)return {saved:false,count:entries.length};
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const pending=file+'.pending';
    fs.writeFileSync(pending,safeStorage.encryptString(payload));
    fs.renameSync(pending,file);
    return {saved:true,count:entries.length};
  };
  const capture=()=>{
    const result=captureQueue.catch(()=>{}).then(captureNow);
    captureQueue=result;
    return result;
  };
  const restore=async()=>{
    if(!safeStorage.isEncryptionAvailable())return 0;
    let entries;
    try{entries=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));}catch{return 0;}
    if(!Array.isArray(entries)||entries.length>100)return 0;
    let restored=0;
    for(const entry of entries){
      if(!domainAllowed(entry?.domain)||typeof entry.name!=='string'||typeof entry.value!=='string')continue;
      const host=entry.domain.replace(/^\./,'');
      const details={url:`https://${host}${entry.path?.startsWith('/')?entry.path:'/'}`,
        name:entry.name,value:entry.value,path:entry.path||'/',secure:!!entry.secure,
        httpOnly:!!entry.httpOnly,
        ...(entry.hostOnly?{}:{domain:entry.domain}),
        ...(['unspecified','no_restriction','lax','strict'].includes(entry.sameSite)?{sameSite:entry.sameSite}:{})};
      try{await cookies.set(details);restored++;}catch{}
    }
    return restored;
  };
  const watch=(delay=1000)=>{
    let timer=null;
    const changed=(_event,cookie)=>{
      if(!cookie?.session||!domainAllowed(cookie.domain))return;
      clearTimeout(timer);
      timer=setTimeout(()=>{timer=null;void capture().catch(()=>{});},delay);
    };
    cookies.on('changed',changed);
    return ()=>{clearTimeout(timer);cookies.removeListener('changed',changed);};
  };
  return {capture,restore,watch};
}
module.exports={allowedDomain,createSessionCookieBackup};
