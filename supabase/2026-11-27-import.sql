-- Salvo update (Nov 27): bulk import. Lets an author post up to 200 chapters an hour (was 20),
-- so a whole book can be imported in one go. Every other spam limit stays the same.
-- Paste into Supabase > SQL Editor > New query (empty), then Run. Safe to run more than once.
-- Nothing else changes: imported chapters use the existing chapters table and scheduling.

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
    if n >= 200 then raise exception 'You can post up to 200 chapters an hour.'; end if;
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
