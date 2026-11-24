/* IPTV+ — utilities */
(function () {
  'use strict';

  // Browser shim so the UI can be previewed outside Android.
  if (!window.Native) {
    window.Native = {
      isTv: function () { return /tv=1/.test(location.search); },
      version: function () { return 'web'; },
      play: function (url, start) { console.log('[native] play', url, start); setTimeout(function () { NativeEvents.player('prepared', { duration: 0 }); }, 300); },
      stop: function () { console.log('[native] stop'); },
      pause: function () {}, resume: function () {}, seekTo: function () {},
      state: function () { return JSON.stringify({ prepared: true, playing: true, buffering: false, pos: 0, dur: 0 }); },
      audioTracks: function () { return '[]'; }, selectAudio: function () {}, setAspect: function (m) { console.log('[native] aspect', m); },
      openExternal: function () { return false; },
      setLandscape: function () {}, exit: function () {},
      http: null
    };
  }

  var U = {};

  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.html = function (str) {
    var t = document.createElement('template');
    t.innerHTML = str.trim();
    return t.content.firstElementChild;
  };

  U.store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('iptvplus.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem('iptvplus.' + k, JSON.stringify(v)); } catch (e) { console.warn('storage full', e); }
    },
    del: function (k) { try { localStorage.removeItem('iptvplus.' + k); } catch (e) {} }
  };

  var toastTimer;
  U.toast = function (msg, ms) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, ms || 2600);
  };

  U.b64 = function (s) {
    if (!s) return '';
    try { return decodeURIComponent(escape(atob(s))); } catch (e) {
      try { return atob(s); } catch (e2) { return s; }
    }
  };

  U.pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  U.hm = function (d) { d = d instanceof Date ? d : new Date(d); return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()); };
  U.dur = function (ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + U.pad(m) : m) + ':' + U.pad(x);
  };
  U.minutesLabel = function (mins) {
    mins = Math.round(mins);
    if (!mins) return '';
    var h = Math.floor(mins / 60), m = mins % 60;
    return h ? h + ' h ' + (m ? U.pad(m) : '') : m + ' min';
  };
  U.noYear = function (s) { return String(s || '').replace(/\s*[\(\[](19|20)\d\d[\)\]]\s*$/, '').replace(/\s*-\s*(19|20)\d\d\s*$/, '').trim() || String(s || ''); };
  U.hmsLabel = function (s) {
    var m = String(s || '').match(/^(\d+):(\d+)(?::(\d+))?$/);
    if (!m) return String(s || '');
    return U.minutesLabel((+m[1]) * 60 + (+m[2]) + (m[3] ? +m[3] / 60 : 0));
  };
  U.year = function (s) { var m = String(s || '').match(/(19|20)\d\d/); return m ? m[0] : ''; };
  U.initials = function (name) {
    return String(name || '?').replace(/^[^|]*\|\s*/, '').replace(/[^\wÀ-ÿ ]+/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ').slice(0, 22);
  };
  U.cleanName = function (name) {
    // Remove common provider prefixes like "FR| " or "|FR| "
    return String(name || '').replace(/^\s*\|?[A-Z]{2,4}\|\s*/, '').replace(/^\s*[A-Z]{2,4}\s*[-:|]\s+/, '').trim() || String(name || '');
  };
  U.fold = function (s) {
    return String(s || '').toLowerCase().normalize ? String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') : String(s || '').toLowerCase();
  };

  // <img> that falls back to a placeholder on error
  U.img = function (src, cls, alt) {
    if (!src) return '';
    return '<img ' + (cls ? 'class="' + cls + '" ' : '') + 'src="' + U.esc(src) + '" alt="' + U.esc(alt || '') + '" loading="lazy" onerror="this.remove()">';
  };

  U.debounce = function (fn, ms) {
    var t;
    return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  };

  U.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  window.U = U;
})();
