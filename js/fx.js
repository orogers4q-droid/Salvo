// Visual effects only: starfield, spiral galaxy and lightning on the dark bands (header, banner, footer).
// Kept separate from the site's logic. Respects "reduce motion" (still picture, no lightning).
(function () {
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MODES = {
    hero: { stars: 1, galaxy: true, bolts: [3500, 8000] },
    header: { stars: 0.5, galaxy: false, bolts: [9000, 20000] },
    footer: { stars: 0.6, galaxy: false, bolts: null },
  };

  function seeded(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

  function attach(host, mode) {
    if (!host || host.querySelector(":scope > canvas.fx")) return;
    const opt = MODES[mode];
    const c = document.createElement("canvas");
    c.className = "fx";
    c.setAttribute("aria-hidden", "true");
    host.prepend(c);
    const ctx = c.getContext("2d");
    let W = 0, H = 0, dpr = 1, stars = [], arms = [], neb = null, bolt = null, nextBolt = 0, visible = true, raf = 0, last = 0;

    function build() {
      const r = seeded(mode.length * 7919 + 13);
      const area = W * H;
      const nStars = Math.round(Math.min(260, area / 2600) * opt.stars);
      stars = Array.from({ length: nStars }, () => ({ x: r() * W, y: r() * H, z: r() * 1.3 + 0.3, ph: r() * 6.28, sp: 0.5 + r() * 1.5 }));
      arms = [];
      if (opt.galaxy) {
        const n = W < 600 ? 700 : 1500;
        for (let i = 0; i < n; i++) {
          const arm = i % 2, t = 0.06 + Math.pow(r(), 0.8) * 0.94;
          arms.push({ rad: t, ang: arm * Math.PI + t * 7 + (r() - 0.5) * (0.35 + t * 0.4), off: (r() - 0.5) * 0.05, size: r() * 1.6 + 0.6,
            hue: r() < 0.18 ? "255,170,120" : r() < 0.5 ? "170,210,255" : "235,240,255", a: 0.5 + r() * 0.5 });
        }
      }
      // Nebula clouds, drawn once per resize.
      neb = document.createElement("canvas");
      neb.width = c.width; neb.height = c.height;
      const n = neb.getContext("2d");
      n.scale(dpr, dpr);
      const clouds = opt.galaxy
        ? (W < 600 ? [[0.8, 0.1, 0.6, "64,150,190", 0.3], [0.3, 0.8, 0.5, "228,87,46", 0.12], [0.1, 0.4, 0.5, "60,90,170", 0.16]]
                   : [[0.585, 0.42, 0.45, "64,150,190", 0.3], [0.85, 0.75, 0.4, "228,87,46", 0.14], [0.15, 0.2, 0.5, "60,90,170", 0.18]])
        : [[0.3, 0.5, 0.6, "60,110,170", 0.14], [0.8, 0.4, 0.5, "228,87,46", 0.07]];
      for (const [cx, cy, rr, col, a] of clouds) {
        const g = n.createRadialGradient(cx * W, cy * H, 0, cx * W, cy * H, rr * Math.max(W, H));
        g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
        n.fillStyle = g; n.fillRect(0, 0, W, H);
      }
    }

    function resize() {
      const b = host.getBoundingClientRect();
      W = Math.max(1, b.width); H = Math.max(1, b.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
      if (reduce) draw(0);
    }

    function makeBolt() {
      const r = Math.random;
      const x0 = W * (0.1 + r() * 0.8), y0 = 0;
      const x1 = x0 + (r() - 0.5) * W * 0.5, y1 = H * (0.55 + r() * 0.45);
      let pts = [[x0, y0], [x1, y1]];
      let disp = Math.hypot(x1 - x0, y1 - y0) * 0.22;
      for (let k = 0; k < 6; k++) {
        const out = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
          out.push([(ax + bx) / 2 + (r() - 0.5) * disp, (ay + by) / 2 + (r() - 0.5) * disp * 0.3], pts[i + 1]);
        }
        pts = out; disp *= 0.55;
      }
      const branches = [];
      for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
        const s = pts[Math.floor(pts.length * (0.2 + r() * 0.5))];
        const len = 30 + r() * H * 0.3, ang = Math.PI / 2 + (r() - 0.5) * 1.6;
        const b = [s]; let [bx, by] = s;
        for (let j = 0; j < 8; j++) { bx += Math.cos(ang) * len / 8 + (r() - 0.5) * 12; by += Math.sin(ang) * len / 8; b.push([bx, by]); }
        branches.push(b);
      }
      return { pts, branches, born: performance.now(), life: 380 };
    }

    function path(p) { ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); }

    function draw(t) {
      ctx.clearRect(0, 0, W, H);
      if (neb) ctx.drawImage(neb, 0, 0, W, H);
      for (const s of stars) {
        const tw = reduce ? 0.8 : 0.55 + 0.45 * Math.sin(s.ph + t * 0.0012 * s.sp);
        ctx.fillStyle = `rgba(235,240,255,${(0.35 + 0.5 * tw).toFixed(3)})`;
        ctx.fillRect(s.x, s.y, s.z, s.z);
      }
      if (arms.length) {
        // Open space: between the title and the cover on wide screens, top-right corner on phones.
        const phone = W < 600;
        const cx = W * (phone ? 0.8 : 0.585), cy = H * (phone ? 0.1 : 0.42), R = phone ? W * 0.42 : Math.min(W * 0.3, H * 0.75);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.16);
        g.addColorStop(0, "rgba(255,240,220,.9)"); g.addColorStop(0.35, "rgba(255,220,180,.35)"); g.addColorStop(1, "rgba(255,220,180,0)");
        ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
        const tilt = -0.45, ct = Math.cos(tilt), st = Math.sin(tilt);
        const spin = reduce ? 0 : t * 0.00004;
        for (const p of arms) {
          const a = p.ang + spin / (0.25 + p.rad);
          const rr = p.rad * R + p.off * R;
          const ex = Math.cos(a) * rr, ey = Math.sin(a) * rr * 0.45;
          const x = cx + ex * ct - ey * st, y = cy + ex * st + ey * ct;
          ctx.fillStyle = `rgba(${p.hue},${(p.a * (1 - p.rad * 0.45)).toFixed(3)})`;
          ctx.fillRect(x, y, p.size, p.size);
        }
      }
      if (bolt) {
        const age = t - bolt.born;
        if (age > bolt.life) bolt = null;
        else {
          const k = 1 - age / bolt.life;
          const flick = age < 60 || (age > 110 && age < 170) ? 1 : 0.55;
          ctx.fillStyle = `rgba(180,210,255,${(0.07 * k * flick).toFixed(3)})`;
          ctx.fillRect(0, 0, W, H);
          ctx.save();
          ctx.lineJoin = "round"; ctx.lineCap = "round";
          ctx.shadowColor = "rgba(140,190,255,.9)"; ctx.shadowBlur = 18;
          ctx.strokeStyle = `rgba(150,195,255,${(0.6 * k * flick).toFixed(3)})`; ctx.lineWidth = 5;
          path(bolt.pts); ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = `rgba(250,252,255,${(0.95 * k * flick).toFixed(3)})`; ctx.lineWidth = 1.6;
          path(bolt.pts); ctx.stroke();
          ctx.lineWidth = 1; ctx.strokeStyle = `rgba(200,225,255,${(0.6 * k * flick).toFixed(3)})`;
          for (const b of bolt.branches) { path(b); ctx.stroke(); }
          ctx.restore();
        }
      }
    }

    function loop(t) {
      raf = 0;
      if (!visible || document.hidden || !host.isConnected) return;
      if (t - last > 33) { // about 30 frames a second is plenty and easy on phones
        last = t;
        if (opt.bolts && !bolt && t > nextBolt) {
          if (nextBolt) bolt = makeBolt();
          nextBolt = t + opt.bolts[0] + Math.random() * (opt.bolts[1] - opt.bolts[0]);
        }
        draw(t);
      }
      raf = requestAnimationFrame(loop);
    }
    c.strike = () => { if (!reduce) { bolt = makeBolt(); kick(); } }; // handy for testing: document.querySelector("canvas.fx").strike()
    const kick = () => { if (!reduce && !raf) raf = requestAnimationFrame(loop); };

    const ro = new ResizeObserver(() => resize());
    ro.observe(host);
    const io = new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) kick(); });
    io.observe(host);
    document.addEventListener("visibilitychange", kick);
    resize();
    kick();
  }

  function scan() {
    attach(document.querySelector("header"), "header");
    attach(document.querySelector("footer"), "footer");
    document.querySelectorAll("#app .hero").forEach((h) => attach(h, "hero"));
  }
  try {
    scan();
    const mo = new MutationObserver(() => scan());
    mo.observe(document.getElementById("app"), { childList: true });
  } catch (e) { console.warn("Effects off:", e); }
})();
