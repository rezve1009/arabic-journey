import {getCache} from './storage.js';
import {getAccount} from './supabase.js';
import {selectUpcoming} from './review-tools.js';
import {cloudWrite,cachedDue,cachedReview} from './sync.js';
import {vocabularyRequest} from './vocabulary-data.js';
export const getDueWords=(page=0)=>!navigator.onLine?cachedDue(page):vocabularyRequest(client=>client.rpc('fixed_due',{p_page:page}));
export async function getReviewInfo(word){
 if(!navigator.onLine)return cachedReview(word);
 const [states,history]=await Promise.all([
  vocabularyRequest(client=>client.from('word_review_state').select('*').eq('word_id',word).eq('algorithm','fixed').is('deleted_at',null)),
  vocabularyRequest(client=>client.from('review_history').select('*').eq('word_id',word).eq('algorithm','fixed').order('occurred_at',{ascending:false}).order('id',{ascending:false}).range(0,24)),
 ]);return{state:states[0]||null,history};
}
// Phase 6 uses this command with the displayed state revision. Reuse its operation
// UUID for a failed request retry; the server acknowledges the original event.
export const recordFixedReview=({operation,word,revision,rating,responseMs=null,mode='scheduled'})=>cloudWrite('fixed_review',{p_operation:operation,p_word:word,p_revision:revision,p_rating:rating,p_response_ms:responseMs,p_mode:mode});

export async function getUpcomingWords(limit=10){if(navigator.onLine)return vocabularyRequest(c=>c.rpc('fixed_upcoming',{p_limit:limit}));const uid=getAccount().user.id;const [words,states]=await Promise.all([getCache(uid,'words'),getCache(uid,'word_review_state')]);return selectUpcoming(words,states,limit);}

export async function getUpcomingPage(page=0){if(navigator.onLine)return vocabularyRequest(c=>c.rpc('fixed_upcoming_page',{p_page:page}));const uid=getAccount().user.id;const [words,states]=await Promise.all([getCache(uid,'words'),getCache(uid,'word_review_state')]);return selectUpcoming(words,states,25,Date.now(),page*25);}
