import { vocabularyClient, getAccount, errorMessage } from './supabase.js';

export async function vocabularyRequest(work) {
  const owner = getAccount().user?.id;
  const client = vocabularyClient();
  const { data, error } = await work(client);
  if (getAccount().user?.id !== owner || getAccount().status !== 'ready') throw new Error('session_expired');
  if (error) throw error;
  return data;
}
export function listWords(filters = {}) {
  return vocabularyRequest(client => client.rpc('vocabulary_list', {
    p_search: filters.search || '', p_type: filters.type || '', p_status: filters.status || '',
    p_tag: filters.tag || null, p_favorite: !!filters.favorite,
    p_from: filters.from || null, p_to: filters.to || null, p_page: filters.page || 0,
    p_root: filters.root || '', p_harakah: filters.harakah ?? true,
    p_tatweel: filters.tatweel ?? true, p_unicode: filters.unicode ?? true,
  }));
}
export async function listTags() {
  const tags = [];
  for (let offset = 0; ; offset += 1000) {
    const batch = await vocabularyRequest(client => client.from('tags').select('id,name,kind,revision')
      .is('deleted_at',null).order('name').order('id').range(offset,offset+999));
    tags.push(...batch);
    if (batch.length < 1000) return tags;
  }
}
export async function getWord(id) {
  const [word, links] = await Promise.all([
    vocabularyRequest(client => client.from('words').select('*').eq('id',id).is('deleted_at',null).single()),
    vocabularyRequest(client => client.from('word_tags').select('tag_id').eq('word_id',id).is('deleted_at',null)),
  ]);
  return { ...word, tags: links.map(link=>link.tag_id) };
}
export function writeVocabulary({ operation = crypto.randomUUID(), action, id, revision = null, values = {}, tags = [], allowDuplicate = false }) {
  return vocabularyRequest(client => client.rpc('vocabulary_write', {
    p_operation:operation,p_action:action,p_id:id,p_revision:revision,p_values:values,
    p_tags:tags,p_allow_duplicate:allowDuplicate,
  }));
}
export function vocabularyError(error) {
  if(error?.message==='invalid_root')return 'Enter exactly 3 or 4 Arabic root letters.';
  if(error?.message==='invalid_arabic_list')return 'Use up to 20 items, with at most 200 characters each.';
  if (error?.code === '40001') return 'This item changed on another device. Your draft is kept. Open the latest item before saving again.';
  if (error?.code === '23505') return 'That tag or deck name already exists.';
  if (['23514','23502','22023','22P02'].includes(error?.code)) return 'Check the required fields and selected tags, then try again.';
  if (['PGRST202','42883'].includes(error?.code)) return 'Vocabulary is unavailable. Apply the Phase 4 database migration.';
  if (error?.code === 'PGRST116') return 'This word is unavailable or has been deleted.';
  return errorMessage(error);
}
