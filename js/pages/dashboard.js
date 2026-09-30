import { emptyState, icon } from '../ui.js';
import { getLanguage, t } from '../i18n.js';
import { getAccount } from '../supabase.js';
import { listWords } from '../vocabulary-data.js';
import { arabicDisplay } from '../morphology.js';
import {getDueWords} from '../srs-data.js';

export function dashboard() {
  const page = document.createElement('div');
  page.className = 'page dashboard-page';
  page.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">A LITTLE LEARNING, EVERY DAY</p><h1>Your Arabic journey</h1><p class="page-description">Make room for a few words. Build something lasting.</p></div><a href="#/add-word" class="button button-primary">${icon('plus')} Add a word</a></div>
    <div class="dashboard-grid"><div class="dashboard-main">
      <section class="review-hero card" aria-labelledby="today-title"><div class="hero-copy"><span class="pill">${icon('sprout')} A fresh start</span><h2 id="today-title">Small steps.<br>Stronger vocabulary.</h2><p>Your daily review will bring the right words back<br class="desktop-break"> at the right time.</p><a href="#/review" class="button button-primary">Start today's review ${icon('arrow')}</a><div class="hero-progress"><div><span>Today's review progress</span><strong>0 / 0 reviewed</strong></div><progress value="0" max="1" aria-label="Today's review progress: no words yet"></progress></div></div><div class="hero-art" aria-hidden="true"><div class="arabic-ring"><span lang="ar" dir="rtl">ع</span></div><span class="art-label">ONE WORD AT A TIME</span><span class="art-leaf leaf-one"></span><span class="art-leaf leaf-two"></span></div></section>
      <section aria-labelledby="today-overview"><div class="section-heading"><h2 id="today-overview">Today at a glance</h2><span class="muted" id="today-date"></span></div><div class="metric-grid">
        ${metric('review', 'Words due', '0', 'Ready when you are')}${metric('sprout', 'New words', '0', 'A fresh beginning')}${metric('mastered', 'Reviewed today', '0', 'Every review counts')}${metric('quiz', 'Daily quiz', '—', 'No quiz yet')}
      </div></section>
      <section class="card recent-card" aria-labelledby="recent-title"><div class="card-heading"><h2 id="recent-title">Recently added</h2><a class="text-link" href="#/vocabulary">View vocabulary ${icon('chevron')}</a></div><div id="recent-empty"></div></section>
      <div class="lower-grid"><section class="card" aria-labelledby="upcoming-title"><div class="card-heading"><h2 id="upcoming-title">Upcoming reviews</h2>${icon('history', 'muted')}</div><div id="upcoming-empty"></div></section><section class="card" aria-labelledby="activity-title"><div class="card-heading"><h2 id="activity-title">Recent activity</h2>${icon('chart', 'muted')}</div><div id="activity-empty"></div></section></div>
    </div><aside class="summary-panel" aria-label="Learning summary">
      <section class="card collection-card"><div class="card-heading"><h2>Your collection</h2>${icon('book', 'muted')}</div><div class="collection-total"><strong>0</strong><span>words and counting</span></div><div class="collection-list">${summary('sprout', 'Learning', '0')}${summary('review', 'Reviewing', '0')}${summary('mastered', 'Mastered', '0')}${summary('weak', 'Weak words', '0')}${summary('heart', 'Favorites', '0')}</div><a class="button button-secondary full-width" href="#/vocabulary">Explore vocabulary ${icon('arrow')}</a></section>
      <section class="card streak-card"><span class="streak-icon">${icon('flame')}</span><div><h2>Every day matters</h2><p><strong>0</strong> day streak</p></div><div class="streak-bottom"><span>Longest streak</span><strong>0 days</strong></div></section>
      <section class="quiet-note"><span class="arabic" lang="ar" dir="rtl">رِحْلَةُ الأَلْفِ مِيلٍ<br>تَبْدَأُ بِخُطْوَةٍ</span><p>A journey of a thousand miles<br>begins with a single step.</p><span class="note-line"></span></section>
      <div class="foundation-note">${icon('info')}<p>You're exploring the foundation.<br>Word saving arrives in Phase 3.</p></div>
    </aside></div>`;
  page.querySelector('#today-date').textContent = new Intl.DateTimeFormat(getLanguage() === 'bn' ? 'bn-BD' : 'en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
  page.querySelector('#recent-empty').append(emptyState({ title: 'Your first word is the start of something.', description: 'No words yet. Add your first Arabic word when vocabulary entry is ready.', link: '#/add-word', label: 'Explore Add Word →' }));
  page.querySelector('#upcoming-empty').append(emptyState({ symbol: 'review', title: 'A clear schedule', description: 'Upcoming reviews will appear as you add and learn words.' }));
  page.querySelector('#activity-empty').append(emptyState({ symbol: 'sprout', title: 'Your story starts here', description: 'Your learning activity will appear here as you make progress.' }));
  page.querySelector('.foundation-note p').textContent = t('Reviews and learning statistics arrive in later phases.');
  const metrics=page.querySelectorAll('.metric-value');
  for(const index of [0,2])metrics[index].textContent='—';
  page.querySelector('.hero-progress strong').textContent=t('Phase 6');
  for(const row of [...page.querySelectorAll('.summary-row')].slice(0,4))row.querySelector('strong').textContent='—';
  page.querySelector('.streak-card p strong').textContent='—';page.querySelector('.streak-bottom strong').textContent='—';
  const total=page.querySelector('.collection-total strong'),favorite=page.querySelector('.summary-row:last-child strong');
  total.textContent='—';favorite.textContent='—';metrics[1].textContent='—';
  const account=getAccount();
  if(account.status!=='ready')page.querySelector('#recent-empty').replaceChildren(emptyState({title:t('Sign in to see your collection.'),description:t('Your words are stored privately in your account.'),link:'#/settings',label:t('Open Settings')}));
  else queueMicrotask(async()=>{
    try{
      const [collection,favorites,newWords,due]=await Promise.all([listWords(),listWords({favorite:true}),listWords({status:'new'}),getDueWords().catch(()=>null)]);
      if(!page.isConnected||getAccount().user?.id!==account.user.id)return;
      total.textContent=collection.total;favorite.textContent=favorites.total;metrics[1].textContent=newWords.total;
      metrics[0].textContent=due?due.total:'—';
      const upcoming=page.querySelector('#upcoming-empty');upcoming.replaceChildren();
      if(!due)upcoming.append(emptyState({symbol:'review',title:t('Review schedule could not be loaded.'),description:t('Retry')}));
      else if(!due.upcoming.length)upcoming.append(emptyState({symbol:'review',title:t('A clear schedule'),description:t('No upcoming reviews. Due words are counted above.')}));
      for(const word of due?.upcoming||[]){const anchor=document.createElement('a');anchor.className='recent-word';anchor.href='#/vocabulary?word='+word.id;
        const arabic=document.createElement('span');arabic.lang='ar';arabic.dir='rtl';arabic.dataset.noTranslate='';arabic.textContent=arabicDisplay(word.arabic_word);
        const date=document.createElement('small');date.textContent=new Intl.DateTimeFormat(getLanguage()==='bn'?'bn-BD':'en',{dateStyle:'medium',timeStyle:'short',timeZone:account.settings.timezone}).format(new Date(word.next_review_at));anchor.append(arabic,date);upcoming.append(anchor);}
      const recent=page.querySelector('#recent-empty');
      recent.replaceChildren();
      if(!collection.words.length)recent.append(emptyState({title:t('No words found'),description:t('Add your first word or change the filters.'),link:'#/add-word',label:t('Add a word')}));
      for(const word of collection.words.slice(0,5)){
        const anchor=document.createElement('a');anchor.className='recent-word';anchor.href='#/vocabulary?word='+word.id;
        const arabic=document.createElement('span');arabic.textContent=arabicDisplay(word.arabic_word);arabic.lang='ar';arabic.dir='rtl';arabic.dataset.noTranslate='';
        const meaning=document.createElement('span');meaning.textContent=getLanguage()==='bn'?word.bangla_meaning:word.english_meaning;meaning.dataset.noTranslate='';anchor.append(arabic,meaning);recent.append(anchor);
      }
    }catch{if(page.isConnected)page.querySelector('#recent-empty').replaceChildren(emptyState({title:t('Collection could not be loaded. Retry from Vocabulary.'),description:t('Your words are stored privately in your account.'),link:'#/vocabulary',label:t('View vocabulary')}));}
  });
  return page;
}

function metric(symbol, label, value, hint) {
  return `<article class="card metric"><div class="metric-top"><span class="metric-icon">${icon(symbol)}</span><span>${label}</span></div><strong class="metric-value">${value}</strong><p>${hint}</p></article>`;
}
function summary(symbol, label, count) {
  return `<div class="summary-row"><span>${icon(symbol)} ${label}</span><strong>${count}</strong></div>`;
}
