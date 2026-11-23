// One data layer, two backends: Supabase when config.js is filled in, demo (this browser) otherwise.
// Every function returns a Promise so the pages don't care which one is running.
(function () {
  const cfg = window.SALVO_CONFIG || {};
  const live = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const words = (t) => (t.trim().match(/\S+/g) || []).length;
  const minsAgo = (d) => Math.max(0, Math.round((Date.now() - new Date(d)) / 60000));
  // Shrink a picture to a cover-sized JPEG (max 900 x 1200) so uploads are small and fast.
  async function shrink(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error("Please choose a picture (JPG, PNG or WebP).");
    if (file.size > 15 * 1024 * 1024) throw new Error("That picture is too large. Please pick one under 15 MB.");
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Couldn't read that picture.")); i.src = url; });
      const k = Math.min(1, 900 / img.naturalWidth, 1200 / img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
    } finally { URL.revokeObjectURL(url); }
  }

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
      chapterCount: s.chapters.length, sample: !!s.sample, mine: !s.sample, coverUrl: s.coverUrl || "" });
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
        const v = U.views || {};
        return { ...card(s), chapters: s.chapters.map((c, i) => ({ n: i + 1, id: s.id + "-" + (i + 1), title: c.t, words: words(c.body), views: s.sample ? null : v[s.id + "-" + (i + 1)] || 0 })) }; },
      async getChapter(id, n) { const s = find(id); const c = s && s.chapters[n - 1]; if (!c) return null;
        return { id: id + "-" + n, title: c.t, body: c.body, note: c.note || "", count: s.chapters.length }; },
      async recordView(chId) { U.views = U.views || {}; U.views[chId] = (U.views[chId] || 0) + 1; save(); },
      async myFollows() { return [...U.follows]; },
      async toggleFollow(id) { U.follows = U.follows.includes(id) ? U.follows.filter((x) => x !== id) : [...U.follows, id]; save(); return U.follows.includes(id); },
      async comments(chId) { return (U.comments[chId] || []).map((c) => ({ ...c })); },
      async addComment(chId, body) { (U.comments[chId] = U.comments[chId] || []).push({ name: U.me.pen || "You", at: new Date().toISOString(), body }); save(); },
      async myStories() { const v = U.views || {}; return U.mine.map((s) => ({ ...card(s), views: s.chapters.reduce((a, c, i) => a + (v[s.id + "-" + (i + 1)] || 0), 0) })); },
      async createStory(d) { const s = { id: "u" + Date.now().toString(36), author: U.me.pen || "You", followers: 0, updated: new Date().toISOString(), chapters: [], ...d }; U.mine.unshift(s); save(); return s.id; },
      async addChapter(id, title, body, note, publishAt) { const s = U.mine.find((x) => x.id === id); s.chapters.push({ t: title, body, note: note || "", publishAt: publishAt || null }); s.updated = new Date().toISOString(); delete s.ago; save(); return s.chapters.length; },
      async report() {},
      async setCover(id, file) {
        const blob = await shrink(file);
        const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
        const s = U.mine.find((x) => x.id === id); if (!s) throw new Error("Only your own stories."); s.coverUrl = url;
        try { save(); } catch (e) {} return url;
      },
      async discover() {
        const R = U.ratings || {};
        return all().map((s) => { const c = card(s); const rs = Object.values(R[s.id] || {}); const sr = s.sample ? s.rating : null;
          return { ...c, lastAt: Date.now() - c.ago * 60000, createdAt: Date.now() - (c.ago + (s.sample ? 50000 : 0)) * 60000,
            rating: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : sr, ratingCount: rs.length || (sr ? Math.round(s.followers / 40) : 0), trend: s.sample ? Math.round(s.followers / 100) : 0 }; });
      },
      async storyExtras(id, mine) {
        const s = find(id); const R = (U.ratings || {})[id] || {}; const rs = Object.values(R);
        const reviews = ((U.reviews || {})[id] || []).map((r) => ({ ...r, mine: r.name === (U.me.pen || "You"), stars: R.me || 0 }));
        const scheduled = {}; if (s && !s.sample) s.chapters.forEach((c, i) => { if (c.publishAt && new Date(c.publishAt) > new Date()) scheduled[i + 1] = c.publishAt; });
        return { on: true, rating: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : s?.rating ?? null, ratingCount: rs.length || (s?.rating ? Math.round(s.followers / 40) : 0),
          myStars: R.me || 0, reviews, myReview: reviews.find((r) => r.mine) || null, supportUrl: s?.supportUrl || "", scheduled };
      },
      async rate(id, stars) { U.ratings = U.ratings || {}; U.ratings[id] = U.ratings[id] || {}; if (stars) U.ratings[id].me = stars; else delete U.ratings[id].me; save(); },
      async saveReview(id, title, body) { U.reviews = U.reviews || {}; const l = (U.reviews[id] = (U.reviews[id] || []).filter((r) => r.name !== (U.me.pen || "You")));
        l.unshift({ id: "r" + Date.now(), name: U.me.pen || "You", title, body, at: new Date().toISOString() }); save(); },
      async deleteReview(id) { U.reviews = U.reviews || {}; U.reviews[id] = (U.reviews[id] || []).filter((r) => r.name !== (U.me.pen || "You")); save(); },
      async setSupport(id, url) { if (url && !/^https:\/\/(www\.)?(patreon\.com|ko-fi\.com|buymeacoffee\.com|paypal\.me|github\.com\/sponsors|subscribestar\.com|subscribestar\.adult)\/\S+$/i.test(url)) throw new Error("Use a full https link to Patreon, Ko-fi, Buy Me a Coffee, PayPal.me, GitHub Sponsors or SubscribeStar.");
        const s = U.mine.find((x) => x.id === id); s.supportUrl = url || ""; save(); },
      async updates() { const seen = U.seen || 0; const out = [];
        for (const id of U.follows) { const s = find(id); if (!s) continue; s.chapters.forEach((c, i) => { const at = s.sample ? Date.now() - (s.ago + (s.chapters.length - 1 - i) * 1440) * 60000 : +new Date(s.updated);
          out.push({ storyId: id, story: s.title, n: i + 1, title: c.t, at: new Date(at).toISOString(), isNew: at > seen }); }); }
        return out.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 50); },
      async unreadUpdates() { return (await this.updates()).filter((u) => u.isNew).length; },
      async markUpdatesSeen() { U.seen = Date.now(); save(); },
      async saveProgress(id, n) { U.prog = U.prog || {}; U.prog[id] = { n, at: Date.now() }; save(); },
      async myProgress() { return { ...(U.prog || {}) }; },
      async sendSuggestion(body, contact, page) { U.sugg = U.sugg || []; U.sugg.unshift({ id: "g" + Date.now(), body, contact, page, from: U.me.pen || "You", status: "new", at: new Date().toISOString() }); save(); },
      async inbox() { return (U.sugg || []).map((x) => ({ ...x })); },
      async setSuggestion(id, status) { const x = (U.sugg || []).find((g) => g.id === id); if (x) { x.status = status; save(); } },
      async unread() { return (U.sugg || []).filter((g) => g.status === "new").length; },
      async stats() {
        const today = new Date();
        const daily = [...Array(14)].map((_, i) => { const d = new Date(today - (13 - i) * 864e5); return { day: d.toISOString().slice(0, 10), n: i === 13 ? 1 : 0 }; });
        const cm = Object.values(U.comments).reduce((a, c) => a + c.length, 0);
        return { accounts: 1, authors: U.mine.length ? 1 : 0, stories: all().length, chapters: all().reduce((a, s) => a + s.chapters.length, 0),
          comments: cm, follows: U.follows.length, views: Object.values(U.views || {}).reduce((a, b) => a + b, 0), open_reports: 0, new_7d: 1, active_7d: 1, daily, demo: true };
      },
    };
  }

  // ---------------- Supabase backend ----------------
  function supa() {
    const VERSION = "2026-11-23.4";
    // What the address bar looked like when the page opened (names only, never the secret values).
    const q = new URLSearchParams(location.search);
    const hq = new URLSearchParams(location.hash.replace(/^#/, ""));
    const linkError = q.get("error_description") || hq.get("error_description");
    const code = q.get("code");
    const implicit = hq.get("access_token") && hq.get("refresh_token") ? { access_token: hq.get("access_token"), refresh_token: hq.get("refresh_token") } : null;
    const cameFromLink = !!(code || implicit || linkError);
    const storageOK = (() => { try { localStorage.setItem("salvo.t", "1"); localStorage.removeItem("salvo.t"); return true; } catch (e) { return false; } })();
    const hasVerifier = () => { try { return Object.keys(localStorage).some((k) => k.endsWith("-code-verifier")); } catch (e) { return false; } };
    // A small log that survives reloads, so we can see what happened to a session between page loads.
    const LOG = "salvo.authlog";
    const log = (msg) => { try { const l = JSON.parse(localStorage.getItem(LOG) || "[]"); l.push(new Date().toLocaleTimeString() + " " + msg); localStorage.setItem(LOG, JSON.stringify(l.slice(-14))); } catch (e) {} };
    const readLog = () => { try { return JSON.parse(localStorage.getItem(LOG) || "[]"); } catch (e) { return []; } };
    const savedSession = () => { try { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); if (!k) return "none";
      const v = JSON.parse(localStorage.getItem(k)); const exp = v?.expires_at ? new Date(v.expires_at * 1000).toLocaleTimeString() : "?";
      return "yes (" + (v?.user?.email || "no email") + ", expires " + exp + (v?.refresh_token ? ", has refresh" : ", NO refresh") + ")"; } catch (e) { return "unreadable"; } };
    log("page load v" + VERSION + " · saved session: " + savedSession() + (location.search || location.hash ? " · address had " + [...new URLSearchParams(location.search).keys(), ...new URLSearchParams(location.hash.replace(/^#/, "")).keys()].filter((k) => k !== "access_token" && k !== "refresh_token").join("/") + (location.hash.includes("access_token") ? "/tokens" : "") : ""));
    const diag = { version: VERSION, opened: new Date().toLocaleTimeString(), queryKeys: [...q.keys()].join(", ") || "none",
      hashKeys: [...hq.keys()].join(", ") || "none", storage: storageOK ? "ok" : "BLOCKED", verifierBefore: hasVerifier() ? "present" : "missing",
      exchange: "not needed", session: "unknown", linkError: linkError || "none" };
    // The site handles the link itself (detectSessionInUrl off) so every step can be reported.
    // Implicit flow: the link carries the session, so it works whichever email in the thread is tapped,
    // even after a rate-limited request, and even in a different browser. (?code= links from before still get handled.)
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { flowType: "implicit", detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storage: window.localStorage },
    });
    let me = null, authNote = "", linkDone = null;
    const tidy = (page) => { try { history.replaceState(null, "", location.pathname + page); } catch (e) {} };
    async function handleLink() {
      if (code) {
        const { data, error } = await sb.auth.exchangeCodeForSession(code);
        diag.exchange = error ? "failed: " + error.message : data?.session ? "ok" : "no session returned";
        log("code link: " + diag.exchange);
      } else if (implicit) {
        const { data, error } = await sb.auth.setSession(implicit);
        diag.exchange = error ? "failed (token link): " + error.message : data?.session ? "ok (token link)" : "no session (token link)";
        log("link: " + diag.exchange + " · saved now: " + savedSession());
      }
    }
    const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    // Name the author link explicitly: follows also connects stories to profiles, so Supabase needs to know which one.
    const COLS = "id,title,blurb,tags,updated_at,author_id,profiles!stories_author_id_fkey(pen_name),chapters(count),follows(count)";
    // Ask for cover_url too; if the database update hasn't been run yet, quietly fall back without it.
    let withCover = true;
    async function stories(build) {
      if (withCover) {
        const res = await build(sb.from("stories").select(COLS + ",cover_url"));
        if (!(res.error && /cover_url/.test(res.error.message))) return ok(res);
        withCover = false;
      }
      return ok(await build(sb.from("stories").select(COLS)));
    }
    const card = (r) => ({ id: r.id, title: r.title, author: r.profiles?.pen_name || "Unknown", tags: r.tags || [], blurb: r.blurb, coverUrl: r.cover_url || "",
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
        log("session check: " + diag.session);
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
      diag() { return { ...diag, verifierNow: hasVerifier() ? "present" : "missing", saved: savedSession(), log: readLog() }; },
      async verifyCode(email, token) {
        ok(await sb.auth.verifyOtp({ email, token, type: "email" }));
        return this.user();
      },
      takeNote() { const n = authNote; authNote = ""; return n; },
      onAuth(fn) {
        sb.auth.onAuthStateChange((_e, session) => {
          log("event " + _e + (session ? " (session)" : " (no session)"));
          // Run outside the auth callback (supabase-js advises against awaiting queries inside it).
          setTimeout(() => loadMe(session).then(fn, (e) => { console.warn(e); fn(session ? me : null); }), 0);
        });
      },
      async signIn(email) {
        try { localStorage.setItem("salvo.email", email); } catch (e) {}
        ok(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }));
        return "Check your email for a sign-in link.";
      },
      async signOut() { log("signed out by the Sign out button"); await sb.auth.signOut(); me = null; },
      async setPen(pen) { const u = need(); ok(await sb.from("profiles").upsert({ id: u.id, pen_name: pen })); u.pen = pen; },
      async listStories() { return (await stories((q) => q.order("updated_at", { ascending: false }).limit(100))).map(card); },
      async getStory(id) {
        const r = await stories((q) => q.eq("id", id).maybeSingle()); if (!r) return null;
        const ch = ok(await sb.from("chapters").select("id,n,title,word_count").eq("story_id", id).order("n"));
        const st = { ...card(r), chapters: ch.map((c) => ({ id: c.id, n: c.n, title: c.title, words: c.word_count, views: null })) };
        if (st.mine && ch.length) {
          // Only the author can read these (database rule). Before the update is run, this just shows nothing.
          const v = await sb.from("chapter_stats").select("chapter_id,views").in("chapter_id", ch.map((c) => c.id));
          if (!v.error) { const m = Object.fromEntries(v.data.map((x) => [x.chapter_id, x.views])); st.chapters.forEach((c) => (c.views = m[c.id] || 0)); }
        }
        return st;
      },
      async getChapter(id, n) {
        // Ask for the author's note too; if the database update hasn't been run yet, fall back without it.
        let res = await sb.from("chapters").select("id,title,body,author_note").eq("story_id", id).eq("n", n).maybeSingle();
        if (res.error && /author_note/.test(res.error.message)) res = await sb.from("chapters").select("id,title,body").eq("story_id", id).eq("n", n).maybeSingle();
        const c = ok(res); if (!c) return null;
        c.note = c.author_note || "";
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
      async myStories() {
        if (!me) return [];
        const list = (await stories((q) => q.eq("author_id", me.id).order("updated_at", { ascending: false }))).map(card);
        const v = await sb.from("chapter_stats").select("views,chapters!inner(story_id)");
        if (!v.error) { const t = {}; v.data.forEach((x) => { const sid = x.chapters?.story_id; t[sid] = (t[sid] || 0) + x.views; }); list.forEach((s) => (s.views = t[s.id] || 0)); }
        return list;
      },
      async recordView(chId) { const { error } = await sb.rpc("record_view", { ch: chId }); if (error) console.warn("View not counted:", error.message); },
      async createStory(d) { const u = need(); return ok(await sb.from("stories").insert({ author_id: u.id, title: d.title, blurb: d.blurb, tags: d.tags }).select("id").single()).id; },
      async addChapter(id, title, body, note, publishAt) {
        const last = ok(await sb.from("chapters").select("n").eq("story_id", id).order("n", { ascending: false }).limit(1));
        const n = (last[0]?.n || 0) + 1;
        const row = { story_id: id, n, title, body, word_count: words(body) };
        if (note) row.author_note = note;
        if (publishAt) row.publish_at = publishAt;
        let res = await sb.from("chapters").insert(row);
        if (res.error && publishAt && /publish_at/.test(res.error.message))
          throw new Error("Scheduling isn't switched on yet (the database update hasn't been run). Nothing was posted.");
        if (res.error && note && /author_note/.test(res.error.message)) {
          delete row.author_note; res = await sb.from("chapters").insert(row);
          if (!res.error) throw new Error("Chapter " + n + " was published, but the author's note couldn't be saved yet (the database update hasn't been run).");
        }
        ok(res);
        return n;
      },
      async report(type, targetId, reason, details) {
        const u = need();
        ok(await sb.from("reports").insert({ reporter_id: u.id, target_type: type, target_id: targetId, reason, details }));
      },
      async stats() { return ok(await sb.rpc("site_stats")); },
      async setCover(id, file) {
        const u = need();
        const blob = await shrink(file);
        const path = u.id + "/" + id + "-" + Date.now() + ".jpg";
        const up = await sb.storage.from("covers").upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (up.error) throw new Error(/bucket|not found/i.test(up.error.message) ? "Covers aren't switched on yet (the database update hasn't been run)." : up.error.message);
        const url = sb.storage.from("covers").getPublicUrl(path).data.publicUrl;
        const res = await sb.from("stories").update({ cover_url: url }).eq("id", id).eq("author_id", u.id);
        if (res.error) throw new Error(/cover_url/.test(res.error.message) ? "Covers aren't switched on yet (the database update hasn't been run)." : res.error.message);
        return url;
      },
      // ----- discovery engine (needs supabase/2026-11-23-engine.sql; returns null/empty before that) -----
      async discover() {
        const res = await sb.from("story_cards").select("*").limit(300);
        if (res.error) { console.warn("Discovery lists off:", res.error.message); return null; }
        return res.data.map((r) => ({ id: r.id, title: r.title, author: r.pen_name || "Unknown", tags: r.tags || [], blurb: r.blurb,
          followers: r.followers || 0, ago: minsAgo(r.last_chapter_at || r.created_at), lastAt: r.last_chapter_at ? +new Date(r.last_chapter_at) : 0,
          createdAt: +new Date(r.created_at), chapterCount: r.chapter_count || 0, coverUrl: r.cover_url || "", supportUrl: r.support_url || "",
          rating: r.rating_avg != null ? +r.rating_avg : null, ratingCount: r.rating_count || 0, trend: r.trend_7d || 0,
          sample: false, mine: !!me && r.author_id === me.id }));
      },
      async storyExtras(id, mine) {
        const x = { rating: null, ratingCount: 0, myStars: 0, reviews: [], myReview: null, supportUrl: "", scheduled: {}, on: false };
        const c = await sb.from("story_cards").select("rating_avg,rating_count,support_url").eq("id", id).maybeSingle();
        if (c.error || !c.data) return x;
        x.on = true; x.rating = c.data.rating_avg != null ? +c.data.rating_avg : null; x.ratingCount = c.data.rating_count || 0; x.supportUrl = c.data.support_url || "";
        const [rv, rt] = await Promise.all([
          sb.from("reviews").select("id,user_id,title,body,created_at,updated_at,profiles(pen_name)").eq("story_id", id).order("created_at", { ascending: false }).limit(50),
          sb.from("ratings").select("user_id,stars").eq("story_id", id),
        ]);
        const stars = Object.fromEntries((rt.data || []).map((r) => [r.user_id, r.stars]));
        if (me) x.myStars = stars[me.id] || 0;
        x.reviews = (rv.data || []).map((r) => ({ id: r.id, mine: !!me && r.user_id === me.id, name: r.profiles?.pen_name || "Reader", title: r.title || "", body: r.body, at: r.created_at, edited: r.updated_at && r.updated_at !== r.created_at, stars: stars[r.user_id] || 0 }));
        x.myReview = x.reviews.find((r) => r.mine) || null;
        if (mine) {
          const sc = await sb.from("chapters").select("n,publish_at").eq("story_id", id).not("publish_at", "is", null);
          if (!sc.error) for (const r of sc.data) if (new Date(r.publish_at) > new Date()) x.scheduled[r.n] = r.publish_at;
        }
        return x;
      },
      async rate(storyId, stars) {
        const u = need();
        if (!stars) ok(await sb.from("ratings").delete().eq("user_id", u.id).eq("story_id", storyId));
        else ok(await sb.from("ratings").upsert({ user_id: u.id, story_id: storyId, stars, updated_at: new Date().toISOString() }, { onConflict: "user_id,story_id" }));
      },
      async saveReview(storyId, title, body) {
        const u = need();
        ok(await sb.from("reviews").upsert({ user_id: u.id, story_id: storyId, title: title || null, body, updated_at: new Date().toISOString() }, { onConflict: "story_id,user_id" }));
      },
      async deleteReview(storyId) { const u = need(); ok(await sb.from("reviews").delete().eq("user_id", u.id).eq("story_id", storyId)); },
      async setSupport(storyId, url) {
        const u = need();
        const res = await sb.from("stories").update({ support_url: url || null }).eq("id", storyId).eq("author_id", u.id);
        if (res.error) throw new Error(/check constraint|violates/.test(res.error.message) ? "Use a full https link to Patreon, Ko-fi, Buy Me a Coffee, PayPal.me, GitHub Sponsors or SubscribeStar." : res.error.message);
      },
      async updates() {
        if (!me) return [];
        const res = await sb.rpc("my_updates", { lim: 50 });
        if (res.error) return [];
        return res.data.map((r) => ({ storyId: r.story_id, story: r.story_title, n: r.n, title: r.chapter_title, at: r.published_at, isNew: r.is_new }));
      },
      async unreadUpdates() { return (await this.updates()).filter((u) => u.isNew).length; },
      async markUpdatesSeen() { if (!me) return; await sb.from("profiles").update({ updates_seen_at: new Date().toISOString() }).eq("id", me.id); },
      async saveProgress(storyId, n) {
        if (!me) return;
        const res = await sb.from("reading_progress").upsert({ user_id: me.id, story_id: storyId, chapter_n: n, updated_at: new Date().toISOString() }, { onConflict: "user_id,story_id" });
        if (res.error) console.warn("Progress not saved:", res.error.message);
      },
      async myProgress() {
        if (!me) return {};
        const res = await sb.from("reading_progress").select("story_id,chapter_n,updated_at").eq("user_id", me.id);
        return res.error ? {} : Object.fromEntries(res.data.map((r) => [r.story_id, { n: r.chapter_n, at: +new Date(r.updated_at) }]));
      },
      async sendSuggestion(body, contact, page) {
        const res = await sb.from("suggestions").insert({ user_id: me ? me.id : null, body, contact: contact || null, page: page || null });
        if (res.error) throw new Error(/suggestions/.test(res.error.message) && /exist|schema cache/.test(res.error.message) ? "The suggestion box isn't switched on yet. Please try again soon." : res.error.message);
      },
      async inbox() {
        const rows = ok(await sb.from("suggestions").select("id,user_id,body,contact,page,status,created_at").order("created_at", { ascending: false }).limit(200));
        const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
        const names = ids.length ? Object.fromEntries(ok(await sb.from("profiles").select("id,pen_name").in("id", ids)).map((p) => [p.id, p.pen_name])) : {};
        return rows.map((r) => ({ id: r.id, body: r.body, contact: r.contact || "", page: r.page || "", status: r.status, at: r.created_at, from: r.user_id ? names[r.user_id] || "Signed-in reader" : "Visitor" }));
      },
      async setSuggestion(id, status) { ok(await sb.from("suggestions").update({ status }).eq("id", id)); },
      async unread() { const { count, error } = await sb.from("suggestions").select("id", { count: "exact", head: true }).eq("status", "new"); return error ? 0 : count || 0; },
    };
  }

  window.DB = live ? supa() : demo();
})();
