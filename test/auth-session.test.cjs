const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {officialOrigin,createAuthSession}=require('../src/auth-session.cjs');

test('only HTTPS Zhihuishu origins can be restored',()=>{
  assert.equal(officialOrigin('https://wisdom-mooc.zhihuishu.com'),true);
  assert.equal(officialOrigin('http://wisdom-mooc.zhihuishu.com'),false);
  assert.equal(officialOrigin('https://zhihuishu.com.example.org'),false);
});
test('session values are encrypted on disk and restored for the same origin',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhs-auth-test-'));
  t.after(()=>{
    const target=fs.realpathSync(dir),base=fs.realpathSync(os.tmpdir());
    if(!target.startsWith(base+path.sep))throw Error('Temporary path outside expected directory');
    fs.rmSync(target,{recursive:true});
  });
  const file=path.join(dir,'auth-session.bin');
  const secret='example-session-value';
  const safeStorage={isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from(value.split('').reverse().join(''),'utf8'),
    decryptString:bytes=>bytes.toString('utf8').split('').reverse().join('')};
  const origin='https://wisdom-mooc.zhihuishu.com';
  const store=createAuthSession(file,safeStorage);
  assert.equal(store.snapshot(origin,[['session-key',secret]]),true);
  assert.equal(fs.readFileSync(file,'utf8').includes(secret),false);
  assert.deepEqual(createAuthSession(file,safeStorage).restore(origin),[['session-key',secret]]);
  assert.deepEqual(store.restore('https://other.example.com'),[]);
});
