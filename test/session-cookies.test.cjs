const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {allowedDomain,createSessionCookieBackup}=require('../src/session-cookies.cjs');

test('cookie backup accepts only Zhihuishu domains',()=>{
  assert.equal(allowedDomain('.zhihuishu.com'),true);
  assert.equal(allowedDomain('login.zhihuishu.com'),true);
  assert.equal(allowedDomain('zhihuishu.com.example.org'),false);
});

test('changed session cookies are backed up promptly without unrelated cookie writes',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhs-cookie-watch-'));
  t.after(()=>{
    const target=fs.realpathSync(dir),base=fs.realpathSync(os.tmpdir());
    if(!target.startsWith(base+path.sep))throw Error('Temporary path outside expected directory');
    fs.rmSync(target,{recursive:true});
  });
  const file=path.join(dir,'session-cookies.bin');
  const cookies=new EventEmitter();
  let reads=0;
  cookies.get=async()=>{
    reads++;
    return [{name:'session',value:'new-token',domain:'login.zhihuishu.com',
      hostOnly:true,path:'/',secure:true,httpOnly:true,session:true,sameSite:'lax'}];
  };
  const safeStorage={isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from(value,'utf8'),
    decryptString:bytes=>bytes.toString('utf8')};
  const backup=createSessionCookieBackup(file,safeStorage,cookies);
  const stop=backup.watch(5);
  cookies.emit('changed',{}, {session:true,domain:'example.org'});
  cookies.emit('changed',{}, {session:false,domain:'login.zhihuishu.com'});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(reads,0);
  cookies.emit('changed',{}, {session:true,domain:'login.zhihuishu.com'});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(reads,1);
  assert.equal(fs.existsSync(file),true);
  stop();
  cookies.emit('changed',{}, {session:true,domain:'login.zhihuishu.com'});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(reads,1);
});

test('simultaneous captures serialize the encrypted backup file',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhs-cookie-queue-'));
  t.after(()=>{
    const target=fs.realpathSync(dir),base=fs.realpathSync(os.tmpdir());
    if(!target.startsWith(base+path.sep))throw Error('Temporary path outside expected directory');
    fs.rmSync(target,{recursive:true});
  });
  const file=path.join(dir,'session-cookies.bin');
  let reads=0;
  const cookies={get:async()=>{
    reads++;
    await new Promise(resolve=>setTimeout(resolve,5));
    return [{name:'session',value:'token',domain:'login.zhihuishu.com',
      hostOnly:true,path:'/',secure:true,httpOnly:true,session:true,sameSite:'lax'}];
  }};
  const safeStorage={isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from(value,'utf8'),
    decryptString:bytes=>bytes.toString('utf8')};
  const backup=createSessionCookieBackup(file,safeStorage,cookies);
  const results=await Promise.all([backup.capture(),backup.capture()]);
  assert.deepEqual(results,[{saved:true,count:1},{saved:true,count:1}]);
  assert.equal(reads,2);
  assert.equal(fs.existsSync(file+'.pending'),false);
});
test('session cookies are encrypted and restored without extending their expiry',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhs-cookie-test-'));
  t.after(()=>{
    const target=fs.realpathSync(dir),base=fs.realpathSync(os.tmpdir());
    if(!target.startsWith(base+path.sep))throw Error('Temporary path outside expected directory');
    fs.rmSync(target,{recursive:true});
  });
  const file=path.join(dir,'session-cookies.bin'),secret='example-cookie-value';
  const safeStorage={isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from(value.split('').reverse().join(''),'utf8'),
    decryptString:bytes=>bytes.toString('utf8').split('').reverse().join('')};
  const restored=[];
  const cookies={get:async filter=>{
    assert.deepEqual(filter,{session:true});
    return [{name:'session',value:secret,domain:'login.zhihuishu.com',hostOnly:true,path:'/',
      secure:true,httpOnly:true,session:true,sameSite:'lax'},
      {name:'other',value:'unrelated',domain:'example.org',session:true}];
  },set:async details=>{restored.push(details);}};
  const backup=createSessionCookieBackup(file,safeStorage,cookies);
  assert.deepEqual(await backup.capture(),{saved:true,count:1});
  assert.equal(fs.readFileSync(file,'utf8').includes(secret),false);
  assert.equal(await backup.restore(),1);
  assert.equal(restored.length,1);
  assert.equal(restored[0].url,'https://login.zhihuishu.com/');
  assert.equal('expirationDate' in restored[0],false);
  assert.equal('domain' in restored[0],false);
});
