// Salvo bulk import: turn a Word file or pasted text into chapters, let the author check them, then post or schedule them.
// The splitting code at the top has no page code in it, so it also runs in Node for testing.
(function (root) {
  const NUMS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred";
  const NUM = `(?:\\d{1,4}|[ivxlcdm]{1,8}|(?:${NUMS})(?:[- ](?:${NUMS}))*)`;
  // "Chapter 3", "Ch. 12: The Drop", "Chapter Twenty-One", "Prologue", "Epilogue - After", "# Chapter 1", "1", "IV."
  const CHAPTER = new RegExp(`^(?:#{1,3}\\s*)?(?:(?:chapter|ch\\.?)\\s+${NUM}\\b|(?:prologue|epilogue|interlude|afterword|foreword|preface)\\b)`, "i");
  const BARE_NUM = new RegExp(`^[-–—\\s]*${NUM}\\.?[-–—\\s]*$`, "i");
  const PART = new RegExp(`^(?:#{1,3}\\s*)?(?:part|book|volume|act)\\s+${NUM}\\b`, "i");
  const MD_HEAD = /^#{1,3}\s+\S/;
  const BARE_CHAPTER = new RegExp(`^(?:#{1,3}\\s*)?(?:(?:chapter|ch\\.?)\\s+${NUM}|${NUM})[.:]?$`, "i");
  const MAX_TITLE = 100, MAX_BODY = 100000;
  // The number part of a title like "Chapter 3: The Drop" or "Ch. Twelve - Fire".
  const PREFIX = new RegExp(`^(?:chapter|ch\\.?)\\s+${NUM}\\b`, "i");

  // Titles to match Salvo's own numbering: "Chapter 1: First Drop" posted as chapter 5 becomes
  // "Chapter 5: First Drop". Titles without a chapter number (Prologue, "The Siege") are left alone.
  function renumber(chapters, startN) {
    let n = startN, changed = 0;
    for (const c of chapters) {
      if (!c.include) continue;
      const m = c.title.match(PREFIX);
      if (m) { const t = ("Chapter " + n + c.title.slice(m[0].length)).slice(0, MAX_TITLE); if (t !== c.title) { c.title = t; changed++; } }
      n++;
    }
    return changed;
  }

  const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
  const clean = (t) => t.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim();
  const stripHash = (t) => t.replace(/^#{1,3}\s*/, "").trim();
  const isHeadingLine = (t) => t.length <= 120 && !/\n/.test(t);

  // Pasted or .txt text: one block per paragraph (blank lines separate paragraphs). A single-line
  // paragraph that looks like a heading is also split off from text right under it.
  function textToBlocks(text) {
    const out = [];
    for (const para of String(text).replace(/\r\n?/g, "\n").split(/\n\s*\n+/)) {
      const p = clean(para);
      if (!p) continue;
      const lines = p.split("\n");
      const first = lines[0].trim();
      if (lines.length > 1 && (CHAPTER.test(first) || MD_HEAD.test(first) || PART.test(first)) && first.length <= 120) {
        out.push({ text: first, level: MD_HEAD.test(first) ? first.match(/^#+/)[0].length : 0 });
        out.push({ text: lines.slice(1).join("\n").trim(), level: 0 });
      } else out.push({ text: p, level: MD_HEAD.test(p) && lines.length === 1 ? p.match(/^#+/)[0].length : 0 });
    }
    return out;
  }

  // Word file (as HTML from mammoth): headings keep their level, everything else is a paragraph.
  function htmlToBlocks(html) {
    const ent = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
      const l = e.toLowerCase();
      if (l[0] === "#") return String.fromCodePoint(l[1] === "x" ? parseInt(l.slice(2), 16) : +l.slice(1));
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[l];
    });
    const out = [];
    const re = /<(h[1-6]|p|li|td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = re.exec(html))) {
      const text = clean(ent(m[2].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")));
      if (!text) continue;
      out.push({ text, level: /^h/i.test(m[1]) ? +m[1][1] : 0 });
    }
    return out;
  }

  // Decide which blocks start chapters, then build the chapter list.
  function split(blocks) {
    const notes = [];
    const isPattern = (b) => isHeadingLine(b.text) && (CHAPTER.test(b.text) || (b.level > 0 && BARE_NUM.test(b.text)));
    let starts = blocks.map((b) => isPattern(b));
    let how = "chapter headings like “Chapter 1”";
    if (starts.filter(Boolean).length < 2) {
      // No "Chapter N" lines: fall back to the most common heading level (Word's Heading styles or # lines).
      const counts = {};
      blocks.forEach((b) => b.level && (counts[b.level] = (counts[b.level] || 0) + 1));
      const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a - b)[0];
      if (best && counts[best] >= 2) { starts = blocks.map((b) => b.level === +best); how = "the document's headings"; }
      else {
        // Last try: lines that are just a number, like "1" or "IV".
        const nums = blocks.map((b) => isHeadingLine(b.text) && b.text.length <= 12 && BARE_NUM.test(b.text));
        if (nums.filter(Boolean).length >= 2) { starts = nums; how = "numbered lines"; }
        else { starts = blocks.map(() => false); how = ""; }
      }
    }

    const chapters = [];
    const dropped = [];
    let cur = null, front = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (starts[i]) {
        let title = stripHash(b.text), heading = b.text;
        if (BARE_NUM.test(title)) title = "Chapter " + title.replace(/[-–—.\s]/g, "");
        const nx = blocks[i + 1];
        // "Chapter 3" followed by a short line like "The Drop" becomes "Chapter 3: The Drop".
        if (BARE_CHAPTER.test(b.text) && nx && !starts[i + 1] && blocks[i + 2] && !starts[i + 2] && isHeadingLine(nx.text) && nx.text.length <= 70 &&
            !/[.!?,;:"”'’…)]$/.test(nx.text) && words(nx.text) <= 10 && (nx.level > 0 || !/[.!?]\s/.test(nx.text))) {
          title = title.replace(/[.:]$/, "") + ": " + stripHash(nx.text); heading += "\n\n" + nx.text; i++;
        }
        cur = { title: title.slice(0, MAX_TITLE), heading, paras: [] };
        chapters.push(cur);
        continue;
      }
      // "Part Two" right before a chapter heading is a section label, not chapter text.
      if (PART.test(b.text) && isHeadingLine(b.text) && starts[i + 1]) { dropped.push(stripHash(b.text)); continue; }
      (cur ? cur.paras : front).push(b.text);
    }

    const list = chapters.map((c) => ({ title: c.title, heading: c.heading, body: c.paras.join("\n\n"), include: true }));
    if (front.length) {
      const body = front.join("\n\n");
      const w = words(body);
      if (!list.length) list.push({ title: "", heading: "", body, include: true });
      else list.unshift({ title: w < 150 ? "Front matter" : "Opening", heading: "", body, include: w >= 150, front: true });
    }
    if (dropped.length) notes.push("Left out these section labels: " + dropped.join(", ") + ".");
    return { chapters: list, how, notes };
  }

  function check(c) {
    const p = [];
    if (!c.title.trim()) p.push("Needs a title");
    if (!c.body.trim()) p.push("Has no text");
    if (c.body.length > MAX_BODY) p.push("Too long for one chapter (" + Math.round(c.body.length / 1000) + "k of 100k characters). Split it.");
    return p;
  }

  const api = { textToBlocks, htmlToBlocks, split, check, words, renumber, CHAPTER };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }

  // ---------------- The page ----------------
  const MAMMOTH = "https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js";
  const MAMMOTH_SRI = "sha384-8NWE3bZDrmRI4IePMoQaEoLhAQ1MmRMJkdNgnGiHRFanTqsFKr0TmK6aSZvFJ/PO";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (d) => d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const localInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  let state = null;      // { storyId, source, chapters, how, notes, mode, firstNow, every, start }
  let loading = null, posting = false, pointerDown = false, pendingRedraw = null, later = () => {};
  document.addEventListener("pointerdown", () => { pointerDown = true; }, true);
  document.addEventListener("pointerup", () => { pointerDown = false; const f = pendingRedraw; pendingRedraw = null; if (f) setTimeout(f, 0); }, true);
  document.addEventListener("pointercancel", () => { pointerDown = false; }, true);

  window.addEventListener("beforeunload", (e) => { if (state && state.chapters.some((c) => c.include)) { e.preventDefault(); e.returnValue = ""; } });

  function loadMammoth() {
    if (window.mammoth) return Promise.resolve(window.mammoth);
    return (loading = loading || new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = MAMMOTH; s.integrity = MAMMOTH_SRI; s.crossOrigin = "anonymous";
      s.onload = () => ok(window.mammoth);
      s.onerror = () => { loading = null; fail(new Error("Couldn't load the Word reader. Check your connection, or paste the text instead.")); };
      document.head.appendChild(s);
    }));
  }

  async function readFile(file) {
    const name = file.name.toLowerCase();
    if (/\.(txt|md|markdown)$/.test(name)) return textToBlocks(await file.text());
    if (/\.doc$/.test(name)) throw new Error("That's an old .doc file. In Word, choose File > Save As > Word Document (.docx), then upload that.");
    if (!/\.docx$/.test(name)) throw new Error("Upload a Word file (.docx) or a text file (.txt), or paste the text instead.");
    if (file.size > 30 * 1024 * 1024) throw new Error("That file is over 30 MB. Try saving it without images.");
    const m = await loadMammoth();
    const r = await m.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { convertImage: m.images.imgElement(() => ({ src: "" })) });
    return htmlToBlocks(r.value);
  }

  function page(ctx) {
    const { mine } = ctx;
    if (!mine.length) return `<section class="band"><div class="wrap">${"<h1 class=\"page\">Import chapters</h1>"}<p>Create your story first (title, blurb and tags), then come back here to bring in its chapters.</p><a class="btn" href="#write">Create a story</a></div></section>`;
    return `<section class="band"><div class="wrap imp"><h1 class="page">Import chapters</h1><div id="impbody"></div></div></section>`;
  }

  function mount(ctx) {
    const box = document.getElementById("impbody");
    if (!box) return;
    if (state && !ctx.mine.some((s) => s.id === state.storyId)) state = null;
    state ? preview(ctx, box) : start(ctx, box);
  }

  function start(ctx, box) {
    const { mine, toast } = ctx;
    const pre = ctx.storyId && mine.some((s) => s.id === ctx.storyId) ? ctx.storyId : mine[0].id;
    box.innerHTML = `<p class="lede">Bring in a story you've already written. Upload a Word file or paste the text, and Salvo splits it into chapters. You check every chapter before anything goes live.</p>
    <div class="two"><div>
      <label>Add chapters to<select id="impstory">${mine.map((s) => `<option value="${s.id}" ${s.id === pre ? "selected" : ""}>${esc(s.title)} (${s.chapterCount} ch)</option>`).join("")}</select></label>
      <label class="drop" id="impdrop"><b>Upload a Word file</b><span class="meta">.docx, or .txt</span><input type="file" id="impfile" accept=".docx,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"></label>
      <p class="note">From Google Docs: File &gt; Download &gt; Microsoft Word (.docx).</p>
    </div><div>
      <label>Or paste your chapters<textarea id="imptext" class="tall" placeholder="Chapter 1: First Drop&#10;&#10;The hull rang like a bell…&#10;&#10;Chapter 2: Contact&#10;&#10;…"></textarea></label>
      <button class="btn" id="impgo" type="button">Find chapters</button>
    </div></div>
    <div class="panel mt"><h2>How Salvo finds chapters</h2><p class="tight">It starts a new chapter at lines like <b>Chapter 1</b>, <b>Chapter Two: The Siege</b>, <b>Prologue</b> or <b>Epilogue</b>, each on a line of its own. If there are none, it uses Word's Heading styles, or lines that are just a number. You can fix anything it gets wrong on the next screen.</p></div>`;
    const run = async (getBlocks, source, btn) => {
      if (btn) btn.disabled = true;
      try {
        const blocks = await getBlocks();
        if (!blocks.length) throw new Error("There's no text in that.");
        const r = split(blocks);
        const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0);
        state = { storyId: document.getElementById("impstory").value, source, ...r, mode: "now", firstNow: 1, every: 7, start: localInput(t) };
        preview(ctx, box); window.scrollTo(0, 0);
      } catch (e) { toast(e.message); } finally { if (btn) btn.disabled = false; }
    };
    document.getElementById("impfile").onchange = (e) => { const f = e.target.files[0]; if (f) { document.getElementById("impdrop").classList.add("busy"); run(() => readFile(f), f.name).finally(() => { const d = document.getElementById("impdrop"); if (d) d.classList.remove("busy"); }); } };
    document.getElementById("impgo").onclick = (e) => { const t = document.getElementById("imptext").value; if (!t.trim()) { toast("Paste your text first"); return; } run(async () => textToBlocks(t), "pasted text", e.target); };
  }

  function schedule() {
    const inc = state.chapters.filter((c) => c.include);
    if (state.mode === "now") return inc.map(() => null);
    const t0 = new Date(state.start);
    const nNow = Math.max(0, Math.min(inc.length, Math.floor(+state.firstNow || 0)));
    return inc.map((c, i) => (i < nNow ? null : new Date(t0.getTime() + (i - nNow) * state.every * 86400000)));
  }

  function preview(ctx, box) {
    const { mine } = ctx;
    const st = mine.find((s) => s.id === state.storyId);
    const inc = state.chapters.filter((c) => c.include);
    const total = inc.reduce((a, c) => a + words(c.body), 0);
    const problems = inc.filter((c) => check(c).length).length;
    const when = schedule();
    let k = 0;
    const startN = st.chapterCount + 1;
    const cards = state.chapters.map((c, i) => {
      const p = check(c), n = c.include ? startN + k : null, w = c.include ? when[k++] : null;
      return `<article class="impch${c.include ? "" : " off"}${p.length && c.include ? " bad" : ""}" data-i="${i}">
        <div class="imphead"><label class="inc"><input type="checkbox" data-act="inc" ${c.include ? "checked" : ""}> ${c.include ? "Ch " + n : "Skipped"}</label>
        <input class="imptitle" data-act="title" maxlength="100" value="${esc(c.title)}" placeholder="Chapter title" aria-label="Title of chapter ${i + 1}">
        <span class="meta num">${words(c.body).toLocaleString()} words${c.include ? " · " + (w ? fmt(w) : "now") : ""}</span></div>
        ${c.front ? `<p class="note">This text came before the first chapter heading${c.include ? "" : ", so it's skipped. Tick the box to post it"}.</p>` : ""}
        ${p.length && c.include ? `<p class="warn">${p.map(esc).join(" · ")}</p>` : ""}
        <details><summary>Text: <span class="meta">${esc(c.body.slice(0, 140)) || "(empty)"}${c.body.length > 140 ? "…" : ""}</span></summary>
          <textarea class="tall" data-act="body">${esc(c.body)}</textarea>
          <div class="row impsplit"><button class="btn ghost small2" type="button" data-act="split">Split at cursor</button><span class="meta">Click in the text where the new chapter should start, then press Split.</span></div></details>
        <div class="row">${i ? `<button class="btn ghost small2" type="button" data-act="merge">Merge into the chapter above</button>` : ""}<button class="btn ghost small2" type="button" data-act="del">Remove</button></div>
      </article>`;
    }).join("");
    box.innerHTML = `<p class="lede">Found <b>${state.chapters.length}</b> chapter${state.chapters.length === 1 ? "" : "s"} in ${esc(state.source)}${state.how ? ", using " + state.how : ""}. ${inc.length} will be added to <b>${esc(st.title)}</b> ${st.chapterCount ? "after its chapter " + st.chapterCount : "as its first chapters"}, ${total.toLocaleString()} words in all.</p>
      ${!state.how && state.chapters.length === 1 ? `<p class="warn">Salvo didn't find any chapter headings, so it's all one chapter. Open the text and use <b>Split at cursor</b>, or put each chapter title on its own line (like "Chapter 1") and start again.</p>` : ""}
      ${state.notes.map((n) => `<p class="note">${esc(n)}</p>`).join("")}
      ${(() => { const copy = state.chapters.map((c) => ({ ...c })); const n = renumber(copy, startN); return n ? `<div class="panel renum"><p class="tight"><b>${n} chapter title${n === 1 ? " has a number" : "s have numbers"} that won't match Salvo's.</b> For example, "${esc(state.chapters.find((c, i) => c.title !== copy[i].title).title)}" will be chapter ${startN + state.chapters.filter((c) => c.include).findIndex((c) => c.title !== copy[state.chapters.indexOf(c)].title)} here.</p><button class="btn ghost small2" type="button" id="imprenum">Renumber titles to match</button></div>` : ""; })()}
      <div class="impchs">${cards}</div>
      <div class="panel mt" id="imppub"><h2>When should they go live?</h2>
        <label class="radio"><input type="radio" name="impmode" value="now" ${state.mode === "now" ? "checked" : ""}> Publish them all now</label>
        <label class="radio"><input type="radio" name="impmode" value="sched" ${state.mode === "sched" ? "checked" : ""}> Release them on a schedule</label>
        ${state.mode === "sched" ? `<div class="sched"><label>Publish this many now<input type="number" id="impnow" min="0" max="${inc.length}" value="${esc(state.firstNow)}"></label>
          <label>Then one chapter every<select id="impevery">${[[1, "day"], [2, "2 days"], [3, "3 days"], [7, "week"]].map(([v, t]) => `<option value="${v}" ${+state.every === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
          <label>Starting<input type="datetime-local" id="impstart" min="${localInput(new Date()).slice(0, 10)}T00:00" max="2099-12-31T23:59" value="${esc(state.start)}"></label></div>
          ${(() => { const l = when.filter(Boolean); if (l.length && (isNaN(l[0]) || l[0].getFullYear() > 2099)) return `<p class="warn">That start date isn't valid. Pick it with the calendar button, or retype it.</p>`; return l.length ? `<p class="note">${l.length === 1 ? "1 scheduled, for " + fmt(l[0]) : l.length + " scheduled: the first on " + fmt(l[0]) + ", the last on " + fmt(l[l.length - 1])}. Readers see each one at its time.</p>` : ""; })()}` : ""}
        <div class="row gap mt"><button class="btn" type="button" id="imppost" ${!inc.length || problems ? "disabled" : ""}>${state.mode === "now" ? "Publish" : "Post and schedule"} ${inc.length} chapter${inc.length === 1 ? "" : "s"}</button><button class="btn ghost" type="button" id="impreset">Start over</button></div>
        ${problems ? `<p class="warn">${problems} chapter${problems === 1 ? " needs" : "s need"} fixing first (marked in red above).</p>` : ""}
        <p class="meta" id="impprog" role="status"></p></div>`;
    bindPreview(ctx, box);
  }

  function bindPreview(ctx, box) {
    const { toast } = ctx;
    const redraw = () => {
      if (!state || posting || !box.isConnected) return;
      const a = document.activeElement, card = a && a.closest && a.closest(".impch");
      const key = a && box.contains(a) ? (card ? `.impch[data-i="${card.dataset.i}"] [data-act="${a.dataset.act}"]` : a.id ? "#" + a.id : null) : null;
      const y = window.scrollY; preview(ctx, box); window.scrollTo(0, y);
      const f = key && box.querySelector(key); if (f) f.focus({ preventScroll: true });
    };
    // A redraw while the mouse button is down would swallow the click, so wait until it's released.
    later = () => { if (pointerDown) pendingRedraw = redraw; else redraw(); };
    box.querySelectorAll(".impch").forEach((el) => {
      const i = +el.dataset.i, c = state.chapters[i];
      el.querySelector("[data-act=title]").oninput = (e) => { c.title = e.target.value; };
      el.querySelector("[data-act=title]").onchange = later;
      const ta = el.querySelector("[data-act=body]");
      ta.oninput = () => { c.body = ta.value; };
      ta.onchange = later;
      el.querySelector("[data-act=inc]").onchange = (e) => { c.include = e.target.checked; redraw(); };
      el.querySelector("[data-act=split]").onclick = () => {
        const pos = ta.selectionStart;
        const before = ta.value.slice(0, pos).trim(), after = ta.value.slice(pos).trim();
        if (!before || !after) { toast("Click inside the text, where the new chapter should begin"); return; }
        const paras = after.split(/\n\s*\n+/);
        let title = "";
        if (paras.length > 1 && paras[0].length <= 100 && !/\n/.test(paras[0]) && (CHAPTER.test(paras[0]) || /^#{1,3}\s/.test(paras[0]))) title = paras.shift().replace(/^#{1,3}\s*/, "");
        c.body = before;
        state.chapters.splice(i + 1, 0, { title, heading: title, body: paras.join("\n\n"), include: true });
        redraw(); toast(title ? "Split. New chapter: " + title : "Split. Give the new chapter a title.");
        const t = box.querySelector(`.impch[data-i="${i + 1}"] .imptitle`); if (t && !title) t.focus();
      };
      const mg = el.querySelector("[data-act=merge]");
      if (mg) mg.onclick = () => {
        const prev = state.chapters[i - 1];
        prev.body = [prev.body, c.heading, c.body].map((s) => (s || "").trim()).filter(Boolean).join("\n\n");
        state.chapters.splice(i, 1); redraw();
      };
      el.querySelector("[data-act=del]").onclick = () => { state.chapters.splice(i, 1); if (!state.chapters.length) { state = null; mount(ctx); return; } redraw(); };
    });
    box.querySelectorAll("[name=impmode]").forEach((r) => (r.onchange = () => { state.mode = r.value; redraw(); }));
    const nw = document.getElementById("impnow"), ev = document.getElementById("impevery"), sd = document.getElementById("impstart");
    if (nw) { nw.oninput = () => { state.firstNow = nw.value; }; nw.onchange = later; }
    if (ev) ev.onchange = () => { state.every = +ev.value; later(); };
    // Redraw only when the date field is left: Chrome fires "change" after each typed part (month, day, hour),
    // and redrawing mid-typing scrambled the date.
    if (sd) { sd.oninput = sd.onchange = () => { if (sd.value) state.start = sd.value; }; sd.onblur = later; }
    const rn = document.getElementById("imprenum");
    if (rn) rn.onclick = () => { const st = ctx.mine.find((s) => s.id === state.storyId); const n = renumber(state.chapters, st.chapterCount + 1); redraw(); toast(n + " title" + (n === 1 ? "" : "s") + " renumbered"); };
    document.getElementById("impreset").onclick = () => { if (confirmReset()) { state = null; mount(ctx); } };
    document.getElementById("imppost").onclick = (e) => post(ctx, box, e.target);
  }

  // A plain check instead of a browser dialog: the button asks once, then acts on the second press.
  let resetArmed = 0;
  function confirmReset() {
    const b = document.getElementById("impreset");
    if (Date.now() - resetArmed < 4000) { resetArmed = 0; return true; }
    resetArmed = Date.now(); b.textContent = "Press again to discard"; setTimeout(() => { if (b.isConnected) b.textContent = "Start over"; }, 4000);
    return false;
  }

  async function post(ctx, box, btn) {
    const { DB, toast } = ctx;
    const when = schedule();
    if (state.mode === "sched") {
      const l = when.filter(Boolean);
      if (l.length && (isNaN(l[0]) || l[0].getFullYear() > 2099)) { toast("That start date isn't valid. Pick it with the calendar button."); return; }
      if (l.length && l[0] < new Date(Date.now() + 60000)) { toast("Pick a start time in the future"); return; }
    }
    const jobs = state.chapters.map((c, i) => ({ c, i })).filter((x) => x.c.include).map((x, k) => ({ ...x, at: when[k] }));
    const prog = document.getElementById("impprog");
    box.querySelectorAll("button,input,select,textarea").forEach((el) => (el.disabled = true));
    const sid = state.storyId;
    let done = 0, first = null;
    posting = true;
    try {
      for (const j of jobs) {
        prog.textContent = `Posting ${done + 1} of ${jobs.length}…`;
        const n = await DB.addChapter(sid, j.c.title.trim(), j.c.body.trim(), "", j.at ? j.at.toISOString() : null);
        if (first == null) first = n;
        j.c.posted = true; done++;
      }
    } catch (e) {
      posting = false;
      state.chapters = state.chapters.filter((c) => !c.posted);
      const limit = /chapters an hour/i.test(e.message);
      if (done) ctx.refresh && (await ctx.refresh());
      mount(ctx);
      const p = document.getElementById("impprog");
      const msg = (done ? `Posted ${done} of ${jobs.length}. ` : "Nothing was posted. ") +
        (limit ? "Salvo's hourly posting limit stopped the rest. They're still here: press the button again in an hour to post them." : e.message + (done ? " The chapters that weren't posted are still here." : ""));
      if (p) p.textContent = msg;
      toast(msg);
      return;
    }
    posting = false;
    state = null;
    const sched = jobs.filter((j) => j.at).length;
    toast(sched ? `${done - sched} published, ${sched} scheduled.` : `${done} chapter${done === 1 ? "" : "s"} published.`);
    location.hash = "#story-" + sid;
  }

  root.SalvoImport = { ...api, page, mount, hasDraft: () => !!state };
})(typeof window !== "undefined" ? window : globalThis);
