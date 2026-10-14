const {spawn}=require('node:child_process');
const path=require('node:path');

function recognizeQuizImages(images,{spawnProcess=spawn,timeoutMs}={}){
  if(!Array.isArray(images)||images.length<1||images.length>48||
    images.some(image=>typeof image!=='string'||image.length>350000)||
    JSON.stringify(images).length>2500000)return Promise.resolve(null);
  // A reading passage needs several images; retain a bounded budget for the whole batch.
  timeoutMs??=Math.min(180000,45000+images.length*5000);
  return new Promise(resolve=>{
    const child=spawnProcess('python',['-X','utf8',path.join(__dirname,'quiz-ocr.py')],
      {windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    let output='',settled=false;
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(null);},timeoutMs);
    child.on('error',()=>finish(null));
    child.stdout.on('data',part=>{output+=part;if(output.length>200000){child.kill();finish(null);}});
    child.on('close',code=>{
      if(code!==0)return finish(null);
      try{
        const rows=JSON.parse(output);
        finish(Array.isArray(rows)&&rows.length===images.length&&rows.every(row=>
          typeof row.text==='string'&&row.text.length<1600&&
          Number.isFinite(row.confidence))?rows:null);
      }catch{finish(null);}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({images}));
  });
}

module.exports={recognizeQuizImages};
