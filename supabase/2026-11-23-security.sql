-- Salvo security update. Paste into Supabase > SQL Editor > New query, then Run. Safe to run more than once.

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
