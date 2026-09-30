import { icon } from '../ui.js';
import { t } from '../i18n.js';

export function futurePage(route) {
  const page = document.createElement('div');
  page.className = 'page future-page';
  page.innerHTML = `<div class="page-heading"><div><p class="eyebrow">YOUR LEARNING SPACE</p><h1></h1><p class="page-description"></p></div></div><section class="card availability-card"><span class="empty-icon">${icon(route.icon)}</span><span class="pill"></span><h2>This space is ready for the next step.</h2><p class="availability-copy"></p><a class="button button-primary" href="#/dashboard">Back to dashboard ${icon('arrow')}</a></section>`;
  page.querySelector('h1').textContent = route.title;
  page.querySelector('.page-description').textContent = route.description;
  page.querySelector('.pill').textContent = t('Planned for Phase {phase}',{phase:route.phase});
  page.querySelector('.availability-copy').textContent = 'This feature will become available in its planned development phase.';
  return page;
}
