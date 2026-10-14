const path=require('node:path');
const fs=require('node:fs');

function runtimeData({appData,root,env=process.env,argv=process.argv}){
  const explicit=env.ZH_STUDY_TEST_DATA_DIR;
  const production=argv.includes('--user-data');
  const target=explicit?path.resolve(explicit):production?
    path.join(appData,'course-study-assistant'):path.join(root,'.local-data','development');
  // Check ancestors as well as the leaf, including existing symlink/junction targets.
  const forbidden=/^zhihuishu-personal-study$/i;
  const within=(value,base)=>value.toLowerCase()===base.toLowerCase()||value.toLowerCase().startsWith(base.toLowerCase()+path.sep);
  const teamData=path.resolve(appData,'SufeStudyAssistant');
  const publicData=path.resolve(appData,'course-study-assistant');
  const check=value=>{
    let current=path.resolve(value);
    if(within(current,teamData))throw Error('Team data directories are forbidden');
    if((explicit||!production)&&within(current,publicData))throw Error('Development and tests require isolated data');
    for(;;){if(forbidden.test(path.basename(current)))throw Error('Personal or team data directories are forbidden');
      const parent=path.dirname(current);if(parent===current)break;current=parent;}
  };
  check(target);
  let ancestor=target;
  while(!fs.existsSync(ancestor)){const parent=path.dirname(ancestor);if(parent===ancestor)break;ancestor=parent;}
  if(fs.existsSync(ancestor))check(path.join(fs.realpathSync(ancestor),path.relative(ancestor,target)));
  if(explicit&&!path.isAbsolute(explicit))throw Error('Test data path must be absolute');
  return {directory:target,isolated:!!explicit||!production};
}
module.exports={runtimeData};
