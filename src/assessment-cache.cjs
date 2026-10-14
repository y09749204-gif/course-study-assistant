const {createHash}=require('node:crypto');

// Memory only: no question text, credentials or answers are persisted by this cache.
function createAssessmentCache(answer,{now=Date.now,ttl=10*60*1000,limit=32}={}){
  const cache=new Map();
  return async(input,config,key,fetchImpl,diagnose)=>{
    const identity=createHash('sha256').update(JSON.stringify([input,config,key])).digest('hex');
    const cached=cache.get(identity);
    if(cached&&now()-cached.at<ttl){
      diagnose?.({reason:'answered',elapsedMs:0,cached:true});
      return structuredClone(cached.answer);
    }
    cache.delete(identity);
    const result=await answer(input,config,key,fetchImpl,diagnose);
    if(result&&result.type===input.type){
      cache.set(identity,{at:now(),answer:structuredClone(result)});
      while(cache.size>limit)cache.delete(cache.keys().next().value);
    }
    return result;
  };
}
module.exports={createAssessmentCache};
