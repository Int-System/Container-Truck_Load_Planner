/* Container & Truck Load Planner — utils/dom.js  (tiny DOM helpers: escape, modal, toast) */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};
  LP.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /** Open a modal. opts: {title, body (html), okText, onOk(root) → false to keep open, wide, onOpen(root)} */
  /** Small "?" link that opens the user manual (manual.html) at a section: start, container, cargo, pack,
   *  results, manual, loading, documents, multi, save, faq, glossary. */
  LP.helpLink = function (anchor, cls) {
    return '<a class="hl' + (cls ? ' ' + cls : '') + '" href="manual.html#' + anchor + '" target="_blank" rel="noopener" title="' +
      LP.esc(LP.t('helpHere')) + '" aria-label="' + LP.esc(LP.t('helpHere')) + '">?</a>';
  };

  LP.modal = function (opts) {
    var wrap = document.createElement('div');
    wrap.className = 'modal-bg';
    wrap.innerHTML = '<div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h2>' + LP.esc(opts.title || '') + '</h2>' + (opts.help ? LP.helpLink(opts.help) : '') + '<button class="icon-btn" data-x aria-label="close">✕</button></div>' +
      '<div class="modal-b">' + (opts.body || '') + '</div>' +
      '<div class="modal-f">' + (opts.extraFooter || '') + '<span class="sp"></span>' +
      '<button class="btn ghost" data-x>' + LP.esc(opts.cancelText || LP.t('cancel')) + '</button>' +
      (opts.onOk ? '<button class="btn primary" data-ok>' + LP.esc(opts.okText || LP.t('ok')) + '</button>' : '') + '</div></div>';
    document.body.appendChild(wrap);
    function close() { wrap.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Enter' && opts.onOk && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') { e.preventDefault(); e.stopPropagation(); ok(); }
    }
    function ok() { if (opts.onOk(wrap) !== false) close(); }
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap || e.target.closest('[data-x]')) close();
      if (e.target.closest('[data-ok]')) ok();
    });
    document.addEventListener('keydown', onKey, true);
    if (opts.onOpen) opts.onOpen(wrap, close);
    var first = wrap.querySelector('input,select');
    if (first) setTimeout(function () { first.focus(); }, 30);
    return { el: wrap, close: close };
  };

  var toastTimer;
  LP.toast = function (msg, tone) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show ' + (tone || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3200);
  };
})(this);
