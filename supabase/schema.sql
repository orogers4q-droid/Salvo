-- Salvo database. Paste this whole file into Supabase > SQL Editor > New query, then Run.
-- Safe to run more than once: it only adds what's missing and refreshes the rules.

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  pen_name text not null unique check (char_length(pen_name) between 2 and 40),
  created_at timestamptz not null default now()
);

create table if not exists stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  blurb text not null check (char_length(blurb) <= 400),
  tags text[] not null default '{}',
  hidden boolean not null default false,          -- set true to take a story down
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chapters (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories on delete cascade,
  n int not null,
  title text not null check (char_length(title) between 1 and 100),
  body text not null check (char_length(body) <= 100000),
  word_count int not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (story_id, n)
);

create table if not exists follows (
  user_id uuid not null references profiles on delete cascade,
  story_id uuid not null references stories on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, story_id)
);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users on delete set null,
  target_type text not null check (target_type in ('story','chapter','comment')),
  target_id uuid not null,
  reason text not null,
  details text check (char_length(details) <= 2000),
  status text not null default 'open',            -- open / actioned / dismissed
  created_at timestamptz not null default now()
);

create index if not exists stories_updated_idx on stories (updated_at desc);
create index if not exists chapters_story_idx on chapters (story_id, n);
create index if not exists comments_chapter_idx on comments (chapter_id, created_at);

-- Posting a chapter moves its story to the top of "Latest updates".
create or replace function bump_story() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update stories set updated_at = now() where id = new.story_id;
  return new;
end $$;
drop trigger if exists chapters_bump on chapters;
create trigger chapters_bump after insert on chapters for each row execute function bump_story();

-- Row level security: anyone can read what isn't hidden; people can only change their own things.
alter table profiles enable row level security;
alter table stories  enable row level security;
alter table chapters enable row level security;
alter table follows  enable row level security;
alter table comments enable row level security;
alter table reports  enable row level security;

drop policy if exists "profiles readable" on profiles;
create policy "profiles readable" on profiles for select using (true);
drop policy if exists "own profile insert" on profiles;
create policy "own profile insert" on profiles for insert with check (auth.uid() = id);
drop policy if exists "own profile update" on profiles;
create policy "own profile update" on profiles for update using (auth.uid() = id);

drop policy if exists "stories readable" on stories;
create policy "stories readable" on stories for select using (not hidden or author_id = auth.uid());
drop policy if exists "own story insert" on stories;
create policy "own story insert" on stories for insert with check (author_id = auth.uid());
drop policy if exists "own story update" on stories;
create policy "own story update" on stories for update using (author_id = auth.uid()) with check (author_id = auth.uid() and hidden = false);
drop policy if exists "own story delete" on stories;
create policy "own story delete" on stories for delete using (author_id = auth.uid());

drop policy if exists "chapters readable" on chapters;
create policy "chapters readable" on chapters for select using (
  not hidden and exists (select 1 from stories s where s.id = story_id and not s.hidden)
  or exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid()));
drop policy if exists "author chapter insert" on chapters;
create policy "author chapter insert" on chapters for insert with check (
  exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid()));
drop policy if exists "author chapter update" on chapters;
create policy "author chapter update" on chapters for update using (
  exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid())) with check (hidden = false);
drop policy if exists "author chapter delete" on chapters;
create policy "author chapter delete" on chapters for delete using (
  exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid()));

drop policy if exists "follows readable" on follows;
create policy "follows readable" on follows for select using (true);
drop policy if exists "own follow insert" on follows;
create policy "own follow insert" on follows for insert with check (user_id = auth.uid());
drop policy if exists "own follow delete" on follows;
create policy "own follow delete" on follows for delete using (user_id = auth.uid());

drop policy if exists "comments readable" on comments;
create policy "comments readable" on comments for select using (not hidden or user_id = auth.uid());
drop policy if exists "own comment insert" on comments;
create policy "own comment insert" on comments for insert with check (user_id = auth.uid());
drop policy if exists "own comment delete" on comments;
create policy "own comment delete" on comments for delete using (user_id = auth.uid());

-- Reports can be sent by signed-in people; only you (in the Supabase dashboard) can read them.
drop policy if exists "send report" on reports;
create policy "send report" on reports for insert with check (reporter_id = auth.uid());

-- ---------------- Owner stats ----------------
-- Only people listed in admins can open the Stats page. Add yourself after you sign up once:
--   insert into admins (user_id) select id from auth.users where email = 'you@example.com';
create table if not exists admins (user_id uuid primary key references auth.users on delete cascade);
alter table admins enable row level security;
drop policy if exists "admins see self" on admins;
create policy "admins see self" on admins for select using (user_id = auth.uid());

create or replace function site_stats() returns json language plpgsql security definer set search_path = public as $$
declare r json;
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'Not allowed';
  end if;
  select json_build_object(
    'accounts',     (select count(*) from auth.users),
    'authors',      (select count(distinct author_id) from stories),
    'stories',      (select count(*) from stories),
    'chapters',     (select count(*) from chapters),
    'comments',     (select count(*) from comments),
    'follows',      (select count(*) from follows),
    'open_reports', (select count(*) from reports where status = 'open'),
    'new_7d',       (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'active_7d',    (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'daily', (select json_agg(json_build_object('day', d::date,
                'n', (select count(*) from auth.users u where u.created_at::date = d::date)) order by d)
              from generate_series(current_date - 13, current_date, interval '1 day') d)
  ) into r;
  return r;
end $$;
revoke execute on function site_stats() from public, anon;
grant execute on function site_stats() to authenticated;

-- ---------------- API access ----------------
-- Lets the site's public key reach these tables. The row rules above still decide what each person can see or change.
grant usage on schema public to anon, authenticated;
grant select on profiles, stories, chapters, follows, comments to anon, authenticated;
grant insert, update, delete on profiles, stories, chapters, follows, comments to authenticated;
grant insert on reports to authenticated;
grant select on admins to authenticated;

-- ---------------- Author's notes and view counts (added 2026-11-23) ----------------
-- 1. Author's note on each chapter (optional).
alter table chapters add column if not exists author_note text check (char_length(author_note) <= 5000);

-- 2. View counts per chapter.
create table if not exists chapter_stats (
  chapter_id uuid primary key references chapters on delete cascade,
  views bigint not null default 0
);
alter table chapter_stats enable row level security;
-- Only the story's author can read its numbers. Nobody can write them directly.
drop policy if exists "author reads own views" on chapter_stats;
create policy "author reads own views" on chapter_stats for select using (
  exists (select 1 from chapters c join stories s on s.id = c.story_id where c.id = chapter_id and s.author_id = auth.uid()));
grant select on chapter_stats to authenticated;

-- Readers add a view through this function only (one per chapter per browser, counted by the site).
create or replace function record_view(ch uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from chapters c join stories s on s.id = c.story_id
             where c.id = ch and not c.hidden and not s.hidden and s.author_id is distinct from auth.uid()) then
    insert into chapter_stats (chapter_id, views) values (ch, 1)
    on conflict (chapter_id) do update set views = chapter_stats.views + 1;
  end if;
end $$;
revoke execute on function record_view(uuid) from public;
grant execute on function record_view(uuid) to anon, authenticated;

-- 3. Owner stats now include total chapter views (still owner-only).
create or replace function site_stats() returns json language plpgsql security definer set search_path = public as $$
declare r json;
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'Not allowed';
  end if;
  select json_build_object(
    'accounts',     (select count(*) from auth.users),
    'authors',      (select count(distinct author_id) from stories),
    'stories',      (select count(*) from stories),
    'chapters',     (select count(*) from chapters),
    'comments',     (select count(*) from comments),
    'follows',      (select count(*) from follows),
    'views',        (select coalesce(sum(views), 0) from chapter_stats),
    'open_reports', (select count(*) from reports where status = 'open'),
    'new_7d',       (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'active_7d',    (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'daily', (select json_agg(json_build_object('day', d::date,
                'n', (select count(*) from auth.users u where u.created_at::date = d::date)) order by d)
              from generate_series(current_date - 13, current_date, interval '1 day') d)
  ) into r;
  return r;
end $$;
revoke execute on function site_stats() from public, anon;
grant execute on function site_stats() to authenticated;


-- ---------------- Security (added 2026-11-23) ----------------
-- 1. Only you (in the Supabase dashboard) can hide or un-hide stories, chapters and comments.
--    Before this, an author could un-hide something you had taken down.
create or replace function keep_hidden() returns trigger language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.hidden := old.hidden;
  end if;
  return new;
end $$;
drop trigger if exists stories_keep_hidden on stories;
create trigger stories_keep_hidden before update on stories for each row execute function keep_hidden();
drop trigger if exists chapters_keep_hidden on chapters;
create trigger chapters_keep_hidden before update on chapters for each row execute function keep_hidden();
drop trigger if exists comments_keep_hidden on comments;
create trigger comments_keep_hidden before update on comments for each row execute function keep_hidden();

-- 2. Spam brakes: limits on how fast one account can post. Generous for real people, annoying for bots.
create or replace function limit_rate() returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return new; end if;   -- you, working in the dashboard
  if tg_table_name = 'comments' then
    select count(*) into n from comments where user_id = auth.uid() and created_at > now() - interval '1 minute';
    if n >= 5 then raise exception 'Slow down: please wait a minute before commenting again.'; end if;
  elsif tg_table_name = 'stories' then
    select count(*) into n from stories where author_id = auth.uid() and created_at > now() - interval '1 day';
    if n >= 5 then raise exception 'You can start up to 5 new stories a day.'; end if;
  elsif tg_table_name = 'chapters' then
    select count(*) into n from chapters c join stories s on s.id = c.story_id
      where s.author_id = auth.uid() and c.created_at > now() - interval '1 hour';
    if n >= 20 then raise exception 'You can post up to 20 chapters an hour.'; end if;
  elsif tg_table_name = 'reports' then
    select count(*) into n from reports where reporter_id = auth.uid() and created_at > now() - interval '1 hour';
    if n >= 10 then raise exception 'Too many reports in an hour. Please try again later.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists comments_rate on comments;
create trigger comments_rate before insert on comments for each row execute function limit_rate();
drop trigger if exists stories_rate on stories;
create trigger stories_rate before insert on stories for each row execute function limit_rate();
drop trigger if exists chapters_rate on chapters;
create trigger chapters_rate before insert on chapters for each row execute function limit_rate();
drop trigger if exists reports_rate on reports;
create trigger reports_rate before insert on reports for each row execute function limit_rate();

-- ---------------- Covers and suggestion box (added 2026-11-23) ----------------
-- ---------------- Cover images ----------------
-- Covers may only point at this project's own "covers" storage, so nobody can link outside images.
alter table stories add column if not exists cover_url text
  check (cover_url is null or (char_length(cover_url) < 500 and cover_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/covers/'));

-- Public bucket: anyone can view covers; images only, 2 MB max.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Each person can only upload into (and delete from) their own folder.
drop policy if exists "salvo covers upload own" on storage.objects;
create policy "salvo covers upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "salvo covers delete own" on storage.objects;
create policy "salvo covers delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------- Suggestion box ----------------
create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,   -- empty for visitors who aren't signed in
  body text not null check (char_length(body) between 3 and 3000),
  contact text check (char_length(contact) <= 200),        -- optional: how to reach them
  page text check (char_length(page) <= 200),              -- which page they were on
  status text not null default 'new' check (status in ('new', 'read', 'archived')),
  created_at timestamptz not null default now()
);
alter table suggestions enable row level security;

-- Anyone can send one (as themselves, or anonymously). Only owners (the admins list) can read or change them.
drop policy if exists "send suggestion" on suggestions;
create policy "send suggestion" on suggestions for insert with check (user_id is null or user_id = auth.uid());
drop policy if exists "owner reads suggestions" on suggestions;
create policy "owner reads suggestions" on suggestions for select using (exists (select 1 from admins a where a.user_id = auth.uid()));
drop policy if exists "owner updates suggestions" on suggestions;
create policy "owner updates suggestions" on suggestions for update using (exists (select 1 from admins a where a.user_id = auth.uid()));
drop policy if exists "owner deletes suggestions" on suggestions;
create policy "owner deletes suggestions" on suggestions for delete using (exists (select 1 from admins a where a.user_id = auth.uid()));
grant insert on suggestions to anon, authenticated;
grant select, update, delete on suggestions to authenticated;

-- Spam brake: 3 an hour per signed-in person, 30 an hour from all visitors combined.
create or replace function limit_suggestions() returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.role() is null then return new; end if;   -- you, working in the dashboard
  new.status := 'new';
  if auth.uid() is not null then
    select count(*) into n from suggestions where user_id = auth.uid() and created_at > now() - interval '1 hour';
    if n >= 3 then raise exception 'Thanks! You can send up to 3 suggestions an hour.'; end if;
  else
    select count(*) into n from suggestions where user_id is null and created_at > now() - interval '1 hour';
    if n >= 30 then raise exception 'The suggestion box is busy right now. Please try again later.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists suggestions_rate on suggestions;
create trigger suggestions_rate before insert on suggestions for each row execute function limit_suggestions();


-- ---------------- Discovery engine (added 2026-11-23) ----------------

-- ---------------- Columns ----------------
alter table stories add column if not exists cover_url text
  check (cover_url is null or (char_length(cover_url) < 500 and cover_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/covers/'));
-- Support link: only well-known tip/support sites, https only.
alter table stories add column if not exists support_url text
  check (support_url is null or (char_length(support_url) < 300 and support_url ~* '^https://(www\.)?(patreon\.com|ko-fi\.com|buymeacoffee\.com|paypal\.me|github\.com/sponsors|subscribestar\.com|subscribestar\.adult)/[^\s<>"]+$'));
-- Scheduling: empty = published when posted.
alter table chapters add column if not exists publish_at timestamptz;
-- When the reader last opened their Updates list.
alter table profiles add column if not exists updates_seen_at timestamptz not null default now();

-- Readers only see a chapter once its publish time has passed. Authors always see their own.
drop policy if exists "chapters readable" on chapters;
create policy "chapters readable" on chapters for select using (
  (not hidden and (publish_at is null or publish_at <= now())
     and exists (select 1 from stories s where s.id = story_id and not s.hidden))
  or exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid()));

-- ---------------- Ratings (1-5 stars, one per reader per story, changeable) ----------------
create table if not exists ratings (
  user_id uuid not null references profiles on delete cascade,
  story_id uuid not null references stories on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, story_id)
);
alter table ratings enable row level security;
drop policy if exists "ratings readable" on ratings;
create policy "ratings readable" on ratings for select using (true);
drop policy if exists "rate others' stories" on ratings;
create policy "rate others' stories" on ratings for insert with check (
  user_id = auth.uid() and not exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid()));
drop policy if exists "change own rating" on ratings;
create policy "change own rating" on ratings for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "remove own rating" on ratings;
create policy "remove own rating" on ratings for delete using (user_id = auth.uid());
grant select on ratings to anon, authenticated;
grant insert, update, delete on ratings to authenticated;

-- ---------------- Reviews (one per reader per story) ----------------
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  title text check (char_length(title) <= 120),
  body text not null check (char_length(body) between 20 and 10000),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (story_id, user_id)
);
alter table reviews enable row level security;
drop policy if exists "reviews readable" on reviews;
create policy "reviews readable" on reviews for select using (not hidden or user_id = auth.uid());
drop policy if exists "review others' stories" on reviews;
create policy "review others' stories" on reviews for insert with check (
  user_id = auth.uid() and not exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid()));
drop policy if exists "edit own review" on reviews;
create policy "edit own review" on reviews for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "delete own review" on reviews;
create policy "delete own review" on reviews for delete using (user_id = auth.uid());
grant select on reviews to anon, authenticated;
grant insert, update, delete on reviews to authenticated;
create index if not exists reviews_story_idx on reviews (story_id, created_at desc);

-- Takedowns stick on reviews too (same rule as stories, chapters, comments).
create or replace function keep_hidden() returns trigger language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.hidden := old.hidden;
  end if;
  return new;
end $$;
drop trigger if exists reviews_keep_hidden on reviews;
create trigger reviews_keep_hidden before update on reviews for each row execute function keep_hidden();

-- ---------------- Reading progress (signed-in readers, private) ----------------
create table if not exists reading_progress (
  user_id uuid not null references profiles on delete cascade,
  story_id uuid not null references stories on delete cascade,
  chapter_n int not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, story_id)
);
alter table reading_progress enable row level security;
drop policy if exists "own progress" on reading_progress;
create policy "own progress" on reading_progress for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on reading_progress to authenticated;

-- ---------------- Spam brakes (same limits as before, plus ratings and reviews) ----------------
create or replace function limit_rate() returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return new; end if;   -- you, working in the dashboard
  if tg_table_name = 'comments' then
    select count(*) into n from comments where user_id = auth.uid() and created_at > now() - interval '1 minute';
    if n >= 5 then raise exception 'Slow down: please wait a minute before commenting again.'; end if;
  elsif tg_table_name = 'stories' then
    select count(*) into n from stories where author_id = auth.uid() and created_at > now() - interval '1 day';
    if n >= 5 then raise exception 'You can start up to 5 new stories a day.'; end if;
  elsif tg_table_name = 'chapters' then
    select count(*) into n from chapters c join stories s on s.id = c.story_id
      where s.author_id = auth.uid() and c.created_at > now() - interval '1 hour';
    if n >= 20 then raise exception 'You can post up to 20 chapters an hour.'; end if;
  elsif tg_table_name = 'reports' then
    select count(*) into n from reports where reporter_id = auth.uid() and created_at > now() - interval '1 hour';
    if n >= 10 then raise exception 'Too many reports in an hour. Please try again later.'; end if;
  elsif tg_table_name = 'ratings' then
    select count(*) into n from ratings where user_id = auth.uid() and created_at > now() - interval '1 hour';
    if n >= 30 then raise exception 'Too many ratings in an hour. Please try again later.'; end if;
  elsif tg_table_name = 'reviews' then
    select count(*) into n from reviews where user_id = auth.uid() and created_at > now() - interval '1 day';
    if n >= 5 then raise exception 'You can post up to 5 reviews a day.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists ratings_rate on ratings;
create trigger ratings_rate before insert on ratings for each row execute function limit_rate();
drop trigger if exists reviews_rate on reviews;
create trigger reviews_rate before insert on reviews for each row execute function limit_rate();

-- ---------------- Discovery: one row per visible story with everything the lists sort by ----------------
-- security_invoker: the view follows the same visibility rules as the tables (hidden stories stay hidden).
drop view if exists story_cards;
create view story_cards with (security_invoker = true) as
select s.id, s.title, s.blurb, s.tags, s.cover_url, s.support_url, s.author_id, s.created_at,
  p.pen_name,
  (select count(*) from chapters c where c.story_id = s.id and not c.hidden and (c.publish_at is null or c.publish_at <= now())) as chapter_count,
  (select max(coalesce(c.publish_at, c.created_at)) from chapters c where c.story_id = s.id and not c.hidden and (c.publish_at is null or c.publish_at <= now())) as last_chapter_at,
  (select count(*) from follows f where f.story_id = s.id) as followers,
  (select round(avg(r.stars)::numeric, 2) from ratings r where r.story_id = s.id) as rating_avg,
  (select count(*) from ratings r where r.story_id = s.id) as rating_count,
  (select count(*) from follows f where f.story_id = s.id and f.created_at > now() - interval '7 days')
    + (select count(*) from ratings r where r.story_id = s.id and r.updated_at > now() - interval '7 days') as trend_7d
from stories s join profiles p on p.id = s.author_id;
grant select on story_cards to anon, authenticated;

-- ---------------- Updates: new chapters in stories you follow ----------------
create or replace function my_updates(lim int default 50)
returns table (story_id uuid, story_title text, n int, chapter_title text, published_at timestamptz, is_new boolean)
language sql stable security invoker set search_path = public as $$
  select s.id, s.title, c.n, c.title, coalesce(c.publish_at, c.created_at),
         coalesce(c.publish_at, c.created_at) > coalesce((select p.updates_seen_at from profiles p where p.id = auth.uid()), 'epoch'::timestamptz)
  from follows f
  join stories s on s.id = f.story_id
  join chapters c on c.story_id = s.id
  where f.user_id = auth.uid() and not c.hidden and (c.publish_at is null or c.publish_at <= now())
    and coalesce(c.publish_at, c.created_at) > f.created_at - interval '7 days'
  order by 5 desc
  limit lim
$$;
revoke execute on function my_updates(int) from public, anon;
grant execute on function my_updates(int) to authenticated;


-- ---------------- Featured story (added 2026-11-23) ----------------
create table if not exists site_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table site_settings enable row level security;
drop policy if exists "settings readable" on site_settings;
create policy "settings readable" on site_settings for select using (true);
drop policy if exists "owner writes settings" on site_settings;
create policy "owner writes settings" on site_settings for all
  using (exists (select 1 from admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from admins a where a.user_id = auth.uid()));
grant select on site_settings to anon, authenticated;
grant insert, update, delete on site_settings to authenticated;

-- Which story leads the home page: the one the owner picked, otherwise the owner's first story that has a chapter.
create or replace function featured_story() returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.id from site_settings ss join stories s on s.id::text = ss.value
      where ss.key = 'featured_story' and not s.hidden),
    (select s.id from stories s join admins a on a.user_id = s.author_id
      where not s.hidden and exists (select 1 from chapters c where c.story_id = s.id and not c.hidden)
      order by s.created_at asc limit 1)
  )
$$;
revoke execute on function featured_story() from public;
grant execute on function featured_story() to anon, authenticated;


-- Tell the API about the new tables right away.
notify pgrst, 'reload schema';
