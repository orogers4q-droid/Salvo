-- Salvo update: the owner's story is the featured banner by default; the owner can pick a different one.
-- Paste into Supabase > SQL Editor > New query (empty), then Run. Safe to run more than once.

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

notify pgrst, 'reload schema';
