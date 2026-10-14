/* Container & Truck Load Planner — components/tour.js
 * First-run guided tour: dims the page, highlights one area at a time and explains it in a small card.
 * Starts automatically on the first visit (remembered in localStorage), again from File → "Guided tour",
 * or with index.html?tour=1 (linked from the manual). Not shown during automated UI tests.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};
  var KEY = 'lp.tour.v1';

  // target: CSS selector of the area to highlight (the first visible match); missing targets are skipped
  var STEPS = [
    { target: null, key: 'tourWelcome' },
    { target: '#stepContainer', key: 'tourContainer' },
    { target: '#stepCargo', key: 'tourCargo' },
    { target: '#btnPack', key: 'tourPack' },
    { target: '#stage', key: 'tourStage' },
    { target: '.insights', key: 'tourInsights' },
    { target: '#btnHelp', key: 'tourHelp' }
  ];

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }
  function find(sel) {
    if (!sel) return null;
    var list = document.querySelectorAll(sel);
    for (var i = 0; i < list.length; i++) if (visible(list[i])) return list[i];
    return null;
  }

  LP.tourSeen = function () {
    try { return !!localStorage.getItem(KEY); } catch (e) { return true; }
  };

  LP.startTour = function () {
    if (document.querySelector('.tour')) return;
    var t = LP.t;
    var steps = STEPS.filter(function (s) { return !s.target || find(s.target); });
    var i = 0;
    var wrap = document.createElement('div');
    wrap.className = 'tour';
    wrap.innerHTML = '<div class="tour-spot"></div><div class="tour-card" role="dialog" aria-live="polite">' +
      '<div class="tour-t"></div><div class="tour-x"></div>' +
      '<div class="tour-f"><span class="tour-n"></span><span class="sp"></span>' +
      '<button class="btn ghost sm" data-skip></button><button class="btn sm" data-prev></button><button class="btn primary sm" data-next></button></div></div>';
    document.body.appendChild(wrap);
    var spot = wrap.querySelector('.tour-spot'), card = wrap.querySelector('.tour-card');

    function done() {
      try { localStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
      wrap.remove();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('keydown', onKey, true);
    }
    function place() {
      var s = steps[i], el = find(s.target);
      var vw = window.innerWidth, vh = window.innerHeight, pad = 6;
      if (!el) {   // centred card, whole page dimmed
        spot.style.cssText = 'left:50%;top:50%;width:0;height:0';
        card.style.left = Math.max(16, (vw - card.offsetWidth) / 2) + 'px';
        card.style.top = Math.max(16, (vh - card.offsetHeight) / 2) + 'px';
        return;
      }
      var r = el.getBoundingClientRect();
      var x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
      var w = Math.min(vw - 8, r.right + pad) - x, h = Math.min(vh - 8, r.bottom + pad) - y;
      spot.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + Math.max(0, w) + 'px;height:' + Math.max(0, h) + 'px';
      var cw = card.offsetWidth, ch = card.offsetHeight, gap = 12, cx, cy;
      if (vw < 640) {               // phones: card pinned to the bottom (or top if the target is down there)
        cx = 12; cy = (y + h / 2 > vh / 2) ? 12 : vh - ch - 12;
      } else if (x + w + gap + cw < vw - 8) { cx = x + w + gap; cy = y; }        // right of the target
      else if (x - gap - cw > 8) { cx = x - gap - cw; cy = y; }                   // left
      else if (y + h + gap + ch < vh - 8) { cx = x; cy = y + h + gap; }           // below
      else { cx = x; cy = Math.max(8, y - gap - ch); }                           // above
      card.style.left = Math.min(Math.max(8, cx), vw - cw - 8) + 'px';
      card.style.top = Math.min(Math.max(8, cy), vh - ch - 8) + 'px';
    }
    function show() {
      var s = steps[i], el = find(s.target);
      card.querySelector('.tour-t').textContent = t(s.key + 'T');
      card.querySelector('.tour-x').textContent = t(s.key);
      card.querySelector('.tour-n').textContent = (i + 1) + ' / ' + steps.length;
      card.querySelector('[data-skip]').textContent = t('tourSkip');
      card.querySelector('[data-skip]').style.display = i === steps.length - 1 ? 'none' : '';
      var prev = card.querySelector('[data-prev]');
      prev.textContent = t('tourPrev');
      prev.style.display = i ? '' : 'none';
      card.querySelector('[data-next]').textContent = i === steps.length - 1 ? t('tourDone') : i ? t('tourNext') : t('tourStart');
      wrap.classList.toggle('no-target', !el);
      if (el) {
        var r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: r.height > window.innerHeight * 0.7 ? 'start' : 'center' });
      }
      place();
      // follow the target while a smooth scroll or a re-render settles
      var t0 = performance.now();
      (function follow() { if (!wrap.isConnected) return; place(); if (performance.now() - t0 < 700) requestAnimationFrame(follow); })();
      card.querySelector('[data-next]').focus({ preventScroll: true });
    }
    function go(d) {
      i += d;
      if (i >= steps.length) { done(); return; }
      i = Math.max(0, i);
      show();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(-1); }
    }
    wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-next]')) go(1);
      else if (e.target.closest('[data-prev]')) go(-1);
      else if (e.target.closest('[data-skip]')) done();
    });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('keydown', onKey, true);
    show();
  };
})(this);
