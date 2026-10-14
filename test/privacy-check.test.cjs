const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync,execFileSync}=require('node:child_process');
test('publication scanner rejects credentials, runtime files and changed binary fixtures',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'publication-scan-'));
  t.after(()=>{assert.ok(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true});});
  fs.mkdirSync(path.join(root,'scripts'));
  fs.copyFileSync(path.join(__dirname,'../scripts/privacy-check.cjs'),path.join(root,'scripts/privacy-check.cjs'));
  execFileSync('git',['init','-q'],{cwd:root});
  const scan=()=>spawnSync(process.execPath,['scripts/privacy-check.cjs'],{cwd:root,encoding:'utf8'});
  assert.equal(scan().status,0);
  const secret='sk'+'-'+ 'a'.repeat(24);
  fs.writeFileSync(path.join(root,'example.cjs'),`const key='${secret}';`);
  const failed=scan();assert.equal(failed.status,1);assert.match(failed.stderr,/possible credential/);assert.equal(failed.stderr.includes(secret),false);
  fs.writeFileSync(path.join(root,'example.cjs'),'// no credentials');
  fs.writeFileSync(path.join(root,'state.json'),'{}');assert.equal(scan().status,1);fs.unlinkSync(path.join(root,'state.json'));
  fs.mkdirSync(path.join(root,'test','fixtures'),{recursive:true});fs.writeFileSync(path.join(root,'test','fixtures','native-input.webm'),'unreviewed video');
  assert.match(scan().stderr,/fixture changed/);
});
