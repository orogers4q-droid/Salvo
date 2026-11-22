-- Salvo: give the site access to the tables. Paste into Supabase > SQL Editor > New query, then Run.
-- Safe to run more than once.

-- ---------------- API access ----------------
-- Lets the site's public key reach these tables. The row rules above still decide what each person can see or change.
grant usage on schema public to anon, authenticated;
grant select on profiles, stories, chapters, follows, comments to anon, authenticated;
grant insert, update, delete on profiles, stories, chapters, follows, comments to authenticated;
grant insert on reports to authenticated;
grant select on admins to authenticated;

notify pgrst, 'reload schema';
