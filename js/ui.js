const paths = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  book: '<path d="M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1Zm0 0v15"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  review: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/><path d="m9 12 2 2 4-4"/>',
  quiz: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zM9 12h6m-6 4h4"/>',
  weak: '<path d="m12 3 9 17H3L12 3Z"/><path d="M12 9v4m0 3v.1"/>',
  mastered: '<circle cx="12" cy="9" r="6"/><path d="m8 14-1 7 5-3 5 3-1-7m-7-6 2 2 4-4"/>',
  heart: '<path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-5 5 8 14 8 14S25 10 20 5Z"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11V3Z"/><circle cx="7.5" cy="7.5" r=".8"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M4 3v17h17M8 16v-4m5 4V7m5 9V4"/>',
  export: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  sprout: '<path d="M12 21v-9C12 6 6 4 3 5c0 5 3 9 9 9m0-2c0-5 4-8 9-8 0 5-3 8-9 8"/>',
  flame: '<path d="M13 3c1 6-5 7-3 11 2-1 3-3 3-5 4 3 7 6 5 10-2 4-10 4-12-1-2-5 3-7 7-15Z"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};

export function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
}

export function emptyState({ symbol = 'book', title, description, link, label }) {
  const section = document.createElement('div');
  section.className = 'empty-state';
  section.innerHTML = `<span class="empty-icon">${icon(symbol)}</span><h3></h3><p></p>`;
  section.querySelector('h3').textContent = title;
  section.querySelector('p').textContent = description;
  if (link) {
    const anchor = document.createElement('a');
    anchor.className = 'text-link';
    anchor.href = link;
    anchor.textContent = label;
    section.append(anchor);
  }
  return section;
}

let returnFocus;
export function showModal(title, content) {
  const dialog = document.getElementById('app-dialog');
  returnFocus = document.activeElement;
  document.getElementById('dialog-title').textContent = title;
  document.getElementById('dialog-content').replaceChildren(content);
  if (!dialog.open) dialog.showModal();
}

export function initializeModal() {
  const dialog = document.getElementById('app-dialog');
  const close = document.getElementById('dialog-close');
  close.innerHTML = icon('close');
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    }
  });
  dialog.addEventListener('close', () => {
    if (returnFocus?.isConnected) returnFocus.focus();
  });
}
