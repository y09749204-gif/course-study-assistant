const {execFile}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const allowedHost=host=>host==='zhihuishu.com'||host.endsWith('.zhihuishu.com')||host==='xueyinonline.com'||host.endsWith('.xueyinonline.com')||host==='chaoxing.com'||host.endsWith('.chaoxing.com');
const hostOf=value=>{try{return new URL(value).hostname;}catch{return null;}};
function summarize(value){
  function find(node,depth=0){
    if(!node||typeof node!=='object'||depth>6)return null;
    if(node.target&&node.network)return node;
    for(const child of Object.values(node)){const found=find(child,depth+1);if(found)return found;}
    return null;
  }
  const data=find(value)||{};
  if(!data.target||!data.network)throw Error('REA returned no page observation');
  return {host:hostOf(data.target.url),frameCount:data.frames?.length||0,
    domNodes:data.dom?.total_nodes||0,scriptCount:data.scripts?.total||0,
    requests:(data.network.requests||[]).slice(0,200).map(r=>({host:hostOf(r.url),
      method:['GET','POST','PUT','DELETE','OPTIONS','HEAD','PATCH'].includes(r.method)?r.method:null,
      status:Number.isInteger(r.status)?r.status:Number.isInteger(r.response?.status)?r.response.status:null})),
    consoleEventCount:data.console?.events?.length||0};
}
async function inspect(){
  let local={};try{local=JSON.parse(fs.readFileSync(path.join(__dirname,'rea.local.json'),'utf8'));}catch{}
  const entry=process.env.REA_ENTRY||local.entry;
  if(!entry||!path.isAbsolute(entry)||!fs.existsSync(entry))throw Error('Set REA_ENTRY to the existing local scripts/rea.mjs');
  const port=Number(process.env.ZH_REA_PORT||9339);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid diagnostic port');
  const endpoint=`http://127.0.0.1:${port}`;
  const targets=await (await fetch(endpoint+'/json/list',{signal:AbortSignal.timeout(5000)})).json();
  const pages=targets.filter(t=>t.type==='page'&&allowedHost(hostOf(t.url)||''));
  if(pages.length!==1)throw Error('Open exactly one supported course page in the diagnostic assistant');
  const target=pages[0],origin=new URL(target.url).origin;
  const stdout=await new Promise((resolve,reject)=>execFile(process.execPath,[entry,'inspect-web-page',endpoint,target.id,
    '--allowed-origins',origin,'--observation-ms','10000','--format','json'],
    {timeout:90000,maxBuffer:32*1024*1024,windowsHide:true},(error,out)=>
      error?reject(Error('REA observation failed or timed out')):resolve(out)));
  return summarize(JSON.parse(stdout));
}
if(require.main===module)inspect().then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n')).catch(error=>{
  console.error(error.message.startsWith('Set REA_ENTRY')||error.message.startsWith('Open exactly')?error.message:'Local REA observation unavailable');process.exitCode=1;
});
module.exports={summarize,inspect};
