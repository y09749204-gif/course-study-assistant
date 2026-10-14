const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {safeLocation,createNavigationTrace}=require('../src/navigation-trace.cjs');

test('navigation trace records only bounded route metadata without tokens or private paths',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhs-nav-trace-'));
  try{
    const file=path.join(dir,'trace.json');
    const trace=createNavigationTrace(file);
    const secret='private-token-123';
    for(let i=0;i<65;i++)trace.record('popup-request',
      `https://passport.zhihuishu.com/user/${secret}?enc=${secret}`,
      {from:`https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=${secret}`,
        initiator:`https://hike-teaching-center.polymas.com/person/${secret}`,
        disposition:'new-window',httpStatus:302});
    const written=fs.readFileSync(file,'utf8');
    const entries=JSON.parse(written);
    assert.equal(entries.length,60);
    assert.equal(written.includes(secret),false);
    assert.equal(written.includes('enc'),false);
    assert.deepEqual(entries.at(-1).target,{host:'passport.zhihuishu.com',route:'other'});
    assert.deepEqual(entries.at(-1).from,{host:'wisdom-mooc.zhihuishu.com',route:'study-index'});
    assert.equal(entries.at(-1).httpStatus,302);
  }finally{fs.unlinkSync(path.join(dir,'trace.json'));fs.rmdirSync(dir);}
  assert.deepEqual(safeLocation('javascript:alert(1)'),{host:'external',route:'other'});
});
