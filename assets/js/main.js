/* astra — the page is simply there. Only navigation and the form need script. */
(function () {
  /* Lenis smooth scrolling (skipped under reduced motion; touch stays native) */
  if (window.Lenis && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var lenis = new Lenis({ lerp: 0.095, smoothWheel: true });
    var lenisRaf = function (t) { lenis.raf(t); requestAnimationFrame(lenisRaf); };
    requestAnimationFrame(lenisRaf);
  }

  /* Loading screen: logo among stars, then the site */
  var root = document.documentElement;
  if (root.classList.contains('astra-loading')) {
    var loader = document.querySelector('.loader');
    setTimeout(function () {
      if (loader) loader.classList.add('leaving');
      setTimeout(function () {
        root.classList.remove('astra-loading');
        root.classList.add('astra-done');
        try { sessionStorage.setItem('astra-seen', '1'); } catch (e) {}
        if (window.__astraField) window.__astraField();
      }, 400);
    }, 1900);
  }


  /* Starfield: hyperspace arrival, cursor constellations, shooting stars.
     Decorative only: skipped under reduced motion, paused off-screen. */
  var field = document.querySelector('canvas.starfield');
  var noMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (field && !noMotion && field.getContext) {
    var fx = field.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var mobileF = window.matchMedia('(max-width: 767px)').matches;
    var COUNT = mobileF ? 70 : 160;
    var WARP = 1100;
    var W2, H2, CX, CY, maxR;
    var stars = [];
    var mx = -9999, my = -9999, pmx = -9999, pmy = -9999;
    var t0 = null, raf = 0, live = false, inView = true;
    var nextShoot = 0, shot = null;

    var glow = document.createElement('canvas');
    glow.width = glow.height = 32;
    var gx = glow.getContext('2d');
    var grad = gx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    gx.fillStyle = grad;
    gx.fillRect(0, 0, 32, 32);

    function sizeField() {
      var r = field.parentElement.getBoundingClientRect();
      W2 = r.width; H2 = r.height;
      CX = W2 * 0.5; CY = H2 * 0.44;
      maxR = Math.hypot(W2, H2) * 0.55;
      field.width = Math.round(W2 * dpr);
      field.height = Math.round(H2 * dpr);
      fx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seed() {
      stars.length = 0;
      for (var i = 0; i < COUNT; i++) {
        stars.push({
          a: Math.random() * Math.PI * 2,
          d: Math.pow(Math.random(), 0.6),
          x: 0, y: 0,
          z: 0.35 + Math.random() * 0.65,
          r: 0.6 + Math.random() * 1.7,
          tw: Math.random() * Math.PI * 2,
          ts: 0.4 + Math.random() * 1.2,
          vx: 0.10 + Math.random() * 0.22,
          brand: Math.random() < 0.05,
          bronze: Math.random() < 0.12
        });
      }
    }

    function starPath(x, y, s) {
      fx.beginPath();
      fx.moveTo(x, y - s);
      fx.quadraticCurveTo(x + s * 0.14, y - s * 0.14, x + s, y);
      fx.quadraticCurveTo(x + s * 0.14, y + s * 0.14, x, y + s);
      fx.quadraticCurveTo(x - s * 0.14, y + s * 0.14, x - s, y);
      fx.quadraticCurveTo(x - s * 0.14, y - s * 0.14, x, y - s);
      fx.closePath();
    }

    function frame(t) {
      if (!live) return;
      if (t0 === null) t0 = t;
      var el = t - t0;
      var k = Math.min(el / WARP, 1);
      var easeK = 1 - Math.pow(1 - k, 3);
      fx.clearRect(0, 0, W2, H2);

      pmx += (mx - pmx) * 0.06;
      pmy += (my - pmy) * 0.06;
      var offx = pmx > -999 ? (pmx - CX) : 0;
      var offy = pmy > -999 ? (pmy - CY) : 0;

      var i, s;
      for (i = 0; i < stars.length; i++) {
        s = stars[i];
        var target = (0.05 + s.d * 0.95) * maxR;
        if (k < 1) {
          var head = target * easeK + maxR * 0.02;
          var tailK = Math.max(k - 0.10, 0);
          var tail = target * (1 - Math.pow(1 - tailK, 3)) + maxR * 0.02;
          var x1 = CX + Math.cos(s.a) * tail, y1 = CY + Math.sin(s.a) * tail;
          var x2 = CX + Math.cos(s.a) * head, y2 = CY + Math.sin(s.a) * head;
          fx.strokeStyle = 'rgba(254,254,254,' + (0.55 * s.z * (0.4 + 0.6 * (1 - k))) + ')';
          fx.lineWidth = s.z * 1.5;
          fx.beginPath(); fx.moveTo(x1, y1); fx.lineTo(x2, y2); fx.stroke();
          s.x = x2; s.y = y2;
        } else {
          s.x += s.vx * s.z * (mobileF ? 0.05 : 0.09);
          if (s.x > W2 + 24) s.x = -24;
          if (s.x < -25) s.x = W2 + 23;
          var tw = 0.55 + 0.45 * Math.sin(t / 1000 * s.ts + s.tw);
          var px = s.x + offx * s.z * 0.035;
          var py = s.y + offy * s.z * 0.035;
          var al = (0.22 + 0.55 * tw) * s.z;
          if (s.brand) {
            fx.fillStyle = s.bronze ? 'rgba(156,107,63,' + al + ')' : 'rgba(254,254,254,' + (al * 0.95) + ')';
            starPath(px, py, 3 + s.r * 2.4);
            fx.fill();
          } else {
            fx.globalAlpha = al * (s.bronze ? 0.75 : 1);
            var d6 = s.r * 6;
            fx.drawImage(glow, px - d6 / 2, py - d6 / 2, d6, d6);
            fx.globalAlpha = 1;
          }
          s.cx = px; s.cy = py;
        }
      }

      /* Constellations gather around the visitor's cursor */
      if (k >= 1 && mx > -999 && !mobileF) {
        var near = [];
        for (i = 0; i < stars.length; i++) {
          s = stars[i];
          var dx = s.cx - pmx, dy = s.cy - pmy;
          var dd = dx * dx + dy * dy;
          if (dd < 24025) near.push(s);
        }
        for (i = 0; i < near.length && i < 26; i++) {
          for (var j = i + 1; j < near.length && j < 26; j++) {
            var ddx = near[i].cx - near[j].cx, ddy = near[i].cy - near[j].cy;
            var dist2 = Math.hypot(ddx, ddy);
            if (dist2 < 112) {
              fx.strokeStyle = 'rgba(42,33,24,' + (0.30 * (1 - dist2 / 112)) + ')';
              fx.lineWidth = 1;
              fx.beginPath();
              fx.moveTo(near[i].cx, near[i].cy);
              fx.lineTo(near[j].cx, near[j].cy);
              fx.stroke();
            }
          }
        }
      }

      /* A shooting star every few seconds */
      if (k >= 1) {
        if (!shot && t > nextShoot) {
          var ang = Math.PI * (0.12 + Math.random() * 0.14);
          shot = {
            x: W2 * (0.15 + Math.random() * 0.7),
            y: H2 * (0.06 + Math.random() * 0.25),
            dx: Math.cos(ang) * (Math.random() < 0.5 ? 1 : -1),
            dy: Math.sin(ang),
            born: t
          };
        }
        if (shot) {
          var sk = (t - shot.born) / 800;
          if (sk >= 1) {
            shot = null;
            nextShoot = t + 5200 + Math.random() * 5200;
          } else {
            var run = 230 * sk;
            var hx = shot.x + shot.dx * run, hy = shot.y + shot.dy * run;
            var tx = hx - shot.dx * 130, ty = hy - shot.dy * 130;
            var fade = sk < 0.2 ? sk / 0.2 : (1 - sk) / 0.8;
            var lg = fx.createLinearGradient(tx, ty, hx, hy);
            lg.addColorStop(0, 'rgba(254,254,254,0)');
            lg.addColorStop(1, 'rgba(254,254,254,' + (0.8 * fade) + ')');
            fx.strokeStyle = lg;
            fx.lineWidth = 1.6;
            fx.beginPath(); fx.moveTo(tx, ty); fx.lineTo(hx, hy); fx.stroke();
            fx.fillStyle = 'rgba(254,254,254,' + fade + ')';
            starPath(hx, hy, 4);
            fx.fill();
          }
        }
      }

      raf = requestAnimationFrame(frame);
    }

    function play() {
      if (live || !inView || document.hidden) return;
      live = true;
      raf = requestAnimationFrame(frame);
    }
    function halt() {
      live = false;
      if (raf) cancelAnimationFrame(raf);
    }

    sizeField();
    seed();
    window.addEventListener('resize', function () { sizeField(); });
    window.addEventListener('mousemove', function (e) {
      var r = field.getBoundingClientRect();
      mx = e.clientX - r.left;
      my = e.clientY - r.top;
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) halt(); else play();
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        inView = en[0].isIntersecting;
        if (inView) play(); else halt();
      }).observe(field);
    }
    window.__astraField = play;
    if (!root.classList.contains('astra-loading')) play();
  }

  /* Scroll reveals: pop into place, staggered per section */
  var canPop = !window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window;
  if (canPop) {
    var popSel = [
      '.statement .wrap > *',
      '.protocol-head > *',
      '.station',
      '.services-head > *',
      '.svc',
      '.close-flood .wrap > *',
      '.page-head nav', '.page-head h1', '.page-head .lede',
      '.band h2', '.band .prose', '.band .muted',
      '.steps .step',
      '.inclusions li',
      '.form-grid form', '.form-grid h2'
    ].join(',');
    var seen = [];
    var counts = {};
    document.querySelectorAll(popSel).forEach(function (el) {
      if (el.closest('.hero') || el.classList.contains('pop')) return;
      var sec = el.closest('section') || document.body;
      var ix = seen.indexOf(sec);
      if (ix === -1) { seen.push(sec); ix = seen.length - 1; counts[ix] = 0; }
      el.classList.add('pop');
      el.style.setProperty('--pd', (Math.min(counts[ix], 7) * 75) + 'ms');
      counts[ix]++;
    });
    var popIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        popIO.unobserve(e.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('.pop').forEach(function (el) { popIO.observe(el); });
  }


  /* Services in orbit around an invisible planet (falls back to the list) */
  var svcSection = document.querySelector('.services');
  var svcLinks = svcSection ? [].slice.call(svcSection.querySelectorAll('.svc')) : [];
  var orbitOK = svcSection && svcLinks.length === 3 &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (orbitOK) {
    var wrapEl = svcSection.querySelector('.wrap');
    var scene = document.createElement('div');
    scene.className = 'orbit-scene';
    scene.innerHTML =
      '<svg class="orbit-star" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C12.9 7.4 16.6 11.1 24 12c-7.4.9-11.1 4.6-12 12-.9-7.4-4.6-11.1-12-12 7.4-.9 11.1-4.6 12-12Z"/></svg>' +
      '<svg class="orbit-star" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C12.9 7.4 16.6 11.1 24 12c-7.4.9-11.1 4.6-12 12-.9-7.4-4.6-11.1-12-12 7.4-.9 11.1-4.6 12-12Z"/></svg>' +
      '<svg class="orbit-star" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C12.9 7.4 16.6 11.1 24 12c-7.4.9-11.1 4.6-12 12-.9-7.4-4.6-11.1-12-12 7.4-.9 11.1-4.6 12-12Z"/></svg>';
    wrapEl.appendChild(scene);
    svcLinks.forEach(function (a) { a.classList.remove('pop'); a.classList.add('in'); scene.appendChild(a); });
    svcSection.classList.add('orbiting');

    var RX, RY, CXo, CYo;
    function sizeOrbit() {
      var r = scene.getBoundingClientRect();
      var mob = r.width < 640;
      if (mob) {
        /* geometry tuned so side chips can never collide: RX*sqrt(3) > chip width */
        RX = Math.max(r.width / 2 - 90, 96);
        RY = r.height * 0.26;
      } else {
        RX = Math.min(r.width * 0.44, 470);
        RY = r.height * 0.17;
      }
      CXo = r.width / 2;
      CYo = r.height * (mob ? 0.44 : 0.47);
    }

    var angle = -Math.PI / 2;
    var speed = (Math.PI * 2) / 22000;
    var curSpeed = speed;
    var target = speed;
    var lastT = null, orbitRaf = 0, orbitLive = false, orbitInView = true;

    function orbitFrame(t) {
      if (!orbitLive) return;
      if (lastT === null) lastT = t;
      var dt = Math.min(t - lastT, 50);
      lastT = t;
      curSpeed += (target - curSpeed) * 0.06;
      angle += curSpeed * dt;
      for (var i = 0; i < 3; i++) {
        var a = angle + i * (Math.PI * 2 / 3);
        var x = CXo + Math.cos(a) * RX;
        var y = CYo + Math.sin(a) * RY;
        var depth = (Math.sin(a) + 1) / 2;
        var sc = 0.58 + 0.48 * depth;
        var el = svcLinks[i];
        el.style.transform = 'translate(-50%, -50%) translate(' + x + 'px,' + y + 'px) scale(' + sc + ')';
        el.style.opacity = (0.38 + 0.62 * depth).toFixed(3);
        el.style.zIndex = depth > 0.52 ? 20 : 6;
        el.classList.toggle('front', depth > 0.86);
      }
      orbitRaf = requestAnimationFrame(orbitFrame);
    }
    function orbitPlay() {
      if (orbitLive || !orbitInView || document.hidden) return;
      orbitLive = true; lastT = null;
      orbitRaf = requestAnimationFrame(orbitFrame);
    }
    function orbitHalt() {
      orbitLive = false;
      if (orbitRaf) cancelAnimationFrame(orbitRaf);
    }

    scene.addEventListener('mouseenter', function () { target = 0; });
    scene.addEventListener('mouseleave', function () { target = speed; });
    window.addEventListener('resize', sizeOrbit);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) orbitHalt(); else orbitPlay();
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        orbitInView = en[0].isIntersecting;
        if (orbitInView) orbitPlay(); else orbitHalt();
      }, { rootMargin: '80px' }).observe(scene);
    }
    sizeOrbit();
    orbitPlay();
  }

  /* Space crossing: scrolling to the services turns the site into night sky */
  var svcZone = document.querySelector('.services');
  var spaceOK = svcZone && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (spaceOK) {
    var sky = document.createElement('canvas');
    sky.id = 'spacefield';
    sky.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sky);
    var kx = sky.getContext('2d');
    var kdpr = Math.min(window.devicePixelRatio || 1, 2);
    var KW, KH, dust = [];
    var skyLive = false, skyRaf = 0;
    var themeTimer = 0;

    function skySize() {
      KW = window.innerWidth; KH = window.innerHeight;
      sky.width = Math.round(KW * kdpr);
      sky.height = Math.round(KH * kdpr);
      kx.setTransform(kdpr, 0, 0, kdpr, 0, 0);
    }
    function skySeed() {
      dust.length = 0;
      var n = KW < 768 ? 110 : 230;
      for (var i = 0; i < n; i++) {
        dust.push({
          x: Math.random() * KW,
          y: Math.random() * KH,
          z: 0.3 + Math.random() * 0.7,
          r: 0.5 + Math.random() * 1.5,
          tw: Math.random() * Math.PI * 2,
          ts: 0.3 + Math.random() * 1.1,
          gold: Math.random() < 0.16,
          brand: Math.random() < 0.03
        });
      }
    }
    function skyStar(x, y, s) {
      kx.beginPath();
      kx.moveTo(x, y - s);
      kx.quadraticCurveTo(x + s * 0.14, y - s * 0.14, x + s, y);
      kx.quadraticCurveTo(x + s * 0.14, y + s * 0.14, x, y + s);
      kx.quadraticCurveTo(x - s * 0.14, y + s * 0.14, x - s, y);
      kx.quadraticCurveTo(x - s * 0.14, y - s * 0.14, x, y - s);
      kx.closePath();
    }
    function skyFrame(t) {
      if (!skyLive) return;
      kx.clearRect(0, 0, KW, KH);
      for (var i = 0; i < dust.length; i++) {
        var s = dust[i];
        s.x += 0.012 * s.z;
        if (s.x > KW + 8) s.x = -8;
        var tw = 0.5 + 0.5 * Math.sin(t / 1000 * s.ts + s.tw);
        var al = (0.25 + 0.6 * tw) * s.z;
        if (s.brand) {
          kx.fillStyle = 'rgba(254,254,254,' + (al * 0.9) + ')';
          skyStar(s.x, s.y, 3.4 + s.r * 2);
          kx.fill();
        } else {
          kx.fillStyle = s.gold
            ? 'rgba(216,177,131,' + (al * 0.85) + ')'
            : 'rgba(244,240,232,' + al + ')';
          kx.beginPath();
          kx.arc(s.x, s.y, s.r, 0, 6.2832);
          kx.fill();
        }
      }
      skyRaf = requestAnimationFrame(skyFrame);
    }
    function skyPlay() {
      if (skyLive || document.hidden || !root.classList.contains('space')) return;
      skyLive = true;
      skyRaf = requestAnimationFrame(skyFrame);
    }
    function skyHalt() {
      skyLive = false;
      if (skyRaf) cancelAnimationFrame(skyRaf);
    }
    var forceSpace = location.search.indexOf('forcespace') !== -1;
    function setSpace(on) {
      if (forceSpace) on = true;
      if (root.classList.contains('space') === on) return;
      root.classList.add('theme-anim');
      root.classList.toggle('space', on);
      clearTimeout(themeTimer);
      themeTimer = setTimeout(function () { root.classList.remove('theme-anim'); }, 1000);
      if (on) skyPlay(); else setTimeout(skyHalt, 1000);
    }

    skySize();
    skySeed();
    if (forceSpace) { root.classList.add('space'); skyPlay(); }
    window.addEventListener('resize', function () { skySize(); skySeed(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) skyHalt(); else skyPlay();
    });

    var sentinel = document.createElement('div');
    sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px;pointer-events:none;';
    svcZone.style.position = 'relative';
    svcZone.insertBefore(sentinel, svcZone.firstChild);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        var e = en[0];
        var line = e.rootBounds ? e.rootBounds.bottom : window.innerHeight * 0.62;
        setSpace(e.boundingClientRect.top < line);
      }, { rootMargin: '0px 0px -38% 0px', threshold: [0, 1] }).observe(sentinel);
    }
  }

  /* Mobile nav */
  var btn = document.querySelector('.menu-btn');
  var nav = document.querySelector('.nav-cells');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* Hero CTA: the star settles while the visitor aims at the action */
  var cta = document.querySelector('.hero-cta .btn');
  var star = document.querySelector('.hero-star');
  if (cta && star) {
    cta.addEventListener('mouseenter', function () { star.classList.add('still'); });
    cta.addEventListener('mouseleave', function () { star.classList.remove('still'); });
  }

  /* Contact form: inline validation + fetch submit */
  var form = document.querySelector('form[data-contact]');
  if (form) {
    var status = form.querySelector('.form-status');
    form.addEventListener('submit', function (ev) {
      var invalid = false;
      form.querySelectorAll('[required]').forEach(function (input) {
        var field = input.closest('.field');
        var bad = !input.value.trim() || (input.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.value));
        field.classList.toggle('invalid', bad);
        if (bad) invalid = true;
      });
      if (invalid) { ev.preventDefault(); return; }

      var action = form.getAttribute('action') || '';
      if (action.indexOf('REPLACE') !== -1) return; /* endpoint not configured: normal POST shows provider error */
      ev.preventDefault();
      var data = new FormData(form);
      fetch(action, { method: 'POST', body: data, headers: { Accept: 'application/json' } })
        .then(function (r) {
          if (r.ok) {
            form.reset();
            status.textContent = 'Received. We reply within one working day.';
            status.className = 'form-status ok';
          } else { throw new Error('bad'); }
        })
        .catch(function () {
          status.textContent = 'Something failed on the way. Email us instead: hello@astramarketing.gr';
          status.className = 'form-status fail';
        });
    });
  }
})();
