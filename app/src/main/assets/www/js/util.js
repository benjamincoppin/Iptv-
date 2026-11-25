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
      lastCrash: function () { return ''; }, openUrl: function (u) { window.open(u, '_blank'); return true; }, subTracks: function () { return '[]'; }, selectSub: function () {}, setSubtitleStyle: function () {}, journal: function () { return ''; }, log: function (m) { console.log('[log]', m); }, share: function () {},
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
    src = U.imgUrl ? U.imgUrl(src) : src;
    if (!src) return '';
    return '<img ' + (cls ? 'class="' + cls + '" ' : '') + 'src="' + U.esc(src) + '" alt="' + U.esc(alt || '') + '" loading="lazy" onerror="this.remove()">';
  };

  // Clean an image URL coming from the provider ("null", empty, relative...)
  U.imgUrl = function (s) {
    s = String(s == null ? '' : s).trim();
    if (!s || s === 'null' || s === 'undefined' || s === '0') return '';
    if (/^\/\//.test(s)) return 'http:' + s;
    if (/^https?:\/\//i.test(s)) return s;
    if (/^\//.test(s) && window.API && API.account) return API.account.server + s;
    return '';
  };
  // <img> trying several URLs in order: the next one is used when one fails to load
  U.imgChain = function (list, cls) {
    var seen = {}, urls = [];
    (list || []).forEach(function (x) {
      (Array.isArray(x) ? x : [x]).forEach(function (y) { var u = U.imgUrl(y); if (u && !seen[u]) { seen[u] = 1; urls.push(u); } });
    });
    if (!urls.length) return '';
    return '<img ' + (cls ? 'class="' + cls + '" ' : '') + 'src="' + U.esc(urls[0]) + '" data-next="' + U.esc(JSON.stringify(urls.slice(1))) + '" alt="" loading="lazy" onerror="U.imgNext(this)">';
  };
  U.imgNext = function (img) {
    var rest = [];
    try { rest = JSON.parse(img.getAttribute('data-next') || '[]'); } catch (e) { }
    if (!rest.length) { img.remove(); return; }
    img.setAttribute('data-next', JSON.stringify(rest.slice(1)));
    img.src = rest[0];
  };

  // SHA-256 (hex) for the sync key when the native helper is not available
  U.sha256 = function (ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var str = unescape(encodeURIComponent(ascii));
    var maxWord = Math.pow(2, 32), result = '', words = [], bitLen = str.length * 8, i, j;
    var hash = [], k = [], pc = 0, isC = {};
    for (var c = 2; pc < 64; c++) {
      if (!isC[c]) {
        for (i = 0; i < 313; i += c) isC[i] = c;
        hash[pc] = (Math.pow(c, .5) * maxWord) | 0;
        k[pc++] = (Math.pow(c, 1 / 3) * maxWord) | 0;
      }
    }
    hash = hash.slice(0, 8);
    str += '\x80';
    while (str.length % 64 - 56) str += '\x00';
    for (i = 0; i < str.length; i++) { j = str.charCodeAt(i); words[i >> 2] |= j << ((3 - i) % 4) * 8; }
    words[words.length] = ((bitLen / maxWord) | 0);
    words[words.length] = (bitLen);
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : '') + b.toString(16); }
    return result;
  };

  U.debounce = function (fn, ms) {
    var t;
    return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  };

  U.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  window.U = U;
})();
