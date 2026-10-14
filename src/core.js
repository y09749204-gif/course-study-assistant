(function(root) {
  const COURSE_ID = '';
  const COURSE_URL = '';
  const MIN_SECONDS = 25 * 60;
  const MIN_LESSONS = 2;
  const dayKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
  const hour = date => Number(new Intl.DateTimeFormat('en-GB', {
    timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'
  }).format(date));
  const shouldStart = (enabled,state,date = new Date()) => enabled && hour(date) >= 6 &&
    !(state?.day === dayKey(date) && state.status !== 'idle');
  const emptyState = day => ({day, status: 'idle', seconds: 0, baseline: [], baselineInitialized: false, completed: [],
    currentLesson: null, blockedReason: null, startedAt: null, platformConfirmed: null, fallbackCount: 0});
  const meetsGoal = state => state.seconds >= MIN_SECONDS && state.completed.length >= MIN_LESSONS;
  function creditPlayback(state, before, after, elapsedWallSeconds, rate) {
    const delta = after - before;
    if (state.status !== 'running' || rate !== 1 || delta <= 0 || elapsedWallSeconds <= 0) return state;
    // Seek jumps and suspended tabs must not be counted as normal playback.
    if (delta > elapsedWallSeconds + 1 || elapsedWallSeconds > 3) return state;
    return {...state, seconds: state.seconds + Math.min(delta, elapsedWallSeconds)};
  }
  function markCompleted(state, id) {
    if (!id || state.baseline.includes(id) || state.completed.includes(id)) return state;
    return {...state, completed: [...state.completed, id]};
  }
  function nextLesson(lessons) {
    return lessons.find(item => !item.complete) || null;
  }
  function nextUnstartedLesson(lessons) {
    return lessons.find(item => item.unstarted) || null;
  }
  const api = {COURSE_ID, COURSE_URL, MIN_SECONDS, MIN_LESSONS, dayKey, shouldStart, emptyState,
    meetsGoal, creditPlayback, markCompleted, nextLesson, nextUnstartedLesson};
  api.create=config=>{
    const cfg=config||{},lessons=cfg.minLessons??MIN_LESSONS,seconds=(cfg.minMinutes??25)*60;
    if(!Number.isInteger(lessons)||lessons<1||lessons>100||!Number.isInteger(seconds)||seconds<60||seconds>28800)throw Error('Invalid course goals');
    return {...api,COURSE_ID:cfg.courseId||COURSE_ID,COURSE_URL:cfg.url||COURSE_URL,MIN_LESSONS:lessons,MIN_SECONDS:seconds,
      emptyState:day=>({...emptyState(day),goal:{minLessons:lessons,minMinutes:seconds/60}}),
      meetsGoal:state=>state.seconds>=(state.goal?.minMinutes??(cfg.legacy?25:seconds/60))*60&&state.completed.length>=(state.goal?.minLessons??(cfg.legacy?2:lessons))};
  };
  root.ZhsCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
