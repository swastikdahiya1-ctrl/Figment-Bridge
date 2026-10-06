(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const small = matchMedia('(max-width: 760px)').matches;
  const hasIO = 'IntersectionObserver' in window;
  const cfg = window.FIGMENT || {};
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* Year */
  const y = $('#year');
  if (y) y.textContent = new Date().getFullYear();

  /* Sticky nav blur */
  const nav = $('#nav');
  const onScrollNav = () => nav.classList.toggle('is-stuck', scrollY > 8);
  onScrollNav();
  addEventListener('scroll', onScrollNav, { passive: true });

  /* Smooth scroll (Lenis) on pointer devices only, never with reduced motion */
  let lenis = null;
  if (window.Lenis && fine && !reduced) {
    lenis = new window.Lenis({ lerp: 0.12 });
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  const jump = (target) => {
    const top = target.getBoundingClientRect().top + scrollY - 76;
    if (lenis) lenis.scrollTo(top, { duration: 1.1 });
    else scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href*="#"]');
    if (!a || a.matches('[data-checkout]')) return;
    const u = new URL(a.href, location.href);
    if (u.pathname !== location.pathname || !u.hash || u.hash.length < 2) return;
    const t = document.getElementById(decodeURIComponent(u.hash.slice(1)));
    if (!t) return;
    e.preventDefault();
    closeMenu();
    jump(t);
    history.replaceState(null, '', u.hash);
  });

  /* Mobile menu with focus trap */
  const toggle = $('#nav-toggle');
  const menu = $('#mobile-menu');
  function closeMenu(refocus) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    document.documentElement.style.overflow = '';
    if (lenis) lenis.start();
    if (refocus) toggle.focus();
  }
  function openMenu() {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close menu');
    document.documentElement.style.overflow = 'hidden';
    if (lenis) lenis.stop();
    nav.classList.add('is-stuck');
    const first = $('a', menu);
    if (first) first.focus();
  }
  if (toggle && menu) {
    toggle.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu(true)));
    document.addEventListener('keydown', (e) => {
      if (menu.hidden) return;
      if (e.key === 'Escape') return closeMenu(true);
      if (e.key !== 'Tab') return;
      const items = [toggle, ...$$('a', menu)];
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    matchMedia('(min-width: 961px)').addEventListener('change', (m) => m.matches && closeMenu());
  }

  /* Active section in the nav */
  const navLinks = $$('.nav-links a');
  if (location.pathname.startsWith('/pricing')) {
    navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === '/pricing/'));
  } else if (hasIO && location.pathname === '/') {
    const map = { features: '/#features', 'live-sync': '/#live-sync', pricing: '/pricing/', faq: '/#faq' };
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const href = map[en.target.id];
        navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === href));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('main > section').forEach((s) => io.observe(s));
  }

  /* Scroll reveals */
  const reveals = $$('.reveal');
  if (hasIO && !reduced) {
    reveals.forEach((el, i) => el.style.setProperty('--d', (i % 3) * 0.08 + 's'));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  } else reveals.forEach((el) => el.classList.add('in'));

  /* Pointer spotlight on cards */
  if (fine) {
    $$('.glow').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', e.clientX - r.left + 'px');
        el.style.setProperty('--my', e.clientY - r.top + 'px');
      });
    });
  }

  /* Pause/play buttons: aria-pressed="true" means paused */
  const setPressed = (btn, paused) => btn && btn.setAttribute('aria-pressed', String(paused));

  /* Hero video: user pause wins; otherwise play only while visible.
     The Figma/Blender chip follows the clip, which cuts to Blender at ~3.9s. */
  const hero = $('#hero-video');
  if (hero) {
    const btn = $('[data-media-toggle="hero-video"]');
    let userPaused = reduced;
    const chips = $$('.stage-apps .app');
    const setApp = (name) => chips.forEach((c) => c.classList.toggle('is-on', c.dataset.app === name));
    hero.addEventListener('timeupdate', () => setApp(hero.currentTime > 3.9 ? 'blender' : 'figma'));
    if (reduced) { hero.removeAttribute('autoplay'); hero.pause(); }
    setPressed(btn, userPaused);
    btn && btn.addEventListener('click', () => {
      userPaused = !userPaused;
      setPressed(btn, userPaused);
      userPaused ? hero.pause() : hero.play().catch(() => {});
    });
    if (hasIO) {
      new IntersectionObserver(([en]) => {
        if (en.isIntersecting && !userPaused) hero.play().catch(() => {});
        else hero.pause();
      }, { threshold: 0.1 }).observe(hero);
    }

    /* Gentle scale-up of the stage as it scrolls into view */
    const stage = $('#hero-stage');
    if (stage && !reduced) {
      let ticking = false;
      const update = () => {
        ticking = false;
        const top = stage.getBoundingClientRect().top;
        const p = clamp((innerHeight - top) / (innerHeight * 0.7), 0, 1);
        stage.style.setProperty('--st', p.toFixed(3));
      };
      update();
      addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    }
  }

  /* Feature videos: posters load near the viewport; on desktop a clip plays while its
     card is hovered or focused. Any click opens a larger player with controls. */
  const sources = (n, v) => {
    const add = (src, type) => { const s = document.createElement('source'); s.src = src; s.type = type; v.appendChild(s); };
    if (small) add(`/assets/video/${n}-sm.mp4`, 'video/mp4');
    else { add(`/assets/video/${n}.webm`, 'video/webm'); add(`/assets/video/${n}.mp4`, 'video/mp4'); }
  };
  const lazy = $$('video[data-lazy]');
  const loadVideo = (v) => {
    if (v.dataset.loaded) return;
    v.dataset.loaded = '1';
    sources(v.dataset.name, v);
    v.load();
  };
  if (hasIO) {
    const pio = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const v = en.target;
        if (v.dataset.poster) v.poster = v.dataset.poster;
        pio.unobserve(v);
      });
    }, { rootMargin: '300px 0px' });
    lazy.forEach((v) => pio.observe(v));
  } else lazy.forEach((v) => (v.poster = v.dataset.poster || ''));

  if (fine && !reduced) {
    $$('.card').forEach((card) => {
      const media = $('.card-media', card);
      const v = $('video[data-lazy]', card);
      if (!v) return;
      const start = () => { loadVideo(v); v.play().then(() => media.classList.add('is-playing')).catch(() => {}); };
      const stop = () => { v.pause(); media.classList.remove('is-playing'); };
      card.addEventListener('pointerenter', start);
      card.addEventListener('pointerleave', stop);
      card.addEventListener('focusin', start);
      card.addEventListener('focusout', stop);
    });
  }

  const lb = $('#lightbox');
  const lbv = $('#lb-video');
  if (lb && lbv && typeof lb.showModal === 'function') {
    $$('[data-lightbox]').forEach((b) => {
      b.addEventListener('click', () => {
        const card = b.closest('.card');
        const inline = card && $('video', card);
        if (inline) inline.pause();
        lbv.innerHTML = '';
        lbv.removeAttribute('src');
        sources(b.dataset.lightbox, lbv);
        lbv.poster = (inline && inline.dataset.poster) || '';
        lbv.setAttribute('aria-label', b.getAttribute('aria-label').replace('Play larger: ', ''));
        lbv.load();
        lb.showModal();
        if (lenis) lenis.stop();
        if (!reduced) lbv.play().catch(() => {});
      });
    });
    lb.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });
    lb.addEventListener('close', () => { lbv.pause(); if (lenis) lenis.start(); });
  }

  /* Live Sync illustration: retype the label in Figma, send it, update it in Blender.
     The timeline playhead keeps running throughout. Pausable, and idle when offscreen. */
  const demo = $('#sync-demo');
  if (demo) {
    const src = $('[data-sync-src]', demo);
    const dst = $('[data-sync-dst]', demo);
    const status = $('[data-sync-status]', demo);
    const head = $('.tl-head', demo);
    const frame = $('[data-frame]', demo);
    const btn = $('[data-demo-toggle="sync-demo"]');
    let paused = reduced, visible = false;
    const running = () => !paused && visible;
    setPressed(btn, paused);
    if (reduced) status.textContent = 'Synced';
    btn && btn.addEventListener('click', () => {
      paused = !paused;
      setPressed(btn, paused);
      demo.classList.toggle('is-paused', paused);
      if (!paused) begin();
    });
    if (hasIO) new IntersectionObserver(([en]) => { visible = en.isIntersecting; demo.classList.toggle('is-off', !visible); }, { threshold: 0.2 }).observe(demo);

    // Playhead driven from JS so pausing is exact.
    const LOOP = 8000;
    let t = 0, last = performance.now();
    head.style.animation = 'none';
    const tick = (now) => {
      const dt = now - last; last = now;
      if (running()) {
        t = (t + dt) % LOOP;
        head.style.left = `calc(${(t / LOOP) * 100}% - ${(t / LOOP) * 2}px)`;
        frame.textContent = 1 + Math.floor((t / LOOP) * 119);
      }
      requestAnimationFrame(tick);
    };

    const wait = (ms) => new Promise((res) => {
      let left = ms, prev = performance.now();
      const step = () => {
        const now = performance.now();
        if (running()) left -= now - prev;
        prev = now;
        left <= 0 ? res() : setTimeout(step, 30);
      };
      setTimeout(step, 30);
    });
    const words = ['Get started', 'Start free trial', 'Try it free'];
    let i = 0;
    const loop = async () => {
      for (;;) {
        status.textContent = 'Synced';
        await wait(1500);
        demo.classList.add('editing');
        status.textContent = 'Editing text';
        await wait(500);
        while (src.textContent.length) { src.textContent = src.textContent.slice(0, -1); await wait(32); }
        await wait(160);
        const next = words[(i = (i + 1) % words.length)];
        for (const ch of next) { src.textContent += ch; await wait(70); }
        await wait(380);
        demo.classList.remove('editing');
        demo.classList.add('sending');
        status.textContent = 'Sending to Blender';
        await wait(560);
        demo.classList.remove('sending');
        dst.textContent = next;
        demo.classList.add('landed');
        status.textContent = 'Updated in place. Keyframes untouched';
        await wait(1200);
        demo.classList.remove('landed');
        await wait(1400);
      }
    };
    let started = false;
    function begin() { if (started) return; started = true; last = performance.now(); requestAnimationFrame(tick); loop(); }
    if (!reduced) begin();
  }

  /* Layer Distance: interactive stack */
  const ld = $('#ld');
  if (ld) {
    const range = $('#ld-range', ld);
    const out = $('#ld-out', ld);
    const plane = $('.ld-plane', ld);
    let anim = 0, touched = false;
    const set = (v) => {
      v = clamp(Math.round(v), 0, 100);
      range.value = v;
      plane.style.setProperty('--s', (v / 100).toFixed(3));
      range.style.setProperty('--p', v + '%');
      out.textContent = (v / 100).toFixed(2);
      range.setAttribute('aria-valuetext', `Layer distance ${(v / 100).toFixed(2)}`);
    };
    const animateTo = (to, dur = 900) => {
      cancelAnimationFrame(anim);
      if (reduced) return set(to);
      const from = +range.value, t0 = performance.now();
      const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
      const step = (now) => {
        const p = clamp((now - t0) / dur, 0, 1);
        set(from + (to - from) * ease(p));
        if (p < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    };
    set(0);
    range.addEventListener('input', () => { touched = true; cancelAnimationFrame(anim); set(+range.value); });
    $$('[data-ld]', ld).forEach((b) => b.addEventListener('click', () => { touched = true; animateTo(+b.dataset.ld); }));
    if (hasIO) {
      const io = new IntersectionObserver(([en]) => {
        if (!en.isIntersecting) return;
        io.disconnect();
        setTimeout(() => { if (!touched) animateTo(60, 1400); }, 350);
      }, { threshold: 0.45 });
      io.observe(ld);
    } else set(60);
  }

  /* Checkout buttons: product IDs and URLs come from site.config.json at build time.
     Hook: define window.FIGMENT.checkout = (tier, productId) => true to take over (e.g. a provider overlay). */
  const toast = $('#toast');
  let tt;
  const say = (msg) => {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(tt);
    tt = setTimeout(() => (toast.hidden = true), 5000);
  };
  $$('a[data-checkout]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const tier = a.dataset.checkout;
      if (typeof cfg.checkout === 'function' && cfg.checkout(tier, a.dataset.product) === true) { e.preventDefault(); return; }
      if (a.getAttribute('href') === '#checkout-not-connected') {
        e.preventDefault();
        say('Checkout is not connected yet. Please check back soon.');
      }
    });
  });

  /* Analytics placeholder: nothing loads unless enabled in site.config.json */
  if (cfg.analyticsEnabled && cfg.analyticsUrl) {
    const s = document.createElement('script');
    s.src = cfg.analyticsUrl;
    s.defer = true;
    document.head.appendChild(s);
  }
})();
