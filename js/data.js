// One data layer, two backends: Supabase when config.js is filled in, demo (this browser) otherwise.
// Every function returns a Promise so the pages don't care which one is running.
(function () {
  const cfg = window.SALVO_CONFIG || {};
  const live = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const words = (t) => (t.trim().match(/\S+/g) || []).length;
  const minsAgo = (d) => Math.max(0, Math.round((Date.now() - new Date(d)) / 60000));

  // ---------------- demo backend ----------------
  function demo() {
    const KEY = "salvo.demo.v1";
    let U = { mine: [], follows: ["s3"], comments: {}, me: { id: "me", pen: "" } };
    try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s) U = Object.assign(U, s); } catch (e) {}
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(U)); } catch (e) {} };
    const seed = (window.SALVO_SEED || []).map((s) => ({ ...s, sample: true }));
    const all = () => [...U.mine, ...seed];
    const card = (s) => ({ id: s.id, title: s.title, author: s.author, tags: s.tags, blurb: s.blurb,
      followers: s.followers + (U.follows.includes(s.id) && !s.sample ? 1 : 0), ago: s.ago ?? minsAgo(s.updated),
      chapterCount: s.chapters.length, sample: !!s.sample, mine: !s.sample });
    const find = (id) => all().find((s) => s.id === id);
    return {
      live: false,
      async user() { return { id: "me", pen: U.me.pen || "You", email: "demo", admin: true }; },
      onAuth() {},
      async signIn() { return "Demo mode: you're already signed in."; },
      takeNote() { return ""; },
      diag() { return null; },
      async verifyCode() { return this.user(); },
      async signOut() {},
      async setPen(p) { U.me.pen = p; save(); },
      async listStories() { return all().map(card).sort((a, b) => a.ago - b.ago); },
      async getStory(id) { const s = find(id); if (!s) return null;
        return { ...card(s), chapters: s.chapters.map((c, i) => ({ n: i + 1, title: c.t, words: words(c.body) })) }; },
      async getChapter(id, n) { const s = find(id); const c = s && s.chapters[n - 1]; if (!c) return null;
        return { id: id + "-" + n, title: c.t, body: c.body, count: s.chapters.length }; },
      async myFollows() { return [...U.follows]; },
      async toggleFollow(id) { U.follows = U.follows.includes(id) ? U.follows.filter((x) => x !== id) : [...U.follows, id]; save(); return U.follows.includes(id); },
      async comments(chId) { return (U.comments[chId] || []).map((c) => ({ ...c })); },
      async addComment(chId, body) { (U.comments[chId] = U.comments[chId] || []).push({ name: U.me.pen || "You", at: new Date().toISOString(), body }); save(); },
      async myStories() { return U.mine.map(card); },
      async createStory(d) { const s = { id: "u" + Date.now().toString(36), author: U.me.pen || "You", followers: 0, updated: new Date().toISOString(), chapters: [], ...d }; U.mine.unshift(s); save(); return s.id; },
      async addChapter(id, title, body) { const s = U.mine.find((x) => x.id === id); s.chapters.push({ t: title, body }); s.updated = new Date().toISOString(); delete s.ago; save(); return s.chapters.length; },
      async report() {},
      async stats() {
        const today = new Date();
        const daily = [...Array(14)].map((_, i) => { const d = new Date(today - (13 - i) * 864e5); return { day: d.toISOString().slice(0, 10), n: i === 13 ? 1 : 0 }; });
        const cm = Object.values(U.comments).reduce((a, c) => a + c.length, 0);
        return { accounts: 1, authors: U.mine.length ? 1 : 0, stories: all().length, chapters: all().reduce((a, s) => a + s.chapters.length, 0),
          comments: cm, follows: U.follows.length, open_reports: 0, new_7d: 1, active_7d: 1, daily, demo: true };
      },
    };
  }

  // ---------------- Supabase backend ----------------
  function supa() {
    const VERSION = "2026-11-22.3";
    // What the address bar looked like when the page opened (names only, never the secret values).
    const q = new URLSearchParams(location.search);
    const hq = new URLSearchParams(location.hash.replace(/^#/, ""));
    const linkError = q.get("error_description") || hq.get("error_description");
    const code = q.get("code");
    const implicit = hq.get("access_token") && hq.get("refresh_token") ? { access_token: hq.get("access_token"), refresh_token: hq.get("refresh_token") } : null;
    const cameFromLink = !!(code || implicit || linkError);
    const storageOK = (() => { try { localStorage.setItem("salvo.t", "1"); localStorage.removeItem("salvo.t"); return true; } catch (e) { return false; } })();
    const hasVerifier = () => { try { return Object.keys(localStorage).some((k) => k.endsWith("-code-verifier")); } catch (e) { return false; } };
    const diag = { version: VERSION, opened: new Date().toLocaleTimeString(), queryKeys: [...q.keys()].join(", ") || "none",
      hashKeys: [...hq.keys()].join(", ") || "none", storage: storageOK ? "ok" : "BLOCKED", verifierBefore: hasVerifier() ? "present" : "missing",
      exchange: "not needed", session: "unknown", linkError: linkError || "none" };
    // The site handles the link itself (detectSessionInUrl off) so every step can be reported.
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { flowType: "pkce", detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
    });
    let me = null, authNote = "", linkDone = null;
    const tidy = (page) => { try { history.replaceState(null, "", location.pathname + page); } catch (e) {} };
    async function handleLink() {
      if (code) {
        const { data, error } = await sb.auth.exchangeCodeForSession(code);
        diag.exchange = error ? "failed: " + error.message : data?.session ? "ok" : "no session returned";
      } else if (implicit) {
        const { data, error } = await sb.auth.setSession(implicit);
        diag.exchange = error ? "failed (token link): " + error.message : data?.session ? "ok (token link)" : "no session (token link)";
      }
    }
    const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    // Name the author link explicitly: follows also connects stories to profiles, so Supabase needs to know which one.
    const COLS = "id,title,blurb,tags,updated_at,author_id,profiles!stories_author_id_fkey(pen_name),chapters(count),follows(count)";
    const card = (r) => ({ id: r.id, title: r.title, author: r.profiles?.pen_name || "Unknown", tags: r.tags || [], blurb: r.blurb,
      followers: r.follows?.[0]?.count || 0, ago: minsAgo(r.updated_at), chapterCount: r.chapters?.[0]?.count || 0,
      sample: false, mine: !!me && r.author_id === me.id });
    async function loadMe(session) {
      if (!session) { me = null; return null; }
      // A signed-in session counts as signed in even if these extra lookups fail.
      me = { id: session.user.id, email: session.user.email, pen: "", admin: false };
      const [p, a] = await Promise.all([
        sb.from("profiles").select("pen_name").eq("id", session.user.id).maybeSingle(),
        sb.from("admins").select("user_id").eq("user_id", session.user.id).maybeSingle(),
      ]);
      if (p.error) console.warn("Profile lookup failed:", p.error.message);
      if (a.error) console.warn("Owner lookup failed:", a.error.message);
      me.pen = p.data?.pen_name || "";
      me.admin = !!a.data;
      return me;
    }
    const need = () => { if (!me) throw new Error("Please sign in first."); return me; };
    return {
      live: true,
      async user() {
        if (cameFromLink && !linkDone) linkDone = handleLink().catch((e) => { diag.exchange = "crashed: " + e.message; });
        if (linkDone) await linkDone;
        const { data, error } = await sb.auth.getSession();
        diag.session = error ? "error: " + error.message : data.session ? "signed in as " + data.session.user.email : "none";
        const u = await loadMe(data.session);
        if (cameFromLink && !diag.noted) {
          diag.noted = true;
          if (u) { authNote = "You're signed in."; tidy(u.pen ? "#home" : "#write"); }
          else {
            authNote = linkError ? "That sign-in link didn't work: " + linkError.replace(/\+/g, " ") + "."
              : diag.exchange.startsWith("failed") ? "That sign-in link didn't work (" + diag.exchange.replace(/^failed: /, "") + ")."
              : "That sign-in link didn't work.";
            tidy("#signin");
          }
        }
        return u;
      },
      diag() { return { ...diag, verifierNow: hasVerifier() ? "present" : "missing" }; },
      async verifyCode(email, token) {
        ok(await sb.auth.verifyOtp({ email, token, type: "email" }));
        return this.user();
      },
      takeNote() { const n = authNote; authNote = ""; return n; },
      onAuth(fn) {
        sb.auth.onAuthStateChange((_e, session) => {
          // Run outside the auth callback (supabase-js advises against awaiting queries inside it).
          setTimeout(() => loadMe(session).then(fn, (e) => { console.warn(e); fn(session ? me : null); }), 0);
        });
      },
      async signIn(email) {
        try { localStorage.setItem("salvo.email", email); } catch (e) {}
        ok(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }));
        return "Check your email for a sign-in link.";
      },
      async signOut() { await sb.auth.signOut(); me = null; },
      async setPen(pen) { const u = need(); ok(await sb.from("profiles").upsert({ id: u.id, pen_name: pen })); u.pen = pen; },
      async listStories() { return ok(await sb.from("stories").select(COLS).order("updated_at", { ascending: false }).limit(100)).map(card); },
      async getStory(id) {
        const r = ok(await sb.from("stories").select(COLS).eq("id", id).maybeSingle()); if (!r) return null;
        const ch = ok(await sb.from("chapters").select("n,title,word_count").eq("story_id", id).order("n"));
        return { ...card(r), chapters: ch.map((c) => ({ n: c.n, title: c.title, words: c.word_count })) };
      },
      async getChapter(id, n) {
        const c = ok(await sb.from("chapters").select("id,title,body").eq("story_id", id).eq("n", n).maybeSingle()); if (!c) return null;
        const { count } = await sb.from("chapters").select("n", { count: "exact", head: true }).eq("story_id", id);
        return { ...c, count: count || n };
      },
      async myFollows() { if (!me) return []; return ok(await sb.from("follows").select("story_id").eq("user_id", me.id)).map((r) => r.story_id); },
      async toggleFollow(id) {
        const u = need();
        const has = ok(await sb.from("follows").select("story_id").eq("user_id", u.id).eq("story_id", id)).length;
        if (has) ok(await sb.from("follows").delete().eq("user_id", u.id).eq("story_id", id));
        else ok(await sb.from("follows").insert({ user_id: u.id, story_id: id }));
        return !has;
      },
      async comments(chId) {
        return ok(await sb.from("comments").select("body,created_at,profiles(pen_name)").eq("chapter_id", chId).order("created_at"))
          .map((c) => ({ name: c.profiles?.pen_name || "Reader", at: c.created_at, body: c.body }));
      },
      async addComment(chId, body) { const u = need(); ok(await sb.from("comments").insert({ chapter_id: chId, user_id: u.id, body })); },
      async myStories() { if (!me) return []; return ok(await sb.from("stories").select(COLS).eq("author_id", me.id).order("updated_at", { ascending: false })).map(card); },
      async createStory(d) { const u = need(); return ok(await sb.from("stories").insert({ author_id: u.id, title: d.title, blurb: d.blurb, tags: d.tags }).select("id").single()).id; },
      async addChapter(id, title, body) {
        const last = ok(await sb.from("chapters").select("n").eq("story_id", id).order("n", { ascending: false }).limit(1));
        const n = (last[0]?.n || 0) + 1;
        ok(await sb.from("chapters").insert({ story_id: id, n, title, body, word_count: words(body) }));
        return n;
      },
      async report(type, targetId, reason, details) {
        const u = need();
        ok(await sb.from("reports").insert({ reporter_id: u.id, target_type: type, target_id: targetId, reason, details }));
      },
      async stats() { return ok(await sb.rpc("site_stats")); },
    };
  }

  window.DB = live ? supa() : demo();
})();
