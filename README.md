# Salvo

Serial fiction for military sci-fi and fantasy: read, follow, comment, and post stories chapter by chapter.

Plain HTML, CSS and JavaScript with no build step. It runs on GitHub Pages, with Supabase handling accounts and the database.

## Files

- `index.html`: the page
- `css/site.css`: the styles
- `js/app.js`: the pages and buttons
- `js/data.js`: talks to the database (or to the browser in demo mode)
- `js/config.js`: your Supabase address and public key
- `js/seed.js`: sample stories for demo mode
- `supabase/schema.sql`: the database tables and security rules

## Demo mode

While `js/config.js` is empty, the site shows sample stories, and anything you post is saved in your own browser only.

## Going live

1. **Host it:** in the GitHub repo, go to Settings > Pages > Deploy from a branch > `main` / root. The site will be at `https://<user>.github.io/<repo>/`.
2. **Database:** create a free project at supabase.com. Open SQL Editor, paste in `supabase/schema.sql`, and click Run.
3. **Sign-in links:** in Supabase, go to Authentication > URL Configuration. Set the Site URL to the GitHub Pages address and add it under Redirect URLs.
4. **Connect:** from Supabase > Project Settings > API, copy the Project URL and the `anon` public key into `js/config.js`.

## Stats page

After you've signed up on the live site once, run this in Supabase > SQL Editor, using your own email:

```sql
insert into admins (user_id) select id from auth.users where email = 'you@example.com';
```

Once you've done that, a **Stats** link appears in the menu for you and nobody else. It shows accounts, readers, authors, people active this week, and new sign-ups per day.

## Importing a book

Authors can bring in a story they've already written from **Write > Import a whole book**, or the **Import chapters** button on their own story page. They upload a Word file (.docx) or paste the text, and Salvo splits it at lines like "Chapter 1", "Prologue" or "Epilogue" (or at Word's Heading styles). They check and fix every chapter before posting, then publish them all at once or release them on a schedule. It uses the existing chapters table; run `supabase/2026-11-27-import.sql` once so a whole book fits under the hourly posting limit.

## Moderation

Reports go to the `reports` table. To take something down, set `hidden = true` on the story, chapter or comment in Supabase's Table Editor.
