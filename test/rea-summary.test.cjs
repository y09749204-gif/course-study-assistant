const test=require('node:test');
const assert=require('node:assert/strict');
const {summarize}=require('../scripts/rea-inspect.cjs');
test('REA summary excludes credentials, URL parameters and page text',()=>{
 const value=summarize({target:{url:'https://wisdom-mooc.zhihuishu.com/course?token=private'},frames:[],dom:{total_nodes:4},
 network:{requests:[{url:'https://wisdom-mooc.zhihuishu.com/api/private-id?token=private',method:'GET',status:302,headers:{Cookie:'private'}}]},
 console:{events:[{text:'private'}]},storage:{cookies:'private'}});
 assert.equal(JSON.stringify(value).includes('private'),false);assert.equal(value.requests[0].status,302);
});
test('REA CLI result envelope is accepted without retaining envelope metadata',()=>{
 const value=summarize({result:{data:{target:{url:'https://wisdom-mooc.zhihuishu.com/'},network:{requests:[]},dom:{total_nodes:3}}},metadata:{secret:'private'}});
 assert.equal(value.domNodes,3);assert.equal(JSON.stringify(value).includes('private'),false);
});
