// Version 1 matches the Phase 3 server comparison; originals are never rewritten.
export const normalizationVersion = 1;
const marks = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/gu;
export function removeHarakah(value = '') { return String(value).replace(marks, ''); }
export function normalizeArabic(value = '', { ignoreHarakah = true, ignoreTatweel = true, unicode = true } = {}) {
  let result = String(value);
  if (unicode) result = result.normalize('NFKC');
  if (ignoreHarakah) result = removeHarakah(result);
  if (ignoreTatweel) result = result.replace(/\u0640/gu, '');
  // PostgreSQL's version-1 whitespace class excludes non-breaking spaces/BOM
  // unless NFKC converts them. Keep that rule stable for existing duplicates.
  return result.replace(/[\u0009-\u000d\u0020\u0085\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+/gu, ' ').replace(/^ +| +$/gu,'');
}
export function arabicEquals(answer,expected,options) {
  const normalized=normalizeArabic(expected,options);
  return !!normalized&&normalizeArabic(answer,options)===normalized;
}
export function displayArabic(value, { mode = 'always_show', quiz = false, revealed = false } = {}) {
  return mode === 'always_hide' || (mode === 'hide_quiz' && quiz && !revealed)
    ? removeHarakah(value) : String(value || '');
}
export function futureArabic(present = '', prefix = 'sa') {
  const value = String(present).trim();
  return value ? (prefix === 'sawfa' ? 'سَوْفَ ' : 'سَ') + value : '';
}
export function parseRoot(value = '') {
  const normalized = normalizeArabic(value).replace(/[،,\-—]/gu, ' ').trim();
  if (!normalized) return [];
  const pieces = normalized.split(/\s+/u);
  const letters = pieces.length === 1 ? [...pieces[0]] : pieces;
  if (![3,4].includes(letters.length) || letters.some(letter => !/^[ء-غف-يٮٯٱ-ۓ]$/u.test(letter))) {
    throw new Error('invalid_root');
  }
  return letters;
}
export function parseArabicList(value = '') {
  const items = String(value).split(/\r?\n|[,،]/u).map(item => item.trim()).filter(Boolean);
  if (items.length > 20 || items.some(item => [...item].length > 200)) throw new Error('invalid_arabic_list');
  return items;
}
export const pronouns = [
  ['huwa','هُوَ','He',false], ['huma_m','هُمَا','They two (masculine)',false], ['hum','هُمْ','They (masculine)',false],
  ['hiya','هِيَ','She',false], ['huma_f','هُمَا','They two (feminine)',false], ['hunna','هُنَّ','They (feminine)',false],
  ['anta','أَنْتَ','You (masculine)',true], ['antuma_m','أَنْتُمَا','You two (masculine)',true], ['antum','أَنْتُمْ','You all (masculine)',true],
  ['anti','أَنْتِ','You (feminine)',true], ['antuma_f','أَنْتُمَا','You two (feminine)',true], ['antunna','أَنْتُنَّ','You all (feminine)',true],
  ['ana','أَنَا','I',false], ['nahnu','نَحْنُ','We',false],
].map(([id,arabic,label,imperative])=>({id,arabic,label,imperative}));
