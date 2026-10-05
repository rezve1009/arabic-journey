import {notificationSettings}from './notifications.js';
import {pwaSettings} from './pwa.js';
import {learningSettings,syncSettings} from './learning-settings.js';
import { getAccount, getPublicConfig, configure, sendCode, verifyCode, signOut, loadAccount, savePreferences, saveArabicDisplay, saveFixedSchedule, errorMessage } from './supabase.js';
import {scheduleForm,acknowledgeScheduleRevision} from './srs-settings.js';
import { getLanguage, t, translate } from './i18n.js';
import { displayArabic, futureArabic } from './arabic-utils.js';

let selectedSettings = '';
let email = '';
let codeSent = false;
let busy = false;
let notice = '';
let noticeError = false;
let draft;
let owner;
let configDraft;
let displayDraft;
let renderRequest = () => {};
export function setSettingsRenderer(callback) { renderRequest = callback; }
export function updateDraftLanguage(language) { if (draft) draft.ui_language = language; }
export function acknowledgeLanguagePreference() {
  acknowledgeScheduleRevision();
  if (draft && getAccount().settings) draft.settings_revision = getAccount().settings.revision;
  if (displayDraft && getAccount().settings) displayDraft.revision = getAccount().settings.revision;
}
async function run(action, success = '') {
  if (busy) return;
  busy = true;
  notice = '';
  renderRequest();
  try { await action(); if (success) { notice = success; noticeError = false; } }
  catch (error) { notice = errorMessage(error); noticeError = true; }
  finally { busy = false; renderRequest(); }
}

export function settingsPage() {
  const account = getAccount();
  if (owner !== account.user?.id) {
    owner = account.user?.id;
    draft = null;
    displayDraft = null;
    notice = '';
  }
  if (account.status === 'ready' && !draft) draft = {
    display_name: account.profile.display_name,
    timezone: account.settings.timezone,
    ui_language: getLanguage(),
    profile_revision: account.profile.revision,
    settings_revision: account.settings.revision,
  };
  const page = document.createElement('div');
  page.className = 'page settings-page';
  page.innerHTML = `<div class="page-heading"><div><p class="eyebrow">YOUR LEARNING SPACE</p><h1>Settings</h1><p class="page-description">Manage your account, language, and timezone.</p></div></div><div class="settings-grid"><section class="card settings-card" id="account-section"><h2>Account</h2></section><section class="card settings-card" id="preferences-section"><h2>Account and preferences</h2></section><section class="card settings-card" id="config-section"><h2>Cloud connection</h2></section><section class="card settings-card" id="learning-section"><h2>Learning controls will become available with their planned phases.</h2><dl class="phase-list"><dt>Revision</dt><dd>Phase 5</dd><dt>Notifications</dt><dd>Phase 12</dd><dt>Quiz</dt><dd>Phase 7</dd><dt>Arabic Display</dt><dd>Phase 4</dd><dt>Daily Goal</dt><dd>Phase 9</dd><dt>Appearance</dt><dd>Light theme</dd><dt>Backup</dt><dd>Phase 13</dd></dl><p class="settings-help">Fixed schedule: 1 → 3 → 7 → 15 → 30 days; repeat every 30 days.</p><p class="settings-help">No notification permission is requested in this phase.</p></section></div>`;
  const accountSection = page.querySelector('#account-section');
  if (account.status === 'loading') {
    const skeleton = document.createElement('div');
    skeleton.className = 'account-skeleton';
    skeleton.innerHTML = '<p role="status">Loading your account…</p><div></div><div></div>';
    accountSection.append(skeleton);
  } else if (account.user) {
    const identity = document.createElement('p');
    identity.className = 'account-email';
    identity.dataset.noTranslate = '';
    identity.textContent = account.user.email;
    if(account.access?.role==='admin'){
      const badge=document.createElement('p');badge.className='admin-badge';badge.textContent=t('Administrator');
      const requests=document.createElement('a');requests.href='#/admin';requests.className='button button-primary';requests.textContent=t('Manage access requests');accountSection.append(badge,requests);
    }
    accountSection.append(identity);
    const out = button('Sign out', () => run(async () => { await signOut(); codeSent = false; draft = null; }));
    accountSection.append(out);
    const manage=document.createElement('a');manage.href='#/login';manage.className='button button-secondary';manage.textContent='Set a password for next time';accountSection.append(manage);
    if (account.status === 'error') {
      const error = document.createElement('p');
      error.className = 'feedback is-error';
      error.textContent = t(account.error);
      error.setAttribute('role','alert');
      accountSection.append(error, button('Reload account', () => { draft = null; run(() => loadAccount()); }));
    }
  } else if (account.status !== 'unconfigured') {
    const login=document.createElement('a');login.href='#/login';login.className='button button-primary';login.textContent='Open sign-in page';accountSection.append(login);
    if (account.error) {
      const error = document.createElement('p');
      error.className = 'feedback is-error';
      error.setAttribute('role','alert');
      error.textContent = t(account.error);
      accountSection.append(error);
    }
  } else {
    const help = document.createElement('p');
    help.className = 'settings-help';
    help.textContent = 'Configure your Supabase project here or in js/config.js.';
    accountSection.append(help);
  }

  const preferences = page.querySelector('#preferences-section');
  if (account.status === 'ready') preferences.append(preferencesForm());
  else {
    const help = document.createElement('p');
    help.className = 'settings-help';
    help.textContent = 'Sign in to save your name, language, and timezone to your account.';
    preferences.append(help);
  }
  const advanced=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Advanced connection settings';advanced.append(summary,configForm());page.querySelector('#config-section').append(advanced);
  const arabicSection=document.createElement('section');arabicSection.className='card settings-card';arabicSection.id='arabic-display-section';
  const arabicTitle=document.createElement('h2');arabicTitle.textContent='Arabic Display';arabicSection.append(arabicTitle);
  if(account.status==='ready')arabicSection.append(arabicDisplayForm());
  else {const help=document.createElement('p');help.className='settings-help';help.textContent='Sign in to save Arabic display preferences.';arabicSection.append(help);}
  page.querySelector('.settings-grid').append(arabicSection);
  const scheduleSection=document.createElement('section');scheduleSection.className='card settings-card';scheduleSection.id='schedule-section';scheduleSection.append(Object.assign(document.createElement('h2'),{textContent:t('Fixed review schedule')}));
  if(account.status==='ready')scheduleSection.append(scheduleForm({save:async(values,revision,baseline)=>{await saveFixedSchedule(values,revision,baseline);acknowledgeLanguagePreference();},run,reload:loadAccount}));
  else scheduleSection.append(Object.assign(document.createElement('p'),{textContent:t('Sign in to edit your fixed schedule.')}));
  page.querySelector('.settings-grid').append(scheduleSection);
  for(const term of page.querySelectorAll('#learning-section dt'))if(term.textContent==='Revision'){term.nextElementSibling.remove();term.remove();}
  for(const term of page.querySelectorAll('#learning-section dt'))if(term.textContent==='Arabic Display'){term.nextElementSibling.remove();term.remove();}
  page.querySelector('#learning-section').remove();
  page.querySelector('.settings-grid').append(pwaSettings());
  if(account.status==='ready')page.querySelector('.settings-grid').append(learningSettings(),notificationSettings());
  if(account.user)page.querySelector('.settings-grid').append(syncSettings());
  if (notice) {
    const message = document.createElement('p');
    message.className = `feedback ${noticeError ? 'is-error' : ''}`;
    message.setAttribute('role', noticeError ? 'alert' : 'status');
    message.textContent = t(notice);
    page.querySelector('.page-heading').after(message);
  }
  const grid=page.querySelector('.settings-grid'),nav=document.createElement('nav');nav.className='settings-tabs';nav.setAttribute('aria-label',t('Settings categories'));
  const categories=[['account','Account'],['schedule','Revision'],['learning','Learning preferences'],['display','Arabic Display'],['notifications','Notifications'],['tools','Tools']];
  const cards=[...grid.children];for(const card of cards){const heading=card.querySelector('h2')?.textContent;card.dataset.category=card.id==='account-section'||card.id==='preferences-section'?'account':card.id==='schedule-section'?'schedule':card.id==='arabic-display-section'?'display':heading===t('Learning preferences')||heading==='Learning preferences'?'learning':card.id==='notifications-section'?'notifications':'tools';if(card.dataset.category==='learning'||card.dataset.category==='schedule')card.classList.add('settings-wide');}
  const requested=new URLSearchParams(location.hash.split('?')[1]||'').get('section');if(['schedule','notifications','learning'].includes(requested))selectedSettings=requested;if(!cards.some(card=>card.dataset.category===selectedSettings))selectedSettings=account.status==='ready'?'learning':'account';
  const show=key=>{selectedSettings=key;for(const card of cards)card.hidden=card.dataset.category!==key;for(const button of nav.children)button.setAttribute('aria-pressed',String(button.dataset.category===key));};
  for(const [key,label]of categories){if(!cards.some(card=>card.dataset.category===key))continue;const tab=button(label,()=>show(key));tab.dataset.category=key;nav.append(tab);}grid.before(nav);show(selectedSettings);
  if (busy) page.querySelectorAll('button,input,select').forEach(control => control.disabled = true);
  const section=new URLSearchParams(location.hash.split('?')[1]||'').get('section');if(['notifications','schedule'].includes(section))queueMicrotask(()=>page.querySelector('#'+section+'-section')?.scrollIntoView({block:'start'}));
  translate(page);
  return page;
}

function authForm() {
  const form = document.createElement('form');
  form.className = 'settings-form';
  const heading = document.createElement('h3');
  heading.textContent = 'Sign in or create an account';
  const emailInput = inputField('Email address','email',email,{ autocomplete: 'email', required: true });
  emailInput.input.addEventListener('input', () => { email = emailInput.input.value.trim(); });
  const instructions = document.createElement('p');
  instructions.className = 'settings-help';
  instructions.textContent = 'Open the sign-in link from your email in this same browser. A new account is created if needed.';
  form.append(heading,emailInput.label,instructions);
  let otp;
  if (codeSent) {
    emailInput.input.readOnly = true;
    const codeHint = document.createElement('p'); codeHint.className = 'settings-help';
    codeHint.textContent = 'If your email includes a code instead of a link, enter it below. Otherwise, open the email link.';
    otp = inputField('Email code','text','',{ autocomplete:'one-time-code', inputMode:'numeric', pattern:'[0-9]{6,10}', required:true });
    form.append(codeHint);
    form.append(otp.label);
  }
  const submit = button(codeSent ? 'Verify code' : 'Send sign-in link');
  submit.type = 'submit';
  submit.className = 'button button-primary';
  form.append(submit);
  if (codeSent) form.append(button('Use another email', () => { codeSent = false; notice = ''; renderRequest(); }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const currentEmail = emailInput.input.value.trim();
    if (codeSent) {
      const token = otp.input.value.trim();
      run(async () => { await verifyCode(currentEmail,token); codeSent = false; });
    } else run(async () => { await sendCode(currentEmail); email = currentEmail; codeSent = true; },'A sign-in email has been sent. Check your inbox and spam folder.');
  });
  return form;
}

function preferencesForm() {
  const form = document.createElement('form');
  form.className = 'settings-form';
  const name = inputField('Display name','text',draft.display_name,{ maxLength:100, autocomplete:'nickname' });
  const timezone = inputField('Timezone','text',draft.timezone,{ required:true, list:'timezones', maxLength:100 });
  const options = document.createElement('datalist');
  options.id = 'timezones';
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Asia/Dhaka','UTC'];
  for (const zone of new Set(['UTC',Intl.DateTimeFormat().resolvedOptions().timeZone,...zones])) {
    const option = document.createElement('option'); option.value = zone; options.append(option);
  }
  const language = document.createElement('label');
  const labelText = document.createElement('span'); labelText.textContent = 'Language';
  const select = document.createElement('select');
  for (const [value,text] of [['en','English'],['bn','বাংলা']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
  }
  select.value = draft.ui_language;
  language.append(labelText,select);
  const help = document.createElement('p'); help.className = 'settings-help'; help.textContent = 'Choose an IANA timezone, for example Asia/Dhaka.';
  name.input.addEventListener('input',()=>{draft.display_name = name.input.value;});
  timezone.input.addEventListener('input',()=>{draft.timezone = timezone.input.value;});
  select.addEventListener('change',()=>{draft.ui_language = select.value;});
  const submit = button('Save preferences'); submit.type = 'submit'; submit.className = 'button button-primary';
  form.append(name.label,language,timezone.label,options,help,submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = { display_name:name.input.value.trim(), timezone:timezone.input.value.trim(), ui_language:select.value };
    const expected = { profile:draft.profile_revision, settings:draft.settings_revision };
    run(async()=>{
      await savePreferences(values,expected);
      acknowledgeLanguagePreference();
      draft = null;
    },'Preferences saved to your account.');
  });
  if (noticeError) form.append(button('Reload account',()=>{
    if (confirm(t('Your changes have not been saved. Keep them or reload the account to get the latest version.'))) {
      draft = null;
      run(()=>loadAccount());
    }
  }));
  return form;
}

function arabicDisplayForm() {
  if(!displayDraft){const settings=getAccount().settings;displayDraft={harakah_mode:settings.harakah_mode||'always_show',arabic_font_size:settings.arabic_font_size||38,future_prefix:settings.future_prefix||'sa',revision:settings.revision};}
  const form=document.createElement('form');form.className='settings-form';
  const selectField=(text,name,values)=>{
    const label=document.createElement('label');const span=document.createElement('span');span.textContent=text;const select=document.createElement('select');
    for(const [value,text]of values){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
    select.value=displayDraft[name];select.addEventListener('change',()=>{displayDraft[name]=select.value;updatePreview();});label.append(span,select);form.append(label);return select;
  };
  const mode=selectField('Harakah display','harakah_mode',[['always_show','Always Show'],['hide_quiz','Hide During Quiz'],['always_hide','Always Hide']]);
  const size=inputField('Arabic font size','number',displayDraft.arabic_font_size,{min:24,max:80,step:1,required:true});form.append(size.label);
  size.input.addEventListener('input',()=>{displayDraft.arabic_font_size=size.input.value;updatePreview();});
  const prefix=selectField('Future prefix','future_prefix',[['sa','سَـ (sa)'],['sawfa','سَوْفَ (sawfa)']]);
  const preview=document.createElement('div');preview.className='arabic-preview';preview.dataset.noTranslate='';preview.lang='ar';preview.dir='rtl';form.append(preview);
  function updatePreview(){preview.textContent=displayArabic('كَتَبَ',{mode:displayDraft.harakah_mode})+' · '+displayArabic(futureArabic('يَكْتُبُ',displayDraft.future_prefix),{mode:displayDraft.harakah_mode});const value=Number(displayDraft.arabic_font_size);if(value>=24&&value<=80)preview.style.fontSize=value+'px';}
  updatePreview();
  const help=document.createElement('p');help.className='settings-help';help.textContent='Display preferences never change stored Arabic. Hide During Quiz will apply when quizzes arrive in Phase 7; revealed answers show the original.';form.append(help);
  const submit=button('Save Arabic display');submit.type='submit';submit.className='button button-primary';form.append(submit);
  form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;
    const values={harakah_mode:mode.value,arabic_font_size:Number(size.input.value),future_prefix:prefix.value};
    const revision=displayDraft.revision;
    run(async()=>{await saveArabicDisplay(values,revision);acknowledgeLanguagePreference();displayDraft=null;},'Arabic display preferences saved.');
  });
  if(noticeError)form.append(button('Reload display preferences',()=>{
    if(confirm(t('Replace the display draft with the latest saved preferences?'))){displayDraft=null;run(()=>loadAccount());}
  }));
  return form;
}

function configForm() {
  if (!configDraft) configDraft = { ...getPublicConfig() };
  const form = document.createElement('form');
  form.className = 'settings-form';
  const url = inputField('Project URL','url',configDraft.url,{ required:true, placeholder:'https://your-project.supabase.co', autocomplete:'off' });
  const key = inputField('Publishable / anon public key','text',configDraft.publicKey,{ required:true, autocomplete:'off', spellcheck:false });
  url.input.addEventListener('input',()=>{configDraft.url = url.input.value;});
  key.input.addEventListener('input',()=>{configDraft.publicKey = key.input.value;});
  const help = document.createElement('p'); help.className = 'settings-help'; help.textContent = 'Public configuration only. Never enter a secret or service-role key.';
  const submit = button('Connect Supabase'); submit.type = 'submit'; submit.className = 'button button-secondary';
  form.append(url.label,key.label,help,submit);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const config = { url:url.input.value.trim(), publicKey:key.input.value.trim() };
    run(()=>configure(config));
  });
  return form;
}

function inputField(text,type,value,properties = {}) {
  const label = document.createElement('label');
  const span = document.createElement('span'); span.textContent = text;
  const input = document.createElement('input');
  input.type = type; input.value = value || '';
  for (const [key,val] of Object.entries(properties)) {
    if (key === 'list') input.setAttribute('list',val);
    else input[key] = val;
  }
  label.append(span,input);
  return { label,input };
}
function button(text,action) {
  const element = document.createElement('button'); element.type = 'button'; element.className = 'button button-secondary'; element.textContent = busy ? 'Working…' : text;
  if (action) element.addEventListener('click',action);
  return element;
}
