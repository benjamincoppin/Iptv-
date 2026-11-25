/* IPTV+ — Xtream Codes API, cache, favorites, history, settings */
(function () {
  'use strict';

  // ---------- native HTTP fallback ----------
  var nativeReqs = {}, nativeId = 0;
  window.NativeHttp = {
    done: function (id, status, body) {
      var r = nativeReqs[id];
      delete nativeReqs[id];
      if (r) r(status, body);
    }
  };
  function nativeGet(url) {
    return new Promise(function (resolve, reject) {
      var id = ++nativeId;
      nativeReqs[id] = function (status, body) {
        if (status >= 200 && status < 300) resolve(body);
        else reject(new Error(status ? 'HTTP ' + status : (body || 'Réseau injoignable')));
      };
      window.Native.http(id, url);
    });
  }
  function xhrGet(url, timeout) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.timeout = timeout || 45000;
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) resolve(x.responseText);
        else if (x.status === 0) reject({ net: true });
        else reject(new Error('HTTP ' + x.status));
      };
      x.onerror = function () { reject({ net: true }); };
      x.ontimeout = function () { reject(new Error('Délai dépassé')); };
      x.send();
    });
  }
  var useNative = false;
  function get(url) {
    if (useNative && window.Native.http) return nativeGet(url);
    return xhrGet(url).catch(function (e) {
      if (e && e.net && window.Native.http) { useNative = true; return nativeGet(url); }
      throw (e && e.net) ? new Error('Serveur injoignable') : e;
    });
  }
  function getJson(url) {
    return get(url).then(function (t) {
      if (!t) return null;
      try { return JSON.parse(t); } catch (e) { throw new Error('Réponse invalide du serveur'); }
    });
  }

  // ---------- account ----------
  function normServer(s) {
    s = String(s || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    s = s.replace(/\/(player_api\.php|get\.php|panel_api\.php|xmltv\.php).*$/i, '');
    return s.replace(/\/+$/, '');
  }
  // Accepts an M3U link like http://host:port/get.php?username=X&password=Y&type=m3u_plus
  function parseM3uLink(s) {
    var m = String(s || '').match(/^(https?:\/\/[^\/?#]+).*[?&]username=([^&]+).*[?&]password=([^&]+)/i);
    if (!m) return null;
    return { server: m[1], user: decodeURIComponent(m[2]), pass: decodeURIComponent(m[3]) };
  }

  var API = {
    account: U.store.get('account', null),
    info: null,          // user_info + server_info from login
    cache: {},
    epgCache: {},
    normServer: normServer,
    parseM3uLink: parseM3uLink
  };

  function base() { var a = API.account; return a.server + '/player_api.php?username=' + encodeURIComponent(a.user) + '&password=' + encodeURIComponent(a.pass); }

  API.login = function (server, user, pass) {
    var acc = { server: normServer(server), user: String(user || '').trim(), pass: String(pass || '').trim() };
    var prev = API.account;
    API.account = acc;
    return getJson(base()).then(function (r) {
      if (!r || !r.user_info) throw new Error('Réponse inattendue : vérifie l\'adresse du serveur');
      if (String(r.user_info.auth) !== '1') throw new Error('Identifiant ou mot de passe incorrect');
      var st = String(r.user_info.status || '').toLowerCase();
      if (st && st !== 'active') throw new Error('Abonnement ' + (st === 'expired' ? 'expiré' : 'inactif (' + st + ')'));
      API.info = r;
      U.store.set('account', acc);
      API.cache = {};
      return r;
    }).catch(function (e) { API.account = prev; throw e; });
  };

  API.refreshInfo = function () {
    return getJson(base()).then(function (r) { if (r && r.user_info) API.info = r; return r; });
  };

  API.logout = function () {
    API.account = null; API.info = null; API.cache = {}; API.epgCache = {};
    U.store.del('account');
  };

  function cached(key, action, extra) {
    if (API.cache[key]) return API.cache[key];
    var p = getJson(base() + '&action=' + action + (extra || '')).then(function (r) {
      return Array.isArray(r) ? r : (r && typeof r === 'object' ? Object.keys(r).map(function (k) { return r[k]; }) : []);
    });
    API.cache[key] = p;
    p.catch(function () { delete API.cache[key]; });
    return p;
  }

  API.categories = function (kind) { // kind: live | vod | series
    return cached('cat_' + kind, 'get_' + kind + '_categories');
  };
  API.liveStreams = function () {
    return cached('live', 'get_live_streams').then(function (list) {
      list.forEach(function (s, i) { if (!s.num) s.num = i + 1; });
      return list;
    });
  };
  API.vodStreams = function () { return cached('vod', 'get_vod_streams'); };
  API.seriesList = function () { return cached('series', 'get_series'); };

  API.vodInfo = function (id) {
    var k = 'vodinfo_' + id;
    if (!API.cache[k]) API.cache[k] = getJson(base() + '&action=get_vod_info&vod_id=' + id);
    return API.cache[k];
  };
  API.seriesInfo = function (id) {
    var k = 'serinfo_' + id;
    if (!API.cache[k]) API.cache[k] = getJson(base() + '&action=get_series_info&series_id=' + id);
    return API.cache[k];
  };

  // Short EPG for a channel, cached 10 minutes
  API.epg = function (streamId, limit) {
    var k = streamId + '_' + (limit || 4), c = API.epgCache[k], now = Date.now();
    if (c && now - c.t < 600000) return c.p;
    var p = getJson(base() + '&action=get_short_epg&stream_id=' + streamId + '&limit=' + (limit || 4)).then(function (r) {
      var l = (r && r.epg_listings) || [];
      return l.map(function (e) {
        var st = e.start_timestamp ? e.start_timestamp * 1000 : Date.parse(String(e.start).replace(' ', 'T'));
        var en = e.stop_timestamp ? e.stop_timestamp * 1000 : Date.parse(String(e.end || e.stop).replace(' ', 'T'));
        return { title: U.b64(e.title), desc: U.b64(e.description), start: st, end: en };
      }).filter(function (e) { return e.end > now - 3 * 3600000; }).sort(function (a, b) { return a.start - b.start; });
    }).catch(function () { return []; });
    API.epgCache[k] = { t: now, p: p };
    return p;
  };
  API.nowNext = function (list) {
    var now = Date.now(), cur = null, next = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].start <= now && list[i].end > now) { cur = list[i]; next = list[i + 1] || null; break; }
      if (list[i].start > now) { next = list[i]; break; }
    }
    return { now: cur, next: next };
  };

  // Queue so the live list does not flood the server with EPG requests
  var epgQueue = [], epgRunning = 0;
  API.epgQueued = function (streamId, limit) {
    return new Promise(function (resolve) {
      epgQueue.push({ id: streamId, limit: limit, resolve: resolve });
      pump();
    });
  };
  API.clearEpgQueue = function () { epgQueue.length = 0; };
  function pump() {
    while (epgRunning < 3 && epgQueue.length) {
      var job = epgQueue.shift();
      epgRunning++;
      API.epg(job.id, job.limit).then(job.resolve, function () { job.resolve([]); }).then(function () { epgRunning--; pump(); });
    }
  }

  // ---------- stream URLs ----------
  API.liveFormat = function () {
    var s = Settings.get('liveFormat');
    if (s === 'm3u8' || s === 'ts') return s;
    if (API.workingLiveFormat) return API.workingLiveFormat;
    var allowed = API.info && API.info.user_info && API.info.user_info.allowed_output_formats;
    if (allowed && allowed.length && allowed.indexOf('m3u8') < 0 && allowed.indexOf('ts') >= 0) return 'ts';
    return 'm3u8';
  };
  API.liveUrl = function (id, fmt) {
    var a = API.account;
    return a.server + '/live/' + encodeURIComponent(a.user) + '/' + encodeURIComponent(a.pass) + '/' + id + '.' + (fmt || API.liveFormat());
  };
  API.movieUrl = function (id, ext) {
    var a = API.account;
    return a.server + '/movie/' + encodeURIComponent(a.user) + '/' + encodeURIComponent(a.pass) + '/' + id + '.' + (ext || 'mp4');
  };
  API.episodeUrl = function (id, ext) {
    var a = API.account;
    return a.server + '/series/' + encodeURIComponent(a.user) + '/' + encodeURIComponent(a.pass) + '/' + id + '.' + (ext || 'mp4');
  };

  window.API = API;

  // ---------- TMDB (images et résumés des épisodes) ----------
  var TMDB = { mem: {} };
  TMDB.key = function () {
    var k = (Settings.get('tmdbKey') || '').trim();
    if (!k && window.IPTV_CONFIG) k = String(IPTV_CONFIG.tmdbKey || '').trim();
    return k;
  };
  TMDB.enabled = function () { return !!TMDB.key(); };
  TMDB.get = function (path, params) {
    var key = TMDB.key();
    var q = Object.keys(params || {}).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    var bearer = key.length > 60; // v4 "read access token" vs v3 api key
    var url = 'https://api.themoviedb.org/3' + path + '?language=fr-FR' + (q ? '&' + q : '') + (bearer ? '' : '&api_key=' + encodeURIComponent(key));
    if (TMDB.mem[url]) return TMDB.mem[url];
    var p = new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.timeout = 15000;
      if (bearer) x.setRequestHeader('Authorization', 'Bearer ' + key);
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) { try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); } }
        else reject(new Error('TMDB ' + x.status));
      };
      x.onerror = x.ontimeout = function () { reject(new Error('TMDB injoignable')); };
      x.send();
    });
    TMDB.mem[url] = p;
    p.catch(function () { delete TMDB.mem[url]; });
    return p;
  };
  TMDB.img = function (path, size) { return path ? 'https://image.tmdb.org/t/p/' + (size || 'w300') + path : ''; };
  // TMDB id of a series: from the Xtream data, else a search by name (+ year), cached per series
  TMDB.tvId = function (sid, info, base, name) {
    var direct = info.tmdb || info.tmdb_id || base.tmdb || base.tmdb_id;
    if (direct && /^\d+$/.test(String(direct))) return Promise.resolve(String(direct));
    var cache = U.store.get('tmdbIds', {});
    if (cache[sid]) return Promise.resolve(cache[sid] === 'none' ? null : cache[sid]);
    var year = U.year(info.releaseDate || info.release_date || base.releaseDate);
    var clean = U.noYear(name).replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ').replace(/\b(VOSTFR|VF|FR|MULTI|4K|HD|FHD|UHD)\b/gi, '').trim();
    function search(withYear) {
      var p = { query: clean };
      if (withYear && year) p.first_air_date_year = year;
      return TMDB.get('/search/tv', p).then(function (r) { return r && r.results && r.results[0] ? String(r.results[0].id) : null; });
    }
    return search(true).then(function (id) { return id || search(false); }).then(function (id) {
      cache = U.store.get('tmdbIds', {}); cache[sid] = id || 'none'; U.store.set('tmdbIds', cache);
      return id;
    });
  };
  // { "<episode number>": {still, name, overview} } for one season
  TMDB.season = function (tvId, n) {
    return TMDB.get('/tv/' + tvId + '/season/' + n).then(function (r) {
      var out = {};
      ((r && r.episodes) || []).forEach(function (e) { out[String(e.episode_number)] = { still: TMDB.img(e.still_path), name: e.name, overview: e.overview }; });
      out._poster = TMDB.img(r && r.poster_path, 'w342');
      return out;
    });
  };
  window.TMDB = TMDB;

  // ---------- settings ----------
  var defaults = { liveFormat: 'auto', player: 'internal', autoNext: true, startLive: false, aspectLive: 'auto', aspectVod: 'auto', tmdbKey: '', syncUrl: '' };
  window.Settings = {
    all: function () { var s = U.store.get('settings', {}); var o = {}; for (var k in defaults) o[k] = (k in s) ? s[k] : defaults[k]; return o; },
    get: function (k) { return this.all()[k]; },
    set: function (k, v) { var s = U.store.get('settings', {}); s[k] = v; U.store.set('settings', s); }
  };

  // ---------- favorites ----------
  // { live: [{id,name,icon,num}], movie: [...], series: [...] }
  window.Fav = {
    all: function () { return U.store.get('fav', { live: [], movie: [], series: [] }); },
    list: function (t) { return this.all()[t] || []; },
    has: function (t, id) { return this.list(t).some(function (x) { return String(x.id) === String(id); }); },
    toggle: function (t, item) {
      var all = this.all(), l = all[t] || [], id = String(item.id);
      var i = l.findIndex(function (x) { return String(x.id) === id; });
      if (i >= 0) l.splice(i, 1); else l.unshift(item);
      all[t] = l; U.store.set('fav', all);
      return i < 0;
    }
  };

  // ---------- watch history / resume ----------
  // key = type:id ; {type, id, name, img, pos, dur, ts, ext, seriesId, seriesName, season, ep, cover}
  window.Hist = {
    all: function () { return U.store.get('hist', {}); },
    get: function (type, id) { return this.all()[type + ':' + id] || null; },
    save: function (item) {
      var all = this.all();
      item.ts = item.watched = Date.now();
      delete item.hidden;
      all[item.type + ':' + item.id] = item;
      var keys = Object.keys(all);
      if (keys.length > 300) {
        keys.sort(function (a, b) { return all[a].ts - all[b].ts; }).slice(0, keys.length - 300).forEach(function (k) { delete all[k]; });
      }
      U.store.set('hist', all);
      if (window.Sync) Sync.later();
    },
    // Hide from "Reprendre la lecture" (kept as a dated marker so other devices hide it too)
    dismiss: function (h) {
      var all = this.all(), now = Date.now();
      Object.keys(all).forEach(function (k) {
        var x = all[k];
        var same = h.type === 'episode' ? (x.type === 'episode' && String(x.seriesId) === String(h.seriesId)) : (x.type === h.type && String(x.id) === String(h.id));
        if (same) { x.hidden = true; x.ts = now; }
      });
      U.store.set('hist', all);
      if (window.Sync) Sync.soon();
    },
    remove: function (type, id) { var all = this.all(); var x = all[type + ':' + id]; if (x) { x.hidden = true; x.ts = Date.now(); } U.store.set('hist', all); },
    clear: function () {
      var all = this.all(), now = Date.now();
      Object.keys(all).forEach(function (k) { all[k].hidden = true; all[k].ts = now; });
      U.store.set('hist', all); U.store.set('recentLive', []);
      if (window.Sync) Sync.soon();
    },
    // "Reprendre la lecture": movies & one entry per series, unfinished
    resumeList: function () {
      var all = this.all(), seen = {}, out = [];
      Object.keys(all).map(function (k) { return all[k]; })
        .filter(function (h) { return !h.hidden && h.type !== 'live' && h.dur > 0 && h.pos > 30000 && h.pos < h.dur * 0.94; })
        .sort(function (a, b) { return b.ts - a.ts; })
        .forEach(function (h) {
          var key = h.type === 'episode' ? 's' + h.seriesId : 'm' + h.id;
          if (seen[key]) return;
          seen[key] = 1; out.push(h);
        });
      return out.slice(0, 20);
    },
    lastEpisode: function (seriesId) {
      var all = this.all(), best = null;
      Object.keys(all).forEach(function (k) {
        var h = all[k];
        if (h.type === 'episode' && String(h.seriesId) === String(seriesId) && h.dur && (!best || (h.watched || h.ts) > (best.watched || best.ts))) best = h;
      });
      return best;
    },
    pushLive: function (ch) {
      var l = U.store.get('recentLive', []).filter(function (x) { return String(x.id) !== String(ch.id); });
      l.unshift({ id: ch.id, name: ch.name, icon: ch.icon, num: ch.num, cat: ch.cat });
      U.store.set('recentLive', l.slice(0, 20));
      U.store.set('lastLive', ch.id);
    },
    recentLive: function () { return U.store.get('recentLive', []); }
  };
})();
