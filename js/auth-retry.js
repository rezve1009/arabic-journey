export function retryAfterSeconds(value,now=Date.now()) {
 if(!value)return null;const seconds=/^\d+$/.test(value.trim())?Number(value):Math.ceil((Date.parse(value)-now)/1000);return Number.isFinite(seconds)&&seconds>0?Math.min(seconds,7200):null;
}
// Store deadlines only: never emails, passwords, OTPs or session tokens.
export function createAuthRetry({storage,now=Date.now,key='arabic-journey.auth-retry'}={}){
 let memory={};const active=new Set();
 function read(){try{const saved=JSON.parse(storage?.getItem(key)||'{}');for(const kind of ['email','request']){const entry=saved[kind];if(entry&&Number.isFinite(entry.until)&&entry.until>now()&&entry.until<=now()+7200000&&['email_quota','request_limit','resend'].includes(entry.reason))memory[kind]=entry;}}catch{}return memory;}
 function wait(kind){const entries=read(),entry=kind==='email'?[entries.email,entries.request].filter(Boolean).sort((a,b)=>b.until-a.until)[0]:entries.request;return entry&&entry.until>now()?{seconds:Math.ceil((entry.until-now())/1000),reason:entry.reason}:null;}
 function hold(kind,seconds,reason){const previous=read()[kind];const until=now()+Math.max(1,Math.min(7200,seconds))*1000;if(!previous||previous.until<until)memory[kind]={until,reason};try{storage?.setItem(key,JSON.stringify(memory));}catch{};}
 async function run(kind,action,{emailOnSuccess=false}={}){
  const blocked=wait(kind);if(blocked)throw Object.assign(new Error('auth_cooldown'),{code:blocked.reason==='email_quota'?'over_email_send_rate_limit':'auth_cooldown',waitSeconds:blocked.seconds});
  if(active.has(kind))throw Object.assign(new Error('auth_in_progress'),{code:'auth_in_progress'});
  active.add(kind);
  try{const result=await action();if(emailOnSuccess)hold('email',60,'resend');return result;}
  catch(error){if(error?.code==='over_email_send_rate_limit')hold('email',Number(error.retryAfterSeconds)||3600,'email_quota');else if(error?.status===429||['over_request_rate_limit','over_sms_send_rate_limit'].includes(error?.code))hold('request',Number(error.retryAfterSeconds)||300,'request_limit');throw error;}
  finally{active.delete(kind);}
 }
 return{wait,run};
}
let retryStorage;try{retryStorage=globalThis.localStorage;}catch{}
export const authRetry=createAuthRetry({storage:retryStorage});
