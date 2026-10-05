import{isRevisionConflict}from './conflicts.js';
export const scheduleBaseline=settings=>structuredClone({revision_schedule:settings.revision_schedule,rating_behavior:settings.rating_behavior});
const fingerprint=s=>JSON.stringify([s.revision_schedule.version,s.revision_schedule.intervals,s.revision_schedule.repeat_days,s.rating_behavior.again_days,s.rating_behavior.hard_factor,s.rating_behavior.easy_skip]);
export async function saveScheduleWithConflict({settings,baseline,revision,save,read,isCurrent}){
 const same=s=>fingerprint(s)===fingerprint(baseline);
 const conflict=()=>Object.assign(new Error('Schedule changed'),{code:'PT409'});
 if(!same(settings))throw conflict();
 try{return await save(revision);}catch(error){
  if(!isRevisionConflict(error))throw error;
  const latest=await read();
  if(!isCurrent())throw new Error('session_expired');
  if(!same(latest))throw conflict();
  // Retry once only when another setting changed. The server still checks revision.
  return save(latest.revision);
 }
}
