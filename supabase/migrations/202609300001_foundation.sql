-- Phase 2 foundation. Run once using Supabase migrations or SQL Editor.
begin;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create function app_private.valid_timezone(value text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = value);
$$;

create function app_private.valid_schedule(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare stage jsonb;
begin
  if jsonb_typeof(value) <> 'object'
    or jsonb_typeof(value->'intervals') <> 'array'
    or jsonb_array_length(value->'intervals') not between 1 and 30
    or jsonb_typeof(value->'repeat_days') <> 'number'
    or jsonb_typeof(value->'version') <> 'number' then return false; end if;
  if (value->>'repeat_days')::numeric not between 1 and 3650
    or (value->>'repeat_days')::numeric <> trunc((value->>'repeat_days')::numeric)
    or (value->>'version')::numeric < 1
    or (value->>'version')::numeric <> trunc((value->>'version')::numeric) then return false; end if;
  for stage in select * from jsonb_array_elements(value->'intervals') loop
    if jsonb_typeof(stage) <> 'number' or stage::text::numeric not between 1 and 3650
      or stage::text::numeric <> trunc(stage::text::numeric) then return false; end if;
  end loop;
  return value ?& array['intervals','repeat_days','version'];
exception when others then return false;
end;
$$;

create function app_private.valid_conjugations(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item record; tense record;
begin
  if jsonb_typeof(value) <> 'object' then return false; end if;
  for item in select * from jsonb_each(value) loop
    if item.key <> all(array['huwa','huma_m','hum','hiya','huma_f','hunna','anta','antuma_m','antum','anti','antuma_f','antunna','ana','nahnu'])
      or jsonb_typeof(item.value) <> 'object' then return false; end if;
    for tense in select * from jsonb_each(item.value) loop
      if tense.key <> all(array['past','present','imperative'])
        or jsonb_typeof(tense.value) <> 'string' or length(tense.value #>> '{}') > 200 then return false; end if;
      if tense.key = 'imperative' and item.key <> all(array['anta','antuma_m','antum','anti','antuma_f','antunna']) then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

create function app_private.touch_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := old.created_at;
  new.updated_at := clock_timestamp();
  new.revision := old.revision + 1;
  return new;
end;
$$;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0)
);

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ui_language text not null default 'en' check (ui_language in ('en','bn')),
  timezone text not null default 'UTC' check (app_private.valid_timezone(timezone)),
  revision_algorithm text not null default 'fixed' check (revision_algorithm in ('fixed','adaptive')),
  revision_schedule jsonb not null default '{"version":1,"intervals":[1,3,7,15,30],"repeat_days":30}'
    check (app_private.valid_schedule(revision_schedule)),
  rating_behavior jsonb not null default '{"again_days":1,"hard_factor":0.5,"easy_skip":1}' check (jsonb_typeof(rating_behavior) = 'object'),
  mastery_thresholds jsonb not null default '{"successful_reviews":5,"accuracy":80,"require_long_term":true}' check (jsonb_typeof(mastery_thresholds) = 'object'),
  daily_goals jsonb not null default '{"new_words":5,"reviews":null,"quiz_questions":10}' check (jsonb_typeof(daily_goals) = 'object'),
  quiz_options jsonb not null default '{"question_count":10,"types":["arabic_bangla","arabic_english"],"weak_percentage":30,"include_mastered":true,"include_new":true}' check (jsonb_typeof(quiz_options) = 'object'),
  harakah_mode text not null default 'always_show' check (harakah_mode in ('always_show','hide_quiz','always_hide')),
  arabic_font_size integer not null default 38 check (arabic_font_size between 24 and 80),
  future_prefix text not null default 'sa' check (future_prefix in ('sa','sawfa')),
  notification_preferences jsonb not null default '{"enabled":false,"morning":"09:00","evening":"20:00","review":true,"quiz":true}' check (jsonb_typeof(notification_preferences) = 'object'),
  appearance text not null default 'light' check (appearance = 'light'),
  onboarding_progress jsonb not null default '{}' check (jsonb_typeof(onboarding_progress) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0)
);

create table public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  arabic_word text not null check (length(trim(arabic_word)) between 1 and 200),
  normalized_arabic text not null check (length(trim(normalized_arabic)) between 1 and 200),
  normalization_version integer not null default 1 check (normalization_version > 0),
  arabic_meaning text not null default '',
  bangla_meaning text not null check (length(trim(bangla_meaning)) between 1 and 2000),
  english_meaning text not null check (length(trim(english_meaning)) between 1 and 2000),
  transliteration text not null default '',
  word_type text not null default 'other' check (word_type in ('verb','noun','adjective','particle','phrase','other')),
  root text[] not null default '{}' check (cardinality(root) in (0,3,4)),
  root_meaning text not null default '',
  wazn text not null default '',
  verb_form integer check (verb_form between 1 and 10),
  masdars text[] not null default '{}',
  past_base text not null default '', present_base text not null default '',
  imperative text not null default '', active_participle text not null default '', passive_participle text not null default '',
  example_arabic text not null default '', example_bangla text not null default '', example_english text not null default '',
  notes text not null default '',
  favorite boolean not null default false,
  needs_details boolean not null default true,
  custom_audio_path text,
  morphology jsonb not null default '{}' check (jsonb_typeof(morphology) = 'object'),
  conjugations jsonb not null default '{}' check (app_private.valid_conjugations(conjugations)),
  linguistic_provenance text not null default 'manual' check (linguistic_provenance in ('manual','teacher','import','ai_suggestion')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0), deleted_at timestamptz,
  unique (id,user_id),
  check (word_type = 'verb' or (verb_form is null and conjugations = '{}'::jsonb))
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  normalized_name text generated always as (lower(trim(name))) stored,
  kind text not null default 'tag' check (kind in ('tag','deck')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0), deleted_at timestamptz,
  unique(id,user_id)
);
create unique index tags_active_name on public.tags(user_id,kind,normalized_name) where deleted_at is null;

create table public.word_tags (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  word_id uuid not null, tag_id uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0), deleted_at timestamptz,
  primary key(word_id,tag_id,user_id),
  foreign key(word_id,user_id) references public.words(id,user_id) on delete cascade,
  foreign key(tag_id,user_id) references public.tags(id,user_id) on delete cascade
);

create table public.word_review_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  word_id uuid not null,
  algorithm text not null default 'fixed' check (algorithm in ('fixed','adaptive')),
  algorithm_version integer not null default 1 check (algorithm_version > 0),
  schedule_version integer not null default 1 check (schedule_version > 0),
  stage integer not null default 0 check (stage >= 0),
  interval_days integer not null default 1 check (interval_days between 1 and 3650),
  next_review_at timestamptz not null,
  last_reviewed_at timestamptz,
  review_count integer not null default 0 check (review_count >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  incorrect_count integer not null default 0 check (incorrect_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  weak_score numeric not null default 0 check (weak_score between 0 and 1000000),
  mastery_status text not null default 'new' check (mastery_status in ('new','learning','reviewing','mastered')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0), deleted_at timestamptz,
  primary key(word_id,user_id,algorithm),
  foreign key(word_id,user_id) references public.words(id,user_id) on delete cascade,
  check (correct_count + incorrect_count = review_count and success_count <= correct_count)
);

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  kind text not null check (kind in ('review','quiz','practice','vocabulary')),
  started_at timestamptz not null, completed_at timestamptz,
  timezone text not null check (app_private.valid_timezone(timezone)),
  local_study_date date not null,
  activity_counts jsonb not null default '{}' check (jsonb_typeof(activity_counts) = 'object'),
  recorded boolean not null default true,
  created_at timestamptz not null default now(),
  unique(id,user_id), unique(user_id,operation_id),
  check (completed_at is null or completed_at >= started_at)
);

create table public.review_history (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  word_id uuid not null, session_id uuid,
  operation_id uuid not null,
  occurred_at timestamptz not null, received_at timestamptz not null default now(),
  algorithm text not null check (algorithm in ('fixed','adaptive')),
  algorithm_version integer not null check (algorithm_version > 0),
  schedule_snapshot jsonb not null check (app_private.valid_schedule(schedule_snapshot)),
  prior_stage integer not null check (prior_stage >= 0), prior_interval integer not null check (prior_interval > 0), prior_due_at timestamptz,
  rating text not null check (rating in ('again','hard','good','easy')),
  new_stage integer not null check (new_stage >= 0), new_interval integer not null check (new_interval > 0), next_review_at timestamptz not null,
  response_ms integer check (response_ms >= 0),
  activity_mode text not null default 'scheduled' check (activity_mode in ('scheduled','recorded_practice')),
  created_at timestamptz not null default now(),
  unique(user_id,operation_id),
  foreign key(word_id,user_id) references public.words(id,user_id) on delete restrict,
  foreign key(session_id,user_id) references public.study_sessions(id,user_id) on delete restrict
);

create table public.quiz_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  started_at timestamptz not null, completed_at timestamptz,
  timezone text not null check (app_private.valid_timezone(timezone)),
  settings_snapshot jsonb not null check (jsonb_typeof(settings_snapshot) = 'object'),
  score integer not null default 0 check (score >= 0), question_count integer not null check (question_count > 0),
  created_at timestamptz not null default now(),
  unique(id,user_id), unique(user_id,operation_id),
  check (score <= question_count), check (completed_at is null or completed_at >= started_at)
);
create table public.quiz_answers (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null, word_id uuid not null, operation_id uuid not null,
  question_type text not null check (question_type in ('arabic_bangla','arabic_english','bangla_arabic','english_arabic','arabic_typing','root','masdar','verb_form','conjugation','fill_blank','multiple_choice','true_false')),
  question_snapshot jsonb not null check (jsonb_typeof(question_snapshot) = 'object'),
  expected_answer jsonb not null, submitted_answer jsonb not null,
  correct boolean not null, response_ms integer check (response_ms >= 0),
  created_at timestamptz not null default now(),
  unique(user_id,operation_id),
  foreign key(session_id,user_id) references public.quiz_sessions(id,user_id) on delete restrict,
  foreign key(word_id,user_id) references public.words(id,user_id) on delete restrict
);
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'), p256dh text not null, auth_key text not null,
  enabled boolean not null default true, last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0), deleted_at timestamptz
);

-- Only server-side transactional RPCs may write counters and learning events in later phases.
create table app_private.sync_operations (
  user_id uuid not null references auth.users(id) on delete cascade, operation_id uuid not null,
  payload_hash text not null, result jsonb not null, applied_at timestamptz not null default now(),
  primary key(user_id,operation_id)
);
create table app_private.notification_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade, local_date date not null, reminder_slot text not null,
  status text not null check (status in ('pending','sending','sent','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0), lease_until timestamptz, sent_at timestamptz,
  primary key(user_id,local_date,reminder_slot)
);

create function app_private.initialize_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id) values(new.id) on conflict do nothing;
  insert into public.user_settings(user_id) values(new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger arabic_journey_new_user after insert on auth.users
for each row execute function app_private.initialize_user();
-- Include accounts created before this migration.
insert into public.profiles(user_id) select id from auth.users on conflict do nothing;
insert into public.user_settings(user_id) select id from auth.users on conflict do nothing;

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles','user_settings','words','tags','word_tags','word_review_state','push_subscriptions'] loop
    execute format('create trigger touch_revision before update on public.%I for each row execute function app_private.touch_revision()',table_name);
  end loop;
  foreach table_name in array array['profiles','user_settings','words','tags','word_tags','word_review_state','review_history','quiz_sessions','quiz_answers','study_sessions','push_subscriptions'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public, anon, authenticated',table_name);
    execute format('grant select on public.%I to authenticated',table_name);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid()) = user_id)',table_name);
  end loop;
  foreach table_name in array array['profiles','user_settings'] loop
    execute format('create policy owner_update on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',table_name);
  end loop;
end;
$$;

-- Phase 2 deliberately grants no vocabulary/history/notification writes.
-- Phase 3+ migrations add least-privilege writes when their operations exist.
grant update(display_name) on public.profiles to authenticated;
grant update(ui_language,timezone) on public.user_settings to authenticated;
grant usage on schema app_private to authenticated;
revoke all on all functions in schema app_private from public,anon,authenticated;
grant execute on function app_private.valid_timezone(text) to authenticated;
grant execute on function app_private.valid_schedule(jsonb) to authenticated;
grant execute on function app_private.valid_conjugations(jsonb) to authenticated;
alter table app_private.sync_operations enable row level security;
alter table app_private.notification_deliveries enable row level security;
revoke all on app_private.sync_operations,app_private.notification_deliveries from public,anon,authenticated;

-- Atomic account/settings save with revision checks; no hidden last-write-wins.
create function public.save_base_settings(p_display_name text, p_timezone text, p_ui_language text,
  p_profile_revision bigint, p_settings_revision bigint) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare profile public.profiles; settings public.user_settings;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.profiles set display_name = trim(p_display_name)
    where user_id = auth.uid() and revision = p_profile_revision returning * into profile;
  if not found then raise exception 'Profile changed; reload before saving' using errcode = '40001'; end if;
  update public.user_settings set timezone = p_timezone, ui_language = p_ui_language
    where user_id = auth.uid() and revision = p_settings_revision returning * into settings;
  if not found then raise exception 'Settings changed; reload before saving' using errcode = '40001'; end if;
  return jsonb_build_object('profile',to_jsonb(profile),'settings',to_jsonb(settings));
end;
$$;
revoke all on function public.save_base_settings(text,text,text,bigint,bigint) from public,anon;
grant execute on function public.save_base_settings(text,text,text,bigint,bigint) to authenticated;

create index words_owner_created on public.words(user_id,created_at desc) where deleted_at is null;
create index words_owner_type on public.words(user_id,word_type) where deleted_at is null;
create index words_owner_normalized on public.words(user_id,normalized_arabic) where deleted_at is null;
create index words_owner_root on public.words using gin(root) where deleted_at is null;
create index words_owner_favorites on public.words(user_id,created_at desc) where favorite and deleted_at is null;
create index word_tags_owner_tag on public.word_tags(user_id,tag_id) where deleted_at is null;
create index review_state_owner_due on public.word_review_state(user_id,next_review_at) where deleted_at is null;
create index review_state_owner_weak on public.word_review_state(user_id,weak_score desc) where deleted_at is null;
create index review_history_owner_date on public.review_history(user_id,occurred_at desc);
create index review_history_word on public.review_history(word_id,user_id);
create index quiz_sessions_owner_date on public.quiz_sessions(user_id,started_at desc);
create index quiz_answers_owner_session on public.quiz_answers(user_id,session_id);
create index quiz_answers_word on public.quiz_answers(word_id,user_id);
create index study_sessions_owner_date on public.study_sessions(user_id,local_study_date desc);
create index push_owner_enabled on public.push_subscriptions(user_id) where enabled and deleted_at is null;
commit;
