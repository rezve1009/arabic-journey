import {authRetry,retryAfterSeconds} from './auth-retry.js';
import { supabaseConfig } from './config.js';
import { getLanguage, setLanguage } from './i18n.js';

const configKey = 'arabic-journey.supabase-public-config';
let client;
let subscription;
let generation = 0;
let connectionEpoch = 0;
let languageSave = Promise.resolve();
let state = { status: 'unconfigured', user: null, profile: null, settings: null, error: null };
const listeners = new Set();
export const getAccount = () => state;
export function subscribeAccount(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function publish(next) { state = { ...state, ...next }; listeners.forEach(listener => listener(state)); }

export function validateConfig(config) {
  let url;
  try { url = new URL(config.url); } catch { throw new Error('invalid_config'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw new Error('invalid_config');
  const publicKey = String(config.publicKey || '').trim();
  if (publicKey.startsWith('sb_secret_')) throw new Error('private_key');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey)) {
    try {
      const segment = publicKey.split('.')[1];
      const claims = JSON.parse(atob(segment.replace(/-/g,'+').replace(/_/g,'/')));
      if (claims.role !== 'anon') throw new Error('private_key');
      if (publicKey.split('.').length !== 3) throw new Error('invalid_config');
    } catch (error) { throw new Error(error.message === 'private_key' ? 'private_key' : 'invalid_config'); }
  }
  return { url: url.origin, publicKey };
}
export function getPublicConfig() {
  try {
    const saved = localStorage.getItem(configKey);
    if (saved) return JSON.parse(saved);
  } catch { /* Fall back to deployed public configuration. */ }
  return supabaseConfig;
}
export async function configure(config) {
  const checked = validateConfig(config);
  // Changing projects must not retain a session from the previous backend.
  if (client) {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
  }
  try { localStorage.setItem(configKey, JSON.stringify(checked)); } catch { throw new Error('storage_error'); }
  await initializeSupabase();
}

const authRetryHeaders=new Map();
function authError(error,path){const until=authRetryHeaders.get(path);if(error?.status===429&&until>Date.now())error.retryAfterSeconds=Math.ceil((until-Date.now())/1000);return error;}
async function timedFetch(input, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timeout = setTimeout(abort, 15000);
  try { const response=await fetch(input,{...options,signal:controller.signal});
    const url=new URL(typeof input==='string'?input:input.url);
    if(url.pathname.startsWith('/auth/v1/')){authRetryHeaders.delete(url.pathname);if(response.status===429){const seconds=retryAfterSeconds(response.headers.get('Retry-After'));if(seconds)authRetryHeaders.set(url.pathname,Date.now()+seconds*1000);}}
    return response;
  }
  finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
}
export async function initializeSupabase() {
  const epoch = ++connectionEpoch;
  const callbackAttempt = new URLSearchParams(location.search).has('code') || /(?:^#|&)error=/.test(location.hash);
  ++generation;
  subscription?.unsubscribe();
  client?.auth.stopAutoRefresh();
  client = null;
  publish({ status: 'unconfigured', user: null, profile: null, settings: null, error: null });
  const config = getPublicConfig();
  if (!config.url && !config.publicKey) return;
  try {
    const checked = validateConfig(config);
    if (!window.supabase?.createClient) throw new Error('sdk_unavailable');
    client = window.supabase.createClient(checked.url, checked.publicKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      global: { fetch: timedFetch },
    });
    publish({ status: 'loading' });
    const activeClient = client;
    let initializationFailed = false;
    const { data } = activeClient.auth.onAuthStateChange((event, session) => {
      // Defer database requests until the SDK auth lock is released.
      setTimeout(() => {
        if (activeClient !== client) return;
        if ((initializationFailed || state.status === 'error') && event === 'INITIAL_SESSION') return;
        if (!session) {
          ++generation;
          publish({ status: 'signed-out', user: null, profile: null, settings: null, error: null });
        } else if (state.user?.id !== session.user.id || state.status !== 'ready') {
          loadAccount(session.user);
        }
      }, 0);
    });
    subscription = data.subscription;
    const initialized = await activeClient.auth.initialize();
    if (initialized.error) { initializationFailed = true; throw initialized.error; }
    const result = await activeClient.auth.getSession();
    if (result.error) throw result.error;
    if (activeClient !== client) return;
    if (new URLSearchParams(location.search).has('code')) {
      // A leftover callback means this browser did not have the matching PKCE verifier.
      const clean = new URL(location.href);
      clean.searchParams.delete('code');
      history.replaceState(null,'',clean);
      if (!result.data.session) { initializationFailed = true; throw new Error('bad_code_verifier'); }
    }
    if (result.data.session) await loadAccount(result.data.session.user);
    else publish({ status: 'signed-out' });
    if (callbackAttempt) {
      const clean = new URL(location.href);
      clean.searchParams.delete('code');
      clean.hash = '/login';
      history.replaceState(null,'',clean);
    }
  } catch (error) {
    if (epoch === connectionEpoch) {
      if (callbackAttempt) {
        const clean = new URL(location.href);
        clean.searchParams.delete('code');
        clean.hash = '/login';
        history.replaceState(null,'',clean);
      }
      publish({ status: 'error', error: errorMessage(error) });
    }
  }
}
export async function loadAccount(user = state.user) {
  if (!client || !user) return;
  const token = ++generation;
  const activeClient = client;
  publish({ status: 'loading', user, profile: null, settings: null, error: null });
  try {
    const [profile, settings] = await Promise.all([
      activeClient.from('profiles').select('*').eq('user_id',user.id).single(),
      activeClient.from('user_settings').select('*').eq('user_id',user.id).single(),
    ]);
    if (profile.error || settings.error) throw profile.error || settings.error;
    if (token !== generation || activeClient !== client) return;
    setLanguage(settings.data.ui_language, { notify: false });
    publish({ status: 'ready', user, profile: profile.data, settings: settings.data, error: null });
    window.dispatchEvent(new Event('languagechange'));
  } catch (error) {
    if (token === generation) publish({ status: 'error', error: errorMessage(error) });
  }
}

function requireClient() {
  if (!client) throw new Error('unconfigured');
  if (!navigator.onLine) throw new Error('offline');
  return client;
}
export function vocabularyClient() {
  if (state.status !== 'ready' || !state.user) throw new Error('session_expired');
  return requireClient();
}
export async function sendCode(email) {
  return authRetry.run('email',async()=>{
  const emailRedirectTo = new URL('index.html',location.href).href.split(/[?#]/)[0];
  const { error } = await requireClient().auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo } });
  if (error) throw authError(error,'/auth/v1/otp');
  },{emailOnSuccess:true});
}
export async function verifyCode(email, token) {
  const result = await authRetry.run('request',async()=>{const result=await requireClient().auth.verifyOtp({email,token,type:'email'});if(result.error)throw authError(result.error,'/auth/v1/verify');return result;});
  if (result.error) throw result.error;
  await loadAccount(result.data.user);
}
export async function signInPassword(email,password) {
 const {data,error}=await authRetry.run('request',async()=>{const result=await requireClient().auth.signInWithPassword({email,password});if(result.error)throw authError(result.error,'/auth/v1/token');return result;});
 if(error)throw error;await loadAccount(data.user);
}
export async function signUpPassword(email,password) {
 const emailRedirectTo=new URL('index.html',location.href).href.split(/[?#]/)[0];
 const {data,error}=await authRetry.run('email',async()=>{const result=await requireClient().auth.signUp({email,password,options:{emailRedirectTo}});if(result.error)throw authError(result.error,'/auth/v1/signup');return result;},{emailOnSuccess:true});
 if(error)throw error;if(data.session)await loadAccount(data.user);return Boolean(data.session);
}
export async function setAccountPassword(password) {
 const {error}=await requireClient().auth.updateUser({password});if(error)throw error;
}
export async function signOut() {
  const { error } = await requireClient().auth.signOut({ scope: 'local' });
  if (error) throw error;
  ++generation;
  publish({ status: 'signed-out', user: null, profile: null, settings: null, error: null });
}
export async function savePreferences(values, expected) {
  const activeClient = requireClient();
  const userId = state.user?.id;
  if (!userId) throw new Error('session_expired');
  const { data, error } = await activeClient.rpc('save_base_settings', {
    p_display_name: values.display_name,
    p_timezone: values.timezone,
    p_ui_language: values.ui_language,
    p_profile_revision: expected.profile,
    p_settings_revision: expected.settings,
  });
  if (error) throw error;
  if (client !== activeClient || state.user?.id !== userId) throw new Error('session_expired');
  publish({ profile: data.profile, settings: data.settings });
  setLanguage(data.settings.ui_language);
}
export function saveLanguagePreference(language = getLanguage()) {
  languageSave = languageSave.catch(() => {}).then(async () => {
    if (state.status !== 'ready') return false;
    const userId = state.user.id;
    const activeClient = requireClient();
    const { data, error } = await activeClient.from('user_settings').update({ ui_language: language })
      .eq('user_id',userId).eq('revision',state.settings.revision).select('*').single();
    if (error) throw error.code === 'PGRST116' ? { code:'40001' } : error;
    if (client !== activeClient || state.user?.id !== userId) return false;
    publish({ settings: data });
    return true;
  });
  return languageSave;
}
export async function saveFixedSchedule(values,revision) {
  const activeClient=vocabularyClient(),userId=state.user.id;
  const {data,error}=await activeClient.rpc('save_fixed_schedule',{p_revision:revision,p_intervals:values.intervals,p_repeat_days:values.repeat_days,p_ratings:values.ratings});
  if(error){if(['23514','22023'].includes(error.code))throw new Error('invalid_srs');if(['PGRST202','42883'].includes(error.code))throw new Error('missing_srs');throw error;}
  if(client!==activeClient||state.user?.id!==userId)throw new Error('session_expired');publish({settings:data});return data;
}
export async function saveArabicDisplay(values,revision) {
  const activeClient=vocabularyClient();const userId=state.user.id;
  const {data,error}=await activeClient.rpc('save_arabic_display',{
    p_revision:revision,p_harakah_mode:values.harakah_mode,
    p_font_size:Number(values.arabic_font_size),p_future_prefix:values.future_prefix,
  });
  if(error){
    if(['23514','23502','22023'].includes(error.code))throw new Error('invalid_display');
    if(['PGRST202','42883'].includes(error.code))throw new Error('missing_morphology');
    throw error;
  }
  if(client!==activeClient||state.user?.id!==userId)throw new Error('session_expired');
  publish({settings:data});return data;
}

export function errorMessage(error) {
  const code = error?.code || error?.message;
  if(code==='over_email_send_rate_limit')return 'The email service has reached its sending limit. Check your latest email instead of requesting more. If no retry time is supplied, wait up to one hour. More email capacity requires custom SMTP.';
  if(code==='auth_cooldown')return 'Please wait for the countdown before trying again.';
  if(code==='auth_in_progress')return 'A sign-in request is already in progress. Please wait.';
  if(code==='invalid_credentials')return 'Email or password is incorrect. If you used an email link before, sign in with Email link and then set a password.';
  if(code==='email_not_confirmed')return 'Confirm your email first. Check your inbox and spam folder, or request a new email link.';
  if(code==='weak_password')return 'Choose a stronger password with at least 8 characters.';
  if(code==='email_address_invalid')return 'Enter a valid email address.';
  if(['email_provider_disabled','signup_disabled'].includes(code))return 'Email registration is currently unavailable. Contact the site owner.';
  if(code==='user_already_exists')return 'This email already has an account. Sign in or use an email link.';
  if(error?.name==='AuthPKCEGrantCodeExchangeError'||['pkce_verifier_invalid','validation_failed'].includes(code))return 'Open the newest email link in the browser where you requested it. You can also paste the link on the sign-in page.';
  if(['unexpected_failure','unexpected_failure_database'].includes(code)||/database error/i.test(error?.message||''))return 'The account service could not finish this request. Please retry; if it continues, the site owner needs to check authentication logs.';

  if(code==='invalid_srs')return 'Use 1–30 stages of 1–3650 whole days and valid rating behavior.';
  if(code==='missing_srs')return 'Apply the Phase 5 database migration to save the fixed schedule.';
  if(code==='invalid_display')return 'Check Harakah mode, font size and future prefix.';
  if(code==='missing_morphology')return 'Apply the Phase 4 database migration to save Arabic display preferences.';
  if (code === 'private_key') return 'Private keys cannot be used in this app. Use a publishable or anon key.';
  if (code === 'invalid_config') return 'Please use a valid HTTPS project URL and a public Supabase key.';
  if (code === 'storage_error') return 'Unable to store configuration on this device. Check browser storage permissions.';
  if (code === 'unconfigured') return 'Supabase is not configured yet.';
  if (code === 'offline' || !navigator.onLine) return 'You are offline. Reconnect and try again.';
  if (code === '40001') return 'Account data changed on another device. Reload before saving.';
  if (code === '23514' || code === '22023') return 'Check the name, language, and timezone, then try again.';
  if (code === '42501') return 'This account is not allowed to make that change.';
  if (['PGRST116','PGRST205','42P01','42883','PGRST202'].includes(code)) return 'Account data is unavailable. Apply the Phase 2 database migration, then reload.';
  if (error?.status === 429 || ['over_email_send_rate_limit','over_request_rate_limit'].includes(code)) return 'Too many attempts. Please wait before trying again.';
  if (code === 'email_address_not_authorized') return 'The default email service only sends to Supabase organization members. Use your Supabase account email or configure custom SMTP.';
  if (error?.name === 'AuthPKCECodeVerifierMissingError' || ['otp_expired','otp_disabled','flow_state_expired','flow_state_not_found','bad_code_verifier'].includes(code)) return 'The sign-in link or code is invalid or expired. Request a new sign-in email in this browser.';
  if (['session_expired','refresh_token_not_found','refresh_token_already_used','bad_jwt'].includes(code)) return 'Sign in again to continue.';
  if (error?.name === 'AbortError' || error?.name === 'AuthRetryableFetchError' || error instanceof TypeError || code === 'sdk_unavailable') return 'Could not reach Supabase. Check the project connection and try again.';
  return 'Something went wrong. Your changes were not saved. Please try again.';
}
