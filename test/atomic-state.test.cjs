const test=require('node:test');
const assert=require('node:assert/strict');
const {createAtomicState}=require('../src/atomic-state.cjs');

for(const stage of ['write','rename'])test(`state survives ${stage} disk-full failure and requires explicit recovery`,()=>{
  let disk=JSON.stringify({status:'running',platformDone:7,currentTask:'3.2/video/0'});
  let pending='',full=true,writes=0,notifications=0;
  const io={readFileSync:()=>disk,mkdirSync:()=>{},
    writeFileSync:(_file,value)=>{writes++;pending=value;if(full&&stage==='write')throw Object.assign(Error('private path'),{code:'ENOSPC'});},
    renameSync:()=>{if(full&&stage==='rename')throw Object.assign(Error('private path'),{code:'ENOSPC'});disk=pending;}};
  const store=createAtomicState('isolated/state.json',()=>({status:'idle'}),{io,onFailure:()=>notifications++});
  assert.equal(store.write({status:'running',platformDone:8}).status,'blocked');
  assert.equal(JSON.parse(disk).platformDone,7);
  assert.equal(store.read().storageError,'ENOSPC');
  assert.equal(JSON.stringify(store.read()).includes('private path'),false);
  store.write({status:'running',platformDone:99});
  assert.equal(writes,1);assert.equal(notifications,1);
  assert.equal(store.recover(),false);
  full=false;
  assert.equal(store.recover(),true);
  assert.equal(store.read().status,'paused');assert.equal(store.read().platformDone,7);
  store.write({...store.read(),status:'running',platformDone:8});
  assert.equal(store.read().platformDone,8);
});
