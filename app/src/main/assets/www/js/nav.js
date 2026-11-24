/* IPTV+ — spatial navigation for TV remotes (D-pad) + touch */
(function () {
  'use strict';

  var Nav = { current: null, roots: [], handler: null };
  var EPS = 8;

  function rootEl() { return Nav.roots.length ? Nav.roots[Nav.roots.length - 1] : document.getElementById('app'); }
  function isInput(el) { return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'); }
  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  Nav.focusables = function (root) {
    return U.$$('.f', root || rootEl()).filter(function (el) { return !el.disabled && visible(el); });
  };

  Nav.focus = function (el, opts) {
    if (!el) return;
    opts = opts || {};
    if (Nav.current && Nav.current !== el) Nav.current.classList.remove('focused');
    Nav.current = el;
    el.classList.add('focused');
    var g = el.closest('.nav-group');
    if (g) g.__last = el;
    if (!isInput(el)) {
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    } else if (document.activeElement && document.activeElement !== el && isInput(document.activeElement)) {
      document.activeElement.blur();
    }
    if (!opts.noScroll) Nav.reveal(el);
    if (Nav.onFocus) Nav.onFocus(el);
  };

  Nav.first = function (sel, root) {
    var r = root || rootEl();
    var el = sel ? U.$(sel, r) : null;
    if (!el || !visible(el)) el = Nav.focusables(r)[0];
    if (el) Nav.focus(el);
    return el;
  };

  Nav.pushRoot = function (el) { Nav.roots.push(el); };
  Nav.popRoot = function (el) {
    var i = Nav.roots.lastIndexOf(el);
    if (i >= 0) Nav.roots.splice(i, 1);
  };

  function scrollables(el, stop) {
    var out = [], p = el.parentElement;
    while (p && p !== document.body) {
      var cs = getComputedStyle(p);
      if ((/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) ||
          (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1)) out.push(p);
      if (p === stop) break;
      p = p.parentElement;
    }
    return out;
  }

  Nav.reveal = function (el) {
    scrollables(el).forEach(function (sc) {
      var r = el.getBoundingClientRect(), s = sc.getBoundingClientRect(), cs = getComputedStyle(sc);
      var padTop = sc.id === 'page' ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav')) + 20 : 16;
      if (sc.dataset.padTop) padTop = +sc.dataset.padTop;
      if (/(auto|scroll)/.test(cs.overflowY) && sc.scrollHeight > sc.clientHeight) {
        if (r.top < s.top + padTop) sc.scrollTop += r.top - s.top - padTop;
        else if (r.bottom > s.bottom - 24) sc.scrollTop += r.bottom - s.bottom + 24;
        if (sc.id === 'page' && sc.scrollTop < 140 && el.getBoundingClientRect().top - s.top + sc.scrollTop < s.height - 80) sc.scrollTop = 0;
      }
      if (/(auto|scroll)/.test(cs.overflowX) && sc.scrollWidth > sc.clientWidth) {
        var padL = sc.dataset.padLeft ? +sc.dataset.padLeft : 40;
        if (r.left < s.left + padL) sc.scrollLeft += r.left - s.left - padL;
        else if (r.right > s.right - 40) sc.scrollLeft += r.right - s.right + 40;
      }
    });
  };

  Nav.move = function (dir) {
    var cur = Nav.current;
    var list = Nav.focusables();
    if (!cur || list.indexOf(cur) < 0) { if (list[0]) Nav.focus(list[0]); return !!list[0]; }
    var a = cur.getBoundingClientRect();
    var ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === cur) continue;
      var b = el.getBoundingClientRect();
      var bx = (b.left + b.right) / 2, by = (b.top + b.bottom) / 2, primary, secondary, overlap;
      if (dir === 'right') { if (b.left < a.right - EPS || bx <= ax) continue; primary = Math.max(0, b.left - a.right); secondary = Math.abs(by - ay); overlap = b.bottom > a.top && b.top < a.bottom; }
      else if (dir === 'left') { if (b.right > a.left + EPS || bx >= ax) continue; primary = Math.max(0, a.left - b.right); secondary = Math.abs(by - ay); overlap = b.bottom > a.top && b.top < a.bottom; }
      else if (dir === 'down') { if (b.top < a.bottom - EPS || by <= ay) continue; primary = Math.max(0, b.top - a.bottom); secondary = Math.abs(bx - ax); overlap = b.right > a.left && b.left < a.right; }
      else { if (b.bottom > a.top + EPS || by >= ay) continue; primary = Math.max(0, a.top - b.bottom); secondary = Math.abs(bx - ax); overlap = b.right > a.left && b.left < a.right; }
      var horiz = dir === 'left' || dir === 'right';
      var score = primary + secondary * (horiz ? (overlap ? 1 : 4) : (overlap ? 0.5 : 1.5));
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return false;
    var g = best.closest('.nav-group'), cg = cur.closest('.nav-group');
    if (g && g !== cg && g.__last && g.__last !== best && g.contains(g.__last) && visible(g.__last)) best = g.__last;
    Nav.focus(best);
    return true;
  };

  var DIRS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

  document.addEventListener('keydown', function (e) {
    var kc = e.keyCode;
    if (!DIRS[kc] && kc !== 13 && kc !== 23 && kc !== 8 && kc !== 27) {
      if (Nav.handler && Nav.handler(e, kc >= 48 && kc <= 57 ? 'digit' : 'other')) { e.preventDefault(); }
      return;
    }
    if (kc === 8 || kc === 27) {
      // Android "back" goes through MainActivity.onBackPressed -> App.back(); this is for Esc in a browser.
      if (kc === 8 && isInput(document.activeElement)) return;
      e.preventDefault();
      if (window.App) App.back();
      return;
    }
    document.body.classList.add('kbd');
    var cur = Nav.current;
    var dir = DIRS[kc];
    var act = dir || 'ok';
    if (Nav.handler && Nav.handler(e, act)) { e.preventDefault(); return; }
    if (isInput(document.activeElement)) {
      var inp = document.activeElement;
      if (dir === 'left' && inp.selectionStart > 0) return;
      if (dir === 'right' && inp.selectionEnd < inp.value.length) return;
      if (act === 'ok') { inp.blur(); if (inp.form || inp.dataset.submit) { var ev = new Event('submit-input'); inp.dispatchEvent(ev); } e.preventDefault(); return; }
      if (dir) { inp.blur(); Nav.focus(inp, { noScroll: true }); }
    }
    if (act === 'ok') {
      e.preventDefault();
      if (!cur || !cur.isConnected) { Nav.first(); return; }
      if (isInput(cur)) { cur.focus(); return; }
      cur.click();
      return;
    }
    e.preventDefault();
    if (!cur || !cur.isConnected || !visible(cur)) { Nav.first(); return; }
    Nav.move(dir);
  }, true);

  // Touch / mouse: hide the focus ring and track the clicked element
  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && document.body.classList.contains('kbd')) return;
    document.body.classList.remove('kbd');
  }, true);
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('.f');
    if (el && el !== Nav.current) {
      if (Nav.current) Nav.current.classList.remove('focused');
      Nav.current = el; el.classList.add('focused');
      var g = el.closest('.nav-group'); if (g) g.__last = el;
    }
  }, true);

  window.Nav = Nav;
})();
