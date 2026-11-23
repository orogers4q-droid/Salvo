// Salvo front end: hash routes (#home, #story-ID, #read-ID-N, #library, #write, #signin, #adfree).
(function () {
  const TAGS = ["Space marines", "Naval", "Mech", "Drop troops", "LitRPG", "Fantasy war", "Alt history", "Hard sci-fi"];
  const PALS = [["#1d2a44", "#e4572e", "#9aa7b8"], ["#3a2a1c", "#d9a441", "#c9b79a"], ["#0f2b2e", "#5fb3a1", "#a8c3bd"], ["#2b2240", "#e46f9a", "#b7a8d1"], ["#33361e", "#c8d35a", "#c2c4a0"]];
  const DB = window.DB;
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ago = (m) => (m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago");
  const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
  const H1 = (t) => `<h1 class="page">${esc(t)}</h1>`;
  let inboxView = "open", lastPage = "", lastNote = "", size = 18, filter = "", me = null, follows = [], token = 0, toastT = null;
  try { size = +localStorage.getItem("salvo.size") || 18; } catch (e) {}

  const toast = (t) => { const e = $("toast"); e.textContent = t; e.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove("show"), Math.max(2400, t.length * 60)); };
  const hash = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 2147483647; return h || 7; };

  function cover(st) {
    if (st.coverUrl) return `<img class="cover" src="${esc(st.coverUrl)}" alt="Cover of ${esc(st.title)}" loading="lazy" decoding="async">`;
    const p = PALS[hash(st.id) % PALS.length];
    let s = hash(st.id + st.title);
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    let stars = "";
    for (let i = 0; i < 34; i++) stars += `<circle cx="${(r() * 300).toFixed(1)}" cy="${(r() * 230).toFixed(1)}" r="${(r() * 1.4 + 0.3).toFixed(2)}" fill="#fff" opacity="${(r() * 0.6 + 0.3).toFixed(2)}"/>`;
    let ships = "";
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const x = 40 + r() * 220, y = 50 + r() * 150, sc = 0.5 + r() * 0.9;
      ships += `<use href="#sh${st.id}" transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) scale(${sc.toFixed(2)}) rotate(${(20 + r() * 14).toFixed(0)})"/><line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x - 30 * sc).toFixed(0)}" y2="${(y - 55 * sc).toFixed(0)}" stroke="${p[1]}" stroke-width="${(2 * sc).toFixed(1)}" opacity=".55"/>`;
    }
    const g = "g" + st.id;
    return `<svg class="cover" viewBox="0 0 300 400" preserveAspectRatio="xMidYMax slice" role="img" aria-label="Cover art for ${esc(st.title)}"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p[0]}"/><stop offset="1" stop-color="${p[2]}"/></linearGradient><radialGradient id="${g}p" cx=".35" cy=".2" r=".9"><stop offset="0" stop-color="${p[2]}"/><stop offset="1" stop-color="${p[0]}"/></radialGradient><path id="sh${st.id}" d="M0-14 L6 6 L0 3 L-6 6Z" fill="${p[1]}" stroke="#000" stroke-opacity=".35"/></defs><rect width="300" height="400" fill="url(#${g})"/>${stars}<circle cx="150" cy="560" r="290" fill="url(#${g}p)"/><path d="M-140 560a290 290 0 0 1 580 0" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/><path d="M0 340 L60 318 L110 332 L170 305 L230 326 L300 312 L300 400 L0 400Z" fill="#000" opacity=".35"/>${ships}<rect y="372" width="300" height="28" fill="#000" opacity=".25"/><text x="14" y="391" fill="#fff" font-family="Barlow,sans-serif" font-size="13" font-weight="700">${esc((st.tags[0] || "Serial").toUpperCase())}</text></svg>`;
  }
  const tagHtml = (st) => `<div class="tags">${st.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>`;
  const item = (st) => `<a class="item" href="#story-${st.id}">${cover(st)}<div><h3>${esc(st.title)}</h3><div class="meta">${esc(st.author)} · ${st.chapterCount} ch · updated ${ago(st.ago)}</div>${tagHtml(st)}</div></a>`;
  const ad = () => `<div class="ad"><strong>Advertisement</strong>Ad space · <a href="#adfree">Remove ads</a></div>`;
  const signInFirst = (what) => `<section class="band"><div class="wrap signin">${H1("Sign in to " + what)}<p>It's free. We'll email you a link, no password needed.</p><a class="btn" href="#signin">Sign in</a></div></section>`;

  async function home() {
    const stories = await DB.listStories();
    if (!stories.length) return `<section class="intro band"><div class="wrap"><p><b>Salvo is a home for serialized military fantasy and sci-fi novels.</b> Space marines, naval fleets, mechs, sieges and wars of magic, posted chapter by chapter. Read free, follow the stories you like, or publish your own.</p><div class="row"><a class="btn small" href="#write">Start writing</a></div></div></section><section class="hero band"><div class="wrap"><div><div class="kicker">Opening soon</div><h1>Military sci-fi and fantasy, one chapter at a time</h1><p>Be one of the first authors on Salvo.</p><a class="btn" href="#write">Post the first story</a></div></div></section>`;
    const f = [...stories].sort((a, b) => b.followers - a.followers)[0];
    const list = stories.filter((s) => !filter || s.tags.includes(filter));
    const top = [...stories].sort((a, b) => b.followers - a.followers).slice(0, 5);
    return `<section class="intro band"><div class="wrap"><p><b>Salvo is a home for serialized military fantasy and sci-fi novels.</b> Space marines, naval fleets, mechs, sieges and wars of magic, posted chapter by chapter. Read free, follow the stories you like, or publish your own.</p><div class="row"><a class="btn small" href="#write">Start writing</a></div></div></section><section class="hero band"><div class="wrap"><div><div class="kicker">Featured serial</div><h1>${esc(f.title)}</h1><p>${esc(f.blurb)}</p><div class="meta hero-meta">${esc(f.author)} · ${k(f.followers)} followers · ${f.chapterCount} chapters</div><div class="row"><a class="btn" href="#read-${f.id}-1">Start reading</a><a class="btn ghost" href="#story-${f.id}">Chapters</a></div></div>${cover(f)}</div></section>
    <section class="band"><div class="wrap"><div class="chips" role="group" aria-label="Filter by tag"><button class="chip ${filter ? "" : "on"}" data-tag="">All</button>${TAGS.map((t) => `<button class="chip ${filter === t ? "on" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</div>
    <div class="cols"><div><h2>Latest updates</h2><div class="list">${list.map(item).join("") || `<p class="note">No stories with this tag yet. <a href="#write">Be the first to post one.</a></p>`}</div>${stories.some((s) => s.sample) ? '<p class="note">Sample stories written to show the layout.</p>' : ""}</div>
    <aside class="side"><div class="panel"><h2>Most followed</h2>${top.map((s, i) => `<a class="rank" href="#story-${s.id}"><b>${i + 1}</b><span>${esc(s.title)}</span><span class="meta num">${k(s.followers)}</span></a>`).join("")}</div>${ad()}<div class="panel"><h2>Write for Salvo</h2><p class="tight">Post your military sci-fi or fantasy serial, chapter by chapter.</p><a class="btn" href="#write">Start a story</a></div></aside></div></div></section>`;
  }

  async function story(id) {
    const st = await DB.getStory(id);
    if (!st) return notFound();
    const fol = follows.includes(id);
    let last = 0; try { last = +localStorage.getItem("salvo.read." + id) || 0; } catch (e) {}
    const next = Math.min(last + 1, st.chapters.length) || 1;
    return `<section class="band"><div class="wrap sgrid">${cover(st)}<div><h1 class="page">${esc(st.title)}</h1><div class="meta">by ${esc(st.author)} · ${k(st.followers)} followers · updated ${ago(st.ago)}</div>${tagHtml(st)}<p class="blurb">${esc(st.blurb)}</p>
    <div class="row gap">${st.chapters.length ? `<a class="btn" href="#read-${st.id}-${next}">${last ? "Continue, chapter " + next : "Read chapter 1"}</a>` : ""}<button class="btn ghost" id="follow">${fol ? "Following" : "Follow"}</button>${st.mine ? `<a class="btn ghost" href="#write">Post a chapter</a><label class="btn ghost filebtn">${st.coverUrl ? "Change cover" : "Add a cover"}<input type="file" id="coverfile" accept="image/*" data-id="${st.id}"></label>` : `<button class="btn ghost" data-report="story" data-id="${st.id}">Report</button>`}</div>
    ${st.mine && st.chapters.some((c) => c.views != null) ? `<p class="meta">Views are visible to you only. Total: ${k(st.chapters.reduce((a, c) => a + (c.views || 0), 0))}</p>` : ""}
    <h2>Chapters</h2>${st.chapters.map((c) => `<a class="chap" href="#read-${st.id}-${c.n}"><span>${c.n}. ${esc(c.title)}${c.n <= last ? ' <span class="meta">· read</span>' : ""}</span><span class="meta num">${c.views != null ? k(c.views) + " views · " : ""}${Math.max(1, Math.round(c.words / 230))} min</span></a>`).join("") || '<p class="note">No chapters yet.</p>'}<div class="mt">${ad()}</div></div></div></section>`;
  }

  async function read(id, n) {
    const [st, c] = await Promise.all([DB.getStory(id), DB.getChapter(id, n)]);
    if (!st || !c) return notFound();
    try { localStorage.setItem("salvo.read." + id, Math.max(n, +localStorage.getItem("salvo.read." + id) || 0)); } catch (e) {}
    const cm = await DB.comments(c.id);
    if (!st.mine) { let seen = false; try { seen = !!localStorage.getItem("salvo.viewed." + c.id); localStorage.setItem("salvo.viewed." + c.id, "1"); } catch (e) {} if (!seen) DB.recordView(c.id).catch(() => {}); }
    const paras = c.body.split(/\n\s*\n+/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`);
    const mid = Math.ceil(paras.length / 2);
    return `<section class="band"><article class="reader" data-ch="${esc(c.id)}"><a class="meta" href="#story-${st.id}">${esc(st.title)} · ${esc(st.author)}</a><h1>${n}. ${esc(c.title)}</h1>
    <div class="tools"><button class="btn ghost" id="smaller" aria-label="Smaller text">A−</button><button class="btn ghost" id="bigger" aria-label="Bigger text">A+</button><span class="meta">Text size ${size}px</span></div>
    <div class="prose" style="font-size:${size}px">${paras.slice(0, mid).join("")}<div class="inad">${ad()}</div>${paras.slice(mid).join("")}</div>
    ${c.note ? `<aside class="anote"><h2>Author's note</h2>${c.note.split(/\n\s*\n+/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}<p class="meta">${esc(st.author)}</p></aside>` : ""}
    <div class="pager">${n > 1 ? `<a class="btn ghost" href="#read-${st.id}-${n - 1}">Previous</a>` : "<span></span>"}${n < c.count ? `<a class="btn" href="#read-${st.id}-${n + 1}">Next chapter</a>` : `<a class="btn ghost" href="#story-${st.id}">You're caught up</a>`}</div>
    <h2>Comments (${cm.length})</h2>${me ? `<form id="cform"><label for="ctext">Add a comment</label><textarea id="ctext" class="short" required maxlength="5000"></textarea><div class="row gap"><button class="btn" type="submit">Post comment</button><button class="btn ghost" type="button" data-report="chapter" data-id="${esc(c.id)}">Report chapter</button></div></form>` : `<p><a href="#signin">Sign in</a> to comment.</p>`}
    ${cm.map((x) => `<div class="cmt"><b>${esc(x.name)}</b> <span class="meta">${esc(new Date(x.at).toLocaleDateString())}</span><div>${esc(x.body)}</div></div>`).join("") || '<p class="note">No comments yet.</p>'}</article></section>`;
  }

  async function library() {
    if (!me) return signInFirst("keep a library");
    const all = await DB.listStories();
    const f = all.filter((s) => follows.includes(s.id));
    return `<section class="band"><div class="wrap">${H1("Your library")}<div class="list narrow">${f.map(item).join("") || '<p class="note">You are not following any stories yet. Tap Follow on a story to keep it here.</p>'}</div></div></section>`;
  }

  async function write() {
    if (!me) return signInFirst("write");
    if (!me.pen) return `<section class="band"><div class="wrap signin">${H1("Choose a pen name")}<form id="pform"><label>Pen name<input id="pen" required minlength="2" maxlength="40"></label><p class="note">Readers see this on your stories and comments.</p><button class="btn" type="submit">Save</button></form></div></section>`;
    const mine = await DB.myStories();
    return `<section class="band"><div class="wrap">${H1("Author dashboard")}<p class="meta">Writing as ${esc(me.pen)} · <a href="#signin">Change pen name</a></p><div class="two">
    <form id="sform"><h2>New story</h2><label>Title<input id="stitle" required maxlength="80"></label><label>Blurb<textarea id="sblurb" class="short" required maxlength="400"></textarea></label><label>Cover image <span class="meta">(optional, you can add or change it later)</span><input type="file" id="scover" accept="image/*"></label><fieldset><legend>Tags</legend><div class="checks">${TAGS.map((t, i) => `<label><input type="checkbox" value="${esc(t)}" id="tg${i}"> ${esc(t)}</label>`).join("")}</div></fieldset><button class="btn" type="submit">Create story</button></form>
    <form id="chform"><h2>Post a chapter</h2>${mine.length ? `<label>Story<select id="cstory">${mine.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join("")}</select></label><label>Chapter title<input id="ctitle" required maxlength="100"></label><label>Chapter text<textarea id="cbody" class="tall" required maxlength="100000"></textarea></label><p class="note">Leave a blank line between paragraphs.</p><label>Author's note <span class="meta">(optional, shown after the chapter)</span><textarea id="cnote" class="short" maxlength="5000" placeholder="Thanks for reading! Next chapter Friday."></textarea></label><button class="btn" type="submit">Publish chapter</button>
    <h2 class="mt">Your stories</h2>${mine.map((s) => `<a class="chap" href="#story-${s.id}"><span>${esc(s.title)}</span><span class="meta num">${s.chapterCount} ch · ${k(s.followers)} followers${s.views != null ? " · " + k(s.views) + " views" : ""}</span></a>`).join("")}` : '<p class="note">Create a story first, then post chapters to it here.</p>'}</form></div></div></section>`;
  }

  function diagBox() {
    const d = DB.diag && DB.diag();
    if (!d) return "";
    const rows = [["Site version", d.version], ["Page opened", d.opened], ["Address had (query)", d.queryKeys], ["Address had (hash)", d.hashKeys],
      ["Browser storage", d.storage], ["Sign-in key before link", d.verifierBefore], ["Sign-in key now", d.verifierNow],
      ["Link exchange", d.exchange], ["Session", d.session], ["Saved in browser", d.saved], ["Error from Supabase", d.linkError]];
    const text = rows.map(([a, b]) => a + ": " + b).join("\n") + "\n\nRecent sign-in log:\n" + (d.log || []).join("\n");
    return `<details class="panel mt" ${d.queryKeys !== "none" || d.hashKeys !== "none" ? "open" : ""}><summary><b>Sign-in check</b> <span class="meta">for troubleshooting</span></summary>
      <div class="mt">${rows.map(([a, b]) => `<div class="rank"><span></span><span>${esc(a)}</span><span class="num">${esc(b)}</span></div>`).join("")}</div>
      <h3 class="mt">Recent sign-in log</h3><ol class="log">${(d.log || []).map((l) => `<li>${esc(l)}</li>`).join("") || "<li>Nothing yet</li>"}</ol>
      <button class="btn ghost mt" type="button" id="copydiag" data-t="${esc(text)}">Copy these details</button></details>`;
  }

  async function signin() {
    if (me) return `<section class="band"><div class="wrap signin">${H1("Your account")}<p class="meta">Signed in as ${esc(me.email)}</p>
    <form id="penedit"><label>Pen name<input id="penname" required minlength="2" maxlength="40" value="${esc(me.pen)}"></label><p class="note">Shown on your stories and comments. Changing it updates them everywhere.</p><button class="btn" type="submit">Save pen name</button></form>
    <button class="btn ghost mt" id="signout">Sign out</button>${diagBox()}</div></section>`;
    let saved = ""; try { saved = localStorage.getItem("salvo.email") || ""; } catch (e) {}
    return `<section class="band"><div class="wrap signin">${H1("Sign in or join")}${lastNote ? `<p class="warn">${esc(lastNote)}</p>` : ""}
    <form id="iform"><label>Email<input id="email" type="email" required autocomplete="email" value="${esc(saved)}"></label><button class="btn" type="submit">Email me a sign-in link</button><p class="note">No password. New here? The same link creates your account. Open the link in this same browser.</p></form>
    <form id="codeform" class="mt"><label>Got a code in the email instead?<input id="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required placeholder="6-digit code"></label><button class="btn ghost" type="submit">Sign in with code</button></form>
    ${diagBox()}</div></section>`;
  }

  async function adfree() {
    return `<section class="band"><div class="wrap narrow">${H1("Read without ads")}<p class="blurb">One small purchase will remove every ad on Salvo, on the website and in the app. Until then, ads help keep the site free.</p><div class="panel"><h2>Coming soon</h2><p class="note tight">Ad-free will launch with the Android app, using Google Play billing there and card payments on the website.</p></div></div></section>`;
  }

  async function stats() {
    if (!me || !me.admin) return notFound();
    const x = await DB.stats();
    const readers = Math.max(0, x.accounts - x.authors);
    const max = Math.max(1, ...x.daily.map((d) => d.n));
    const tile = (n, l, sub) => `<div class="stat"><div class="big num">${k(n)}</div><div><b>${l}</b>${sub ? `<div class="meta">${sub}</div>` : ""}</div></div>`;
    return `<section class="band"><div class="wrap">${H1("Site stats")}<p class="meta">Only you can see this page.${x.demo ? " Demo numbers until the database is connected." : ""}</p>
    <div class="stats">${tile(x.accounts, "Accounts", `${k(x.new_7d)} new this week`)}${tile(readers, "Readers", "accounts with no stories")}${tile(x.authors, "Authors", "accounts with at least one story")}${tile(x.active_7d, "Active this week", "signed in within 7 days")}${x.views != null ? tile(x.views, "Chapter views", "all stories, all time") : ""}</div>
    <div class="two mt"><div class="panel"><h2>New accounts, last 14 days</h2><div class="bars">${x.daily.map((d) => `<div class="bar"><span class="meta num">${new Date(d.day + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><span class="track"><span style="width:${(d.n / max) * 100}%"></span></span><span class="num">${d.n}</span></div>`).join("")}</div></div>
    <div class="panel"><h2>Activity</h2>${[["Stories", x.stories], ["Chapters", x.chapters], ["Comments", x.comments], ["Follows", x.follows], ["Open reports", x.open_reports]].map(([l, n]) => `<div class="rank"><span></span><span>${l}</span><span class="num">${k(n)}</span></div>`).join("")}<button class="btn ghost mt" id="refresh">Refresh</button></div></div></div></section>`;
  }

  async function suggest() {
    return `<section class="band"><div class="wrap narrow">${H1("Suggestion box")}<p class="blurb">Ideas, bugs, a tag we're missing, a feature you want? Tell us. Every suggestion goes straight to the site owner.</p>
    <form id="sugform" class="panel"><label>Your suggestion<textarea id="sugbody" required minlength="3" maxlength="3000"></textarea></label>
    <label>How to reach you <span class="meta">(optional, only the owner sees this)</span><input id="sugcontact" maxlength="200" placeholder="Email or pen name" value="${esc(me ? me.pen || "" : "")}"></label>
    <button class="btn" type="submit">Send suggestion</button></form></div></section>`;
  }

  async function inbox() {
    if (!me || !me.admin) return notFound();
    const all = await DB.inbox();
    const show = all.filter((x) => (inboxView === "archived" ? x.status === "archived" : x.status !== "archived"));
    const nNew = all.filter((x) => x.status === "new").length;
    return `<section class="band"><div class="wrap narrow">${H1("Inbox")}<p class="meta">Suggestions from readers and authors. Only you can see this page. ${nNew} new.</p>
    <div class="chips"><button class="chip ${inboxView !== "archived" ? "on" : ""}" data-iv="open">Open</button><button class="chip ${inboxView === "archived" ? "on" : ""}" data-iv="archived">Archived</button></div>
    ${show.map((x) => `<article class="sugg ${x.status === "new" ? "new" : ""}"><div class="meta">${x.status === "new" ? "<b>New</b> · " : ""}${esc(x.from)}${x.contact ? " · " + esc(x.contact) : ""} · ${esc(new Date(x.at).toLocaleString())}${x.page ? " · from " + esc(x.page) : ""}</div><p>${esc(x.body).replace(/\n/g, "<br>")}</p>
      <div class="row">${x.status === "new" ? `<button class="btn ghost small2" data-sg="${x.id}" data-st="read">Mark read</button>` : ""}${x.status !== "archived" ? `<button class="btn ghost small2" data-sg="${x.id}" data-st="archived">Archive</button>` : `<button class="btn ghost small2" data-sg="${x.id}" data-st="read">Move back</button>`}</div></article>`).join("") || '<p class="note">Nothing here yet.</p>'}</div></section>`;
  }

  const notFound = () => `<section class="band"><div class="wrap">${H1("Not found")}<p>That story or chapter doesn't exist, or was taken down. <a href="#home">Back to browsing</a></p></div></section>`;

  function modal(h) { $("mbox").innerHTML = h; $("modal").classList.add("open"); const b = $("mbox").querySelector("select,button"); if (b) b.focus(); }
  const close = () => $("modal").classList.remove("open");
  $("modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  async function render() {
    const t = ++token;
    const h = (location.hash || "#home").slice(1);
    let v = "home", m, job;
    if ((m = h.match(/^read-(.+)-(\d+)$/))) { job = read(m[1], +m[2]); v = ""; }
    else if ((m = h.match(/^story-(.+)$/))) { job = story(m[1]); v = ""; }
    else if (["library", "write", "signin", "adfree", "stats", "suggest", "inbox"].includes(h)) { v = h; job = { library, write, signin, adfree, stats, suggest, inbox }[h](); }
    else job = home();
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.v === v));
    $("navsign").textContent = me ? "Account" : "Sign in";
    $("navstats").hidden = !(me && me.admin);
    $("navinbox").hidden = !(me && me.admin);
    if (me && me.admin && DB.unread) DB.unread().then((n) => { $("navinbox").textContent = n ? "Inbox (" + n + ")" : "Inbox"; }).catch(() => {});
    app.setAttribute("aria-busy", "true");
    const slow = setTimeout(() => { if (t === token) app.innerHTML = '<p class="loading">Loading…</p>'; }, 250);
    let html;
    try { html = await job; } catch (e) { console.error(e); html = `<section class="band"><div class="wrap">${H1("Something went wrong")}<p>${esc(e.message)}</p><a class="btn" href="#home">Back to browsing</a></div></section>`; }
    clearTimeout(slow);
    if (t !== token) return;
    app.innerHTML = html;
    app.removeAttribute("aria-busy");
    bind(m);
  }

  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { toast(e.message); } finally { btn.disabled = false; } };

  function bind(m) {
    app.querySelectorAll(".chip").forEach((b) => (b.onclick = () => { filter = b.dataset.tag; render(); }));
    app.querySelectorAll("[data-report]").forEach((b) => (b.onclick = () => {
      if (!me) { location.hash = "#signin"; return; }
      modal(`<h2>Report this ${b.dataset.report}</h2><label>Reason<select id="rr"><option>Copied from another author</option><option>Spam or advertising</option><option>Harassment or hate</option><option>Sexual content involving minors</option><option>Other</option></select></label><label>Details (optional)<textarea id="rd" class="short" maxlength="2000"></textarea></label><div class="row gap"><button class="btn" id="rsend">Send report</button><button class="btn ghost" data-close>Cancel</button></div>`);
      $("rsend").onclick = (e) => busy(e.target, async () => { await DB.report(b.dataset.report, b.dataset.id, $("rr").value, $("rd").value.trim()); close(); toast("Report sent to moderators"); });
    }));
    const fb = $("follow");
    if (fb && m) fb.onclick = () => { if (!me) { location.hash = "#signin"; return; } busy(fb, async () => { const on = await DB.toggleFollow(m[1]); follows = await DB.myFollows(); toast(on ? "Added to your library" : "Removed from your library"); render(); }); };
    const sm = $("smaller");
    if (sm) {
      const set = (d) => { size = Math.max(15, Math.min(24, size + d)); try { localStorage.setItem("salvo.size", size); } catch (e) {} app.querySelector(".prose").style.fontSize = size + "px"; app.querySelector(".tools .meta").textContent = "Text size " + size + "px"; };
      sm.onclick = () => set(-1); $("bigger").onclick = () => set(1);
    }
    const cf = $("cform");
    if (cf) cf.onsubmit = (e) => { e.preventDefault(); const t = $("ctext").value.trim(); if (!t) return; busy(cf.querySelector("button"), async () => { await DB.addComment(app.querySelector(".reader").dataset.ch, t); toast("Comment posted"); render(); }); };
    const pf = $("pform");
    if (pf) pf.onsubmit = (e) => { e.preventDefault(); busy(pf.querySelector("button"), async () => { try { await DB.setPen($("pen").value.trim()); } catch (err) { throw new Error(/duplicate|unique/i.test(err.message) ? "That pen name is taken. Try another." : err.message); } me = await DB.user(); render(); }); };
    const sf = $("sform");
    if (sf) sf.onsubmit = (e) => { e.preventDefault(); const tags = TAGS.filter((t, i) => $("tg" + i).checked); if (!tags.length) { toast("Pick at least one tag"); return; }
      busy(sf.querySelector("button"), async () => { const id = await DB.createStory({ title: $("stitle").value.trim(), blurb: $("sblurb").value.trim(), tags });
        const f = $("scover").files[0];
        if (f) { try { await DB.setCover(id, f); } catch (err) { toast("Story created, but the cover didn't upload: " + err.message); render(); return; } }
        toast("Story created. Now post chapter 1."); render(); }); };
    const chf = $("chform");
    if (chf && $("cstory")) chf.onsubmit = (e) => { e.preventDefault(); const id = $("cstory").value;
      busy(chf.querySelector("button"), async () => { const n = await DB.addChapter(id, $("ctitle").value.trim(), $("cbody").value.trim(), $("cnote").value.trim()); toast("Chapter " + n + " published"); location.hash = "#read-" + id + "-" + n; }); };
    const inf = $("iform");
    if (inf) inf.onsubmit = (e) => { e.preventDefault(); busy(inf.querySelector("button"), async () => { toast(await DB.signIn($("email").value.trim())); }); };
    const rf = $("refresh");
    if (rf) rf.onclick = () => render();
    const cvf = $("coverfile");
    if (cvf) cvf.onchange = () => { const f = cvf.files[0]; if (!f) return; const lab = cvf.closest("label"); lab.classList.add("busy"); lab.firstChild.textContent = "Uploading…";
      DB.setCover(cvf.dataset.id, f).then(() => { toast("Cover updated"); render(); }, (err) => { toast(err.message); render(); }); };
    const sgf = $("sugform");
    if (sgf) sgf.onsubmit = (e) => { e.preventDefault(); busy(sgf.querySelector("button"), async () => { await DB.sendSuggestion($("sugbody").value.trim(), $("sugcontact").value.trim(), lastPage); $("sugbody").value = ""; toast("Thanks! Your suggestion was sent."); }); };
    app.querySelectorAll("[data-iv]").forEach((b) => (b.onclick = () => { inboxView = b.dataset.iv; render(); }));
    app.querySelectorAll("[data-sg]").forEach((b) => (b.onclick = () => busy(b, async () => { await DB.setSuggestion(b.dataset.sg, b.dataset.st); render(); })));
    const pe = $("penedit");
    if (pe) pe.onsubmit = (e) => { e.preventDefault(); const v = $("penname").value.trim(); if (v === me.pen) { toast("That's already your pen name"); return; }
      busy(pe.querySelector("button"), async () => {
        try { await DB.setPen(v); } catch (err) { throw new Error(/duplicate|unique/i.test(err.message) ? "That pen name is taken. Try another." : err.message); }
        me = await DB.user(); toast("Pen name saved: " + me.pen); render(); }); };
    const cd = $("copydiag");
    if (cd) cd.onclick = async () => { try { await navigator.clipboard.writeText(cd.dataset.t); toast("Copied. Paste it to Claude."); } catch (e) { toast("Couldn't copy. Take a screenshot instead."); } };
    const cof = $("codeform");
    if (cof) cof.onsubmit = (e) => { e.preventDefault(); const em = $("email").value.trim(); if (!em) { toast("Enter your email above first"); return; }
      busy(cof.querySelector("button"), async () => { me = await DB.verifyCode(em, $("otp").value.trim()); follows = await DB.myFollows(); lastNote = ""; toast(me ? "You're signed in." : "That code didn't work"); location.hash = me && !me.pen ? "#write" : "#home"; render(); }); };
    const so = $("signout");
    if (so) so.onclick = () => busy(so, async () => { await DB.signOut(); me = null; follows = []; location.hash = "#home"; render(); });
  }

  window.addEventListener("hashchange", (e) => { try { const from = new URL(e.oldURL).hash.slice(1); if (from && from !== "suggest") lastPage = from; } catch (err) {} render(); window.scrollTo(0, 0); });
  DB.onAuth(async (u) => { me = u && u.id ? u : null; follows = await DB.myFollows().catch(() => []); render(); });
  (async () => {
    try { me = await DB.user(); follows = await DB.myFollows(); } catch (e) { console.error(e); }
    if (!DB.live) $("mode").textContent = "Demo mode: posts are saved in this browser only.";
    const note = DB.takeNote && DB.takeNote();
    if (note && !me) lastNote = note;
    render();
    if (note) toast(note);
  })();
})();
