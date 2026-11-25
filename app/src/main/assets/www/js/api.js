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
    account: Accounts.current(),
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
      API.account = Accounts.upsert(acc);
      API.cache = {}; API.epgCache = {}; API.loadedAt = 0; API.xmltv = null; API.lists = {}; guideLoading = null;
      return r;
    }).catch(function (e) { API.account = prev; throw e; });
  };

  API.refreshInfo = function () {
    return getJson(base()).then(function (r) { if (r && r.user_info) API.info = r; return r; });
  };

  // Remove the current account; switch to another saved one if any
  API.logout = function () {
    if (API.account) { API.forgetDisk(API.account); Accounts.remove(API.account.id); }
    API.account = Accounts.current(); API.info = null; API.cache = {}; API.epgCache = {}; API.loadedAt = 0; API.xmltv = null; API.lists = {}; guideLoading = null;
  };
  API.switchAccount = function (id) {
    Accounts.use(id);
    API.account = Accounts.current(); API.info = null; API.cache = {}; API.epgCache = {}; API.loadedAt = 0; API.xmltv = null; API.lists = {}; guideLoading = null;
    if (window.TMDB) TMDB.mem = {};
  };

  // ---------- catalogue kept on the device ----------
  // Lists are saved to files by the app: the next start reads them instantly, and they are
  // refreshed in the background once they are more than 12 hours old.
  var hasDisk = !!(window.Native && Native.cacheInfo && Native.cacheDownload);
  var diskReqs = {}, diskId = 0;
  window.NativeCache = {
    done: function (id, ok, result, err) { var r = diskReqs[id]; delete diskReqs[id]; if (r) r(ok, result, err); }
  };
  function nativeTask(method, url, key) {
    return new Promise(function (resolve, reject) {
      var id = ++diskId;
      diskReqs[id] = function (ok, r, e) { if (ok) resolve(r); else reject(new Error(e || 'échec')); };
      Native[method](id, url, key);
    });
  }
  function readFile(path) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', path, true);
      x.onload = function () { if (x.responseText) resolve(x.responseText); else reject(new Error('fichier vide')); };
      x.onerror = function () { reject(new Error('lecture impossible')); };
      x.send();
    });
  }
  function diskKey(key) { return (API.account && API.account.id || 'x') + '_' + key; }
  function diskInfo(key) { try { return JSON.parse(Native.cacheInfo(diskKey(key))); } catch (e) { return { exists: false }; } }
  function toList(r) { return Array.isArray(r) ? r : (r && typeof r === 'object' ? Object.keys(r).map(function (k) { return r[k]; }) : []); }
  function parseList(t) { try { return toList(JSON.parse(t)); } catch (e) { throw new Error('Réponse invalide du serveur'); } }
  API.diskCache = hasDisk;
  API.lists = {}; // key -> url of the lists loaded in this session

  function cached(key, action, extra) {
    if (API.cache[key]) return API.cache[key];
    var url = base() + '&action=' + action + (extra || '');
    API.lists[key] = url;
    var p;
    if (hasDisk) {
      var info = diskInfo(key);
      if (info.exists) {
        var at = Date.now() - info.age;
        API.loadedAt = API.loadedAt ? Math.min(API.loadedAt, at) : at;
        p = readFile(info.path).then(parseList).catch(function () {
          return nativeTask('cacheDownload', url, diskKey(key)).then(readFile).then(parseList);
        });
      } else {
        if (!API.loadedAt) API.loadedAt = Date.now();
        p = nativeTask('cacheDownload', url, diskKey(key)).then(readFile).then(parseList).catch(function () { return getJson(url).then(toList); });
      }
    } else {
      if (!API.loadedAt) API.loadedAt = Date.now();
      p = getJson(url).then(toList);
    }
    API.cache[key] = p;
    p.catch(function () { if (API.cache[key] === p) delete API.cache[key]; });
    return p;
  }

  // Catalogue automatically reloaded every 12 hours (new movies, series, channels)
  API.RELOAD_MS = 12 * 3600 * 1000;
  API.isStale = function () { return !!API.loadedAt && Date.now() - API.loadedAt > API.RELOAD_MS; };
  var reloading = null;
  // Resolves to true once fresh lists are in place. With the on-device copy the download
  // happens in the background and the current lists stay usable until it is done.
  API.reloadCatalog = function () {
    if (!hasDisk) {
      API.cache = {}; API.epgCache = {}; API.loadedAt = 0; API.xmltv = null; API.lists = {};
      return API.refreshInfo().catch(function () { }).then(function () { API.loadGuide(true); return true; });
    }
    if (reloading) return reloading;
    var lists = API.lists, keys = Object.keys(lists);
    API.loadedAt = Date.now();
    reloading = Promise.all(keys.map(function (k) {
      return nativeTask('cacheDownload', lists[k], diskKey(k)).then(function () { return k; }, function () { return null; });
    })).then(function (done) {
      done.forEach(function (k) { if (k) delete API.cache[k]; });
      Object.keys(API.cache).forEach(function (k) { if (/^(vodinfo|serinfo|fullepg)_/.test(k)) delete API.cache[k]; });
      API.epgCache = {};
      API.refreshInfo().catch(function () { });
      API.loadGuide(true);
      return done.some(Boolean);
    }).then(function (r) { reloading = null; return r; }, function () { reloading = null; return false; });
    return reloading;
  };
  API.forgetDisk = function (acc) { if (hasDisk && acc && acc.id && Native.cacheClear) Native.cacheClear(acc.id + '_'); };

  // ---------- full TV guide (XMLTV) ----------
  // The provider's xmltv.php is downloaded and reduced by the app to the channels'
  // programmes from 12 h ago to 2 days ahead; the short per-channel EPG is the fallback.
  API.xmltv = null;
  var guideLoading = null;
  API.loadGuide = function (force) {
    if (!hasDisk || !Native.guideBuild || !API.account) return Promise.resolve(null);
    if (guideLoading && !force) return guideLoading;
    var a = API.account;
    var url = a.server + '/xmltv.php?username=' + encodeURIComponent(a.user) + '&password=' + encodeURIComponent(a.pass);
    var info = diskInfo('xmltv');
    var fresh = info.exists && info.age < 6 * 3600000 && !force;
    var p = (fresh ? Promise.resolve(info.path) : nativeTask('guideBuild', url, diskKey('xmltv')).then(function (r) { return r.split('|')[0]; })
      .catch(function (e) { if (info.exists) return info.path; throw e; }))
      .then(readFile).then(function (t) {
        var g = JSON.parse(t);
        if (!g || !g.ch || !Object.keys(g.ch).length) return null;
        if (a === API.account) { API.xmltv = g; API.epgCache = {}; }
        return g;
      }).catch(function () { return null; });
    guideLoading = p;
    return p;
  };
  function epgIdOf(streamId) {
    var m = API._epgIds;
    return m ? m[String(streamId)] : null;
  }
  function xmltvList(streamId) {
    var g = API.xmltv, id = g && epgIdOf(streamId);
    var l = id && g.ch[id];
    if (!l || !l.length) return null;
    return l.map(function (e) { return { title: e[2] || '', desc: e[3] || '', start: e[0] * 1000, end: e[1] * 1000 }; });
  }
  API.guideFor = xmltvList;

  API.categories = function (kind) { // kind: live | vod | series
    return cached('cat_' + kind, 'get_' + kind + '_categories');
  };
  API.liveStreams = function () {
    return cached('live', 'get_live_streams').then(function (list) {
      var ids = {};
      list.forEach(function (s, i) { if (!s.num) s.num = i + 1; if (s.epg_channel_id) ids[String(s.stream_id)] = String(s.epg_channel_id); });
      API._epgIds = ids;
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
    var x = xmltvList(streamId);
    if (x) {
      if ((limit || 4) <= 4) {
        var from = x.findIndex(function (e) { return e.end > now; });
        return Promise.resolve(from < 0 ? [] : x.slice(from, from + (limit || 4)));
      }
      return Promise.resolve(x.filter(function (e) { return e.end > now - 4 * 3600000; }));
    }
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
    if (xmltvList(streamId)) return API.epg(streamId, limit);
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

  // ---------- replay (catch-up) ----------
  // Full EPG of a channel, past programmes included (has_archive = recorded on the server)
  API.fullEpg = function (streamId) {
    var k = 'fullepg_' + streamId;
    if (API.cache[k]) return API.cache[k];
    var p = getJson(base() + '&action=get_simple_data_table&stream_id=' + streamId).then(function (r) {
      var l = (r && r.epg_listings) || [];
      return l.map(function (e) {
        var st = e.start_timestamp ? e.start_timestamp * 1000 : Date.parse(String(e.start).replace(' ', 'T'));
        var en = e.stop_timestamp ? e.stop_timestamp * 1000 : Date.parse(String(e.end || e.stop).replace(' ', 'T'));
        return { title: U.b64(e.title), desc: U.b64(e.description), start: st, end: en, startStr: e.start || '', archive: String(e.has_archive) === '1' };
      }).sort(function (a, b) { return a.start - b.start; });
    });
    API.cache[k] = p;
    p.catch(function () { delete API.cache[k]; });
    return p;
  };
  API.hasArchive = function (s) { return s && String(s.tv_archive) === '1' && +s.tv_archive_duration > 0; };
  // Server-local "YYYY-MM-DD:HH-MM" for a timestamp (Xtream timeshift URLs use the server's time zone)
  API.serverTime = function (ms, startStr) {
    if (startStr && /^\d{4}-\d\d-\d\d \d\d:\d\d/.test(startStr)) return startStr.slice(0, 10) + ':' + startStr.slice(11, 13) + '-' + startStr.slice(14, 16);
    var tz = API.info && API.info.server_info && API.info.server_info.timezone;
    var d = new Date(ms), parts = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
      return parts.year + '-' + parts.month + '-' + parts.day + ':' + (parts.hour === '24' ? '00' : parts.hour) + '-' + parts.minute;
    } catch (e) {
      return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate()) + ':' + U.pad(d.getHours()) + '-' + U.pad(d.getMinutes());
    }
  };
  API.replayUrl = function (streamId, prog) {
    var a = API.account, mins = Math.max(1, Math.round((prog.end - prog.start) / 60000));
    return a.server + '/timeshift/' + encodeURIComponent(a.user) + '/' + encodeURIComponent(a.pass) + '/' + mins + '/' + API.serverTime(prog.start, prog.startStr) + '/' + streamId + '.ts';
  };

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
  // Each user brings their own TMDB key (Paramètres or login screen); it is shared between
  // the user's own devices through the sync (stored under their own Xtream account entry).
  TMDB.key = function () { return String(Cfg.get('tmdbKey', '') || '').trim(); };
  TMDB.setKey = function (k) {
    k = String(k || '').replace(/[^A-Za-z0-9._-]/g, '');
    AS.del('tmdbIds'); TMDB.mem = {};
    Cfg.set('tmdbKey', k);
  };
  TMDB.check = function () { return TMDB.get('/configuration').then(function () { return true; }, function () { return false; }); };
  TMDB.enabled = function () { return !!TMDB.key(); };
  TMDB.get = function (path, params) {
    var key = TMDB.key();
    var q = Object.keys(params || {}).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    var bearer = key.length > 60; // v4 "read access token" vs v3 api key
    var lang = params && params.language ? '' : 'language=fr-FR';
    var url = 'https://api.themoviedb.org/3' + path + '?' + [lang, q].filter(Boolean).join('&') + (bearer ? '' : '&api_key=' + encodeURIComponent(key));
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
    var cache = AS.get('tmdbIds', {});
    if (cache[sid]) return Promise.resolve(cache[sid] === 'none' ? null : cache[sid]);
    var year = U.year(info.releaseDate || info.release_date || base.releaseDate);
    var clean = U.noYear(name).replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ').replace(/\b(VOSTFR|VF|FR|MULTI|4K|HD|FHD|UHD)\b/gi, '').trim();
    function search(withYear) {
      var p = { query: clean };
      if (withYear && year) p.first_air_date_year = year;
      return TMDB.get('/search/tv', p).then(function (r) { return r && r.results && r.results[0] ? String(r.results[0].id) : null; });
    }
    return search(true).then(function (id) { return id || search(false); }).then(function (id) {
      cache = AS.get('tmdbIds', {}); cache[sid] = id || 'none'; AS.set('tmdbIds', cache);
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
  // TMDB id of a movie (from Xtream vod_info when available, else search)
  TMDB.movieId = function (vodId, info, name) {
    var direct = info && (info.tmdb_id || info.tmdb);
    if (direct && /^\d+$/.test(String(direct))) return Promise.resolve(String(direct));
    var cache = AS.get('tmdbIds', {}), ck = 'm' + vodId;
    if (cache[ck]) return Promise.resolve(cache[ck] === 'none' ? null : cache[ck]);
    var year = U.year((info && (info.releasedate || info.release_date)) || name);
    var clean = U.noYear(U.cleanName(name)).replace(/\b(VOSTFR|VF|FR|MULTI|4K|HD|FHD|UHD)\b/gi, '').trim();
    var p = { query: clean }; if (year) p.year = year;
    return TMDB.get('/search/movie', p).then(function (r) {
      var id = r && r.results && r.results[0] ? String(r.results[0].id) : null;
      cache = AS.get('tmdbIds', {}); cache[ck] = id || 'none'; AS.set('tmdbIds', cache);
      return id;
    });
  };
  TMDB.recommendations = function (kind, id) { // kind: movie | tv
    return TMDB.get('/' + kind + '/' + id + '/recommendations').then(function (r) {
      return ((r && r.results) || []).map(function (x) { return { title: x.title || x.name, original: x.original_title || x.original_name, year: U.year(x.release_date || x.first_air_date) }; });
    });
  };
  // YouTube key of the trailer (French first, then any language)
  TMDB.trailer = function (kind, id) {
    function pick(r) {
      var v = ((r && r.results) || []).filter(function (x) { return x.site === 'YouTube'; });
      var t = v.filter(function (x) { return x.type === 'Trailer'; })[0] || v.filter(function (x) { return x.type === 'Teaser'; })[0] || v[0];
      return t ? t.key : null;
    }
    return TMDB.get('/' + kind + '/' + id + '/videos').then(function (r) {
      return pick(r) || TMDB.get('/' + kind + '/' + id + '/videos', { language: 'en-US' }).then(pick);
    }).catch(function () { return null; });
  };
  window.TMDB = TMDB;

  // ---------- settings ----------
  var defaults = { liveFormat: 'auto', player: 'internal', autoNext: true, startLive: false, aspectLive: 'auto', aspectVod: 'auto', syncUrl: '', subSize: 'normal', subColor: 'white', subAuto: true, introSkip: 85, autoUpdate: true, askProfile: true };
  window.Settings = {
    all: function () { var s = U.store.get('settings', {}); var o = {}; for (var k in defaults) o[k] = (k in s) ? s[k] : defaults[k]; return o; },
    get: function (k) { return this.all()[k]; },
    set: function (k, v) { var s = U.store.get('settings', {}); s[k] = v; U.store.set('settings', s); }
  };

})();
