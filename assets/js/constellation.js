/* astra — Constellation
   One swarm of stars for the whole homepage. On arrival it assembles the
   wordmark, then dissolves into the slogan (the real <h1> fades in where the
   stars land). On scroll the same swarm re-forms beside each section: a star
   outline, the protocol as a constellation, a planet the services orbit, a
   breathing star behind the close. The pointer is gravity.
   Decorative only (aria-hidden); skipped under reduced motion. */
(function () {
  var root = document.documentElement;
  var hero = document.querySelector('.hero');
  var h1 = hero && hero.querySelector('h1');
  if (!hero || !h1) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.remove('cx', 'cx-intro');
    return;
  }

  var cv = document.createElement('canvas');
  cv.id = 'cx';
  cv.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(cv, document.body.firstChild);
  var ctx = cv.getContext('2d');
  if (!ctx) { root.classList.add('cx-landed'); return; }

  var mobile = window.matchMedia('(max-width: 767px)').matches;
  var N = mobile ? 1200 : 3000;
  var FREE_VISIBLE = mobile ? 220 : 520;
  var DPR = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  var W = 0, H = 0;

  /* ---------- particle state ---------- */
  var x = new Float32Array(N), y = new Float32Array(N);
  var vx = new Float32Array(N), vy = new Float32Array(N);
  var tx = new Float32Array(N), ty = new Float32Array(N);
  var a = new Float32Array(N), ta = new Float32Array(N);
  var sz = new Float32Array(N), boost = new Float32Array(N);
  var k = new Float32Array(N), ph = new Float32Array(N), tw = new Float32Array(N);
  var hx = new Float32Array(N), hy = new Float32Array(N), dep = new Float32Array(N);
  var mode = new Uint8Array(N);       /* 0 = screen space (free), 1 = document space (in a shape) */
  var stamp = new Uint32Array(N);
  var act = new Float32Array(N);      /* intro activation time (ms) */
  var perm = new Uint32Array(N);

  for (var i = 0; i < N; i++) {
    perm[i] = i;
    var r = Math.random();
    sz[i] = r < 0.035 ? 2.6 + Math.random() * 1.2 : 0.7 + Math.pow(Math.random(), 2.2) * 1.5;
    k[i] = 0.022 + Math.random() * 0.03;
    ph[i] = Math.random() * 6.283;
    tw[i] = 0.6 + Math.random() * 2.2;
    dep[i] = 0.15 + Math.random() * 0.85;
    boost[i] = 1;
  }
  for (i = N - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0; var t0 = perm[i]; perm[i] = perm[j]; perm[j] = t0; }

  /* ---------- sprites ---------- */
  function sprite(night) {
    var s = 48, c = document.createElement('canvas'); c.width = c.height = s;
    var g = c.getContext('2d');
    if (!night) {
      var sh = g.createRadialGradient(24, 26, 0, 24, 26, 15);
      sh.addColorStop(0, 'rgba(107,69,38,0.2)');
      sh.addColorStop(1, 'rgba(107,69,38,0)');
      g.fillStyle = sh; g.fillRect(0, 0, s, s);
      var core = g.createRadialGradient(24, 24, 0, 24, 24, 10);
      core.addColorStop(0, 'rgba(255,255,255,1)');
      core.addColorStop(0.62, 'rgba(255,255,255,1)');
      core.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = core; g.fillRect(0, 0, s, s);
    } else {
      var gl = g.createRadialGradient(24, 24, 0, 24, 24, 24);
      gl.addColorStop(0, 'rgba(255,252,246,1)');
      gl.addColorStop(0.18, 'rgba(255,244,228,0.85)');
      gl.addColorStop(0.45, 'rgba(232,200,160,0.18)');
      gl.addColorStop(1, 'rgba(232,200,160,0)');
      g.fillStyle = gl; g.fillRect(0, 0, s, s);
    }
    return c;
  }
  var STAR_PATH = 'M12 0C12.9 7.4 16.6 11.1 24 12c-7.4.9-11.1 4.6-12 12-.9-7.4-4.6-11.1-12-12 7.4-.9 11.1-4.6 12-12Z';
  function glint(night) {
    var s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    var g = c.getContext('2d');
    var p = new Path2D(STAR_PATH);
    g.translate(8, 8); g.scale(2, 2);
    if (!night) { g.shadowColor = 'rgba(107,69,38,0.4)'; g.shadowBlur = 8; g.shadowOffsetY = 3; }
    else { g.shadowColor = 'rgba(255,236,210,0.9)'; g.shadowBlur = 10; }
    g.fillStyle = '#FFFFFF'; g.fill(p);
    return c;
  }
  var SPR = [sprite(false), sprite(true)];
  var GLI = [glint(false), glint(true)];

  /* ---------- sampling ---------- */
  function sample(c, step, limit) {
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, pts = [];
    for (var yy = 0; yy < c.height; yy += step)
      for (var xx = 0; xx < c.width; xx += step)
        if (d[(yy * c.width + xx) * 4 + 3] > 110) pts.push(xx + (Math.random() - 0.5) * step * 0.6, yy + (Math.random() - 0.5) * step * 0.6);
    var n = pts.length / 2;
    if (n > limit) {
      /* random subsample, keeps the texture of a dust cloud rather than a grid */
      var keep = [], idx = new Uint32Array(n);
      for (var q = 0; q < n; q++) idx[q] = q;
      for (q = n - 1; q > 0; q--) { var w = (Math.random() * (q + 1)) | 0; var tt = idx[q]; idx[q] = idx[w]; idx[w] = tt; }
      for (q = 0; q < limit; q++) keep.push(pts[idx[q] * 2], pts[idx[q] * 2 + 1]);
      pts = keep;
    }
    return pts;
  }

  /* shape = { top, bottom, n, ox, oy, sz, al, cx, cy, update(t) } — targets in document space */
  function makeShape(pts, cx0, cy0, opts) {
    opts = opts || {};
    var n = Math.min(pts.length / 2, N);
    var s = { n: n, ox: new Float32Array(n), oy: new Float32Array(n), sz: new Float32Array(n), al: new Float32Array(n),
      cx: cx0, cy: cy0, top: opts.top || 0, bottom: opts.bottom || 0, lines: opts.lines || null, update: opts.update || null,
      scale: 1, alpha: opts.alpha || 1 };
    for (var q = 0; q < n; q++) {
      s.ox[q] = pts[q * 2]; s.oy[q] = pts[q * 2 + 1];
      s.sz[q] = opts.sz ? opts.sz[q] || 1 : 1;
      s.al[q] = s.alpha;
    }
    return s;
  }

  function starPoints(S, outlineFrac, limit) {
    var c = document.createElement('canvas'); c.width = c.height = Math.ceil(S);
    var g = c.getContext('2d'), p = new Path2D(STAR_PATH);
    g.scale(S / 24, S / 24);
    g.lineWidth = 2.6 / (S / 24); g.strokeStyle = '#000'; g.stroke(p);
    var outline = sample(c, 2, Math.round(limit * outlineFrac));
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    g.scale(S / 24, S / 24); g.fillStyle = '#000'; g.fill(p);
    var fill = sample(c, 3, Math.round(limit * (1 - outlineFrac)));
    var all = outline.concat(fill);
    for (var q = 0; q < all.length; q++) all[q] -= S / 2;
    return all;
  }

  var shapes = {}, sections = [];
  var logoImg = new Image();
  logoImg.src = '/assets/img/logo-white.webp';

  function docRect(el) {
    var r = el.getBoundingClientRect();
    return { left: r.left, top: r.top + window.scrollY, width: r.width, height: r.height, right: r.right, bottom: r.bottom + window.scrollY };
  }

  function buildLogo() {
    if (!logoImg.complete || !logoImg.naturalWidth) return null;
    var lw = Math.min(W * (mobile ? 0.78 : 0.56), 600), lh = lw * logoImg.naturalHeight / logoImg.naturalWidth;
    var c = document.createElement('canvas'); c.width = Math.ceil(lw); c.height = Math.ceil(lh);
    c.getContext('2d').drawImage(logoImg, 0, 0, lw, lh);
    var pts = sample(c, mobile ? 2 : 2, N);
    for (var q = 0; q < pts.length; q += 2) { pts[q] -= lw / 2; pts[q + 1] -= lh / 2; }
    var s = makeShape(pts, W / 2, window.scrollY + H * 0.45);
    s.w = lw; s.h = lh;
    return s;
  }

  function buildSlogan() {
    var cs = getComputedStyle(h1);
    var node = h1.firstChild;
    if (!node || node.nodeType !== 3) return null;
    var r = h1.getBoundingClientRect();
    var pad = 40;
    var c = document.createElement('canvas');
    c.width = Math.ceil(r.width + pad * 2); c.height = Math.ceil(r.height + pad * 2);
    var g = c.getContext('2d');
    g.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    if ('letterSpacing' in g && cs.letterSpacing !== 'normal') g.letterSpacing = cs.letterSpacing;
    g.fillStyle = '#000'; g.textBaseline = 'alphabetic';
    var text = node.nodeValue, range = document.createRange(), start = 0;
    var m = g.measureText('Hg'), asc = m.fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.8, desc = m.fontBoundingBoxDescent || parseFloat(cs.fontSize) * 0.2;
    text.split(' ').forEach(function (word) {
      if (word) {
        range.setStart(node, start); range.setEnd(node, start + word.length);
        var wr = range.getBoundingClientRect();
        var base = wr.top + (wr.height - (asc + desc)) / 2 + asc;
        g.fillText(word, wr.left - r.left + pad, base - r.top + pad);
      }
      start += word.length + 1;
    });
    var pts = sample(c, 2, N);
    for (var q = 0; q < pts.length; q += 2) { pts[q] -= pad; pts[q + 1] -= pad; }
    return makeShape(pts, r.left, r.top + window.scrollY);
  }

  function buildSections() {
    sections = [];
    var wide = W >= 900;

    /* Statement: the astra star drawn in stars */
    var st = document.querySelector('.statement .wrap');
    if (st) {
      var R = docRect(st);
      var S = wide ? Math.min(W * 0.3, 420) : Math.min(W * 0.36, 150);
      var pts = starPoints(S, 0.62, mobile ? 520 : 1100);
      var cx = wide ? R.right - S * 0.55 : R.right - S * 0.42;
      var cy = wide ? R.top + R.height * 0.58 : R.top + S * 0.05;
      var sh = makeShape(pts, cx, cy, { top: R.top - H * 0.15, bottom: R.bottom + H * 0.1, alpha: wide ? 1 : 0.6 });
      sh.update = function (t) { this.rot = Math.sin(t / 5200) * 0.12; this.scale = 1 + Math.sin(t / 1900) * 0.025; };
      sections.push(sh);
    }

    /* Protocol: three stations joined into one constellation */
    var pr = document.querySelector('.protocol .wrap');
    var stations = [].slice.call(document.querySelectorAll('.protocol .station'));
    if (pr && stations.length) {
      var PR = docRect(pr), nodes = [];
      var headR = docRect(document.querySelector('.protocol-head') || pr);
      if (wide) {
        var hx0 = PR.left + PR.width * 0.64, hw = PR.width * 0.34;
        nodes.push([hx0 + hw * 0.08, headR.top + headR.height * 0.12, 1.6]);
        nodes.push([hx0 + hw * 0.42, headR.top + headR.height * 0.02, 1.2]);
        nodes.push([hx0 + hw * 0.70, headR.top + headR.height * 0.36, 2.0]);
        nodes.push([hx0 + hw * 0.96, headR.top + headR.height * 0.74, 1.3]);
        stations.slice().reverse().forEach(function (stn, q) {
          var mr = docRect(stn.querySelector('.mono') || stn);
          nodes.push([mr.left + 8, mr.top - 34, q === 2 ? 2.4 : 2.0]);
        });
      } else {
        stations.forEach(function (stn) {
          var hr = docRect(stn.querySelector('h3') || stn);
          nodes.push([Math.max(6, hr.left * 0.42), hr.top + hr.height / 2, 2.0]);
        });
      }
      var P = [], Z = [], budget = mobile ? 620 : 1300;
      var linePts = [], len = 0;
      for (var q = 1; q < nodes.length; q++) len += Math.hypot(nodes[q][0] - nodes[q - 1][0], nodes[q][1] - nodes[q - 1][1]);
      var clusterPer = mobile ? 60 : 90;
      var lineBudget = Math.max(0, budget - clusterPer * nodes.length);
      for (q = 1; q < nodes.length; q++) {
        var ax = nodes[q - 1][0], ay = nodes[q - 1][1], bx = nodes[q][0], by = nodes[q][1];
        var seg = Math.hypot(bx - ax, by - ay), cnt = Math.round(lineBudget * seg / len);
        for (var e = 0; e < cnt; e++) {
          var u = Math.random(), jit = (Math.random() - 0.5) * 3.2;
          var nx = -(by - ay) / seg, ny = (bx - ax) / seg;
          linePts.push(ax + (bx - ax) * u + nx * jit, ay + (by - ay) * u + ny * jit);
        }
      }
      nodes.forEach(function (nd) {
        for (var c2 = 0; c2 < clusterPer; c2++) {
          var ang = Math.random() * 6.283, rr = Math.pow(Math.random(), 1.6) * 9 * nd[2];
          P.push(nd[0] + Math.cos(ang) * rr, nd[1] + Math.sin(ang) * rr);
          Z.push(c2 === 0 ? 3.2 * nd[2] : 1);
        }
      });
      for (q = 0; q < linePts.length; q += 2) { P.push(linePts[q], linePts[q + 1]); Z.push(1); }
      var cxp = PR.left, cyp = PR.top;
      for (q = 0; q < P.length; q += 2) { P[q] -= cxp; P[q + 1] -= cyp; }
      var ps = makeShape(P, cxp, cyp, { top: PR.top - H * 0.1, bottom: PR.bottom + H * 0.05, sz: Z });
      ps.lines = nodes;
      sections.push(ps);
    }

    /* Services: the planet the services orbit, and the ring they ride on */
    var scene = document.querySelector('.orbit-scene');
    var sv = document.querySelector('.services .wrap');
    if (sv) {
      var SR = docRect(sv), cxs, cys, RX, RY, mob, PRC = 0;
      if (scene) {
        var sc = docRect(scene); mob = sc.width < 640;
        RX = mob ? Math.max(sc.width / 2 - 90, 96) : Math.min(sc.width * 0.44, 470);
        RY = mob ? sc.height * 0.26 : sc.height * 0.17;
        cxs = sc.left + sc.width / 2; cys = sc.top + sc.height * (mob ? 0.44 : 0.47);
      } else {
        mob = !wide; RX = wide ? Math.min(W * 0.21, 300) : Math.min(W * 0.34, 130); RY = RX * 0.3; PRC = RX * (wide ? 0.5 : 0.42);
        cxs = wide ? SR.right - RX - 30 : SR.left + SR.width * 0.5; cys = wide ? SR.top + SR.height * 0.5 : SR.top + 18;
      }
      var PR2 = PRC || Math.min(RY * (mob ? 0.95 : 1.3), mob ? 78 : 124);
      var nPlanet = mobile ? 520 : 1150, nRing = mobile ? 300 : 700;
      var u3 = [], v3 = [], w3 = [];
      var gold = Math.PI * (3 - Math.sqrt(5));
      for (q = 0; q < nPlanet; q++) {
        var yy = 1 - (q / (nPlanet - 1)) * 2, rad = Math.sqrt(1 - yy * yy), th = gold * q;
        u3.push(Math.cos(th) * rad); v3.push(yy); w3.push(Math.sin(th) * rad);
      }
      var ringA = [], ringJ = [];
      for (q = 0; q < nRing; q++) { ringA.push(Math.random() * 6.283); ringJ.push((Math.random() - 0.5) * 2 * (mob ? 5 : 9)); }
      var total = nPlanet + nRing, PP = new Array(total * 2).fill(0), ZZ = [];
      for (q = 0; q < total; q++) ZZ.push(q >= nPlanet && Math.random() < 0.03 ? 2.4 : 1);
      var svs = makeShape(PP, cxs, cys, { top: SR.top - H * 0.05, bottom: SR.bottom + H * 0.15, sz: ZZ });
      svs.update = function (t) {
        var ry = t / 7000, tilt = -0.38, cr = Math.cos(ry), sr = Math.sin(ry), ct = Math.cos(tilt), st2 = Math.sin(tilt);
        var breathe = 1 + Math.sin(t / 1600) * 0.015;
        for (var p = 0; p < nPlanet; p++) {
          var X = u3[p] * cr + w3[p] * sr, Zz = -u3[p] * sr + w3[p] * cr, Y = v3[p];
          var Y2 = Y * ct - Zz * st2, Z2 = Y * st2 + Zz * ct;
          this.ox[p] = X * PR2 * breathe; this.oy[p] = Y2 * PR2 * breathe;
          this.al[p] = Z2 > 0 ? 0.55 + 0.45 * Z2 : 0.1 + 0.25 * (1 + Z2);
        }
        var spin = t * (Math.PI * 2) / 26000;
        for (p = 0; p < nRing; p++) {
          var an = ringA[p] - spin, rj = ringJ[p];
          this.ox[nPlanet + p] = Math.cos(an) * (RX + rj);
          this.oy[nPlanet + p] = Math.sin(an) * (RY + rj * 0.4);
          var front = Math.sin(an);
          /* the ring disappears behind the planet */
          var hidden = front < 0 && Math.abs(Math.cos(an) * RX) < PR2 * 0.92;
          this.al[nPlanet + p] = hidden ? 0.04 : 0.35 + 0.5 * (front + 1) / 2;
        }
      };
      sections.push(svs);
    }

    /* Close: one star, breathing, behind the call to action */
    var cl = document.querySelector('.close-flood .wrap');
    if (cl) {
      var CR = docRect(cl);
      var S2 = wide ? Math.min(W * 0.34, 480) : Math.min(W * 0.42, 170);
      var pts2 = starPoints(S2, 0.38, mobile ? 640 : 1500);
      var cs2 = makeShape(pts2, wide ? CR.right - S2 * 0.62 : CR.right - S2 * 0.4, wide ? CR.top + CR.height * 0.5 : CR.top + S2 * 0.15,
        { top: CR.top - H * 0.35, bottom: CR.bottom + H, alpha: wide ? 1 : 0.55 });
      cs2.update = function (t) { this.scale = 1 + Math.sin(t / 1100) * 0.05; this.rot = t / 30000; };
      sections.push(cs2);
    }
  }

  /* ---------- layout ---------- */
  function size() {
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (var q = 0; q < N; q++) { if (!hx[q] || hx[q] > W) hx[q] = Math.random() * W; hy[q] = Math.random() * H * 1.4; }
  }
  size();

  /* ---------- pointer ---------- */
  var px = -9999, py = -9999, ppx = -9999, ppy = -9999, pv = 0;
  window.addEventListener('pointermove', function (e) { px = e.clientX; py = e.clientY; }, { passive: true });
  window.addEventListener('pointerleave', function () { px = py = -9999; });
  document.addEventListener('mouseleave', function () { px = py = -9999; });
  window.addEventListener('touchstart', function (e) { var t = e.touches[0]; px = t.clientX; py = t.clientY; }, { passive: true });
  window.addEventListener('touchmove', function (e) { var t = e.touches[0]; px = t.clientX; py = t.clientY; }, { passive: true });
  window.addEventListener('touchend', function () { setTimeout(function () { px = py = -9999; }, 220); }, { passive: true });
  var shock = null;
  window.addEventListener('pointerdown', function (e) {
    if (e.target.closest && e.target.closest('a, button, input, textarea, label')) return;
    shock = { x: e.clientX, y: e.clientY, t: performance.now() };
  });

  /* ---------- sequence ---------- */
  var intro = root.classList.contains('cx-intro');
  var phase = intro ? 'logo' : 'gather';
  var phaseT = 0, start = null, active = null, slogan = null, logo = null, landed = false, releaseAt = 0;
  var space = false, warpT = -1e9, frameN = 0;

  if (intro) {
    /* start far outside, falling in like a hyperspace arrival */
    var diag = Math.hypot(W, H);
    for (i = 0; i < N; i++) {
      var an = Math.random() * 6.283, rr2 = diag * (0.55 + Math.random() * 0.5);
      x[i] = W / 2 + Math.cos(an) * rr2; y[i] = window.scrollY + H * 0.45 + Math.sin(an) * rr2;
      mode[i] = 1; a[i] = 0; act[i] = Math.random() * 650;
    }
  } else {
    for (i = 0; i < N; i++) {
      x[i] = Math.random() * W; y[i] = Math.random() * H; mode[i] = 0; a[i] = 0;
      act[i] = 0;
    }
  }

  function finishIntroUI() {
    root.classList.remove('cx-intro');
    try { sessionStorage.setItem('astra-cx-seen', '1'); } catch (e) {}
  }
  function land() {
    if (landed) return;
    landed = true;
    root.classList.add('cx-landed');
    releaseAt = performance.now() + 700;
  }
  /* safety: never leave the headline hidden */
  setTimeout(function () { finishIntroUI(); land(); }, 7000);

  var built = false;
  function build() {
    slogan = buildSlogan();
    buildSections();
    built = true;
  }

  var fontsReady = (document.fonts && document.fonts.load)
    ? Promise.all([document.fonts.load('800 100px "Montserrat"'), document.fonts.ready]).catch(function () {})
    : Promise.resolve();
  var logoReady = new Promise(function (res) { if (logoImg.complete) res(); else { logoImg.onload = res; logoImg.onerror = res; } });

  Promise.all([fontsReady, logoReady]).then(function () {
    if (intro) logo = buildLogo();
    build();
    if (intro && !logo) { phase = 'gather'; finishIntroUI(); }
    requestAnimationFrame(frame);
  });

  var rT = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rT);
    rT = setTimeout(function () { size(); build(); }, 160);
  });
  setTimeout(function () { if (built) buildSections(); }, 900);
  setTimeout(function () { if (built) buildSections(); }, 2600);
  window.addEventListener('load', function () { if (built) buildSections(); });

  /* ---------- frame ---------- */
  var last = 0, running = true;
  function frame(now) {
    if (!running) return;
    if (start === null) { start = now; phaseT = now; }
    var dt = Math.min(now - last || 16, 40) / 16.67; last = now;
    var t = now - start, sy = window.scrollY;
    frameN++;
    var night = root.classList.contains('space') ? 1 : 0;
    if (night && !space) { warpT = now; space = true; }
    if (!night && space) space = false;
    var warp = Math.max(0, 1 - (now - warpT) / 1100);

    /* choose what the swarm is drawing */
    var shape = null, alphaMul = 1, kMul = 1, damp = 0.86;
    if (phase === 'logo') {
      shape = logo; kMul = 0.75; damp = 0.84;
      if (now - phaseT > (mobile ? 2900 : 2500)) {
        phase = 'slogan'; phaseT = now;
        for (var q = 0; q < N; q++) {
          var ddx = x[q] - logo.cx, ddy = y[q] - logo.cy, dd = Math.hypot(ddx, ddy) || 1, f = 4 + Math.random() * 14;
          vx[q] += ddx / dd * f; vy[q] += ddy / dd * f - 2;
        }
        finishIntroUI();
      }
    } else if (phase === 'gather') {
      if (t > 250) { phase = 'slogan'; phaseT = now; }
    } else if (phase === 'slogan') {
      shape = slogan; kMul = 1.1;
      if (!landed && slogan) {
        var close = 0, n2 = slogan.n;
        for (q = 0; q < n2; q += 7) { var pi = perm[q]; if (Math.abs(x[pi] - tx[pi]) + Math.abs(y[pi] - ty[pi]) < 2.5) close++; }
        if (close / (n2 / 7) > 0.84 || now - phaseT > 2100) land();
      }
      if (landed) {
        alphaMul = Math.max(0, 1 - (now - (releaseAt - 700)) / 900);
        if (now > releaseAt) {
          phase = 'free'; phaseT = now;
          for (q = 0; q < N; q++) { vx[q] += (Math.random() - 0.5) * 3; vy[q] -= 0.5 + Math.random() * 3.5; }
        }
      }
    } else {
      var mid = sy + H * 0.55;
      for (var s = 0; s < sections.length; s++) if (mid >= sections[s].top && mid <= sections[s].bottom) { shape = sections[s]; break; }
    }
    if (shape !== active) { active = shape; }

    /* write shape targets */
    var stampV = frameN;
    if (shape) {
      if (shape.update) shape.update(t);
      var sc = shape.scale || 1, rot = shape.rot || 0, cr = Math.cos(rot), sr = Math.sin(rot);
      for (q = 0; q < shape.n; q++) {
        var p = perm[q], ox = shape.ox[q] * sc, oy = shape.oy[q] * sc;
        tx[p] = shape.cx + ox * cr - oy * sr; ty[p] = shape.cy + ox * sr + oy * cr;
        ta[p] = shape.al[q] * alphaMul;
        boost[p] = shape.sz[q];
        stamp[p] = stampV;
      }
    }

    var pxs = px, pys = py, R = mobile ? 110 : 160, R2 = R * R;
    var sk = shock && now - shock.t < 600 ? shock : null;
    var skR = sk ? (now - sk.t) * 0.9 : 0;

    for (q = 0; q < N; q++) {
      if (phase === 'logo' && t < act[q]) continue;
      var inShape = stamp[q] === stampV;
      if (inShape) {
        if (mode[q] === 0) { y[q] += sy; mode[q] = 1; }
      } else {
        if (mode[q] === 1) { y[q] -= sy; mode[q] = 0; }
        boost[q] = 1;
        /* free field: slow drift with depth parallax */
        hx[q] += 0.04 * dep[q] * dt;
        if (hx[q] > W + 10) hx[q] -= W + 20;
        var hyS = hy[q] - sy * 0.25 * dep[q];
        hyS = ((hyS % (H * 1.4)) + H * 1.4) % (H * 1.4) - H * 0.2;
        if (Math.abs(hyS - y[q]) > H * 0.7) y[q] += hyS > y[q] ? H * 1.4 : -H * 1.4;
        tx[q] = hx[q]; ty[q] = hyS;
        ta[q] = q % Math.ceil(N / FREE_VISIBLE) === 0 ? 0.35 + 0.5 * dep[q] : 0;
        if (phase === 'slogan' || phase === 'logo') ta[q] *= 0.6;
        /* the pointer is a lantern: hidden stars light up around it */
        if (pxs > -999) {
          var lx0 = x[q] - pxs, ly0 = y[q] - pys, ld0 = lx0 * lx0 + ly0 * ly0, LR = R * 1.25;
          if (ld0 < LR * LR) ta[q] = Math.max(ta[q], 0.9 * (1 - Math.sqrt(ld0) / LR));
        }
      }
      var oy2 = mode[q] ? sy : 0;
      /* gravity of the pointer: push out and swirl, then the spring brings them home */
      var dx = x[q] - pxs, dy = y[q] - oy2 - pys, d2 = dx * dx + dy * dy;
      if (d2 < R2 && d2 > 0.01) {
        var d = Math.sqrt(d2), ff = 1 - d / R, f2 = ff * ff;
        vx[q] += (dx / d * f2 * 2.4 - dy / d * ff * 0.9) * dt;
        vy[q] += (dy / d * f2 * 2.4 + dx / d * ff * 0.9) * dt;
      }
      if (sk) {
        var sdx = x[q] - sk.x, sdy = y[q] - oy2 - sk.y, sd = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
        var band = Math.abs(sd - skR);
        if (band < 40) { var sf = (1 - band / 40) * 3.2; vx[q] += sdx / sd * sf; vy[q] += sdy / sd * sf; }
      }
      if (warp > 0 && !inShape) {
        var wdx = x[q] - W / 2, wdy = y[q] - H / 2, wd = Math.sqrt(wdx * wdx + wdy * wdy) || 1;
        vx[q] += wdx / wd * warp * 1.6; vy[q] += wdy / wd * warp * 1.6;
      }
      var kk = k[q] * kMul * (inShape ? 1 : 0.35);
      vx[q] += (tx[q] - x[q]) * kk * dt; vy[q] += (ty[q] - y[q]) * kk * dt;
      var dm = Math.pow(damp, dt);
      vx[q] *= dm; vy[q] *= dm;
      x[q] += vx[q] * dt; y[q] += vy[q] * dt;
      a[q] += (ta[q] - a[q]) * 0.08 * dt;
    }

    /* ---------- draw ---------- */
    ctx.clearRect(0, 0, W, H);
    var spr = SPR[night], gli = GLI[night];
    ctx.globalCompositeOperation = night ? 'lighter' : 'source-over';

    /* constellation lines for the protocol */
    if (shape && shape.lines) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = night ? 'rgba(255,240,220,0.22)' : 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (q = 0; q < shape.lines.length; q++) {
        var L = shape.lines[q];
        if (q) ctx.lineTo(L[0], L[1] - sy); else ctx.moveTo(L[0], L[1] - sy);
      }
      ctx.stroke();
    }

    /* streaks while things move fast (arrival, warp) */
    var streak = phase === 'logo' || phase === 'slogan' && now - phaseT < 900 || warp > 0.05;
    if (streak) {
      ctx.globalAlpha = night ? 0.5 : 0.55;
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (q = 0; q < N; q++) {
        var sp = vx[q] * vx[q] + vy[q] * vy[q];
        if (sp < 16 || a[q] < 0.05) continue;
        var syq = mode[q] ? y[q] - sy : y[q];
        ctx.moveTo(x[q], syq); ctx.lineTo(x[q] - vx[q] * 2.2, syq - vy[q] * 2.2);
      }
      ctx.stroke();
    }

    var near = [];
    for (q = 0; q < N; q++) {
      var al = a[q];
      if (al < 0.02) continue;
      var X0 = x[q], Y0 = mode[q] ? y[q] - sy : y[q];
      if (X0 < -20 || X0 > W + 20 || Y0 < -20 || Y0 > H + 20) continue;
      var twk = 0.72 + 0.28 * Math.sin(t * 0.001 * tw[q] + ph[q]);
      var s0 = sz[q] * boost[q];
      ctx.globalAlpha = Math.min(1, al * twk);
      if (s0 > 2.5) {
        var gs = s0 * (night ? 4.2 : 3.6);
        ctx.drawImage(gli, X0 - gs / 2, Y0 - gs / 2, gs, gs);
      } else {
        var ds = s0 * (night ? 6 : 5.2);
        ctx.drawImage(spr, X0 - ds / 2, Y0 - ds / 2, ds, ds);
      }
      if (pxs > -999 && near.length < 80) {
        var ndx = X0 - pxs, ndy = Y0 - pys;
        if (ndx * ndx + ndy * ndy < 16900 && al > 0.25) near.push(X0, Y0);
      }
    }

    /* cursor constellations */
    if (near.length > 4) {
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = night ? 'rgba(255,236,210,1)' : 'rgba(255,255,255,1)';
      for (q = 0; q < near.length; q += 2) {
        for (var w2 = q + 2; w2 < near.length; w2 += 2) {
          var lx = near[q] - near[w2], ly = near[q + 1] - near[w2 + 1], ld = lx * lx + ly * ly;
          if (ld < 2500) {
            ctx.globalAlpha = (1 - Math.sqrt(ld) / 50) * (night ? 0.4 : 0.7);
            ctx.beginPath(); ctx.moveTo(near[q], near[q + 1]); ctx.lineTo(near[w2], near[w2 + 1]); ctx.stroke();
          }
        }
      }
    }

    /* the loader hairline under the wordmark */
    if (phase === 'logo' && logo) {
      var lp = Math.min(1, Math.max(0, (now - phaseT - 900) / 1500));
      if (lp > 0) {
        var ly0 = logo.cy - sy + logo.h / 2 + 46, lw0 = logo.w * 0.5;
        ctx.globalAlpha = 0.9; ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(42,33,24,0.14)'; ctx.fillRect(W / 2 - lw0 / 2, ly0, lw0, 1.5);
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(W / 2 - lw0 / 2, ly0, lw0 * (1 - Math.pow(1 - lp, 3)), 1.5);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) running = false;
    else if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
  });
})();
