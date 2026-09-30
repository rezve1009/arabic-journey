// Loaded only by scripts/test-vocabulary-server.mjs on port 5174.
const account={status:'loading',user:{id:'11111111-1111-4111-8111-111111111111',email:'disposable@example.test'},profile:{display_name:'Test account',revision:1},settings:{ui_language:'en',timezone:'Asia/Dhaka',revision:1}};
export const getAccount=()=>account;
const listeners=new Set();
const publish=()=>listeners.forEach(listener=>listener(account));
export const subscribeAccount=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
export const initializeSupabase=async()=>loadAccount();
export const saveLanguagePreference=async()=>false;
export const getPublicConfig=()=>({url:'',publicKey:''});
export const configure=async()=>{};
export const sendCode=async()=>{};
export const verifyCode=async()=>{};
export const signOut=async()=>{};
export const loadAccount=async()=>{const result=await request({table:'user_settings',filters:[],start:0,end:0,single:true});if(result.error)throw new Error(result.error.message);account.settings=result.data;account.status='ready';publish();};
export const saveArabicDisplay=async(values,revision)=>{const result=await request({rpc:'save_arabic_display',args:{p_revision:revision,p_harakah_mode:values.harakah_mode,p_font_size:values.arabic_font_size,p_future_prefix:values.future_prefix}});if(result.error)throw new Error(result.error.message);account.settings=result.data;publish();return result.data;};
export const saveFixedSchedule=async(values,revision)=>{const result=await request({rpc:'save_fixed_schedule',args:{p_revision:revision,p_intervals:values.intervals,p_repeat_days:values.repeat_days,p_ratings:values.ratings}});if(result.error)throw result.error;account.settings=result.data;publish();return result.data;};
export const savePreferences=async()=>{};
export const errorMessage=()=>navigator.onLine?'Something went wrong. Your changes were not saved. Please try again.':'You are offline. Reconnect and try again.';
async function request(body){try{return await (await fetch('/__test-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();}catch(error){return{error:{message:error.message}};}}
export function vocabularyClient(){
  if(!navigator.onLine)throw new Error('offline');
  return{rpc:(name,args)=>request({rpc:name,args}),from:table=>{
    const query={table,filters:[],start:0,end:999};
    const builder={select:()=>builder,eq:(key,value)=>{query.filters.push([key,value]);return builder;},is:(key,value)=>{query.filters.push([key,value]);return builder;},order:()=>builder,range:(start,end)=>{query.start=start;query.end=end;return builder;},single:()=>{query.single=true;return builder;},then:(resolve,reject)=>request(query).then(resolve,reject)};return builder;
  }};
}
