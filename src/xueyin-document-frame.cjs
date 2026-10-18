(() => {
  const official=origin=>{try{const host=new URL(origin).hostname;return ['chaoxing.com','xueyinonline.com'].some(d=>host===d||host.endsWith('.'+d));}catch{return false;}};
  const chapter=location.pathname==='/mooc-ans/knowledge/cards';
  const wrapper=location.pathname==='/ananas/modules/pdf/index.html';
  const reader=location.pathname.startsWith('/screen/v2/');
  if(!chapter&&!wrapper&&!reader)return;
  let active=false,target=null,startedAt=0,lastStep=0,stage='idle',childStage=null,lastPosition=0,progressAt=0,resourceWaitSince=null,childReportAt=0,reason=null;
  const reasons=['resource-loading','resource-timeout','reader-frame-timeout','chapter-frame-timeout'];
  const tasks=()=>[...document.querySelectorAll('.ans-attach-ct')].filter(e=>
    e.querySelector('.ans-job-icon')&&e.querySelector('iframe[src*="/ananas/modules/pdf/index.html"]'));
  const complete=e=>e.classList.contains('ans-job-finished');
  const send=(frame,data)=>{try{frame?.contentWindow.postMessage(data,'*');}catch{}};
  const report=data=>{try{parent.postMessage(data,'*');}catch{}};
  const stop=()=>{
    active=false;stage='idle';reason=null;
    for(const f of document.querySelectorAll('iframe'))send(f,{type:'xy-pause'});
  };
  addEventListener('message',event=>{
    if(!official(event.origin))return;
    if(event.source===parent){
      if(event.data?.type==='xy-pause'){stop();return;}
      if(event.data?.type!=='xy-read-document')return;
      if(!active){active=true;startedAt=Date.now();lastStep=0;stage='loading';target=null;childStage=null;lastPosition=0;progressAt=Date.now();resourceWaitSince=null;childReportAt=0;reason=null;}
      return;
    }
    if(!['xy-document-progress','xy-document-wheel'].includes(event.data?.type))return;
    const child=[...document.querySelectorAll('iframe')].find(f=>f.contentWindow===event.source);
    if(!child)return;
    if(event.data.type==='xy-document-progress'&&
      !['loading','browsing','end','unsupported','unconfirmed','stalled'].includes(event.data.stage))return;
    if(chapter){
      if(!active)return;
      if(child!==target?.querySelector('iframe[src*="/ananas/modules/pdf/index.html"]'))return;
      if(event.data.type==='xy-document-wheel'){
        // Layout changes or a previously initialized video may have moved
        // this job outside the main viewport. Re-establish the input target.
        target.scrollIntoView({block:'center',behavior:'instant'});
        const r=child.getBoundingClientRect();report({...event.data,x:r.left+event.data.x,y:r.top+event.data.y});return;
      }
      childStage=event.data.stage;
      childReportAt=Date.now();reason=reasons.includes(event.data.reason)?event.data.reason:null;
      if(['unsupported','unconfirmed','stalled'].includes(childStage))stage=childStage;
      else if(childStage==='end'&&stage!=='waiting'){stage='waiting';startedAt=Date.now();}
      else if(childStage==='browsing')stage='browsing';
      else if(childStage==='loading')stage='loading';
    }else if(wrapper){
      if(!active||child!==target)return;
      if(event.data.type==='xy-document-wheel'){
        const r=child.getBoundingClientRect();report({...event.data,x:r.left+event.data.x,y:r.top+event.data.y});return;
      }
      childStage=event.data.stage;
      childReportAt=Date.now();reason=reasons.includes(event.data.reason)?event.data.reason:null;
      report({type:'xy-document-progress',stage:childStage,reason});
    }
  });
  setInterval(()=>{
    if(chapter){
      const list=tasks(),next=list.find(e=>!complete(e));
      if(active){
        if(!next){send(target?.querySelector('iframe'),{type:'xy-pause'});stage='complete';active=false;}
        else if(next!==target){
          if(target)send(target.querySelector('iframe'),{type:'xy-pause'});
          target=next;stage='loading';childStage=null;startedAt=Date.now();childReportAt=0;reason=null;
          target.scrollIntoView({block:'center',behavior:'instant'});
          send(target.querySelector('iframe[src*="/ananas/modules/pdf/index.html"]'),{type:'xy-read-document'});
        }else if(stage==='loading'){
          send(target.querySelector('iframe[src*="/ananas/modules/pdf/index.html"]'),{type:'xy-read-document'});
        }else if(stage==='waiting'&&Date.now()-startedAt>15000)stage='unconfirmed';
        if(next&&Date.now()-Math.max(startedAt,childReportAt)>20000){stage='unsupported';reason='chapter-frame-timeout';}
      }
      if(active&&['unsupported','unconfirmed','stalled'].includes(stage)){
        active=false;send(target?.querySelector('iframe'),{type:'xy-pause'});
      }
      report({type:'xy-document-status',stage,tasks:list.map(e=>({complete:complete(e)})),
        index:target?list.indexOf(target):null,reason});
      return;
    }
    if(!active)return;
    if(wrapper){
      const candidates=[...document.querySelectorAll('iframe')].filter(f=>{
        const r=f.getBoundingClientRect();
        try{return r.width>=260&&r.height>=150&&official(new URL(f.src,location.href).origin);}catch{return false;}
      });
      const frame=candidates.length===1?candidates[0]:null;
      if(frame){
        if(frame!==target){target=frame;childStage=null;childReportAt=0;}
        send(frame,{type:'xy-read-document'});
      }
      if(Date.now()-Math.max(startedAt,childReportAt)>20000)
        report({type:'xy-document-progress',stage:'unsupported',reason:'reader-frame-timeout'});
      return;
    }
    // Use the reader's real scrolling surface; its own scroll handlers report progress.
    const images=[...document.querySelectorAll('.fileBox img')];
    const root=document.scrollingElement;
    if(!root||!images.length||images.filter(e=>{const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;}).some(e=>!e.complete||e.naturalWidth===0)){
      if(resourceWaitSince===null)resourceWaitSince=Date.now();
      const timedOut=Date.now()-resourceWaitSince>20000;
      report({type:'xy-document-progress',stage:timedOut?'unsupported':'loading',
        reason:timedOut?'resource-timeout':'resource-loading'});
      return;
    }
    if(resourceWaitSince!==null){resourceWaitSince=null;progressAt=Date.now();}
    if(root.scrollTop!==lastPosition){lastPosition=root.scrollTop;progressAt=Date.now();}
    if(stage==='browsing'&&Date.now()-progressAt>20000){report({type:'xy-document-progress',stage:'stalled'});return;}
    if(Date.now()-lastStep<3000)return;
    lastStep=Date.now();
    if(stage==='loading'){
      window.scrollTo({top:0,behavior:'instant'});stage='browsing';
      // Loading and layout time must not consume the reader's progress budget.
      lastPosition=root.scrollTop;progressAt=Date.now();
    }else if(root.scrollTop+root.clientHeight>=root.scrollHeight-3){stage='end';}
    else {
      const amount=Math.max(80,root.clientHeight*.85);
      // Keep the enclosing job visible and deliver the platform's normal wheel
      // input as well; reader scrolling remains independent of input routing.
      report({type:'xy-document-wheel',x:innerWidth/2,y:innerHeight/2,amount});
      window.scrollBy({top:amount,behavior:'instant'});
    }
    report({type:'xy-document-progress',stage});
  },1000);
})();
