const fs=require('node:fs');
const path=require('node:path');

// Keep the last committed file intact, and latch failures until an explicit retry.
function createAtomicState(file,empty,{io=fs,onFailure=()=>{}}={}){
  let failure=null;
  const load=()=>{try{return {...empty(),...JSON.parse(io.readFileSync(file,'utf8'))};}catch{return empty();}};
  const read=()=>failure?{...load(),status:'blocked',blockedReason:
    failure==='ENOSPC'?'磁盘空间不足，学习状态无法保存；释放空间后点开始／恢复':
      '学习状态保存失败；检查磁盘权限后点开始／恢复',storageError:failure}:load();
  const persist=value=>{
    if(failure)return read();
    try{
      io.mkdirSync(path.dirname(file),{recursive:true});
      io.writeFileSync(file+'.pending',JSON.stringify(value),'utf8');
      io.renameSync(file+'.pending',file);
      return value;
    }catch(error){
      failure=['ENOSPC','EACCES','EPERM','EIO'].includes(error?.code)?error.code:'other';
      try{onFailure(failure);}catch{}
      return read();
    }
  };
  return {read,write:persist,failed:()=>!!failure,recover:()=>{
    if(!failure)return true;
    const value=load();failure=null;
    persist({...value,status:'paused',blockedReason:null});
    return !failure;
  }};
}
module.exports={createAtomicState};
