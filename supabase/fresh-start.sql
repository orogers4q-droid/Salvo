-- FRESH START: deletes Salvo's tables and everything in them, then builds them again from schema.sql.
-- Only use this while the site has no real users or stories.
-- Paste this whole file into Supabase > SQL Editor > New query, then Run.

drop table if exists admins, reports, comments, follows, chapters, stories, profiles cascade;
drop function if exists bump_story() cascade;
drop function if exists site_stats() cascade;


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

-- Tell the API about the new tables right away.
notify pgrst, 'reload schema';
