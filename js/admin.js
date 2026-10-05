import{getAccount,accessRequest}from './supabase.js';
import{t}from './i18n.js';
import{node,content,action,link,shell,finish,message}from './learning-ui.js';
export function adminPage(){
 const page=shell('Access requests'),account=getAccount();page.classList.add('admin-page');
 if(account.access?.role!=='admin'||account.status!=='ready'){page.append(node('p','Only the administrator can manage requests.'),link('Sign in','#/login'));return finish(page);}
 page.querySelector('.page-heading').append(node('p','Review requests and decide who can use Arabic Journey.','page-description'));
 const badge=node('p','Administrator','admin-badge'),tools=node('div','','admin-tools'),filter=node('select');filter.setAttribute('aria-label',t('Request status'));
 for(const [value,label]of [['pending','Pending'],['approved','Approved'],['declined','Declined'],['all','All requests']]){const option=node('option',label);option.value=value;filter.append(option);}
 const list=node('section','','admin-request-list'),count=node('p','','settings-help'),pagination=node('nav','','pagination');pagination.setAttribute('aria-label',t('Pagination'));
 let at=0,busy=false,version=0;const uid=account.user.id;
 const refresh=action('Refresh requests',()=>load());tools.append(filter,refresh);page.append(badge,tools,count,list,pagination);
 filter.addEventListener('change',()=>{at=0;load();});
 async function load(){
  const token=++version;refresh.disabled=true;list.replaceChildren(node('p','Loading…'));
  try{const data=await accessRequest('access_requests',{p_status:filter.value,p_page:at});if(token!==version||!page.isConnected||getAccount().user?.id!==uid)return;
   count.textContent=t('{count} pending requests',{count:data.pending});list.replaceChildren();
   if(!data.requests.length)list.append(node('div','No requests in this category.','card admin-empty'));
   for(const request of data.requests){const card=node('article','','card access-request');const header=node('div','','request-header');header.append(content('h2',request.display_name||request.email),node('span',request.status==='pending'?'Pending':request.status==='approved'?'Approved':'Declined','request-status status-'+request.status));card.append(header);
    if(request.display_name)card.append(content('p',request.email,'request-email'));
    card.append(content('p',new Date(request.requested_at).toLocaleString(getAccount().settings.ui_language==='bn'?'bn-BD':'en-GB'),'settings-help'),node('p',request.email_verified?'Email confirmed':'Email confirmation pending','settings-help'));
    const controls=node('div','','request-actions');
    async function decide(decision){if(busy)return;busy=true;page.querySelectorAll('.request-actions button').forEach(b=>b.disabled=true);try{await accessRequest('access_decide',{p_user:request.user_id,p_revision:request.revision,p_decision:decision});await load();}catch(e){message(card,e);}finally{busy=false;if(page.isConnected)page.querySelectorAll('.request-actions button').forEach(b=>b.disabled=false);}}
    if(request.status!=='approved')controls.append(action('Accept',()=>decide('approved'),true));
    if(request.status!=='declined'){const decline=action('Decline',()=>decide('declined'));decline.classList.add('button-danger');controls.append(decline);}card.append(controls);list.append(card);
   }
   pagination.replaceChildren();const previous=action('Previous',()=>{at--;load();});previous.disabled=at===0;const next=action('Next',()=>{at++;load();});next.disabled=(at+1)*25>=data.total;if(data.total>25)pagination.append(previous,content('span',String(at+1)),next);
  }catch(e){if(token===version&&page.isConnected){list.replaceChildren();message(list,e);}}finally{if(token===version)refresh.disabled=false;}
 }
 queueMicrotask(load);return finish(page);
}
