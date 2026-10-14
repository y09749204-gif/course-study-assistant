const fs=require('node:fs');
const path=require('node:path');

function officialOrigin(value){
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&(url.hostname==='zhihuishu.com'||url.hostname.endsWith('.zhihuishu.com'))
      && url.origin===value;
  }catch{return false;}
}

function createAuthSession(file,safeStorage,originAllowed=officialOrigin){
  let cache={};
  if(safeStorage.isEncryptionAvailable()){
    try{cache=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));}catch{}
  }
  const restore=origin=>originAllowed(origin)&&safeStorage.isEncryptionAvailable()&&Array.isArray(cache[origin])
    ? cache[origin]:[];
  const snapshot=(origin,entries)=>{
    if(!originAllowed(origin)||!safeStorage.isEncryptionAvailable()||!Array.isArray(entries)||entries.length>100||
      entries.some(item=>!Array.isArray(item)||item.length!==2||item.some(part=>typeof part!=='string')))
      return false;
    const serialized=JSON.stringify(entries);
    if(serialized.length>128_000||JSON.stringify(cache[origin]||[])===serialized)return false;
    cache={...cache,[origin]:entries};
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const pending=file+'.pending';
    fs.writeFileSync(pending,safeStorage.encryptString(JSON.stringify(cache)));
    fs.renameSync(pending,file);
    return true;
  };
  return {restore,snapshot};
}
module.exports={officialOrigin,createAuthSession};
