const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {createProfiles,createCourseRuntime}=require('../src/course-profiles.cjs');
const C=require('./helpers/mock-course.cjs');
const {coursePage}=require('../src/study.cjs');
function setup(){
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'course-profiles-isolated-')),key=crypto.randomBytes(32);
  const safe={isEncryptionAvailable:()=>true,encryptString:s=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([c.update(s,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]);},decryptString:b=>{const c=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString();}};
  return {data,safe,p:createProfiles(data,safe)};
}
const zUrl=id=>`https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=${id}`;
const xUrl=id=>`https://mooc2-ans.xueyinonline.com/mooc2-ans/mycourse/stu?courseid=${id}&clazzid=22&cpi=33&enc=synthetic-secret`;
const mUrl=term=>`https://www.icourse163.org/mooc/learn/MOCK-100/content/200?tid=${term}&unitId=400`;

test('MOOC profiles encrypt links and isolate progress by course offering',()=>{
  const {p,data}=setup();
  const a=p.save({name:'Mock MOOC A',platform:'icourse',url:mUrl('300')});
  const b=p.save({name:'Mock MOOC B',platform:'icourse',url:mUrl('301')});
  assert.notEqual(p.dataFor(a),p.dataFor(b));
  assert.equal(p.config(a).url,mUrl('300'));
  assert.equal(p.config(a).courseId,null);
  assert.equal(p.list().profiles.find(x=>x.id===a.id).configured,true);
  assert.equal(fs.readFileSync(path.join(data,'courses.json'),'utf8').includes('icourse163.org'),false);
  const before=fs.readFileSync(path.join(data,'course-config',a.id+'.bin'));
  assert.equal(before.includes(Buffer.from('icourse163.org')),false);
  assert.throws(()=>p.save({...a,url:mUrl('302')}),/新增课程/);
  assert.deepEqual(fs.readFileSync(path.join(data,'course-config',a.id+'.bin')),before);
  p.save({...a,url:mUrl('300').replace('content/200','content/201')});
  p.select(a.id);assert.equal(p.list().selectedId,a.id);
});

test('a registered platform cannot dispatch to a different adapter before activation',()=>{
  const {p}=setup(),host=new EventEmitter(),ipc=new EventEmitter();
  const runtime=createCourseRuntime({profiles:p,ipcMain:ipc,host,onChange:()=>{},factory:()=>{throw Error('Unexpected adapter creation');}});
  const before=JSON.stringify(p.list());
  assert.throws(()=>runtime.save({name:'MOOC',platform:'icourse',url:mUrl('300')}),/尚未启用/);
  assert.equal(JSON.stringify(p.list()),before);
  const item=p.save({name:'MOOC',platform:'icourse',url:mUrl('300')});
  assert.throws(()=>runtime.select(item.id),/尚未启用/);
  assert.equal(p.list().selectedId,'mayuan');
});
test('default courses retain their legacy data paths; new courses are encrypted and isolated',()=>{
  const {p,data}=setup();assert.equal(p.dataFor(p.get('mayuan')),data);assert.equal(p.dataFor(p.get('xueyin')),data);
  const a=p.save({name:'Mock A',platform:'mayuan',url:zUrl('mock-course-alpha'),minLessons:3,minMinutes:40});
  const b=p.save({name:'Mock B',platform:'xueyin',expectedChapters:2,url:xUrl('11')});
  assert.notEqual(p.dataFor(a),p.dataFor(b));assert.ok(p.dataFor(a).startsWith(path.join(data,'courses')+path.sep));
  assert.equal(p.config(a).courseId,'mock-course-alpha');assert.equal(p.config(b).url,xUrl('11'));
  assert.equal(JSON.stringify(p.list()).includes('synthetic-secret'),false);
  assert.equal(fs.readFileSync(path.join(data,'courses.json'),'utf8').includes('recruitAndCourseId'),false);
  assert.equal(fs.readFileSync(path.join(p.dataFor(b),'xueyin-study/course-url.bin')).includes(Buffer.from('synthetic-secret')),false);
});
test('editing course identity or accepting arbitrary URLs cannot overwrite existing progress or links',()=>{
  const {p}=setup();const a=p.save({name:'Mock A',platform:'xueyin',expectedChapters:2,url:xUrl('11')});
  const file=path.join(p.dataFor(a),'xueyin-study/course-url.bin'),before=fs.readFileSync(file);
  assert.throws(()=>p.save({...a,url:xUrl('12')}),/新增课程/);assert.deepEqual(fs.readFileSync(file),before);
  assert.throws(()=>p.save({name:'Bad',platform:'mayuan',url:'https://example.test/study/index?recruitAndCourseId=mock-course-alpha'}),/智慧树/);
  assert.throws(()=>p.save({...a,minMinutes:0}),/每日目标/);
  assert.throws(()=>p.select('../../escape'),/课程不存在/);
});
test('corrupt registry paths fail closed instead of silently overwriting the index',()=>{
  const {p,data}=setup();fs.writeFileSync(path.join(data,'courses.json'),JSON.stringify({version:1,selectedId:'../../escape',profiles:[{id:'../../escape',platform:'xueyin'}]}));
  const before=fs.readFileSync(path.join(data,'courses.json'));assert.throws(()=>p.list(),/无法读取/);assert.deepEqual(fs.readFileSync(path.join(data,'courses.json')),before);
});
test('custom course guards and daily goals use the selected profile; prior goal snapshots remain stable',()=>{
  const c=C.create({url:zUrl('mock-course-alpha'),courseId:'mock-course-alpha',minLessons:4,minMinutes:45});
  assert.equal(c.meetsGoal({seconds:1500,completed:['1','2']}),false);
  assert.equal(c.meetsGoal({seconds:2700,completed:['1','2','3','4']}),true);
  assert.equal(c.meetsGoal({seconds:1500,completed:['1','2'],goal:{minLessons:2,minMinutes:25}}),true);
  assert.equal(coursePage(zUrl('mock-course-alpha'),'mock-course-alpha'),true);assert.equal(coursePage(zUrl('mock-course-beta'),'mock-course-alpha'),false);
});
test('switching profiles pauses and closes old views, cleans handlers and preserves submission intent',()=>{
  const {p}=setup(),host=new EventEmitter(),ipc=new EventEmitter(),handlers=new Map(),created=[];
  ipc.handle=(n,f)=>{assert.equal(handlers.has(n),false);handlers.set(n,f);};ipc.removeHandler=n=>handlers.delete(n);
  const runtime=createCourseRuntime({profiles:p,ipcMain:ipc,host,onChange:()=>{},factory:(profile,scoped,win)=>{
    const item={profile,state:'paused',closed:0,stopped:0,intent:null};created.push(item);
    scoped.handle(profile.platform+'-status',()=>profile.id);win.on('resize',()=>{});
    return {status:()=>({status:item.state,submissionIntent:item.intent}),command:()=>{item.state='paused';},close:()=>{item.closed++;},stop:()=>{item.stopped++;},setExpanded:()=>{}};
  }});runtime.init();const a=p.save({name:'Other',platform:'mayuan',url:zUrl('mock-course-alpha')});
  created[0].state='running';runtime.select(a.id);assert.equal(created[0].state,'paused');assert.equal(created[0].stopped,1);assert.equal(host.listenerCount('resize'),2);
  assert.equal(handlers.get('mayuan-status')(),a.id);
  created.at(-1).intent={section:'1.2'};assert.throws(()=>runtime.select('mayuan'),/核对/);assert.equal(p.list().selectedId,a.id);
  const closed=created.at(-1).closed;runtime.select(a.id);assert.equal(created.at(-1).closed,closed);assert.ok(created.at(-1).intent);
});

test('legacy records keep their original goals while new daily tasks use updated targets',()=>{
  const c=C.create({legacy:true,minLessons:4,minMinutes:45});
  assert.equal(c.meetsGoal({seconds:1500,completed:['1','2']}),true);
  const day=c.emptyState('2026-10-14');assert.equal(day.goal.minMinutes,45);
  assert.equal(c.meetsGoal({...day,seconds:1500,completed:['1','2']}),false);
});
test('score review uses only the configured course identifiers',async()=>{
  const {readPlatformReview}=require('../src/platform-review.cjs');let calls=0;
  const session={fetch:async(_url,options)=>{const b=new URLSearchParams(options.body);assert.equal(b.get('courseId'),'111');assert.equal(b.get('recruitId'),'222');const at=++calls;
    return {ok:true,text:async()=>JSON.stringify(at===1?{recruitId:'222',studentStudyMap:{'10.13':'40,3'},stuStudyRecord:{suggestTime:40}}:{recruitId:'222',studentId:'mock',chapterOrLesson:{clList:[]}})};}};
  const result=await readPlatformReview(session,'2026-10-13',[],{courseId:'111',recruitId:'222'});assert.equal(result.state,'observed');assert.equal(result.habitMinutes,40);
});
