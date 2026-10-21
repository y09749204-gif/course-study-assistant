// Runs in the isolated preload world. The platform owns navigation and reporting.
function attach({bridge,identity,matches,root=window}){
  let running=false,busy=false,missingSince=null,endedSince=null,lastSource='',lastTime=null,stalledSince=null,latestState=null;
  const watched=new Set();
  const ended=event=>{
    if(!running||!latestState||event.target?.tagName!=='VIDEO'||!event.target.ended||!matches(root.location.href,identity))return;
    const u=new URL(root.location.href),unit=[u.pathname.split('/').at(-1),u.searchParams.get('unitId')||''].join(':');
    // Capture the natural end before the platform's target listener changes URL.
    bridge.ended?.({epoch:latestState.epoch,unit});
  };
  const player=()=>{
    const docs=[root.document];
    for(let i=0;i<docs.length&&i<8;i++)for(const frame of docs[i].querySelectorAll('iframe')){
      try{if(frame.contentDocument&&!docs.includes(frame.contentDocument))docs.push(frame.contentDocument);}catch{}
    }
    for(const doc of docs)if(!watched.has(doc)){watched.add(doc);doc.addEventListener('ended',ended,true);}
    const videos=docs.flatMap(d=>[...d.querySelectorAll('video')]).filter(v=>v.getBoundingClientRect().width>0&&v.getBoundingClientRect().height>0);
    return videos.length===1?videos[0]:null;
  };
  const pause=()=>{const v=player();if(v)v.pause();};
  bridge.onCommand(()=>{running=false;pause();});
  const tick=async()=>{
    if(busy)return;busy=true;
    try{
      if(!matches(root.location.href,identity)){running=false;pause();return;}
      const state=await bridge.state();latestState=state;running=state.status==='running';
      const v=player();
      if(!running){pause();lastTime=null;missingSince=null;endedSince=null;stalledSince=null;return;}
      const u=new URL(root.location.href),unit=[u.pathname.split('/').at(-1),u.searchParams.get('unitId')||''].join(':');
      const report=(issue,extra={})=>bridge.report({epoch:state.epoch,unit,issue,...extra});
      const modal=[...root.document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].some(node=>{
        const r=node.getBoundingClientRect(),style=root.getComputedStyle(node);
        return r.width>0&&r.height>0&&style.display!=='none'&&style.visibility!=='hidden';
      });
      if(modal){await report('interaction');pause();return;}
      if(!v){missingSince??=Date.now();if(Date.now()-missingSince>=30000)await report('no-video');return;}
      if(v.error){await report('media-error');pause();return;}
      if(v.readyState<2){missingSince??=Date.now();if(Date.now()-missingSince>=30000)await report('loading');return;}
      missingSince=null;
      const source=unit+'|'+v.currentSrc;
      if(source!==lastSource){lastSource=source;lastTime=null;endedSince=null;stalledSince=null;}
      if(v.ended){
        endedSince??=Date.now();lastTime=null;
        await report(Date.now()-endedSince>=30000?'next-unconfirmed':'waiting-next',{ended:true});
        return;
      }
      endedSince=null;
      v.muted=true;v.defaultPlaybackRate=1;v.playbackRate=1;
      if(!v.paused&&lastTime!==null&&v.currentTime<=lastTime&&!v.seeking){
        stalledSince??=Date.now();if(Date.now()-stalledSince>=30000){await report('stalled');pause();return;}
      }else stalledSince=null;
      lastTime=v.currentTime;
      if(v.paused){try{await v.play();}catch{await report('autoplay');return;}}
      // Recheck the command epoch in the host before accepting playback observations.
      if(!await report('playing',{time:v.currentTime,paused:v.paused,seeking:v.seeking,rate:v.playbackRate}))pause();
    }catch{running=false;pause();}finally{busy=false;}
  };
  const timer=root.setInterval(tick,1000);void tick();
  return ()=>{root.clearInterval(timer);running=false;pause();for(const doc of watched)doc.removeEventListener('ended',ended,true);};
}
module.exports={attach};
