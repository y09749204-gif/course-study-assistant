const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {runtimeData}=require('../src/runtime-data.cjs');
const base={appData:path.join(os.tmpdir(),'mock-appdata'),root:path.join(os.tmpdir(),'mock-source'),env:{},argv:[]};
test('public launch and source development have different data namespaces',()=>{
  assert.equal(runtimeData(base).directory,path.join(base.root,'.local-data','development'));
  assert.equal(runtimeData({...base,argv:['--user-data']}).directory,path.join(base.appData,'course-study-assistant'));
});
test('explicit overrides cannot access personal, team, or public production data in development',()=>{
  for(const directory of ['zhihuishu-personal-study','SufeStudyAssistant','course-study-assistant'])
    assert.throws(()=>runtimeData({...base,env:{ZH_STUDY_TEST_DATA_DIR:path.join(base.appData,directory,'child')}}));
  assert.throws(()=>runtimeData({...base,env:{ZH_STUDY_TEST_DATA_DIR:'relative'}}));
  assert.throws(()=>runtimeData({...base,argv:['--user-data'],env:{ZH_STUDY_TEST_DATA_DIR:path.join(base.appData,'course-study-assistant')}}));
});
test('missing course configuration cannot load a real course or query scores',async()=>{
  const {createProfiles}=require('../src/course-profiles.cjs');
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'public-config-'));
  const profiles=createProfiles(data,{});
  assert.ok(profiles.list().profiles.every(p=>!p.configured));
  assert.equal(require('../src/core.js').COURSE_URL,'');
  assert.equal(require('../src/core.js').COURSE_ID,'');
  const {readPlatformReview}=require('../src/platform-review.cjs');let called=false;
  await assert.rejects(()=>readPlatformReview({fetch:()=>{called=true;}},'2026-10-14',[]),/unconfigured/);
  assert.equal(called,false);
  assert.ok(fs.realpathSync(data).startsWith(fs.realpathSync(os.tmpdir())+path.sep));
  fs.rmSync(data,{recursive:true});
});
test('junction aliases cannot bypass protected data directories',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-junction-'));
  const appData=path.join(root,'appdata'),formal=path.join(appData,'SufeStudyAssistant'),alias=path.join(root,'alias');
  fs.mkdirSync(formal,{recursive:true});fs.writeFileSync(path.join(formal,'marker'),'untouched');
  fs.symlinkSync(formal,alias,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>runtimeData({...base,appData,env:{ZH_STUDY_TEST_DATA_DIR:path.join(alias,'new')}}));
  assert.equal(fs.readFileSync(path.join(formal,'marker'),'utf8'),'untouched');
  fs.unlinkSync(alias);
  assert.ok(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));
  fs.rmSync(root,{recursive:true});
});
