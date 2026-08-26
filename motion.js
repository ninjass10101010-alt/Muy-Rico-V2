/* Muy Rico — shared motion system (Editorial Panadería)
   Warm, confident, unhurried. One orchestrated moment per viewport.
   Owns: GSAP CDN-failure stubbing, scroll reveals (data-motion), group
   staggers, scrubbed parallax, magnetic CTAs. Ambient floats are CSS. */
(function () {
  'use strict';

  var docEl = document.documentElement;

  /* Resilience: if the GSAP CDN failed, stub the animation API and reveal
     all content via CSS (.no-gsap). Mirrors the previous per-page stubs,
     including the onComplete-after-delay `to` used by the order cart. */
  if (typeof window.gsap === 'undefined' || typeof window.ScrollTrigger === 'undefined') {
    var noop = function () {};
    var chain = {
      add: function () { return this; },
      from: function () { return this; },
      to: function () { return this; },
      fromTo: function () { return this; },
      set: function () { return this; }
    };
    window.gsap = {
      registerPlugin: noop,
      set: noop,
      from: noop,
      fromTo: noop,
      to: function (t, vars) {
        if (vars && vars.onComplete) setTimeout(vars.onComplete, ((vars.delay || 0) * 1000) + 400);
      },
      getProperty: function () { return 0; },
      timeline: function () {
        var t = {};
        ['add', 'from', 'to', 'fromTo', 'set'].forEach(function (m) { t[m] = chain[m]; });
        return t;
      },
      utils: { toArray: function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); } }
    };
    window.ScrollTrigger = window.ScrollTrigger || { getAll: function () { return []; }, create: noop };
    docEl.classList.add('no-gsap');
  }

  gsap.registerPlugin(ScrollTrigger);

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var active = !reduced && !docEl.classList.contains('no-gsap');
  if (active) docEl.classList.add('js-motion');

  var TOKENS = {
    fast: 0.22,
    revealDur: 0.8,
    heroDur: 1.1,
    stagger: 0.09,
    riseY: 24,
    maxParallax: 40,
    startReveal: 'top 88%'
  };

  var FROM = {
    rise: { y: TOKENS.riseY, autoAlpha: 0 },
    fade: { autoAlpha: 0 },
    clip: { y: 14, clipPath: 'inset(100% 0% 0% 0%)', autoAlpha: 1 },
    scale: { scale: 1.06, autoAlpha: 0 }
  };
  var TO = {
    rise: { y: 0, autoAlpha: 1 },
    fade: { autoAlpha: 1 },
    clip: { y: 0, clipPath: 'inset(0% 0% 0% 0%)', autoAlpha: 1 },
    scale: { scale: 1, autoAlpha: 1 }
  };

  function variantOf(el) {
    var v = el.getAttribute('data-motion');
    if (!v && el.classList.contains('reveal')) v = 'rise';
    return FROM[v] ? v : 'rise';
  }

  function bindSingle(el) {
    el.dataset.motionBound = '1';
    var v = variantOf(el);
    var vars = {};
    for (var k in TO[v]) vars[k] = TO[v][k];
    vars.scrollTrigger = { trigger: el, start: TOKENS.startReveal, toggleActions: 'play none none reverse' };
    vars.duration = TOKENS.revealDur;
    vars.ease = 'power3.out';
    gsap.fromTo(el, FROM[v], vars);
  }

  function bindGroup(group) {
    group.dataset.groupBound = '1';
    var kids = Array.prototype.slice.call(group.children).filter(function (c) {
      return c.matches('[data-motion], .reveal') && !c.dataset.motionBound;
    });
    if (!kids.length) return;
    var tl = gsap.timeline({
      scrollTrigger: { trigger: group, start: TOKENS.startReveal, toggleActions: 'play none none reverse' }
    });
    kids.forEach(function (kid, i) {
      kid.dataset.motionBound = '1';
      var v = variantOf(kid);
      var to = {};
      for (var k in TO[v]) to[k] = TO[v][k];
      to.duration = TOKENS.revealDur;
      to.ease = 'power3.out';
      tl.fromTo(kid, FROM[v], to, i * TOKENS.stagger);
    });
  }

  function targets(root) {
    var scope = root && root !== document ? root : document;
    return gsap.utils.toArray('[data-motion], .reveal').filter(function (el) {
      return scope === document || scope.contains(el);
    }).filter(function (el) { return !el.dataset.motionBound; });
  }

  /* Idempotent: safe to call again after dynamic content injection. */
  function bindReveals(root) {
    if (!active) return;
    targets(root).forEach(function (el) {
      var group = el.parentElement ? el.parentElement.closest('[data-motion-group]') : null;
      if (group && !group.dataset.groupBound) {
        bindGroup(group);
      } else if (!el.dataset.motionBound) {
        bindSingle(el);
      }
    });
    ScrollTrigger.refresh();
  }

  function bindParallax() {
    if (!active) return;
    gsap.utils.toArray('[data-parallax]').forEach(function (el) {
      var n = parseFloat(el.getAttribute('data-parallax')) || 30;
      n = Math.min(Math.abs(n), TOKENS.maxParallax);
      var scope = el.closest('section, figure, .section') || el;
      gsap.fromTo(el, { y: n }, {
        y: -n, ease: 'none',
        scrollTrigger: { trigger: scope, start: 'top bottom', end: 'bottom top', scrub: true }
      });
    });
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function bindMagnetic() {
    if (!active) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    gsap.utils.toArray('[data-magnetic]').forEach(function (el) {
      var xTo = gsap.quickTo(el, 'x', { duration: 0.35, ease: 'power3.out' });
      var yTo = gsap.quickTo(el, 'y', { duration: 0.35, ease: 'power3.out' });
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        xTo(clamp((e.clientX - (r.left + r.width / 2)) * 0.18, -6, 6));
        yTo(clamp((e.clientY - (r.top + r.height / 2)) * 0.18, -6, 6));
      });
      el.addEventListener('mouseleave', function () { xTo(0); yTo(0); });
      el.addEventListener('mousedown', function () { gsap.to(el, { scale: 0.97, duration: 0.12 }); });
      el.addEventListener('mouseup', function () { gsap.to(el, { scale: 1, duration: 0.2 }); });
    });
  }

  function init(config) {
    config = config || {};
    if (!active) return;
    bindReveals(document);
    bindParallax();
    bindMagnetic();
    if (typeof config.hero === 'function') {
      config.hero({ gsap: gsap, ScrollTrigger: ScrollTrigger, TOKENS: TOKENS });
    }
  }

  window.MuyRicoMotion = {
    init: init,
    bindReveals: bindReveals,
    refresh: function () { if (active) ScrollTrigger.refresh(); },
    TOKENS: TOKENS
  };
})();
