-- Salvo update: ratings, reviews, discovery lists, chapter scheduling, support links,
-- follower updates, and reading progress. Free features only.
-- Paste into Supabase > SQL Editor > New query (empty), then Run once. Safe to run again.
-- Works whether or not the covers update has been run.

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

notify pgrst, 'reload schema';
