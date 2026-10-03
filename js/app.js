import {backupPage}from './backup.js';
import {initializePwa} from './pwa.js';
import {initializeSync,syncStatus} from './sync.js';
import {progressPage} from './progress.js';
import {statisticsPage} from './statistics.js';
import {quizPage,setQuizRenderer} from './quiz.js';
import {reviewPage,setReviewRenderer,unmountReview} from './review.js';
import { routes, startRouter, currentRoute } from './router.js';
import { icon, initializeModal, showModal } from './ui.js';
import { dashboard } from './pages/dashboard.js';
import { futurePage } from './pages/future.js';
import { getLanguage, setLanguage, t, translate } from './i18n.js';
import { initializeSupabase, subscribeAccount, getAccount, saveLanguagePreference } from './supabase.js';
import { settingsPage, setSettingsRenderer, updateDraftLanguage, acknowledgeLanguagePreference } from './settings.js';
import { vocabularyPage, setVocabularyRenderer, unmountVocabulary } from './vocabulary.js';

import { loginPage, setLoginRenderer } from './login.js';

const desktopNav = document.getElementById('desktop-nav');
for (const [group, label] of [['learn', ''], ['collection', 'YOUR COLLECTION'], ['tools', 'TOOLS & INSIGHTS']]) {
  if (label) {
    const caption = document.createElement('div');
    caption.className = 'nav-caption';
    caption.textContent = label;
    desktopNav.append(caption);
  }
  for (const route of routes.filter(item => item.group === group)) desktopNav.append(navLink(route));
}

const mobileNav = document.getElementById('mobile-nav');
for (const id of ['dashboard', 'vocabulary', 'add-word', 'review']) mobileNav.append(navLink(routes.find(route => route.id === id), true));
const more = document.createElement('button');
more.type = 'button';
more.className = 'mobile-nav-link';
more.innerHTML = `${icon('more')}<span>More</span>`;
more.setAttribute('aria-label', 'More navigation options');
mobileNav.append(more);
more.addEventListener('click', () => {
  const links = document.createElement('nav');
  links.className = 'more-menu';
  links.setAttribute('aria-label', 'More pages');
  for (const route of routes.filter(item => !['dashboard', 'vocabulary', 'add-word', 'review'].includes(item.id))) links.append(navLink(route));
  links.addEventListener('click', event => {
    if (event.target.closest('a')) document.getElementById('app-dialog').close();
  });
  translate(links);
  showModal(t('Your learning space'), links);
});

initializeModal();
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  const main = document.getElementById('main');
  main.focus({ preventScroll: true });
  main.scrollIntoView({ block: 'start' });
});
const about = document.getElementById('about-button');
about.innerHTML = icon('info');
about.addEventListener('click', () => {
  const body = document.createElement('div');
  body.className = 'about-content';
  const description = document.createElement('p');
  description.textContent = t('A calm space to learn Arabic, one word at a time. Save, organize and find your vocabulary.');
  const detail = document.createElement('p');
  detail.textContent = 'Save your vocabulary, practice recall, and keep learning with a regular review schedule.';
  const link = document.createElement('a');
  link.href = './docs/architecture.md';
  link.className = 'text-link';
  link.textContent = 'Read the architecture and roadmap →';
  const languages = document.createElement('p');
  languages.className = 'language-sample';
  languages.innerHTML = '<span lang="ar" dir="rtl">كَلِمَةٌ</span><span lang="bn" dir="ltr">শব্দ</span><span>Word</span>';
  body.append(description, detail, languages);
  translate(body);
  showModal(t('About Arabic Journey'), body);
});

function updateConnectivity() {
  document.documentElement.style.setProperty('--arabic-size',`${(getAccount().settings?.arabic_font_size||38)+2}px`);
  const status = document.getElementById('connection-status');
  status.classList.toggle('is-offline', !navigator.onLine);
  const account = getAccount();
  const label = account.user ? syncStatus() : !navigator.onLine ? 'Offline' : ({ ready:'Cloud ready', loading:'Connecting…', error:'Connection error', 'signed-out':'Signed out', unconfigured:'Not connected' }[account.status]);
  status.textContent = t(label);
  status.setAttribute('aria-label',t(label));
  status.title=t(syncStatus());
  document.getElementById('account-link').textContent = t(account.user ? 'Signed in' : 'Sign in');
  document.getElementById('account-link').href=account.user?'#/settings':'#/login';
}
window.addEventListener('online', updateConnectivity);
window.addEventListener('offline', updateConnectivity);
updateConnectivity();

let initialNavigation = true;
function renderRoute(route, navigate = false) {
  document.body.classList.toggle('login-layout',route.id==='login');
  unmountVocabulary();
  unmountReview();
  if (document.getElementById('app-dialog').open) document.getElementById('app-dialog').close();
  const page = route.id === 'login' ? loginPage() : route.id==='import-export'?backupPage():['weak-words','mastered'].includes(route.id) ? progressPage(route) : ['statistics','history'].includes(route.id) ? statisticsPage(route) : route.id === 'quiz' ? quizPage() : route.id === 'review' ? reviewPage() : route.id === 'dashboard' ? dashboard() : route.id === 'settings' ? settingsPage() : ['vocabulary','add-word','favorites','tags'].includes(route.id) ? vocabularyPage(route) : futurePage(route);
  translate(page);
  document.getElementById('main').replaceChildren(page);
  document.getElementById('breadcrumb-title').textContent = t(route.title);
  document.title = `${t(route.title)} · ${t('Arabic Journey')}`;
  document.querySelectorAll('[data-route]').forEach(link => {
    if (link.dataset.route === route.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const moreIsCurrent = !['dashboard', 'vocabulary', 'add-word', 'review'].includes(route.id);
  more.classList.toggle('is-current', moreIsCurrent);
  more.setAttribute('aria-label', moreIsCurrent ? `${t('More navigation options')}: ${t(route.title)}` : t('More navigation options'));
  if (navigate) window.scrollTo({ top: 0, behavior: 'instant' });
  if (navigate && !initialNavigation) document.getElementById('main').focus({ preventScroll: true });
  initialNavigation = false;
}

setQuizRenderer(()=>{if(currentRoute()?.id==='quiz')renderRoute(currentRoute());});
setReviewRenderer(()=>{if(currentRoute()?.id==='review')renderRoute(currentRoute());});
setLoginRenderer(()=>{if(currentRoute()?.id==='login')renderRoute(currentRoute());});
setSettingsRenderer(() => {
  if (currentRoute()?.id === 'settings') renderRoute(currentRoute());
});
setVocabularyRenderer(() => {
  if (['vocabulary','add-word','favorites','tags'].includes(currentRoute()?.id)) renderRoute(currentRoute());
});
const languageToggle = document.getElementById('language-toggle');
function translateShell() {
  setLanguage(getLanguage(),{notify:false});
  for (const element of [document.querySelector('.sidebar'),document.querySelector('.topbar'),document.querySelector('.page-footer'),mobileNav,document.querySelector('.skip-link'),document.getElementById('dialog-close')]) translate(element);
  languageToggle.textContent = getLanguage() === 'en' ? 'বাংলা' : 'English';
  languageToggle.setAttribute('aria-label',getLanguage() === 'en' ? 'Switch to Bengali' : 'ইংরেজিতে পরিবর্তন করুন');
  updateConnectivity();
}
languageToggle.addEventListener('click',async()=>{
  const language = getLanguage() === 'en' ? 'bn' : 'en';
  updateDraftLanguage(language);
  setLanguage(language);
  languageToggle.disabled = true;
  try {
    const saved = await saveLanguagePreference(language);
    if (saved) acknowledgeLanguagePreference();
    showNotice(saved ? 'Language saved to your account.' : 'Language changed on this device. Sign in and save preferences to also store it in your account.');
  } catch {
    showNotice('Language changed on this device, but could not be saved to your account. Retry from Settings.');
  } finally { languageToggle.disabled = false; }
});
let noticeText = '';
function showNotice(message) {
  noticeText = message;
  const notice = document.getElementById('app-notice');
  notice.textContent = t(message);
  notice.hidden = !message;
}
window.addEventListener('learningrefresh',()=>renderRoute(currentRoute()||routes[0]));
window.addEventListener('pwa-ready',()=>{if(currentRoute()?.id==='settings')renderRoute(currentRoute());});
window.addEventListener('languagechange',()=>{
  translateShell();
  renderRoute(currentRoute() || routes[0]);
  showNotice(noticeText);
});
subscribeAccount(()=>{
  updateConnectivity();
  if (['weak-words','mastered','statistics','history','quiz','review','login','settings','vocabulary','add-word','favorites','tags','dashboard'].includes(currentRoute()?.id)) renderRoute(currentRoute());
});
initializeSync();
initializePwa().catch(()=>{});
window.addEventListener('syncstatus',updateConnectivity);
translateShell();
renderRoute(currentRoute() || routes[0]);
// Let the SDK exchange PKCE email callbacks before the hash router can redirect.
await initializeSupabase();
startRouter(route => renderRoute(route,true));

function navLink(route, mobile = false) {
  const link = document.createElement('a');
  link.href = `#/${route.id}`;
  link.dataset.route = route.id;
  link.className = mobile ? 'mobile-nav-link' : 'nav-link';
  link.innerHTML = icon(route.icon);
  const label = document.createElement('span');
  label.textContent = mobile && route.id === 'dashboard' ? 'Home' : mobile && route.id === 'add-word' ? 'Add' : route.title;
  link.append(label);
  return link;
}
