const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../src/icourse-core.cjs');
const url='https://www.icourse163.org/mooc/learn/MOCK-100/content/200?tid=300&unitId=400&chapterId=500';
test('MOOC identity is stable across units but distinct across offerings',()=>{
  const config=M.validateLaunchURL(url);
  assert.deepEqual(config.identity,{course:'MOCK-100',term:'300'});
  assert.equal(M.coursePage(url.replace('content/200','content/201').replace('unitId=400','unitId=401'),config.identity),true);
  assert.equal(M.coursePage(url.replace('tid=300','tid=301'),config.identity),false);
  assert.equal(M.coursePage(url.replace('MOCK-100','MOCK-101'),config.identity),false);
  assert.equal(M.validateLaunchURL(url+'&tracking=synthetic#fragment').url,url);
});
test('MOOC launch rejects foreign origins, credentials and ambiguous identifiers',()=>{
  for(const value of [url.replace('https:','http:'),url.replace('www.icourse163.org','example.test'),
    url.replace('www.icourse163.org','www.icourse163.org.example.test'),url.replace('https://','https://user:password@'),
    url.replace('tid=300','tid='),url+'&tid=301',url.replace('unitId=400','unitId=invalid'),
    url.replace('/mooc/learn/MOCK-100/content/200','/course/MOCK-100')])assert.throws(()=>M.validateLaunchURL(value));
});
