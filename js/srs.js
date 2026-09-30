// Fixed algorithm v1: intervals are elapsed 24-hour days, not creation offsets.
export const defaultSchedule={intervals:[1,3,7,15,30],repeat_days:30,version:1};
export const defaultRatings={again_days:1,hard_factor:0.5,easy_skip:1};
export function validateSchedule(schedule,ratings=defaultRatings){
  const day=n=>Number.isInteger(n)&&n>=1&&n<=3650;
  if(!Array.isArray(schedule?.intervals)||schedule.intervals.length<1||schedule.intervals.length>30||!schedule.intervals.every(day)||!day(schedule.repeat_days))throw new Error('invalid_srs');
  if(!day(ratings.again_days)||!Number.isFinite(ratings.hard_factor)||ratings.hard_factor<0.1||ratings.hard_factor>1||!Number.isInteger(ratings.easy_skip)||ratings.easy_skip<0||ratings.easy_skip>10)throw new Error('invalid_srs');
  return true;
}
export function fixedTransition(state,rating,schedule=defaultSchedule,ratings=defaultRatings,at=new Date()){
  validateSchedule(schedule,ratings);
  if(!['again','hard','good','easy'].includes(rating)||!Number.isInteger(state.stage)||state.stage<0)throw new Error('invalid_srs');
  const count=schedule.intervals.length;
  let stage=Math.min(state.stage,count);
  if(rating==='again')stage=0;
  if(rating==='good'||rating==='easy')stage=Math.min(stage+1+(rating==='easy'?ratings.easy_skip:0),count);
  const base=stage===count?schedule.repeat_days:schedule.intervals[stage];
  const interval=rating==='again'?ratings.again_days:rating==='hard'?Math.max(1,Math.ceil(base*ratings.hard_factor)):base;
  const time=new Date(at).getTime();if(!Number.isFinite(time))throw new Error('invalid_srs');
  return{stage,interval_days:interval,next_review_at:new Date(time+interval*86400000).toISOString()};
}
