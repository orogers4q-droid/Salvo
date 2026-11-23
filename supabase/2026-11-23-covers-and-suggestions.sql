-- Salvo update: story cover images + a suggestion box that only the owner can read.
-- Paste into Supabase > SQL Editor > New query (empty), then Run. Safe to run more than once.

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

notify pgrst, 'reload schema';
