export const routes = [
  { id: 'dashboard', title: 'Dashboard', icon: 'dashboard', phase: 1, group: 'learn' },
  { id:'login', title:'Sign in', icon:'settings', phase:2, group:'auth' },
  { id: 'vocabulary', title: 'Vocabulary', icon: 'book', phase: 3, group: 'learn', description: 'Your Arabic words, meanings, and notes will live here.' },
  { id: 'add-word', title: 'Add Word', icon: 'plus', phase: 3, group: 'learn', description: 'Quick Add and full word entry will help you capture what you learn.' },
  { id: 'review', title: 'Review', icon: 'review', phase: 6, group: 'learn', description: 'Review due vocabulary with flashcards and a fixed revision schedule.' },
  { id: 'quiz', title: 'Daily Quiz', icon: 'quiz', phase: 7, group: 'learn', description: 'Practice recall with questions based on your saved vocabulary.' },
  { id: 'weak-words', title: 'Weak Words', icon: 'weak', phase: 8, group: 'collection', description: 'Words that need extra practice will appear here after reviews and quizzes.' },
  { id: 'mastered', title: 'Mastered', icon: 'mastered', phase: 8, group: 'collection', description: 'Track words you know well and keep them fresh with occasional reviews.' },
  { id: 'favorites', title: 'Favorites', icon: 'heart', phase: 3, group: 'collection', description: 'Keep important vocabulary close by marking words as favorites.' },
  { id: 'tags', title: 'Tags / Decks', icon: 'tag', phase: 3, group: 'collection', description: 'Organize your vocabulary by lesson, topic, or collection.' },
  { id: 'history', title: 'History', icon: 'history', phase: 9, group: 'tools', description: 'Explore your review activity and learning history.' },
  { id: 'statistics', title: 'Statistics', icon: 'chart', phase: 9, group: 'tools', description: 'See your progress, accuracy, and study streak over time.' },
  { id: 'import-export', title: 'Import / Export', icon: 'export', phase: 13, group: 'tools', description: 'Back up your learning data and bring in vocabulary from JSON or CSV.' },
  { id: 'settings', title: 'Settings', icon: 'settings', phase: 2, group: 'tools', description: 'Account and base settings begin in Phase 2. Revision, quiz, display, and reminder controls arrive with their respective phases.' },
];

export function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  return routes.find(route => route.id === id);
}

export function startRouter(onNavigate) {
  function navigate() {
    let route = currentRoute();
    if (!route) {
      history.replaceState(null, '', `${location.pathname}${location.search}#/dashboard`);
      route = routes[0];
    }
    onNavigate(route);
  }
  window.addEventListener('hashchange', navigate);
  navigate();
}
