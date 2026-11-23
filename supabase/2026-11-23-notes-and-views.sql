-- Salvo update: author's notes on chapters + view counts that only each author (and the owner) can see.
-- Paste into Supabase > SQL Editor > New query, then Run. Safe to run more than once. Changes nothing that already exists.

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

notify pgrst, 'reload schema';
