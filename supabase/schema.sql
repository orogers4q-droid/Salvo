-- Salvo database. Paste this whole file into Supabase > SQL Editor > New query, then Run.
-- Safe to run once on a new project.

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  pen_name text not null unique check (char_length(pen_name) between 2 and 40),
  created_at timestamptz not null default now()
);

create table stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  blurb text not null check (char_length(blurb) <= 400),
  tags text[] not null default '{}',
  hidden boolean not null default false,          -- set true to take a story down
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table chapters (
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

create table follows (
  user_id uuid not null references profiles on delete cascade,
  story_id uuid not null references stories on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, story_id)
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users on delete set null,
  target_type text not null check (target_type in ('story','chapter','comment')),
  target_id uuid not null,
  reason text not null,
  details text check (char_length(details) <= 2000),
  status text not null default 'open',            -- open / actioned / dismissed
  created_at timestamptz not null default now()
);

create index on stories (updated_at desc);
create index on chapters (story_id, n);
create index on comments (chapter_id, created_at);

-- Posting a chapter moves its story to the top of "Latest updates".
create function bump_story() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update stories set updated_at = now() where id = new.story_id;
  return new;
end $$;
create trigger chapters_bump after insert on chapters for each row execute function bump_story();

-- Row level security: anyone can read what isn't hidden; people can only change their own things.
alter table profiles enable row level security;
alter table stories  enable row level security;
alter table chapters enable row level security;
alter table follows  enable row level security;
alter table comments enable row level security;
alter table reports  enable row level security;

create policy "profiles readable" on profiles for select using (true);
create policy "own profile insert" on profiles for insert with check (auth.uid() = id);
create policy "own profile update" on profiles for update using (auth.uid() = id);

create policy "stories readable" on stories for select using (not hidden or author_id = auth.uid());
create policy "own story insert" on stories for insert with check (author_id = auth.uid());
create policy "own story update" on stories for update using (author_id = auth.uid()) with check (author_id = auth.uid() and hidden = false);
create policy "own story delete" on stories for delete using (author_id = auth.uid());

create policy "chapters readable" on chapters for select using (
  not hidden and exists (select 1 from stories s where s.id = story_id and not s.hidden)
  or exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid()));
create policy "author chapter insert" on chapters for insert with check (
  exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid()));
create policy "author chapter update" on chapters for update using (
  exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid())) with check (hidden = false);
create policy "author chapter delete" on chapters for delete using (
  exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid()));

create policy "follows readable" on follows for select using (true);
create policy "own follow insert" on follows for insert with check (user_id = auth.uid());
create policy "own follow delete" on follows for delete using (user_id = auth.uid());

create policy "comments readable" on comments for select using (not hidden or user_id = auth.uid());
create policy "own comment insert" on comments for insert with check (user_id = auth.uid());
create policy "own comment delete" on comments for delete using (user_id = auth.uid());

-- Reports can be sent by signed-in people; only you (in the Supabase dashboard) can read them.
create policy "send report" on reports for insert with check (reporter_id = auth.uid());
