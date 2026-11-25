/* IPTV+ — profils, comptes, catégories, replay, paramètres, recommandations, mises à jour */
(function () {
  'use strict';

  var V = window.Views;
  var I = window.ICONS;
  var COLOR_NAMES = { '#ff6a3d': 'Orange', '#3d8bff': 'Bleu', '#2fbf71': 'Vert', '#b55cff': 'Violet', '#f5c542': 'Jaune', '#ff4f8b': 'Rose', '#1fb8c4': 'Turquoise', '#8d8882': 'Gris' };

  function avatar(p, size) {
    var s = size || 40;
    return '<span class="avatar" style="width:' + s + 'px;height:' + s + 'px;background:' + U.esc(p.color) + ';font-size:' + Math.round(s * 0.45) + 'px">' + U.esc(String(p.name || '?').trim().charAt(0).toUpperCase()) + '</span>';
  }
  V.avatar = avatar;

  // ---------- "Qui regarde ?" ----------
  V.profiles = function (page, params) {
    var manage = !!params.manage;
    function draw() {
      var list = Profiles.list(), cur = Profiles.current();
      page.innerHTML =
        '<div class="who"><h1>' + (manage ? 'Gérer les profils' : 'Qui regarde ?') + '</h1>' +
        '<div class="who-grid nav-group">' +
          list.map(function (p) {
            return '<button class="f who-p' + (p.id === cur.id && manage ? ' cur' : '') + '" data-p="' + U.esc(p.id) + '" data-key="prof' + U.esc(p.id) + '">' + avatar(p, 96) +
              '<span class="who-n">' + U.esc(p.name) + '</span>' + (manage ? '<span class="who-e">Modifier</span>' : '') + '</button>';
          }).join('') +
          (list.length < 8 ? '<button class="f who-p" data-add="1" data-key="profadd"><span class="avatar add" style="width:96px;height:96px">+</span><span class="who-n">Ajouter</span></button>' : '') +
        '</div>' +
        '<div class="who-actions nav-group">' +
          (manage ? '<button class="f btn primary" data-done="1">Terminé</button>' : '<button class="f btn" data-manage="1">Gérer les profils</button>') +
        '</div></div>';
      U.$$('[data-p]', page).forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.dataset.p;
          if (!manage) { Profiles.use(id); App.afterProfileChange(); return; }
          var p = Profiles.list().filter(function (x) { return x.id === id; })[0];
          Modal.choose(p.name, [
            { label: 'Renommer', value: 'name' },
            { label: 'Changer la couleur', value: 'color' },
            { label: 'Supprimer ce profil', value: 'del' }
          ], function (v) {
            setTimeout(function () {
              if (v === 'name') Modal.prompt('Nom du profil', 'Prénom ou surnom affiché sur l\'écran « Qui regarde ? ».', p.name, function (n) { if (n.trim()) { Profiles.update(id, n.trim()); draw(); refocus('prof' + id); } });
              else if (v === 'color') chooseColor(p.color, function (c) { Profiles.update(id, null, c); draw(); refocus('prof' + id); });
              else if (v === 'del') {
                if (Profiles.list().length <= 1) { U.toast('Il faut garder au moins un profil'); return; }
                Modal.choose('Supprimer « ' + p.name + ' » ?', [{ label: 'Oui, supprimer', value: 1 }, { label: 'Annuler', value: 0 }], function (ok) {
                  if (ok) { Profiles.remove(id); draw(); Nav.first(null, page); }
                });
              }
            }, 0);
          });
        });
      });
      var add = U.$('[data-add]', page);
      if (add) add.addEventListener('click', function () {
        Modal.prompt('Nouveau profil', 'Prénom ou surnom de la personne. Chaque profil a son propre « Reprendre la lecture » et ses favoris.', '', function (n) {
          if (!n.trim()) return;
          var id = Profiles.add(n.trim());
          draw(); refocus('prof' + id);
        });
      });
      var m = U.$('[data-manage]', page); if (m) m.addEventListener('click', function () { manage = true; draw(); Nav.first('.who-p', page); });
      var d = U.$('[data-done]', page); if (d) d.addEventListener('click', function () { manage = false; draw(); Nav.first('.who-p', page); });
    }
    function refocus(key) { var el = U.$('[data-key="' + key + '"]', page); if (el) Nav.focus(el); }
    function chooseColor(cur, cb) {
      Modal.choose('Couleur', Profiles.COLORS.map(function (c) { return { label: COLOR_NAMES[c] || c, value: c, selected: c === cur }; }), cb);
    }
    draw();
    return Promise.resolve().then(function () { Nav.first('.who-p', page); });
  };

  // ---------- Xtream accounts ----------
  V.accounts = function (page) {
    function draw() {
      var list = Accounts.list(), cur = API.account;
      page.innerHTML = '<div class="settings"><h1>Comptes Xtream</h1>' +
        '<p class="muted" style="margin:-8px 0 16px;line-height:1.5">Chaque compte a ses propres profils, favoris et « Reprendre la lecture ».</p>' +
        '<div class="nav-group">' +
        list.map(function (a) {
          return '<button class="f srow" data-a="' + U.esc(a.id) + '" data-key="acc' + U.esc(a.id) + '"><div class="sl"><div class="st">' + U.esc(a.name) + '</div><div class="sd">' + U.esc(a.server + ' · ' + a.user) + '</div></div><div class="sv">' + (cur && a.id === cur.id ? 'Utilisé' : '') + '</div></button>';
        }).join('') +
        '<button class="f srow" data-add="1"><div class="sl"><div class="st">+ Ajouter un compte</div><div class="sd">Un autre abonnement Xtream</div></div></button>' +
        '</div></div>';
      U.$$('[data-a]', page).forEach(function (b) {
        b.addEventListener('click', function () {
          var a = Accounts.list().filter(function (x) { return x.id === b.dataset.a; })[0];
          var isCur = cur && a.id === cur.id;
          Modal.choose(a.name, (isCur ? [] : [{ label: 'Utiliser ce compte', value: 'use' }]).concat([
            { label: 'Renommer', value: 'name' },
            { label: 'Supprimer de cet appareil', value: 'del' }
          ]), function (v) {
            setTimeout(function () {
              if (v === 'use') { API.switchAccount(a.id); U.toast('Compte : ' + a.name); App.start(); }
              else if (v === 'name') Modal.prompt('Nom du compte', 'Nom affiché dans la liste des comptes.', a.name, function (n) { if (n.trim()) { Accounts.rename(a.id, n.trim()); if (isCur) API.account = Accounts.current(); draw(); } });
              else if (v === 'del') Modal.choose('Supprimer « ' + a.name + ' » ?', [{ label: 'Oui, supprimer', value: 1 }, { label: 'Annuler', value: 0 }], function (ok) {
                if (!ok) return;
                if (isCur) { API.logout(); if (API.account) App.start(); else App.go('login'); }
                else { Accounts.remove(a.id); draw(); Nav.first(null, page); }
              });
            }, 0);
          });
        });
      });
      U.$('[data-add]', page).addEventListener('click', function () { App.go('login', { add: true }); });
    }
    draw();
    return Promise.resolve();
  };

  // ---------- categories: hide / reorder ----------
  var KIND_LABEL = { live: 'TV en direct', vod: 'Films', series: 'Séries' };
  V.cats = function (page, params) {
    var kind = params.kind || 'live';
    page.innerHTML = '<div class="spinner" style="margin-top:140px"></div>';
    return API.categories(kind).then(function (all) {
      function draw(focusKey) {
        var list = Cats.apply(kind, all, true), conf = Cats.conf(kind);
        page.innerHTML = '<div class="settings"><h1>Catégories · ' + KIND_LABEL[kind] + '</h1>' +
          '<div class="chips nav-group" style="margin:0 0 12px;padding-left:0">' + ['live', 'vod', 'series'].map(function (k) {
            return '<button class="f chip' + (k === kind ? ' active' : '') + '" data-kind="' + k + '">' + KIND_LABEL[k] + '</button>';
          }).join('') + '</div>' +
          '<p class="muted" style="margin:0 0 14px;line-height:1.5">OK masque ou affiche une catégorie. ▲ ▼ changent sa place. Les catégories masquées disparaissent aussi des nouveautés et de la recherche.</p>' +
          list.map(function (c, i) {
            var hid = conf.hidden.indexOf(String(c.category_id)) >= 0;
            return '<div class="catrow nav-group' + (hid ? ' off' : '') + '">' +
              '<button class="f catname" data-t="' + U.esc(c.category_id) + '" data-key="t' + U.esc(c.category_id) + '"><span class="eye">' + (hid ? 'Masquée' : 'Visible') + '</span>' + U.esc(c.category_name) + '</button>' +
              '<button class="f catmv" data-up="' + i + '" data-key="u' + U.esc(c.category_id) + '" aria-label="Monter">▲</button>' +
              '<button class="f catmv" data-down="' + i + '" data-key="d' + U.esc(c.category_id) + '" aria-label="Descendre">▼</button></div>';
          }).join('') + '</div>';
        U.$$('[data-kind]', page).forEach(function (b) { b.addEventListener('click', function () { App.go('cats', { kind: b.dataset.kind }, { replace: true }); }); });
        U.$$('[data-t]', page).forEach(function (b) {
          b.addEventListener('click', function () {
            var c = Cats.conf(kind), id = String(b.dataset.t), i = c.hidden.indexOf(id);
            if (i >= 0) c.hidden.splice(i, 1); else c.hidden.push(id);
            Cats.save(kind, c); API.cache = {}; draw('t' + id);
          });
        });
        function move(i, d) {
          var ids = Cats.apply(kind, all, true).map(function (c) { return String(c.category_id); });
          var j = i + d; if (j < 0 || j >= ids.length) return;
          var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
          var c = Cats.conf(kind); c.order = ids; Cats.save(kind, c);
          draw((d < 0 ? 'u' : 'd') + t);
        }
        U.$$('[data-up]', page).forEach(function (b) { b.addEventListener('click', function () { move(+b.dataset.up, -1); }); });
        U.$$('[data-down]', page).forEach(function (b) { b.addEventListener('click', function () { move(+b.dataset.down, 1); }); });
        var f = focusKey && U.$('[data-key="' + focusKey + '"]', page);
        if (f) Nav.focus(f); else Nav.first('.chip.active', page);
      }
      draw();
    });
  };

  // ---------- Replay ----------
  var DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  function dayLabel(d) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var x = new Date(d); x.setHours(0, 0, 0, 0);
    var diff = Math.round((t - x) / 86400000);
    if (diff === 0) return 'Aujourd\'hui';
    if (diff === 1) return 'Hier';
    return DAYS[x.getDay()].charAt(0).toUpperCase() + DAYS[x.getDay()].slice(1) + ' ' + x.getDate();
  }
  V.playReplay = function (s, prog) {
    Player.start({
      kind: 'replay', url: API.replayUrl(s.stream_id, prog),
      title: prog.title || 'Replay', sub: U.cleanName(s.name) + ' · ' + dayLabel(prog.start) + ' ' + U.hm(prog.start) + ' – ' + U.hm(prog.end),
      startMs: 0
    });
  };
  V.replay = function (page, params) {
    page.innerHTML = '<div class="spinner" style="margin-top:140px"></div>';
    return API.liveStreams().then(function (all) {
      var chans = Cats.filterItems('live', all).filter(API.hasArchive);
      if (!params.id) {
        page.innerHTML = '<div class="section" style="margin-top:6px"><h1 style="font-size:26px">Replay</h1>' +
          '<p class="muted" style="margin:6px 0 0">Les programmes des derniers jours, sur les chaînes qui le proposent.</p></div>' +
          (chans.length ? '<div class="grid nav-group" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">' + chans.map(function (s) {
            return '<button class="f card chan" style="width:auto" data-id="' + s.stream_id + '" data-key="rc' + s.stream_id + '"><div class="thumb"><span class="ph">' + U.esc(U.initials(U.cleanName(s.name))) + '</span>' + (s.stream_icon ? U.img(s.stream_icon, 'logo-img') : '') + '</div>' +
              '<div class="lbl">' + U.esc(U.cleanName(s.name)) + ' · ' + s.tv_archive_duration + ' j</div></button>';
          }).join('') + '</div>' : '<div class="empty">Aucune chaîne de ton abonnement ne propose le replay.</div>');
        U.$$('[data-id]', page).forEach(function (b) { b.addEventListener('click', function () { App.go('replay', { id: b.dataset.id }); }); });
        return;
      }
      var s = all.filter(function (x) { return String(x.stream_id) === String(params.id); })[0];
      if (!s) { page.innerHTML = '<div class="empty">Chaîne introuvable.</div>'; return; }
      return API.fullEpg(s.stream_id).then(function (epg) {
        var now = Date.now(), maxAge = (+s.tv_archive_duration || 7) * 86400000;
        var past = epg.filter(function (p) { return p.end <= now && p.start >= now - maxAge && (p.archive || API.hasArchive(s)); });
        var days = [];
        past.forEach(function (p) { var l = dayLabel(p.start); if (days.indexOf(l) < 0) days.push(l); });
        days.reverse();
        var day = params.day && days.indexOf(params.day) >= 0 ? params.day : days[0];
        page.innerHTML = '<div class="section" style="margin-top:6px;display:flex;align-items:center;gap:14px">' +
          '<span class="lg" style="width:64px;height:40px;display:flex;align-items:center;justify-content:center">' + (s.stream_icon ? U.img(s.stream_icon) : '') + '</span>' +
          '<h1 style="font-size:24px">Replay · ' + U.esc(U.cleanName(s.name)) + '</h1></div>' +
          (days.length ? '<div class="section" style="margin-top:8px"><div class="chips nav-group">' + days.map(function (d) { return '<button class="f chip' + (d === day ? ' active' : '') + '" data-day="' + U.esc(d) + '">' + U.esc(d) + '</button>'; }).join('') + '</div></div>' : '') +
          '<div class="episodes nav-group" id="rp"></div>';
        function showDay(d) {
          day = d;
          U.$$('[data-day]', page).forEach(function (b) { b.classList.toggle('active', b.dataset.day === d); });
          var list = past.filter(function (p) { return dayLabel(p.start) === d; }).reverse();
          var box = U.$('#rp', page);
          box.innerHTML = list.length ? list.map(function (p, i) {
            return '<button class="f ep" data-i="' + past.indexOf(p) + '" data-key="rp' + p.start + '"><div class="rtime">' + U.hm(p.start) + '<small>' + U.minutesLabel((p.end - p.start) / 60000) + '</small></div>' +
              '<div style="min-width:0"><div class="et">' + U.esc(p.title || 'Programme') + '</div><div class="ed">' + U.esc(p.desc || '') + '</div></div></button>';
          }).join('') : '<div class="empty">Aucun programme disponible en replay pour ce jour.</div>';
          U.$$('[data-i]', box).forEach(function (b) { b.addEventListener('click', function () { V.playReplay(s, past[+b.dataset.i]); }); });
        }
        U.$$('[data-day]', page).forEach(function (b) { b.addEventListener('click', function () { showDay(b.dataset.day); }); });
        if (day) showDay(day); else U.$('#rp', page).innerHTML = '<div class="empty">Pas encore de programme enregistré pour cette chaîne.</div>';
      });
    });
  };

  // ---------- recommendations ("Parce que tu as regardé…") ----------
  function norm(t) { return U.fold(U.noYear(U.cleanName(t))).replace(/[^a-z0-9]+/g, ' ').trim(); }
  V.recommendations = function (vod, ser) {
    var recent = Hist.recentTitles(2);
    if (!recent.length) return Promise.resolve([]);
    var vodIdx = {}, serIdx = {};
    vod.forEach(function (m) { var k = norm(m.name); (vodIdx[k] = vodIdx[k] || []).push(m); });
    ser.forEach(function (s) { var k = norm(s.name); (serIdx[k] = serIdx[k] || []).push(s); });
    function match(results, idx) {
      var out = [];
      results.forEach(function (r) {
        var c = idx[norm(r.title)] || idx[norm(r.original || '')];
        if (!c) return;
        var best = c.filter(function (x) { return !r.year || !U.year(x.year || x.releaseDate || x.name) || U.year(x.year || x.releaseDate || x.name) === r.year; })[0] || c[0];
        if (out.indexOf(best) < 0) out.push(best);
      });
      return out;
    }
    function sameCategory(h) {
      // Without TMDB: well-rated titles from the same category, not watched yet
      if (h.type === 'movie') {
        var m = vod.filter(function (x) { return String(x.stream_id) === String(h.id); })[0];
        if (!m) return [];
        return vod.filter(function (x) { return x.category_id === m.category_id && x !== m && !Hist.isWatched('movie', x.stream_id); })
          .sort(function (a, b) { return (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0); }).slice(0, 15).map(function (x) { return { kind: 'movie', x: x }; });
      }
      var s = ser.filter(function (x) { return String(x.series_id) === String(h.seriesId); })[0];
      if (!s) return [];
      return ser.filter(function (x) { return x.category_id === s.category_id && x !== s && !Hist.seriesStarted(x.series_id); })
        .sort(function (a, b) { return (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0); }).slice(0, 15).map(function (x) { return { kind: 'series', x: x }; });
    }
    return Promise.all(recent.map(function (h) {
      var title = h.type === 'episode' ? h.seriesName : h.name;
      var p;
      if (!TMDB.enabled()) p = Promise.resolve(sameCategory(h));
      else if (h.type === 'movie') {
        p = API.vodInfo(h.id).catch(function () { return null; }).then(function (r) {
          return TMDB.movieId(h.id, (r && r.info) || {}, h.name);
        }).then(function (id) { return id ? TMDB.recommendations('movie', id) : []; })
          .then(function (res) { var m = match(res, vodIdx).filter(function (x) { return String(x.stream_id) !== String(h.id); }).map(function (x) { return { kind: 'movie', x: x }; }); return m.length >= 3 ? m : m.concat(sameCategory(h)).slice(0, 15); });
      } else {
        var base = ser.filter(function (x) { return String(x.series_id) === String(h.seriesId); })[0] || {};
        p = TMDB.tvId(h.seriesId, {}, base, h.seriesName || '').then(function (id) { return id ? TMDB.recommendations('tv', id) : []; })
          .then(function (res) { var m = match(res, serIdx).filter(function (x) { return String(x.series_id) !== String(h.seriesId); }).map(function (x) { return { kind: 'series', x: x }; }); return m.length >= 3 ? m : m.concat(sameCategory(h)).slice(0, 15); });
      }
      return p.catch(function () { return sameCategory(h); }).then(function (items) { return { title: title, items: items }; });
    })).then(function (rows) { return rows.filter(function (r) { return r.items.length >= 3; }); });
  };

  // ---------- automatic updates (GitHub Releases) ----------
  var Update = { busy: false };
  function verNum(v) { return String(v || '').replace(/^v/i, '').split('.').map(function (x) { return parseInt(x, 10) || 0; }); }
  function newer(a, b) { var x = verNum(a), y = verNum(b); for (var i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
  Update.repo = function () { return (window.IPTV_CONFIG && IPTV_CONFIG.updateRepo) || ''; };
  Update.check = function (manual) {
    if (!Update.repo() || Update.busy) return Promise.resolve(null);
    if (!manual && (!Settings.get('autoUpdate') || Date.now() - U.store.get('updateLastCheck', 0) < 6 * 3600000)) return Promise.resolve(null);
    U.store.set('updateLastCheck', Date.now());
    return new Promise(function (resolve) {
      var x = new XMLHttpRequest();
      x.open('GET', 'https://api.github.com/repos/' + Update.repo() + '/releases/latest', true);
      x.timeout = 15000;
      x.onload = function () {
        try {
          var r = JSON.parse(x.responseText);
          var asset = (r.assets || []).filter(function (a) { return a.name === 'IPTVPlus.apk'; })[0];
          var cur = Native.version();
          if (asset && r.tag_name && newer(r.tag_name, cur)) resolve({ version: r.tag_name.replace(/^v/, ''), url: asset.browser_download_url, notes: r.body || '' });
          else resolve(false);
        } catch (e) { resolve(null); }
      };
      x.onerror = x.ontimeout = function () { resolve(null); };
      x.send();
    }).then(function (u) {
      if (u && (manual || U.store.get('updateSkip', '') !== u.version)) Update.offer(u);
      else if (manual) U.toast(u === false ? 'IPTV+ est à jour (version ' + Native.version() + ')' : 'Impossible de vérifier les mises à jour');
      return u;
    });
  };
  Update.offer = function (u) {
    if (Player.open || Live.open) return; // never interrupt playback
    Modal.choose('Nouvelle version ' + u.version + ' disponible', [
      { label: 'Installer maintenant', value: 'go' },
      { label: 'Plus tard', value: 'later' },
      { label: 'Ignorer cette version', value: 'skip' }
    ], function (v) {
      if (v === 'skip') U.store.set('updateSkip', u.version);
      if (v !== 'go') return;
      if (!Native.installUpdate) { U.toast('Mise à jour impossible ici'); return; }
      Update.busy = true;
      U.toast('Téléchargement de la mise à jour…', 4000);
      Native.installUpdate(u.url);
    });
  };
  Update.progress = function (state, pct, msg) {
    if (state === 'download') { if (pct >= 0 && pct % 10 === 0) U.toast('Téléchargement de la mise à jour : ' + pct + ' %', 3000); }
    else if (state === 'permission') { Update.busy = false; U.toast('Autorise IPTV+ à installer des applications, puis relance la mise à jour (Paramètres → Mises à jour)', 9000); }
    else if (state === 'installing') { Update.busy = false; }
    else if (state === 'error') { Update.busy = false; U.toast('Échec de la mise à jour : ' + msg, 6000); }
  };
  window.Update = Update;

  // ---------- settings ----------
  V.settings = function (page) {
    var s = Settings.all(), inf = API.info && API.info.user_info || {};
    var exp = inf.exp_date ? new Date(+inf.exp_date * 1000) : null;
    var fmtLabel = { auto: 'Automatique', m3u8: 'HLS (.m3u8)', ts: 'MPEG-TS (.ts)' };
    var sizeLabel = { small: 'Petits', normal: 'Normaux', large: 'Grands', huge: 'Très grands' };
    var colorLabel = { white: 'Blancs', yellow: 'Jaunes', box: 'Blancs sur fond noir' };
    var prof = Profiles.current();
    function row(k, t, d, v) {
      return '<button class="f srow" data-k="' + k + '" data-key="s' + k + '"><div class="sl"><div class="st">' + U.esc(t) + '</div><div class="sd">' + U.esc(d) + '</div></div><div class="sv">' + U.esc(v) + '</div></button>';
    }
    function head(t) { return '<h2 class="sh">' + U.esc(t) + '</h2>'; }
    page.innerHTML =
      '<div class="settings"><h1>Paramètres</h1>' +
      '<div class="acc">' +
        '<div><small>Compte</small>' + U.esc(API.account ? API.account.name : '') + '</div>' +
        '<div><small>Profil</small>' + U.esc(prof.name) + '</div>' +
        '<div><small>Statut</small>' + U.esc(inf.status || '—') + '</div>' +
        '<div><small>Expiration</small>' + (exp ? exp.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Illimitée') + '</div>' +
        '<div><small>Connexions</small>' + U.esc((inf.active_cons != null ? inf.active_cons : '?') + ' / ' + (inf.max_connections || '?')) + '</div>' +
        '<div><small>Version</small>IPTV+ ' + U.esc(Native.version()) + '</div>' +
      '</div>' +
      '<div class="nav-group">' +
      head('Compte et profils') +
      row('accounts', 'Comptes Xtream', 'Ajouter un abonnement, passer de l\'un à l\'autre', Accounts.list().length + ' compte' + (Accounts.list().length > 1 ? 's' : '')) +
      row('profiles', 'Profils', 'Un « Reprendre la lecture » et des favoris par personne', Profiles.list().length + ' profil' + (Profiles.list().length > 1 ? 's' : '')) +
      row('askProfile', 'Demander le profil au démarrage', 'Affiche « Qui regarde ? » à l\'ouverture (s\'il y a plusieurs profils)', s.askProfile === false ? 'Non' : 'Oui') +
      row('cats', 'Catégories', 'Masquer ou réorganiser les catégories', '') +
      head('Lecture') +
      row('liveFormat', 'Format du direct', 'Change-le si certaines chaînes ne se lancent pas', fmtLabel[s.liveFormat]) +
      row('player', 'Lecteur vidéo', 'Intégré, ou externe (VLC, MX Player…)', s.player === 'external' ? 'Externe' : 'Intégré') +
      row('aspectLive', 'Format d\'image · TV en direct', 'Original, 16:9, 4:3, étirer ou zoom', Aspect.labels[Aspect.get('live')]) +
      row('aspectVod', 'Format d\'image · Films et séries', 'Original, 16:9, 4:3, étirer ou zoom', Aspect.labels[Aspect.get('vod')]) +
      row('subAuto', 'Sous-titres français automatiques', 'Activés quand le son n\'est pas en français et qu\'une piste française existe', s.subAuto ? 'Oui' : 'Non') +
      row('subSize', 'Taille des sous-titres', '', sizeLabel[s.subSize] || 'Normaux') +
      row('subColor', 'Couleur des sous-titres', '', colorLabel[s.subColor] || 'Blancs') +
      row('introSkip', 'Bouton « Passer l\'intro »', 'Durée sautée au début des épisodes', s.introSkip ? s.introSkip + ' s' : 'Désactivé') +
      row('autoNext', 'Épisode suivant automatique', 'Enchaîne les épisodes d\'une série', s.autoNext ? 'Oui' : 'Non') +
      head('Contenu') +
      row('tmdb', 'Clé API TMDB', TMDB.enabled() ? 'Images, bandes-annonces et recommandations activées' : 'Facultatif : clé gratuite sur themoviedb.org → Paramètres → API', TMDB.enabled() ? 'Configurée' : 'Non configurée') +
      row('reload', 'Recharger les listes', 'Récupère les nouvelles chaînes, films et séries (automatique toutes les 12 h)', '') +
      row('clearHist', 'Effacer l\'historique de ce profil', 'Vide « Reprendre la lecture » et les chaînes récentes', '') +
      head('Appareil') +
      row('sync', 'Synchronisation entre appareils', Sync.url() ? ('Profils, favoris, reprise et réglages partagés · ' + (AS.get('syncLast', 0) ? 'dernière synchro ' + U.hm(AS.get('syncLast', 0)) : 'jamais synchronisé')) : 'Adresse du serveur non configurée', Sync.url() ? 'Activée' : 'Désactivée') +
      row('update', 'Mises à jour', 'Recherche automatique des nouvelles versions', s.autoUpdate ? 'Automatiques' : 'Manuelles') +
      row('diag', 'Diagnostic', 'Journal technique à m\'envoyer en cas de problème', '') +
      '</div></div>';
    function pick(title, opts, key, cb) {
      Modal.choose(title, opts.map(function (o) { o.selected = Settings.get(key) === o.value; return o; }), function (v) { Settings.set(key, v); if (cb) cb(v); App.refresh(); });
    }
    U.$$('.srow', page).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.k;
        if (k === 'accounts') App.go('accounts');
        else if (k === 'profiles') App.go('profiles', { manage: true });
        else if (k === 'askProfile') { Settings.set('askProfile', Settings.get('askProfile') === false); App.refresh(); }
        else if (k === 'cats') App.go('cats', { kind: 'live' });
        else if (k === 'liveFormat') pick('Format du direct', ['auto', 'm3u8', 'ts'].map(function (v) { return { label: fmtLabel[v], value: v }; }), 'liveFormat', function () { API.workingLiveFormat = null; });
        else if (k === 'player') pick('Lecteur vidéo', [{ label: 'Intégré', value: 'internal' }, { label: 'Externe', value: 'external' }], 'player');
        else if (k === 'aspectLive') Aspect.choose('live', function () { App.refresh(); });
        else if (k === 'aspectVod') Aspect.choose('vod', function () { App.refresh(); });
        else if (k === 'subAuto') { Settings.set('subAuto', !Settings.get('subAuto')); App.refresh(); }
        else if (k === 'subSize') pick('Taille des sous-titres', ['small', 'normal', 'large', 'huge'].map(function (v) { return { label: sizeLabel[v], value: v }; }), 'subSize', applySubStyle);
        else if (k === 'subColor') pick('Couleur des sous-titres', ['white', 'yellow', 'box'].map(function (v) { return { label: colorLabel[v], value: v }; }), 'subColor', applySubStyle);
        else if (k === 'introSkip') pick('Passer l\'intro', [{ label: 'Désactivé', value: 0 }, { label: '60 secondes', value: 60 }, { label: '85 secondes', value: 85 }, { label: '90 secondes', value: 90 }, { label: '120 secondes', value: 120 }], 'introSkip');
        else if (k === 'autoNext') { Settings.set('autoNext', !Settings.get('autoNext')); App.refresh(); }
        else if (k === 'tmdb') Modal.prompt('Clé API TMDB', 'Colle ta clé API TMDB personnelle (gratuite sur themoviedb.org → Paramètres → API). Laisse vide pour la retirer.', TMDB.key(), function (val) {
          TMDB.setKey(val);
          if (!TMDB.enabled()) { U.toast('Clé TMDB retirée'); App.refresh(); return; }
          TMDB.check().then(function (ok) { U.toast(ok ? 'Clé TMDB valide' : 'Clé TMDB refusée, vérifie-la'); });
          App.refresh();
        });
        else if (k === 'reload') { API.reloadCatalog(); U.toast('Listes rechargées'); }
        else if (k === 'clearHist') Modal.choose('Effacer l\'historique de « ' + prof.name + ' » ?', [{ label: 'Oui, effacer', value: 1 }, { label: 'Annuler', value: 0 }], function (v) { if (v) { Hist.clear(); U.toast('Historique effacé'); } });
        else if (k === 'sync') Modal.choose('Synchronisation', [
          { label: 'Synchroniser maintenant', value: 'now' },
          { label: 'Adresse du serveur…', value: 'url' }
        ], function (c) {
          if (c === 'now') { if (!Sync.enabled()) { U.toast('Configure d\'abord l\'adresse du serveur'); return; } U.toast('Synchronisation…'); Sync.now().then(function () { U.toast(Sync.error ? 'Échec : ' + Sync.error : 'Synchronisé'); App.refresh(); }); }
          else setTimeout(function () {
            Modal.prompt('Adresse du serveur de synchronisation', 'Laisse vide pour utiliser l\'adresse intégrée à l\'appli.', Settings.get('syncUrl') || '', function (val) {
              Settings.set('syncUrl', val.trim());
              if (Sync.enabled()) Sync.now().then(function () { U.toast(Sync.error ? 'Échec : ' + Sync.error : 'Synchronisé'); App.refresh(); });
              else App.refresh();
            });
          }, 0);
        });
        else if (k === 'update') Modal.choose('Mises à jour', [
          { label: 'Rechercher maintenant', value: 'now' },
          { label: Settings.get('autoUpdate') ? 'Désactiver la recherche automatique' : 'Activer la recherche automatique', value: 'toggle' }
        ], function (v) {
          if (v === 'now') { U.toast('Recherche…'); setTimeout(function () { Update.check(true); }, 300); }
          else { Settings.set('autoUpdate', !Settings.get('autoUpdate')); App.refresh(); }
        });
        else if (k === 'diag') App.showReport('Diagnostic IPTV+', 'IPTV+ ' + Native.version() + '\n\n' + (Native.journal() || '(journal vide)'));
      });
    });
    API.refreshInfo().catch(function () { });
    return Promise.resolve();
  };
  function applySubStyle() { if (Native.setSubtitleStyle) Native.setSubtitleStyle(Settings.get('subSize'), Settings.get('subColor')); }
  V.applySubStyle = applySubStyle;
})();
