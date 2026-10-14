const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const files=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const problems=[];
const forbiddenFile=/(^|\/)(node_modules|\.local-data|backups|screenshots|Cookies|Local Storage|Session Storage)(\/|$)|(^|\/)(\.env(?:\..*)?|ai\.json|courses\.json|state\.json|rea\.local\.json)$|\.(bin|pending|log|png|jpg|zip|bundle)$/i;
const machinePath=/[A-Z]:[\\/](?:Users[\\/][^\s'"`]+|DesktopMoved[\\/][^\s'"`]+)/i;
const token=/\b(?:sk|ghp|github_pat)[-_][A-Za-z0-9_-]{20,}\b/;
for(const file of new Set(files)){
  const full=path.join(root,file);if(!fs.existsSync(full))continue;
  if(forbiddenFile.test(file)){problems.push(`${file}: runtime/private artifact`);continue;}
  if(fs.lstatSync(full).isSymbolicLink()){problems.push(`${file}: symbolic link requires separate review`);continue;}
  const raw=fs.readFileSync(full);
  if(file==='test/fixtures/native-input.webm'){
    const digest=require('node:crypto').createHash('sha256').update(raw).digest('hex');
    if(digest!=='aa86a7e02e277aa62b06e0e48f1879bd4f04264d5b7bd00c05c4f0832f6d1c80')problems.push(`${file}: generated fixture changed; review provenance`);
    continue;
  }
  if(raw.includes(0)){problems.push(`${file}: unreviewed binary`);continue;}
  const text=raw.toString('utf8');
  if(machinePath.test(text))problems.push(`${file}: machine-specific path`);
  if(token.test(text))problems.push(`${file}: possible credential`);
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))problems.push(`${file}: private key`);
  if(/(?:https?:\/\/)[^\s'"`]*[?&](?:enc|cpi|clazzid|recruitAndCourseId)=/i.test(text)&&!file.startsWith('test/'))
    problems.push(`${file}: embedded course URL`);
  if(/https:\/\/(?:[^/]*\.)?(?:feishu\.cn|larksuite\.com)\/(?:wiki|docx)\//i.test(text))problems.push(`${file}: internal document link`);
}
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}
else console.log(`Publication scan passed (${new Set(files).size} files). Manual review is still required.`);
