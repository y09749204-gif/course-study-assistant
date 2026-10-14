const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),file=path.join(root,'src/xueyin-preload-bundle.cjs');
const before=fs.readFileSync(file);
try{
  execFileSync(process.execPath,[path.join(__dirname,'generate-xueyin-preload.cjs')],{cwd:root});
  if(!before.equals(fs.readFileSync(file)))throw Error('Generated preload is stale; run npm run build:preload and commit the result');
  console.log('Generated preload matches source');
}finally{fs.writeFileSync(file,before);}
