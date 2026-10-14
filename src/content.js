(() => {
  const C = globalThis.ZhsCore;
  if (new URL(location.href).searchParams.get('recruitAndCourseId') !== C.COURSE_ID) return;
  let state = null, busy = false, owner = false, lastVideoTime = null, lastWall = null, lastSave = 0, endedAt = null;
  let catalogMissingSince = null, catalogExpansionAttempted = false, videoMissingSince = null;
  let nextChapterWaitSince = null,unconfirmedSelection=null;
  let playbackWaitSince=null,stalledSince=null,lastDiagnostic=0,selectionMissingSince=null;
  let readinessRequested=false, readinessSince=null, inputSequence=0,selectionExpansionAttempted=false;
  let quizParseSince=null,quizParseDialog=null;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const inputRequest=message=>Promise.race([chrome.runtime.sendMessage(message),wait(5000).then(()=>{throw Error('正常鼠标输入超时，请检查右侧页面');})]);
  async function clickTarget(node,kind) {
    if (!node?.isConnected || !visible(node)) throw Error('操作目标已变化');
    const prepared=await inputRequest({type:'INPUT_FOCUS',kind});
    node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    // Chapter expansion animates the catalog. Measure only after its layout settles.
    await wait(250);
    let previous=null,stableSince=Date.now(),settled=false;
    const deadline=Date.now()+2500;
    while(Date.now()<deadline){
      const rect=node.getBoundingClientRect();
      const current=[rect.left,rect.top,rect.width,rect.height];
      if(!previous||current.some((value,index)=>Math.abs(value-previous[index])>0.5))stableSince=Date.now();
      previous=current;
      if(Date.now()-stableSince>=200){settled=true;break;}
      await wait(50);
    }
    if(!settled)throw Error('操作目标位置未稳定，请恢复后重试');
    if (!node.isConnected || !visible(node)) throw Error('操作目标已变化');
    if(['chapter','lesson'].includes(kind)&&(blockingQuiz()||courseReminder())){
      const error=Error('目录输入被课程弹窗打断');error.retryAfterModal=true;throw error;
    }
    const rect=node.getBoundingClientRect();
    let left=Math.max(rect.left,0),top=Math.max(rect.top,0),right=Math.min(rect.right,innerWidth),bottom=Math.min(rect.bottom,innerHeight);
    // Use only exposed points inside both the row and its scroll containers.
    for(let parent=node.parentElement;parent;parent=parent.parentElement){
      const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
      if(/hidden|clip|auto|scroll/.test(style.overflowX)){left=Math.max(left,bounds.left);right=Math.min(right,bounds.right);}
      if(/hidden|clip|auto|scroll/.test(style.overflowY)){top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.bottom);}
    }
    let point=null;
    // Fixed overlays can escape an ancestor's overflow clip. Hit testing is the
    // authority: try the clipped region first, then the viewport-clipped target.
    search:for(const [l,t,r,b] of [[left,top,right,bottom],
      [Math.max(rect.left,0),Math.max(rect.top,0),Math.min(rect.right,innerWidth),Math.min(rect.bottom,innerHeight)]]){
      if(r-l<2||b-t<2)continue;
      for(const fy of [0.5,0.2,0.8])for(const fx of [0.5,0.2,0.8]){
        const x=Math.min(Math.floor(r)-1,Math.max(Math.ceil(l)+1,Math.round(l+(r-l)*fx)));
        const y=Math.min(Math.floor(b)-1,Math.max(Math.ceil(t)+1,Math.round(t+(b-t)*fy)));
        const hit=document.elementFromPoint(x,y);
        if(hit&&(node===hit||node.contains(hit))){point={x,y};break search;}
      }
    }
    const sample=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,Math.round(rect.left+rect.width/2))),Math.max(0,Math.min(innerHeight-1,Math.round(rect.top+rect.height/2))));
    await chrome.runtime.sendMessage({type:'CLICK_DIAGNOSTIC',kind,exposed:!!point,
      target:{tag:node.tagName,rect:[rect.left,rect.top,rect.right,rect.bottom]},
      clipped:[left,top,right,bottom],hit:{tag:sample?.tagName||'',related:!!sample&&(sample===node||node.contains(sample))},
      ancestors:Array.from((function*(){for(let p=node.parentElement;p;p=p.parentElement)yield p;})()).slice(0,10).map(p=>{
        const r=p.getBoundingClientRect(),s=getComputedStyle(p);
        return {tag:p.tagName,rect:[r.left,r.top,r.right,r.bottom],overflowX:s.overflowX,overflowY:s.overflowY};
      })});
    if(!point)throw Error('操作目标被遮挡');
    const {x,y}=point;
    const result=await inputRequest({type:'INPUT_CLICK',epoch:prepared.epoch,
      actionId:String(++inputSequence),kind,x,y,width:innerWidth,height:innerHeight});
    if (!result?.accepted) throw Error(result?.reason||'正常鼠标输入失败');
  }
  async function confirmAction(kind,check,timeout=5000) {
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){if(check()) {
      await chrome.runtime.sendMessage({type:'INPUT_RESULT',kind,result:'confirmed'});return true;
    } await wait(100);}
    await chrome.runtime.sendMessage({type:'INPUT_RESULT',kind,result:'timeout'});return false;
  }
  const navigationBlock=reason=>/^课程(?:页面|窗口)已离开|^正在返回智慧树课程|^自动返回智慧树课程|^智慧树登录已失效/.test(reason||'');
  async function reportReady() {
    const active=lessons().find(item=>item.active),player=video();
    if (!active || !player || player.readyState<2) {
      readinessSince ||= Date.now();
      if(Date.now()-readinessSince>20000){readinessRequested=false;await block('课程页面已返回，但目录、播放器或当前小节未就绪');}
      return;
    }
    readinessSince=null;
    const result=await chrome.runtime.sendMessage({type:'PAGE_READY',lessonId:active.id});
    if(result?.resumed)readinessRequested=false;
  }
  const lessonId = text => /^\s*(\d+\.\d+)(?=\s|$)/.exec(text)?.[1] || null;
  const visible = node => !!node && getComputedStyle(node).display !== 'none' &&
    getComputedStyle(node).visibility !== 'hidden' && node.getBoundingClientRect().width > 0;
  const currentVideoIfPresentPause=()=>video()?.pause();

  function lessons() {
    const found = new Map();
    const platformRows = [...document.querySelectorAll('.chapter-item')].filter(visible);
    const candidates = new Set(platformRows.length ? platformRows :
      document.querySelectorAll('li,[role=treeitem],[class*=video-item],[class*=lesson-item],[class*=course-item]'));
    if (!platformRows.length) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let textNode;
      while ((textNode = walker.nextNode())) {
        if (!lessonId(textNode.textContent || '')) continue;
        const parent = textNode.parentElement;
        if (parent) candidates.add(parent.closest('li,[role=treeitem],button,[class*=item],[class*=node]') || parent.parentElement || parent);
      }
    }
    for (const node of candidates) {
      if (!visible(node)) continue;
      const lines = (node.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
      if (lines.length > 3) continue;
      const id = lessonId(lines[0] || '') || lessonId((node.innerText || '').trim());
      if (!id || found.has(id)) continue;
      const attrs = [node.className, node.getAttribute('aria-label'), node.getAttribute('data-status'),
        ...Array.from(node.querySelectorAll('[class],[aria-label]')).slice(0,8).map(el => `${el.className} ${el.getAttribute('aria-label') || ''}`)].join(' ');
      const complete = !!node.querySelector('img.finish-icon') ||
        /(?:^|[\s_-])(completed?|finished?|done|success|learned|yixue|yiwan)(?:$|[\s_-])/i.test(attrs)
        || !!node.querySelector('[aria-label*="已完成"],[title*="已完成"],[data-status="completed"]');
      const partial=!complete && !!node.querySelector('svg');
      found.set(id,{id,node,complete,unstarted:!complete&&!partial,
        active:/(?:^|\s)(?:active|current|selected)(?:\s|$)/i.test(String(node.className)) || node.getAttribute('aria-current') === 'true'});
    }
    return [...found.values()];
  }
  async function expandCurrentChapter() {
    const selected=[...document.querySelectorAll('.chapter-item')].filter(node=>
      /(?:^|\s)(?:active|current|selected)(?:\s|$)/i.test(String(node.className))||node.getAttribute('aria-current')==='true');
    const selectedId=selected.length===1?lessonId(selected[0].textContent||''):null;
    const chapter=Number((selectedId||state?.currentLesson||state?.navigationHint || '1.1').split('.')[0]);
    const name=['','一','二','三','四','五','六','七'][chapter];
    if (!name) return false;
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode=walker.nextNode())) {
      const label=(textNode.textContent || '').trim();
      if (!label.startsWith(`第${name}章`) || label.length>40) continue;
      const target=textNode.parentElement;
      if (!visible(target)) continue;
      await clickTarget(target,'chapter');
      if(!await confirmAction('chapter',()=>selectedId?lessons().some(item=>item.id===selectedId&&item.active):lessons().length>0))throw Error('操作目标章节展开未获平台确认');
      return true;
    }
    return false;
  }
  async function expandNextChapter() {
    const current=Number((state?.currentLesson || '').split('.')[0]);
    const names=['零','一','二','三','四','五','六','七','八','九','十'];
    if (!Number.isInteger(current) || current<0) return false;
    const headers=[];
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let textNode;
    while((textNode=walker.nextNode())){
      const text=(textNode.textContent||'').trim();
      if(!/^第[零一二三四五六七八九十]+章(?:[:：\s]|$)/.test(text)||text.length>40)continue;
      const parent=textNode.parentElement;
      const node=parent?.closest('button,[role="button"],.el-collapse-item__header')||parent;
      if(visible(node))headers.push({node,text});
    }
    const expanded=lessons();
    for (let chapter=current+1;chapter<names.length;chapter++) {
      // Already expanded chapters have been searched by nextUnstartedLesson. Do not
      // click them again: the platform toggles them closed instead of exposing more rows.
      if(expanded.some(item=>Number(item.id.split('.')[0])===chapter))continue;
      const label=new RegExp(`^第${names[chapter]}章(?:[:：\\s]|$)`);
      const header=headers.find(item=>label.test(item.text))?.node;
      if (header) {
        await clickTarget(header,'chapter');
        if(!await confirmAction('chapter',()=>lessons().some(item=>Number(item.id.split('.')[0])===chapter)))
          throw Error('操作目标章节展开未获平台确认');
        return true;
      }
    }
    return false;
  }
  const video = () => [...document.querySelectorAll('video')].find(visible) || null;
  function blockingQuiz() {
    const platformDialog=[...document.querySelectorAll('.ai-class-exercise-dialog')].find(visible);
    if(platformDialog)return platformDialog;
    return [...document.querySelectorAll('[role=dialog],.el-dialog,.ant-modal,[class*=modal]')]
      .find(node => visible(node) && /AI随堂练习/.test((node.innerText || '').replace(/\s+/g,''))) || null;
  }
  function courseReminder() {
    return [...document.querySelectorAll('[role=dialog],.el-dialog,.ant-modal,[class*=modal]')]
      .find(node => visible(node) && /课程提醒/.test(node.innerText || '') &&
        /下次再说/.test(node.innerText || '')) || null;
  }
  async function dismissCourseReminder(dialog) {
    const later=[...dialog.querySelectorAll('*')]
      .filter(node=>visible(node) && (node.innerText || '').replace(/\s+/g,'')==='下次再说').at(-1);
    if (!later) {await block('课程提醒无法关闭');return false;}
    await clickTarget(later,'reminder');
    await confirmAction('reminder',()=>!courseReminder(),2500);
    if (courseReminder()) {await block('课程提醒关闭失败');return false;}
    lastVideoTime=null;lastWall=null;
    return true;
  }
  const quizSubmitted = dialog => dialog.matches('.ai-class-exercise-dialog')?
    !!dialog.querySelector('.dialog-footer .is-finish'):
    /正确答案\s*[:：]/.test(dialog.innerText || '') ||
    [...dialog.querySelectorAll('button,[role=button]')]
      .some(node => /已提交/.test(node.innerText || ''));
  async function dismissSubmittedQuiz(dialog) {
    if (!blockingQuiz()) return true;
    if (!quizSubmitted(dialog)) return false;
    const close = [...dialog.querySelectorAll('[aria-label*="关闭"],[title*="关闭"],[class*=close],img.header-icon,button,[role=button]')]
      .find(node => visible(node) && (/关闭|close/i.test(`${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''} ${node.className || ''}`) ||
        /^[×x]$/i.test((node.innerText || '').trim()) || node.matches('img.header-icon')));
    if (!close) {await block('弹题已提交但关闭按钮无法识别');return false;}
    try {await clickTarget(close,'quiz-close');}
    catch(error){
      // The site may remove its result dialog while a native click is being prepared.
      // Disappearance is the requested outcome, not an input failure.
      if(blockingQuiz()) {await block(`弹题已提交但关闭失败：${error.message}`);return false;}
    }
    await confirmAction('quiz-close',()=>!blockingQuiz(),2500);
    if (blockingQuiz()) {await block('弹题已提交但未关闭');return false;}
    lastVideoTime = null;lastWall = null;
    return true;
  }
  async function resumeAfterQuiz(){
    lastVideoTime=null;lastWall=null;playbackWaitSince=null;stalledSince=null;
    if(state.status!=='running'||blockingQuiz()||courseReminder())return;
    const player=video();
    if(player?.paused&&!player.ended&&player.readyState>=2){
      try{await player.play();}catch{await block('浏览器阻止自动播放，请在课程页点一次播放');}
    }
  }
  function quizData(dialog) {
    const diagnose=(reason,optionCount=0,controlCount=0)=>{void chrome.runtime.sendMessage({type:'QUIZ_DIAGNOSTIC',reason,optionCount,controlCount}).catch(()=>{});};
    const typePattern=/[\[【［(（]\s*(单\s*选|判\s*断|多\s*选)\s*(?:题)?\s*[\]】］)）]/;
    const text=(dialog.innerText||'').replace(typePattern,match=>match.replace(/\s+/g,''));
    const lines = text.split('\n').map(x=>x.trim()).filter(Boolean);
    const marker = lines.findIndex(x => typePattern.test(x));
    if (marker < 0 || /多选/.test(lines[marker])) {diagnose(marker<0?'missing-type':'unsupported-type');return null;}
    const typeMatch=typePattern.exec(lines[marker]);
    const inlineQuestion=lines[marker].slice(typeMatch.index+typeMatch[0].length).trim();
    const question = inlineQuestion || lines.slice(marker + 1).find(x => x && !/^[A-H](?:\s|[.、]|$)/.test(x));
    const normalize = value => (value || '').replace(/\s+/g,' ').trim();
    const candidateNodes = new Set(dialog.querySelectorAll('label,[role=radio],[class*=option],li'));
    // Official option letters can be generated by CSS and thus absent from innerText.
    // Use the actual option controls, and reject ancestors containing several options.
    const controls=[...dialog.querySelectorAll('.class-question-select')].filter(visible);
    const platformOptions=controls.map((control,index)=>{
      const letter=/^[A-H]$/.test(normalize(control.innerText))?normalize(control.innerText):String.fromCharCode(65+index);
      for(let node=control.parentElement;node&&node!==dialog;node=node.parentElement){
        if(node.querySelectorAll('.class-question-select').length!==1)break;
        const text=normalize(node.innerText).replace(new RegExp(`^${letter}(?:[.、]|\\s)*`),'').trim();
        if(text)return {node,text:`${letter} ${text}`};
      }
      return null;
    });
    // Some question dialogs put the letter and its text in sibling elements with generic class names.
    const walker = document.createTreeWalker(dialog,NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode=walker.nextNode())) {
      if (!/^[A-H](?:\s|[.、]|$)/.test((textNode.textContent || '').trim())) continue;
      let node=textNode.parentElement;
      for (let depth=0;node&&node!==dialog&&depth<5;node=node.parentElement,depth++) {
        const text=normalize(node.innerText);
        if (/^[A-H](?:\s|[.、])?\s*\S/.test(text) && text.length<240) {
          candidateNodes.add(node);break;
        }
      }
    }
    const rows = [...candidateNodes].filter(visible)
      .map(node => ({node,text:normalize(node.innerText)}))
      .filter(row => /^[A-H](?:\s|[.、])?\s*\S/.test(row.text));
    const choices = new Map();
    for (const row of rows) {
      const letter = row.text[0];
      if (!choices.has(letter) || row.text.length < choices.get(letter).text.length) choices.set(letter,row);
    }
    const options = controls.length>=2&&platformOptions.every(Boolean)?platformOptions:
      [...choices.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([,row])=>row);
    if (!question || options.length < 2 || options.length > 8 ||
        (/判断/.test(lines[marker]) && options.length !== 2)) {
      diagnose(!question?'missing-question':'invalid-option-count',options.length,controls.length);return null;
    }
    diagnose('recognized',options.length,controls.length);
    return {question,options};
  }
  async function save(force = false) {
    if (!state || (!force && Date.now() - lastSave < 5000)) return;
    lastSave = Date.now();
    await chrome.storage.local.set({dailyState:state});
  }
  async function notify(message) {await chrome.runtime.sendMessage({type:'NOTIFY',message}).catch(()=>{});}
  async function block(reason) {
    state = {...state,status:'blocked',blockedReason:reason};
    video()?.pause();
    await save(true);await notify(`智慧树学习已暂停：${reason}`);
  }
  async function answerQuiz(dialog) {
    if (quizSubmitted(dialog)) {state={...state,submissionIntent:false,submissionContext:null};await save(true);if(await dismissSubmittedQuiz(dialog))await resumeAfterQuiz();return;}
    const data = quizData(dialog);
    if (!data){
      if(quizParseDialog!==dialog){quizParseDialog=dialog;quizParseSince=Date.now();}
      if(Date.now()-quizParseSince<10000)return;
      return block('弹题题型或选项无法识别');
    }
    quizParseSince=null;quizParseDialog=null;
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({question:data.question,options:data.options.map(x=>x.text)})));
    const context={lessonId:lessons().find(item=>item.active)?.id||state.currentLesson,
      key:Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')};
    if(state.submissionIntent&&state.submissionContext&&
      (state.submissionContext.lessonId!==context.lessonId||state.submissionContext.key!==context.key)){
      state={...state,submissionIntent:false,submissionContext:null};await save(true);
    }
    if(state.submissionIntent)return block('弹题提交结果未确认，请人工核对后恢复');
    let answer;
    try {answer = await chrome.runtime.sendMessage({type:'ANSWER',question:data.question,
      options:data.options.map(x=>x.text.slice(1).trim())});} catch {answer = null;}
    let index = answer?.index;
    if (!Number.isInteger(index) || index < 0 || index >= data.options.length) {
      index=data.options.findIndex(option=>choiceSelected(option.node));
      if(index<0){
        const random = new Uint32Array(1);crypto.getRandomValues(random);
        index = random[0] % data.options.length;
        state = {...state,fallbackCount:(state.fallbackCount || 0)+1};
        await save(true);
      }
    }
    const choice=data.options[index].node;
    if(!choiceSelected(choice))await clickTarget(choice,'quiz-option');
    if(!await confirmAction('quiz-option',()=>choiceSelected(choice)))
      return block('弹题选项未获平台确认，请人工核对');
    const submit = [...dialog.querySelectorAll('button,[role=button]')]
      .find(node => visible(node) && /提交作答/.test(node.innerText || ''));
    if (!submit || submit.disabled) return block('弹题提交按钮不可用');
    state={...state,submissionIntent:true,submissionContext:context};await save(true);
    await clickTarget(submit,'quiz-submit');
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && blockingQuiz() && !quizSubmitted(dialog))
      await new Promise(resolve=>setTimeout(resolve,250));
    const confirmed=!blockingQuiz()||quizSubmitted(dialog);
    await chrome.runtime.sendMessage({type:'INPUT_RESULT',kind:'quiz-submit',result:confirmed?'confirmed':'timeout'});
    if(confirmed){state={...state,submissionIntent:false,submissionContext:null};await save(true);}
    if (blockingQuiz() && quizSubmitted(dialog)) await dismissSubmittedQuiz(dialog);
    if (blockingQuiz()) return block('弹题提交后未关闭');
    state={...state,submissionIntent:false,submissionContext:null};
    lastVideoTime = null;lastWall = null;
    await save(true);
    await resumeAfterQuiz();
  }
  const choiceSelected=choice=>choice.matches('[aria-checked=true],.active,.selected,.checked,.is-checked,.isSelect')||
    !!choice.querySelector(':checked,[aria-checked=true],.active,.selected,.checked,.is-checked,.class-question-select.isSelect');
  async function tick() {
    if (busy || !owner || !state || !['running','blocked'].includes(state.status)) return;
    busy = true;
    try {
      if (readinessRequested || (state.status==='blocked' && navigationBlock(state.blockedReason))) {
        readinessRequested=true;await reportReady();return;
      }
      if (state.status === 'blocked') {
        // A question we could not parse may be answered manually. Resume only after its dialog is gone.
        if (state.blockedReason?.startsWith('课程提醒')) {
          const reminder=courseReminder();
          if (reminder) return;
        } else if (state.blockedReason?.startsWith('弹题') ||
          (state.blockedReason==='操作目标已变化'&&state.submissionIntent&&state.submissionContext)) {
          const dialog = blockingQuiz();
          if (dialog) return;
          state={...state,submissionIntent:false,submissionContext:null};
        } else if (state.blockedReason?.startsWith('未识别到课程小节目录')) {
          catalogMissingSince=null;catalogExpansionAttempted=false;
        } else return;
        state = {...state,status:'running',blockedReason:null};
        lastVideoTime = null;lastWall = null;
        await save(true);
      }
      if (C.dayKey() !== state.day) return await block('跨过当天日期，请重新开始');
      if (/login|passport/i.test(location.href)) return await block('智慧树登录已失效');
      const modal = blockingQuiz();
      if (modal) {await answerQuiz(modal);return;}
      quizParseSince=null;quizParseDialog=null;
      // A saved intent belongs to the dialog that was actually submitted. Never let
      // it survive a dialog-free interval and block a later exercise or lesson.
      if(state.submissionIntent||state.submissionContext){
        state={...state,submissionIntent:false,submissionContext:null};await save(true);
      }
      const reminder=courseReminder();
      if (reminder) {await dismissCourseReminder(reminder);return;}
      const list = lessons();
      if (!list.length) {
        catalogMissingSince ||= Date.now();
        if (!catalogExpansionAttempted) {
          catalogExpansionAttempted=await expandCurrentChapter();
          if (catalogExpansionAttempted) return;
        }
        if (Date.now()-catalogMissingSince < 20000) return;
        return await block('未识别到课程小节目录');
      }
      catalogMissingSince = null;catalogExpansionAttempted=false;
      const selectedRows=list.filter(item=>item.active);
      const active=selectedRows.length===1?selectedRows[0]:null;
      if(unconfirmedSelection){
        const player=video(),source=player?.currentSrc||player?.getAttribute('src')||player?.querySelector('source')?.src||'';
        if(active?.id!==unconfirmedSelection.id||!player||player.readyState<2||
          (unconfirmedSelection.source&&player===unconfirmedSelection.player&&source===unconfirmedSelection.source)){
          state={...state,currentLessonConfirmed:false};currentVideoIfPresentPause();
          return await block('下一节目录或视频切换未获平台确认，请检查右侧课程');
        }
        unconfirmedSelection=null;
      }
      if(!active){
        state={...state,currentLessonConfirmed:false};currentVideoIfPresentPause();
        if(!selectionExpansionAttempted){
          selectionExpansionAttempted=true;
          if(await expandCurrentChapter())return;
        }
        selectionMissingSince ||= Date.now();
        if(Date.now()-selectionMissingSince>8000)return await block('未确认网站当前小节，请展开目录并恢复');
        await save(true);return;
      }
      selectionMissingSince=null;
      selectionExpansionAttempted=false;
      state={...state,currentLesson:active.id,currentLessonConfirmed:true};
      if (!state.baselineInitialized || state.completionMarkerVersion !== 1) {
        const existing=list.filter(x=>x.complete && !state.completed.includes(x.id)).map(x=>x.id);
        state = {...state,startedAt:state.startedAt || new Date().toISOString(),
          baseline:[...new Set([...state.baseline,...existing])],baselineInitialized:true,
          completionMarkerVersion:1};
        await save(true);
      }
      const currentVideo = video();
      if (!currentVideo) {
        videoMissingSince ||= Date.now();
        if (Date.now()-videoMissingSince < 20000) return;
        return await block('未找到可播放视频');
      }
      videoMissingSince = null;
      if(Date.now()-lastDiagnostic>=5000){
        lastDiagnostic=Date.now();
        await chrome.runtime.sendMessage({type:'PLAYBACK_DIAGNOSTIC',lessonId:state.currentLesson,
          selectedLessonId:active.id,selectionConfirmed:state.currentLessonConfirmed===true,
          paused:currentVideo.paused,readyState:currentVideo.readyState,time:currentVideo.currentTime,
          duration:currentVideo.duration,errorCode:currentVideo.error?.code||0,hidden:document.hidden});
      }
      const now = performance.now();
      const previousVideoTime=lastVideoTime;
      if (lastVideoTime !== null && lastWall !== null && !currentVideo.paused && !currentVideo.seeking && !document.hidden) {
        state = C.creditPlayback(state,lastVideoTime,currentVideo.currentTime,(now-lastWall)/1000,currentVideo.playbackRate);
      }
      lastVideoTime = currentVideo.currentTime;lastWall = now;
      const before = state.completed.length;
      for (const item of list.filter(x=>x.complete)) state = C.markCompleted(state,item.id);
      if (state.completed.length > before) await save(true);
      if (C.meetsGoal(state) && active?.complete) {
        state = {...state,status:'complete',blockedReason:null};
        currentVideo.pause();await save(true);await notify('智慧树今日预计达标，等待平台成绩分析更新确认');return;
      }
      if (active) state.currentLesson = active.id;
      if (currentVideo.ended && active && !active.complete) {
        endedAt ||= Date.now();
        if (Date.now()-endedAt > 10000) return await block('视频结束后平台未显示小节完成标记');
        return;
      }
      endedAt = null;
      if (currentVideo.ended || active?.complete) {
        if (!active?.complete) return;
        const next = C.nextUnstartedLesson(list);
        if (!next) {
          if (nextChapterWaitSince && Date.now()-nextChapterWaitSince<2000) return;
          if (await expandNextChapter()) {
            nextChapterWaitSince=Date.now();return;
          }
          return await block('目录内没有下一节未开始课程');
        }
        nextChapterWaitSince=null;
        if (next.id !== state.currentLesson) {
          const priorSource=currentVideo.currentSrc||currentVideo.getAttribute('src')||currentVideo.querySelector('source')?.src||'';
          currentVideo.pause();
          state={...state,currentLessonConfirmed:false};await save(true);
          await clickTarget(next.node,'lesson');
          unconfirmedSelection={id:next.id,player:currentVideo,source:priorSource};
          if(!(await confirmAction('lesson',()=>{
            const player=video(),source=player?.currentSrc||player?.getAttribute('src')||player?.querySelector('source')?.src||'';
            const selected=lessons().filter(item=>item.active);
            return selected.length===1&&selected[0].id===next.id&&player?.readyState>=2&&
              (!priorSource||player!==currentVideo||source!==priorSource);
          },10000)))
            return await block('下一节目录或视频切换未获平台确认，请检查右侧课程');
          state.currentLesson = next.id;state.currentLessonConfirmed=true;
          unconfirmedSelection=null;
          playbackWaitSince=null;stalledSince=null;
          lastVideoTime = null;lastWall = null;endedAt=null;await save(true);return;
        }
      }
      if(currentVideo.readyState<2){
        playbackWaitSince ||= Date.now();
        if(Date.now()-playbackWaitSince>30000)return await block('播放器超过30秒未就绪，请检查右侧加载或网络提示');
        return;
      }
      playbackWaitSince=null;
      if(!currentVideo.paused&&!currentVideo.ended&&!currentVideo.seeking&&previousVideoTime!==null&&currentVideo.currentTime<=previousVideoTime){
        stalledSince ||= Date.now();
        if(Date.now()-stalledSince>30000)return await block('视频时间超过30秒未前进，请检查右侧播放器');
      }else stalledSince=null;
      if (currentVideo.paused && currentVideo.readyState >= 2) {
        try {await currentVideo.play();} catch {return await block('浏览器阻止自动播放，请在课程页点一次播放');}
      }
      await save();
    } catch(error) {if(!error.retryAfterModal)await block(/^(操作目标|页面或输入目标|正常鼠标输入)/.test(error.message||'')?error.message:'页面结构变化或脚本异常');}
    finally {busy = false;}
  }
  chrome.runtime.onMessage.addListener((message,_sender,reply) => {
    if(message.type==='PROBE_READY'){readinessRequested=true;void tick();reply({ok:true});return;}
    if (message.type === 'START') {
      readinessRequested=false;
      selectionMissingSince=null;
      selectionExpansionAttempted=false;
      playbackWaitSince=null;stalledSince=null;lastVideoTime=null;lastWall=null;
      owner = true;
      nextChapterWaitSince=null;
      void chrome.storage.local.get('dailyState').then(({dailyState}) => {
        state = dailyState?.day===C.dayKey()?{...dailyState,status:'running',blockedReason:null}:C.emptyState(C.dayKey());
        state.status='running';state.currentLessonConfirmed=false;void save(true).then(tick);
      });reply({ok:true});
    }
    if (message.type === 'PAUSE' && state) {state={...state,status:'paused'};video()?.pause();void save(true);reply({ok:true});}
    if (message.type === 'END' && state) {state={...state,status:'ended'};video()?.pause();void save(true);reply({ok:true});}
  });
  chrome.storage.onChanged.addListener(changes => {
    const next = changes.dailyState?.newValue;
    if (!owner || !next || next.day !== C.dayKey()) return;
    if (next.status !== 'running' && state?.status === 'running') video()?.pause();
    state = next;
  });
  void chrome.runtime.sendMessage({type:'IS_OWNER'}).then(({owner:isOwner}) => {
    owner = !!isOwner;
    return chrome.storage.local.get('dailyState');
  }).then(({dailyState}) => {
    if (owner && dailyState?.day === C.dayKey() &&
        (dailyState.status === 'running' || (dailyState.status === 'blocked' &&
          (dailyState.blockedReason?.startsWith('弹题') ||
           (dailyState.blockedReason==='操作目标已变化'&&dailyState.submissionIntent&&dailyState.submissionContext) ||
           dailyState.blockedReason?.startsWith('课程提醒') ||
           dailyState.blockedReason?.startsWith('未识别到课程小节目录') ||
           navigationBlock(dailyState.blockedReason))))) {
      state=dailyState;void tick();
    }
  });
  setInterval(()=>void tick(),1000);
})();
