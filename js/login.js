import {getAccount,getPublicConfig,sendCode,verifyCode,signInPassword,signUpPassword,setAccountPassword,errorMessage} from './supabase.js';
import {authRetry} from './auth-retry.js';
import {t,translate} from './i18n.js';
let mode='password',email='',sent=false,busy=false,message='',failed=false,retryTimer;
let render=()=>{};
export function setLoginRenderer(callback){render=callback;}
export function validateEmailLink(value,projectUrl,callbackUrl){
 let url;try{url=new URL(value.trim());}catch{throw new Error('invalid_email_link');}
 const project=new URL(projectUrl);
 if(url.protocol!=='https:'||url.origin!==project.origin||url.pathname!=='/auth/v1/verify'||url.username||url.password||!url.searchParams.get('token')||!['signup','magiclink','email','recovery'].includes(url.searchParams.get('type')))throw new Error('invalid_email_link');
 url.searchParams.set('redirect_to',callbackUrl);return url.href;
}
async function run(action,success=''){
 if(busy)return;busy=true;message='';failed=false;render();
 try{await action();message=success;}catch(error){message=error?.message==='invalid_email_link'?'Paste the complete sign-in link from your latest email.':errorMessage(error);failed=true;}
 finally{busy=false;render();}
}
function button(text,action,style='button-secondary'){
 const b=document.createElement('button');b.type='button';b.className='button '+style;b.textContent=t(text);if(action)b.addEventListener('click',action);return b;
}
function field(text,type,properties={}){
 const label=document.createElement('label');const span=document.createElement('span');span.textContent=t(text);const input=document.createElement('input');input.type=type;Object.assign(input,properties);label.append(span,input);return{label,input};
}
export function loginPage(){
 clearInterval(retryTimer);
 const account=getAccount(),page=document.createElement('div');page.className='login-page';
 page.innerHTML=`<section class="login-story"><a class="login-brand" href="#/dashboard"><img src="./icons/app.svg" width="42" height="42" alt=""><span>Arabic Journey</span></a><div class="login-story-content"><p class="eyebrow">ONE WORD AT A TIME</p><div class="login-arabic" lang="ar" dir="rtl">كُلُّ يَوْمٍ، خُطْوَةٌ</div><h2>A little learning.<br>A lasting journey.</h2><p>Your words, your progress, your own learning space.</p><div class="login-chips"><span>Vocabulary</span><span>Revision</span><span>Every day</span></div></div><p class="login-story-foot">Your vocabulary stays private in your account.</p></section><section class="login-panel"><div class="login-form-wrap"><a href="#/dashboard" class="login-back">← Back to learning space</a><p class="eyebrow">WELCOME TO ARABIC JOURNEY</p><h1>Welcome back</h1><p class="login-subtitle">Sign in and continue your learning.</p><div id="login-content"></div></div></section>`;
 const content=page.querySelector('#login-content');
 if(account.user){
  page.querySelector('h1').textContent=t('You are signed in');
  const identity=document.createElement('p');identity.textContent=account.user.email;identity.dataset.noTranslate='';content.append(identity);
  const link=document.createElement('a');link.href=account.status==='ready'?'#/dashboard':'#/settings';link.className='button button-primary';link.textContent=t(account.status==='ready'?'Continue learning':'Reload account');content.append(link);
  const details=document.createElement('details');details.className='login-help';const summary=document.createElement('summary');summary.textContent=t('Set a password for next time');details.append(summary);
  const form=document.createElement('form');form.className='settings-form';const pass=field('New password','password',{required:true,minLength:8,autocomplete:'new-password'}),confirm=field('Confirm password','password',{required:true,minLength:8,autocomplete:'new-password'});const submit=button('Save password',null,'button-primary');submit.type='submit';form.append(pass.label,confirm.label,submit);
  form.addEventListener('submit',event=>{event.preventDefault();confirm.input.setCustomValidity(pass.input.value===confirm.input.value?'':t('Passwords do not match.'));if(!form.reportValidity())return;const password=pass.input.value;pass.input.value='';confirm.input.value='';run(()=>setAccountPassword(password),'Password saved. Next time, sign in with your email and password.');});confirm.input.addEventListener('input',()=>confirm.input.setCustomValidity(''));pass.input.addEventListener('input',()=>confirm.input.setCustomValidity(''));details.append(form);content.append(details);
 }else{
  const tabs=document.createElement('div');tabs.className='login-tabs';tabs.setAttribute('aria-label',t('Sign-in method'));
  for(const [id,label]of [['password','Password'],['email','Email link'],['signup','Create account']]){const b=button(label,()=>{mode=id;message='';render();});b.setAttribute('aria-pressed',String(mode===id));tabs.append(b);}content.append(tabs);
  if(mode==='signup'){page.querySelector('h1').textContent=t('Start your journey');page.querySelector('.login-subtitle').textContent=t('Create an account with your email and a password.');}
  const form=document.createElement('form');form.className='settings-form login-form';
  const mail=field('Email address','email',{value:email,required:true,autocomplete:'email',placeholder:'you@example.com',readOnly:mode==='email'&&sent});mail.input.addEventListener('input',()=>email=mail.input.value.trim());form.append(mail.label);
  let pass,confirm,code;
  if(mode!=='email'){
   pass=field('Password','password',{required:true,minLength:mode==='signup'?8:1,autocomplete:mode==='signup'?'new-password':'current-password'});form.append(pass.label);
   const show=button('Show password',()=>{const visible=pass.input.type==='password';pass.input.type=visible?'text':'password';show.textContent=t(visible?'Hide password':'Show password');show.setAttribute('aria-pressed',String(visible));},'login-text-button');show.setAttribute('aria-pressed','false');form.append(show);
   if(mode==='signup'){confirm=field('Confirm password','password',{required:true,minLength:8,autocomplete:'new-password'});confirm.input.addEventListener('input',()=>confirm.input.setCustomValidity(''));pass.input.addEventListener('input',()=>confirm.input.setCustomValidity(''));form.append(confirm.label);}
  }
  const help=document.createElement('p');help.className='settings-help';help.textContent=t(mode==='signup'?'Use at least 8 characters. Confirm the email we send before signing in.':mode==='password'?'Used an email link before? Choose Email link, sign in, then set a password.':sent?'Check your inbox and spam folder. Open the newest link in this browser, or paste it below.':'No password needed. We will send a sign-in link to your email.');form.append(help);
  const submit=button(busy?'Working…':mode==='signup'?'Create account':mode==='password'?'Sign in':sent?'Send another link':'Send sign-in link',null,'button-primary');submit.type='submit';form.append(submit);
  form.addEventListener('submit',event=>{event.preventDefault();if(busy)return;const value=mail.input.value.trim();email=value;
   if(mode==='signup'){confirm.input.setCustomValidity(pass.input.value===confirm.input.value?'':t('Passwords do not match.'));if(!form.reportValidity())return;const password=pass.input.value;pass.input.value='';confirm.input.value='';run(async()=>{await signUpPassword(value,password);},'Check your email to confirm your account. Open the confirmation link in this browser.');}
   else if(mode==='password'){const password=pass.input.value;pass.input.value='';run(()=>signInPassword(value,password));}
   else {run(async()=>{await sendCode(value);sent=true;},'Email sent. Check your inbox and spam folder.');}
  });content.append(form);
  if(mode==='email'){
   if(sent)content.append(button('Use another email',()=>{sent=false;message='';render();},'login-text-button'));
   const pasteForm=document.createElement('form');pasteForm.className='settings-form login-help';const link=field('Paste the email sign-in link','url',{required:true,autocomplete:'off',placeholder:'https://…'});const open=button('Open link in this browser',null,'button-secondary');open.type='submit';pasteForm.append(link.label,open);pasteForm.addEventListener('submit',event=>{event.preventDefault();try{const callback=new URL('index.html',location.href).href.split(/[?#]/)[0];const target=validateEmailLink(link.input.value,getPublicConfig().url,callback);link.input.value='';location.assign(target);}catch{message='Paste the complete sign-in link from your latest email.';failed=true;render();}});content.append(pasteForm);
   const details=document.createElement('details');details.className='login-help';const summary=document.createElement('summary');summary.textContent=t('My email contains a code');const codeForm=document.createElement('form');codeForm.className='settings-form';code=field('Email code','text',{required:true,autocomplete:'one-time-code',inputMode:'numeric',pattern:'[0-9]{6,10}'});const verify=button('Verify code',null,'button-primary');verify.type='submit';codeForm.append(code.label,verify);codeForm.addEventListener('submit',event=>{event.preventDefault();const token=code.input.value.trim();code.input.value='';run(()=>verifyCode(email,token));});details.append(summary,codeForm);content.append(details);
  }
 }
 const waitInfo=document.createElement('p');waitInfo.className='feedback auth-wait';waitInfo.setAttribute('role','status');const primaryForm=content.querySelector('.login-form');if(primaryForm)primaryForm.after(waitInfo);else content.append(waitInfo);
 function updateWait(){
  if(!page.isConnected)return;
  const wait=authRetry.wait(mode==='password'||account.user?'request':'email');
  waitInfo.hidden=!wait;
  const submit=content.querySelector('.login-form button[type="submit"]');
  if(wait){const minutes=Math.floor(wait.seconds/60),seconds=String(wait.seconds%60).padStart(2,'0');waitInfo.textContent=t(wait.reason==='email_quota'?'Email limit reached. Retry in {time}. This is a retry estimate, not a guaranteed reset time.':'Retry in {time}.',{time:minutes+':'+seconds});if(submit){submit.disabled=true;submit.textContent=t('Please wait');}}
  else if(submit&&!busy&&account.status!=='loading'){submit.disabled=false;submit.textContent=t(mode==='signup'?'Create account':mode==='password'?'Sign in':sent?'Send another link':'Send sign-in link');}
 }
 retryTimer=setInterval(()=>{if(!page.isConnected){clearInterval(retryTimer);return;}updateWait();},1000);
 setTimeout(updateWait,0);
 const notice=message||account.error;if(notice){const feedback=document.createElement('p');feedback.className='feedback '+((failed||account.error)?'is-error':'');feedback.setAttribute('role',(failed||account.error)?'alert':'status');feedback.textContent=t(notice);content.prepend(feedback);}
 if(busy||account.status==='loading'){content.querySelectorAll('button,input').forEach(c=>c.disabled=true);const loading=document.createElement('p');loading.setAttribute('role','status');loading.textContent=t('Connecting…');content.append(loading);}
 translate(page);return page;
}
