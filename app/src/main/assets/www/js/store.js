/* IPTV+ — stockage : comptes Xtream, profils, favoris, historique, réglages partagés.
   Tout ce qui doit suivre l'utilisateur d'un appareil à l'autre est rangé dans une seule table
   « data » par compte (synchronisée par sync.js) :
     p:<profil>                 profil {name, color, created}
     <profil>|h|<type>:<id>     historique / reprise de lecture
     <profil>|f|<type>:<id>     favori
     cfg:<nom>                  réglage partagé (clé TMDB, catégories…)
   Chaque entrée porte « ts » (date de modification) : la plus récente gagne lors des fusions. */
(function () {
  'use strict';

  function host(s) { return String(s || '').replace(/^https?:\/\//i, '').replace(/[:\/].*$/, ''); }

  // ---------- accounts ----------
  var Accounts = {
    list: function () { return U.store.get('accounts', []); },
    save: function (l) { U.store.set('accounts', l); },
    idOf: function (server, user) { return U.sha256(String(server).toLowerCase() + '|' + user).slice(0, 12); },
    current: function () {
      var id = U.store.get('currentAccount', null), l = this.list();
      return l.filter(function (a) { return a.id === id; })[0] || l[0] || null;
    },
    upsert: function (acc) {
      acc.id = this.idOf(acc.server, acc.user);
      if (!acc.name) acc.name = host(acc.server) + ' · ' + acc.user;
      var l = this.list().filter(function (a) { return a.id !== acc.id; });
      l.unshift(acc);
      this.save(l);
      U.store.set('currentAccount', acc.id);
      return acc;
    },
    use: function (id) { U.store.set('currentAccount', id); },
    rename: function (id, name) {
      var l = this.list(); l.forEach(function (a) { if (a.id === id) a.name = name; }); this.save(l);
    },
    remove: function (id) {
      this.save(this.list().filter(function (a) { return a.id !== id; }));
      if (U.store.get('currentAccount', null) === id) U.store.set('currentAccount', (this.list()[0] || {}).id || null);
    }
  };
  window.Accounts = Accounts;

  // Storage scoped to the current account
  var AS = {
    k: function (k) { var a = Accounts.current(); return 'a.' + (a ? a.id : 'none') + '.' + k; },
    get: function (k, d) { return U.store.get(this.k(k), d); },
    set: function (k, v) { U.store.set(this.k(k), v); },
    del: function (k) { U.store.del(this.k(k)); }
  };
  window.AS = AS;

  // ---------- shared data table ----------
  var Store = {
    all: function () { return AS.get('data', {}); },
    set: function (m) { AS.set('data', m); },
    put: function (k, v) { var m = this.all(); v.ts = Date.now(); m[k] = v; this.set(m); if (window.Sync) Sync.later(); },
    changed: function (fast) { if (window.Sync) { if (fast) Sync.soon(); else Sync.later(); } }
  };
  window.Store = Store;

  // ---------- shared settings (synced between the user's devices) ----------
  var Cfg = {
    get: function (k, d) { var x = Store.all()['cfg:' + k]; return x && !x.hidden && x.v !== undefined ? x.v : d; },
    set: function (k, v) { var m = Store.all(); m['cfg:' + k] = { type: 'cfg', v: v, ts: Date.now() }; Store.set(m); Store.changed(true); }
  };
  window.Cfg = Cfg;

  // ---------- profiles ----------
  var COLORS = ['#ff6a3d', '#3d8bff', '#2fbf71', '#b55cff', '#f5c542', '#ff4f8b', '#1fb8c4', '#8d8882'];
  var Profiles = {
    COLORS: COLORS,
    list: function () {
      var m = Store.all(), out = [];
      Object.keys(m).forEach(function (k) {
        if (k.indexOf('p:') === 0 && !m[k].hidden) out.push({ id: k.slice(2), name: m[k].name, color: m[k].color, created: m[k].created || 0 });
      });
      if (!out.length) {
        var p = { type: 'profile', name: 'Moi', color: COLORS[0], created: 1, ts: Date.now() };
        m['p:p1'] = p; Store.set(m);
        out.push({ id: 'p1', name: p.name, color: p.color, created: 1 });
      }
      return out.sort(function (a, b) { return a.created - b.created; });
    },
    current: function () {
      var l = this.list(), id = AS.get('profile', null);
      return l.filter(function (p) { return p.id === id; })[0] || l[0];
    },
    use: function (id) { AS.set('profile', id); AS.set('profileChosen', true); },
    add: function (name, color) {
      var id = 'p' + Date.now().toString(36);
      var m = Store.all();
      m['p:' + id] = { type: 'profile', name: name, color: color || COLORS[this.list().length % COLORS.length], created: Date.now(), ts: Date.now() };
      Store.set(m); Store.changed(true);
      return id;
    },
    update: function (id, name, color) {
      var m = Store.all(), p = m['p:' + id]; if (!p) return;
      if (name) p.name = name; if (color) p.color = color; p.ts = Date.now();
      Store.set(m); Store.changed(true);
    },
    remove: function (id) {
      var m = Store.all(), p = m['p:' + id]; if (!p) return;
      p.hidden = true; p.ts = Date.now();
      Store.set(m); Store.changed(true);
      if (AS.get('profile', null) === id) AS.del('profile');
    }
  };
  window.Profiles = Profiles;
  function pid() { return Profiles.current().id; }
  // Device-local storage scoped to account + profile (recent channels…)
  var PS = {
    get: function (k, d) { return AS.get('p.' + pid() + '.' + k, d); },
    set: function (k, v) { AS.set('p.' + pid() + '.' + k, v); }
  };
  window.PS = PS;

  // ---------- favorites (per profile) ----------
  window.Fav = {
    prefix: function (t) { return pid() + '|f|' + t + ':'; },
    list: function (t) {
      var m = Store.all(), pre = this.prefix(t), out = [];
      Object.keys(m).forEach(function (k) { if (k.indexOf(pre) === 0 && !m[k].hidden) out.push(m[k]); });
      return out.sort(function (a, b) { return (b.added || 0) - (a.added || 0); })
        .map(function (x) { return { id: x.id, name: x.name, icon: x.icon, num: x.num, cat: x.cat }; });
    },
    has: function (t, id) { var x = Store.all()[this.prefix(t) + id]; return !!(x && !x.hidden); },
    toggle: function (t, item) {
      var m = Store.all(), k = this.prefix(t) + item.id, x = m[k], now = Date.now();
      var add = !(x && !x.hidden);
      m[k] = add ? { type: 'fav', t: t, id: item.id, name: item.name, icon: item.icon, num: item.num, cat: item.cat, added: now, ts: now }
                 : { type: 'fav', t: t, id: item.id, hidden: true, ts: now };
      Store.set(m); Store.changed(true);
      return add;
    }
  };

  // ---------- watch history / resume (per profile) ----------
  // entry: {type, id, name, img, pos, dur, ts, watched, ext, seriesId, seriesName, season, ep, hidden}
  var HMAX = 200;
  window.Hist = {
    prefix: function () { return pid() + '|h|'; },
    all: function () {
      var m = Store.all(), pre = this.prefix(), out = {};
      Object.keys(m).forEach(function (k) { if (k.indexOf(pre) === 0) out[k.slice(pre.length)] = m[k]; });
      return out;
    },
    get: function (type, id) { return Store.all()[this.prefix() + type + ':' + id] || null; },
    save: function (item) {
      var m = Store.all(), pre = this.prefix();
      item.ts = item.watched = Date.now();
      delete item.hidden;
      m[pre + item.type + ':' + item.id] = item;
      var keys = Object.keys(m).filter(function (k) { return k.indexOf(pre) === 0; });
      if (keys.length > HMAX) {
        keys.sort(function (a, b) { return m[a].ts - m[b].ts; }).slice(0, keys.length - HMAX).forEach(function (k) { delete m[k]; });
      }
      Store.set(m); Store.changed(false);
    },
    // Hide from "Reprendre la lecture" (kept as a dated marker so the other devices hide it too)
    dismiss: function (h) {
      var m = Store.all(), pre = this.prefix(), now = Date.now();
      Object.keys(m).forEach(function (k) {
        if (k.indexOf(pre) !== 0) return;
        var x = m[k];
        var same = h.type === 'episode' ? (x.type === 'episode' && String(x.seriesId) === String(h.seriesId)) : (x.type === h.type && String(x.id) === String(h.id));
        if (same) { x.hidden = true; x.ts = now; }
      });
      Store.set(m); Store.changed(true);
    },
    clear: function () {
      var m = Store.all(), pre = this.prefix(), now = Date.now();
      Object.keys(m).forEach(function (k) { if (k.indexOf(pre) === 0) { m[k].hidden = true; m[k].ts = now; } });
      Store.set(m); PS.set('recentLive', []);
      Store.changed(true);
    },
    resumeList: function () {
      var all = this.all(), seen = {}, out = [];
      Object.keys(all).map(function (k) { return all[k]; })
        .filter(function (h) { return !h.hidden && (h.type === 'movie' || h.type === 'episode') && h.dur > 0 && h.pos > 30000 && h.pos < h.dur * 0.94; })
        .sort(function (a, b) { return b.ts - a.ts; })
        .forEach(function (h) {
          var key = h.type === 'episode' ? 's' + h.seriesId : 'm' + h.id;
          if (seen[key]) return;
          seen[key] = 1; out.push(h);
        });
      return out.slice(0, 20);
    },
    // Watched (≥ 90 %) — used by "masquer ce qui est déjà vu"
    isWatched: function (type, id) {
      var h = this.get(type, id);
      return !!(h && h.dur && h.pos >= h.dur * 0.9);
    },
    seriesStarted: function (seriesId) {
      var all = this.all();
      return Object.keys(all).some(function (k) { var h = all[k]; return h.type === 'episode' && String(h.seriesId) === String(seriesId); });
    },
    lastEpisode: function (seriesId) {
      var all = this.all(), best = null;
      Object.keys(all).forEach(function (k) {
        var h = all[k];
        if (h.type === 'episode' && String(h.seriesId) === String(seriesId) && h.dur && (!best || (h.watched || h.ts) > (best.watched || best.ts))) best = h;
      });
      return best;
    },
    // Most recently watched movies / series (for recommendations)
    recentTitles: function (n) {
      var all = this.all(), seen = {}, out = [];
      Object.keys(all).map(function (k) { return all[k]; })
        .filter(function (h) { return (h.type === 'movie' || h.type === 'episode') && h.pos > 120000; })
        .sort(function (a, b) { return (b.watched || b.ts) - (a.watched || a.ts); })
        .forEach(function (h) {
          var key = h.type === 'episode' ? 's' + h.seriesId : 'm' + h.id;
          if (seen[key]) return; seen[key] = 1; out.push(h);
        });
      return out.slice(0, n || 3);
    },
    pushLive: function (ch) {
      var l = PS.get('recentLive', []).filter(function (x) { return String(x.id) !== String(ch.id); });
      l.unshift({ id: ch.id, name: ch.name, icon: ch.icon, num: ch.num, cat: ch.cat });
      PS.set('recentLive', l.slice(0, 20));
      PS.set('lastLive', ch.id);
    },
    recentLive: function () { return PS.get('recentLive', []); },
    lastLive: function () { return PS.get('lastLive', null); }
  };

  // ---------- categories: hide / reorder (shared) ----------
  window.Cats = {
    conf: function (kind) { var c = Cfg.get('cats', {}) || {}; return c[kind] || { hidden: [], order: [] }; },
    save: function (kind, conf) { var c = Cfg.get('cats', {}) || {}; c[kind] = conf; Cfg.set('cats', c); },
    isHidden: function (kind, id) { return this.conf(kind).hidden.indexOf(String(id)) >= 0; },
    // Provider categories (category_id, category_name) → ordered, optionally without the hidden ones
    apply: function (kind, cats, keepHidden) {
      var c = this.conf(kind), order = c.order || [], hidden = c.hidden || [];
      var list = cats.slice().sort(function (a, b) {
        var ia = order.indexOf(String(a.category_id)), ib = order.indexOf(String(b.category_id));
        if (ia < 0) ia = 1e6 + cats.indexOf(a); if (ib < 0) ib = 1e6 + cats.indexOf(b);
        return ia - ib;
      });
      return keepHidden ? list : list.filter(function (x) { return hidden.indexOf(String(x.category_id)) < 0; });
    },
    // Items whose category is not hidden
    filterItems: function (kind, items) {
      var hidden = this.conf(kind).hidden || [];
      if (!hidden.length) return items;
      return items.filter(function (x) { return hidden.indexOf(String(x.category_id)) < 0; });
    }
  };

  // ---------- migration from the single-account versions (≤ 1.1.16) ----------
  (function migrate() {
    var old = U.store.get('account', null);
    if (!old || Accounts.list().length) return;
    Accounts.upsert({ server: old.server, user: old.user, pass: old.pass });
    var m = {}, now = Date.now();
    m['p:p1'] = { type: 'profile', name: 'Moi', color: COLORS[0], created: 1, ts: now };
    var h = U.store.get('hist', {});
    Object.keys(h).forEach(function (k) {
      if (k === 'cfg:tmdbKey') { m['cfg:tmdbKey'] = h[k]; return; }
      m['p1|h|' + k] = h[k];
    });
    var f = U.store.get('fav', null);
    if (f) ['live', 'movie', 'series'].forEach(function (t, ti) {
      (f[t] || []).forEach(function (x, i) {
        m['p1|f|' + t + ':' + x.id] = { type: 'fav', t: t, id: x.id, name: x.name, icon: x.icon, num: x.num, cat: x.cat, added: now - i * 1000 - ti, ts: now };
      });
    });
    var st = U.store.get('settings', {});
    if (st.tmdbKey && !m['cfg:tmdbKey']) m['cfg:tmdbKey'] = { type: 'cfg', v: st.tmdbKey, ts: now };
    Store.set(m);
    AS.set('profile', 'p1');
    ['recentLive', 'lastLive'].forEach(function (k) { var v = U.store.get(k, null); if (v != null) AS.set('p.p1.' + k, v); });
    ['lastLiveCat', 'guideCat', 'tmdbIds', 'syncLast'].forEach(function (k) { var v = U.store.get(k, null); if (v != null) AS.set(k, v); });
    ['account', 'hist', 'fav', 'recentLive', 'lastLive', 'lastLiveCat', 'guideCat', 'tmdbIds', 'syncLast'].forEach(function (k) { U.store.del(k); });
  })();
})();
