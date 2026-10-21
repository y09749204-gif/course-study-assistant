// Learning URLs identify a course offering independently of the selected unit.
function validateLaunchURL(value){
  let u;
  try{u=new URL(value);}catch{throw Error('请使用中国大学 MOOC 课程学习页面链接');}
  const match=/^\/mooc\/learn\/([A-Za-z0-9_-]{1,100})\/content\/(\d{1,20})\/?$/.exec(u.pathname);
  const numeric=value=>/^\d{1,20}$/.test(value||'');
  if(u.origin!=='https://www.icourse163.org'||u.username||u.password||!match||
    !numeric(u.searchParams.get('tid'))||
    ['unitId','chapterId'].some(key=>u.searchParams.has(key)&&!numeric(u.searchParams.get(key)))||
    ['tid','unitId','chapterId'].some(key=>u.searchParams.getAll(key).length>1))
    throw Error('请使用中国大学 MOOC 课程学习页面链接（包含 tid）');
  // Persist only learning identifiers; exclude tracking, fragments and unrelated parameters.
  const clean=new URL(u.origin+u.pathname);
  for(const key of ['tid','unitId','chapterId'])if(u.searchParams.has(key))clean.searchParams.set(key,u.searchParams.get(key));
  return {url:clean.href,identity:{course:match[1],term:u.searchParams.get('tid')},contentId:match[2]};
}
function coursePage(value,identity){
  try{const current=validateLaunchURL(value).identity;return current.course===identity.course&&current.term===identity.term;}catch{return false;}
}
module.exports={validateLaunchURL,coursePage};
