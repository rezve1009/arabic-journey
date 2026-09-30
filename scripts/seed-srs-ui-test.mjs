// Disposable port-5174 adapter only. Creates two recorded-practice events for UI QA.
import {randomUUID} from 'node:crypto';
const word=process.argv[2]||randomUUID();
async function request(body){const result=await(await fetch('http://127.0.0.1:5174/__test-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();if(result.error)throw new Error(result.error.message);return result.data;}
if(!process.argv[2])await request({rpc:'vocabulary_write',args:{p_operation:randomUUID(),p_action:'save',p_id:word,p_revision:null,p_values:{arabic_word:'كَتَبَ',bangla_meaning:'লিখেছে',english_meaning:'wrote',word_type:'verb'},p_tags:[],p_allow_duplicate:true}});
let [state]=await request({table:'word_review_state',filters:[['word_id',word],['algorithm','fixed']],start:0,end:0});
for(const rating of ['good','hard']){const result=await request({rpc:'fixed_review',args:{p_operation:randomUUID(),p_word:word,p_revision:state.revision,p_rating:rating,p_response_ms:1500,p_mode:'recorded_practice'}});state=result.state;}
console.log('Disposable UI events created:',state.review_count,'reviews,',state.interval_days,'days');
console.log('http://localhost:5174/#/vocabulary?word='+word);
