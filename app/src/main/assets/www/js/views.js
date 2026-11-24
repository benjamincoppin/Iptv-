/* IPTV+ — pages : connexion, accueil, films, séries, fiches, favoris, recherche, paramètres */
(function () {
  'use strict';

  var V = {};
  var I = window.ICONS;
  var HEART = '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>';
  var HEART_ON = '<svg viewBox="0 0 24 24" style="fill:var(--accent);stroke:var(--accent)"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>';

  // ---------- builders ----------
  function ratingOf(x) {
    var r = parseFloat(x.rating_5based ? x.rating_5based * 2 : x.rating);
    return r > 0 ? (Math.round(r * 10) / 10).toString().replace('.', ',') : '';
  }
  function posterHtml(kind, x) {
    var isMovie = kind === 'movie';
    var id = isMovie ? x.stream_id : x.series_id;
    var name = U.noYear(U.cleanName(x.name));
    var img = isMovie ? x.stream_icon : x.cover;
    var r = ratingOf(x), y = U.year(x.year || x.releaseDate || x.release_date || x.name);
    return '<button class="f poster" data-go="' + (isMovie ? 'movie' : 'serie') + ':' + id + '" data-key="' + kind + id + '">' +
      '<div class="img"><div class="ph">' + U.esc(name) + '</div>' + U.img(img) + (r ? '<span class="rate">★ ' + r + '</span>' : '') + '</div>' +
      '<div class="t">' + U.esc(name) + '</div>' + (y ? '<div class="s">' + y + '</div>' : '') + '</button>';
  }
  function chanCard(c) {
    return '<button class="f card chan" data-go="live:' + c.id + '" data-key="c' + c.id + '">' +
      '<div class="thumb"><span class="ph">' + U.esc(U.initials(c.name)) + '</span>' + (c.icon ? U.img(c.icon, 'logo-img') : '') + '</div>' +
      '<div class="lbl">' + U.esc((c.num ? c.num + ' · ' : '') + c.name) + '</div></button>';
  }
  function resumeCard(h) {
    var pct = h.dur ? Math.round(h.pos / h.dur * 100) : 0;
    var go = h.type === 'movie' ? 'movie:' + h.id : 'serie:' + h.seriesId;
    var label = h.type === 'episode' ? (h.seriesName || '') + ' · S' + h.season + ' É' + h.ep : h.name;
    return '<button class="f card" data-go="' + go + '" data-resume="1" data-key="r' + h.type + h.id + '">' +
      '<div class="thumb"><span class="ph">' + U.esc(U.initials(h.seriesName || h.name)) + '</span>' + U.img(h.img) + '</div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div><div class="lbl">' + U.esc(label) + '</div></button>';
  }
  function rail(title, items, count) {
    if (!items) return '';
    return '<div class="section"><h2 class="section-title">' + U.esc(title) + (count ? ' <span class="count">' + count + '</span>' : '') + '</h2>' +
      '<div class="rail nav-group">' + items + '</div></div>';
  }
  function byAdded(a, b) { return (+b.added || 0) - (+a.added || 0); }
  function byModified(a, b) { return (+b.last_modified || 0) - (+a.last_modified || 0); }

  // Delegate navigation clicks inside a page
  V.bindGo = function (root) {
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]');
      if (!b || !root.contains(b)) return;
      var p = b.dataset.go.split(':'), kind = p[0], id = p.slice(1).join(':');
      if (kind === 'live') App.go('live', { id: id });
      else if (kind === 'movie') App.go('movie', { id: id, resume: !!b.dataset.resume });
      else if (kind === 'serie') App.go('serie', { id: id, resume: !!b.dataset.resume });
    });
  };

  // ---------- LOGIN ----------
  V.login = function (page) {
    var a = API.account || U.store.get('lastAccount', {}) || {};
    page.innerHTML =
      '<div class="login"><div class="box nav-group">' +
        '<div class="logo">IPTV<span>+</span></div>' +
        '<p>Connecte-toi avec les identifiants Xtream Codes fournis par ton abonnement.</p>' +
        '<label class="field"><span>Adresse du serveur</span><input class="f" id="lg-s" type="url" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="http://exemple.com:8080" value="' + U.esc(a.server || '') + '"></label>' +
        '<label class="field"><span>Nom d\'utilisateur</span><input class="f" id="lg-u" type="text" autocapitalize="off" autocomplete="off" spellcheck="false" value="' + U.esc(a.user || '') + '"></label>' +
        '<label class="field"><span>Mot de passe</span><input class="f" id="lg-p" type="password" autocomplete="off" data-submit="1" value=""></label>' +
        '<button class="f btn primary" id="lg-go">Se connecter</button>' +
        '<div class="err" id="lg-e"></div>' +
        '<div class="hint">Astuce : tu peux aussi coller ton lien M3U complet (…/get.php?username=…&amp;password=…) dans le champ « Adresse du serveur ».</div>' +
      '</div></div>';
    var s = U.$('#lg-s', page), u = U.$('#lg-u', page), p = U.$('#lg-p', page), go = U.$('#lg-go', page), err = U.$('#lg-e', page);
    s.addEventListener('change', function () {
      var m = API.parseM3uLink(s.value);
      if (m) { s.value = m.server; u.value = m.user; p.value = m.pass; }
    });
    function submit() {
      var m = API.parseM3uLink(s.value);
      if (m) { s.value = m.server; u.value = m.user; p.value = m.pass; }
      if (!s.value || !u.value || !p.value) { err.textContent = 'Renseigne les trois champs.'; return; }
      err.textContent = ''; go.disabled = true; go.textContent = 'Connexion…';
      API.login(s.value, u.value, p.value).then(function () {
        U.store.set('lastAccount', { server: API.account.server, user: API.account.user });
        U.toast('Connecté');
        App.start();
      }).catch(function (e) {
        err.textContent = e.message || 'Connexion impossible';
        go.disabled = false; go.textContent = 'Se connecter';
      });
    }
    go.addEventListener('click', submit);
    p.addEventListener('submit-input', submit);
    p.addEventListener('keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); submit(); } });
    return Promise.resolve().then(function () { Nav.focus(a.server ? (a.user ? p : u) : s); });
  };

  // ---------- HOME (style Cinéma) ----------
  V.home = function (page) {
    page.innerHTML = '<div class="spinner" style="margin-top:160px"></div>';
    return Promise.all([API.vodStreams().catch(function () { return []; }), API.seriesList().catch(function () { return []; })]).then(function (r) {
      var vod = r[0].slice().sort(byAdded), ser = r[1].slice().sort(byModified);
      var hero = vod.find(function (m) { return m.stream_icon; }) || vod[0];
      var html = '';
      if (hero) {
        html += '<section class="hero"><div class="bg"></div><div class="in nav-group">' +
          '<div class="kicker">À la une · Film</div><h1>' + U.esc(U.noYear(U.cleanName(hero.name))) + '</h1>' +
          '<div class="meta">' + [U.year(hero.year || hero.name), ratingOf(hero) ? '★ ' + ratingOf(hero) : ''].filter(Boolean).join(' · ') + '</div>' +
          '<div class="plot"></div>' +
          '<div class="actions"><button class="f btn primary" id="hero-play">' + I.play + ' Lecture</button>' +
          '<button class="f btn" data-go="movie:' + hero.stream_id + '">Plus d\'infos</button></div></div></section>';
      } else {
        html += '<div style="height:20px"></div>';
      }
      var resume = Hist.resumeList();
      if (resume.length) html += rail('Reprendre la lecture', resume.map(resumeCard).join(''));
      var favCh = Fav.list('live'), recCh = Hist.recentLive();
      if (favCh.length) html += rail('Chaînes favorites', favCh.slice(0, 30).map(chanCard).join(''));
      else if (recCh.length) html += rail('Chaînes récentes', recCh.slice(0, 20).map(chanCard).join(''));
      if (vod.length) html += rail('Films récemment ajoutés', vod.slice(0, 24).map(function (m) { return posterHtml('movie', m); }).join(''));
      if (ser.length) html += rail('Séries mises à jour', ser.slice(0, 24).map(function (s) { return posterHtml('series', s); }).join(''));
      var favM = Fav.list('movie');
      if (favM.length) html += rail('Ma liste · Films', favM.slice(0, 24).map(function (m) { return posterHtml('movie', { stream_id: m.id, name: m.name, stream_icon: m.icon }); }).join(''));
      if (!vod.length && !ser.length && !resume.length) html += '<div class="empty">Aucun film ni série sur ce compte.<br>Va dans « TV en direct » pour regarder les chaînes.</div>';
      html += '<div style="height:40px"></div>';
      page.innerHTML = html;
      V.bindGo(page);
      if (hero) {
        var hp = U.$('#hero-play', page);
        hp.addEventListener('click', function () { V.playMovie(hero); });
        var bg = U.$('.hero .bg', page);
        if (hero.stream_icon) bg.style.backgroundImage = 'url("' + hero.stream_icon.replace(/"/g, '%22') + '")';
        API.vodInfo(hero.stream_id).then(function (inf) {
          var info = inf && inf.info || {};
          var bd = info.backdrop_path && info.backdrop_path[0];
          if (bd && bg.isConnected) bg.style.backgroundImage = 'url("' + String(bd).replace(/"/g, '%22') + '")';
          var pl = U.$('.hero .plot', page);
          if (pl && info.plot) pl.textContent = info.plot;
          var meta = U.$('.hero .meta', page);
          if (meta) meta.textContent = [U.year(info.releasedate || hero.name), info.genre, info.duration_secs ? U.minutesLabel(info.duration_secs / 60) : '', ratingOf(hero) ? '★ ' + ratingOf(hero) : ''].filter(Boolean).join(' · ');
        }).catch(function () { });
      }
    });
  };

  // ---------- catalog grid (films / séries) ----------
  var catState = { movie: { cat: '__recent' }, series: { cat: '__recent' } };

  function catalog(page, kind, params) {
    var isMovie = kind === 'movie';
    page.innerHTML = '<div class="spinner" style="margin-top:140px"></div>';
    var st = catState[kind];
    return Promise.all([API.categories(isMovie ? 'vod' : 'series'), isMovie ? API.vodStreams() : API.seriesList()]).then(function (r) {
      var cats = r[0], items = r[1];
      var byCat = {};
      items.forEach(function (x) { (byCat[x.category_id] = byCat[x.category_id] || []).push(x); });
      var chips = [{ id: '__recent', name: 'Nouveautés' }, { id: '__all', name: 'Tout' }, { id: '__fav', name: 'Ma liste' }]
        .concat(cats.filter(function (c) { return byCat[c.category_id]; }).map(function (c) { return { id: c.category_id, name: c.category_name }; }));
      page.innerHTML =
        '<div class="section" style="margin-top:6px"><h1 style="font-size:26px">' + (isMovie ? 'Films' : 'Séries') + ' <span class="muted" style="font-size:14px;font-family:IN;font-weight:500" id="cnt"></span></h1></div>' +
        '<div class="section" style="margin-top:8px"><div class="chips nav-group">' + chips.map(function (c) { return '<button class="f chip" data-c="' + U.esc(c.id) + '" data-key="cat' + U.esc(c.id) + '">' + U.esc(c.name) + '</button>'; }).join('') + '</div></div>' +
        '<div class="grid nav-group" id="grid"></div>';
      var grid = U.$('#grid', page), list = [], shown = 0, sio = null;
      function listFor(id) {
        if (id === '__recent') return items.slice().sort(isMovie ? byAdded : byModified).slice(0, 120);
        if (id === '__all') return items.slice().sort(function (a, b) { return U.cleanName(a.name).localeCompare(U.cleanName(b.name), 'fr'); });
        if (id === '__fav') return Fav.list(isMovie ? 'movie' : 'series').map(function (f) {
          return items.find(function (x) { return String(isMovie ? x.stream_id : x.series_id) === String(f.id); }) || (isMovie ? { stream_id: f.id, name: f.name, stream_icon: f.icon } : { series_id: f.id, name: f.name, cover: f.icon });
        });
        return byCat[id] || [];
      }
      function more(n) {
        var end = Math.min(list.length, shown + (n || 60));
        var s = U.$('.sentinel', grid); if (s) s.remove();
        grid.insertAdjacentHTML('beforeend', list.slice(shown, end).map(function (x) { return posterHtml(isMovie ? 'movie' : 'series', x); }).join(''));
        shown = end;
        if (shown < list.length) {
          var sen = U.html('<div class="sentinel" style="height:1px;grid-column:1/-1"></div>');
          grid.appendChild(sen);
          if (!sio) sio = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) more(); }); }, { root: document.getElementById('page'), rootMargin: '600px' });
          sio.observe(sen);
        }
      }
      function select(id, minCount) {
        st.cat = id;
        U.$$('.chip', page).forEach(function (b) { b.classList.toggle('active', b.dataset.c === String(id)); });
        list = listFor(id); shown = 0; grid.innerHTML = '';
        U.$('#cnt', page).textContent = list.length + (isMovie ? ' film' : ' série') + (list.length > 1 ? 's' : '');
        if (!list.length) grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' + (id === '__fav' ? 'Ta liste est vide. Ajoute des ' + (isMovie ? 'films' : 'séries') + ' depuis leur fiche.' : 'Rien dans cette catégorie.') + '</div>';
        else more(Math.max(60, minCount || 0));
      }
      U.$$('.chip', page).forEach(function (b) { b.addEventListener('click', function () { select(b.dataset.c); }); });
      if (!chips.some(function (c) { return String(c.id) === String(st.cat); })) st.cat = '__recent';
      var restoreKey = params && params._restore && params._restore.key;
      var need = 0;
      if (restoreKey) {
        var l0 = listFor(st.cat);
        need = l0.findIndex(function (x) { return (kind + (isMovie ? x.stream_id : x.series_id)) === restoreKey; }) + 20;
      }
      select(st.cat, need);
      V.bindGo(grid);
    });
  }
  V.movies = function (page, params) { return catalog(page, 'movie', params); };
  V.series = function (page, params) { return catalog(page, 'series', params); };

  // ---------- MOVIE DETAIL ----------
  V.playMovie = function (m, fromStart) {
    var id = m.stream_id;
    var h = Hist.get('movie', id);
    var start = !fromStart && h && h.pos > 30000 && h.pos < h.dur * 0.94 ? h.pos : 0;
    Player.start({
      kind: 'movie', url: API.movieUrl(id, m.container_extension), title: U.cleanName(m.name), sub: m._sub || '',
      startMs: start,
      hist: { type: 'movie', id: id, name: U.cleanName(m.name), img: m._backdrop || m.stream_icon, ext: m.container_extension }
    });
  };

  V.movie = function (page, params) {
    page.innerHTML = '<div class="spinner" style="margin-top:160px"></div>';
    return Promise.all([API.vodStreams().catch(function () { return []; }), API.vodInfo(params.id).catch(function () { return null; })]).then(function (r) {
      var base = r[0].find(function (x) { return String(x.stream_id) === String(params.id); }) || {};
      var inf = r[1] || {}, info = inf.info || {}, md = inf.movie_data || {};
      var m = {
        stream_id: params.id, name: md.name || base.name || info.name || 'Film',
        container_extension: md.container_extension || base.container_extension || 'mp4',
        stream_icon: info.movie_image || info.cover_big || base.stream_icon,
        rating: info.rating || base.rating
      };
      m._backdrop = (info.backdrop_path && info.backdrop_path[0]) || m.stream_icon;
      var year = U.year(info.releasedate || info.release_date || base.year || m.name);
      var mins = info.duration_secs ? info.duration_secs / 60 : (info.episode_run_time || 0);
      m._sub = [year, info.genre].filter(Boolean).join(' · ');
      var h = Hist.get('movie', m.stream_id);
      var canResume = h && h.pos > 30000 && h.dur && h.pos < h.dur * 0.94;
      var fav = Fav.has('movie', m.stream_id);
      page.innerHTML =
        '<div class="detail"><div class="bg"></div><div class="content">' +
          '<div class="cover"><div class="img">' + U.img(m.stream_icon) + '</div></div>' +
          '<div class="info"><h1>' + U.esc(U.noYear(U.cleanName(m.name))) + '</h1>' +
            '<div class="meta">' + [year, info.genre, mins ? U.minutesLabel(mins) : '', ratingOf(m) ? '<span class="star">★ ' + ratingOf(m) + '</span>' : '', info.country].filter(Boolean).map(function (x) { return '<span>' + (x.indexOf && x.indexOf('<span') === 0 ? x : U.esc(x)) + '</span>'; }).join('') + '</div>' +
            '<div class="plot">' + U.esc(info.plot || info.description || 'Aucun résumé disponible.') + '</div>' +
            '<div class="crew">' + (info.director ? '<b>Réalisation</b> ' + U.esc(info.director) + '<br>' : '') + (info.cast || info.actors ? '<b>Avec</b> ' + U.esc(String(info.cast || info.actors).split(',').slice(0, 6).join(', ')) : '') + '</div>' +
            '<div class="actions nav-group">' +
              '<button class="f btn primary" data-a="play" data-key="play">' + I.play + (canResume ? ' Reprendre · ' + U.dur(h.pos) : ' Lecture') + '</button>' +
              (canResume ? '<button class="f btn" data-a="start" data-key="start">Depuis le début</button>' : '') +
              '<button class="f btn" data-a="fav" data-key="fav">' + (fav ? HEART_ON + ' Dans ma liste' : HEART + ' Ma liste') + '</button>' +
            '</div></div></div></div>';
      var bg = U.$('.detail .bg', page);
      if (m._backdrop) bg.style.backgroundImage = 'url("' + String(m._backdrop).replace(/"/g, '%22') + '")';
      U.$$('[data-a]', page).forEach(function (b) {
        b.addEventListener('click', function () {
          var a = b.dataset.a;
          if (a === 'play') V.playMovie(m);
          else if (a === 'start') V.playMovie(m, true);
          else if (a === 'fav') {
            var on = Fav.toggle('movie', { id: m.stream_id, name: U.cleanName(m.name), icon: m.stream_icon });
            b.innerHTML = on ? HEART_ON + ' Dans ma liste' : HEART + ' Ma liste';
            U.toast(on ? 'Ajouté à ta liste' : 'Retiré de ta liste');
          }
        });
      });
      if (params.resume && canResume && !params._restore) setTimeout(function () { V.playMovie(m); }, 50);
    });
  };

  // ---------- SERIES DETAIL ----------
  var serieSeason = {};
  V.serie = function (page, params) {
    page.innerHTML = '<div class="spinner" style="margin-top:160px"></div>';
    var sid = params.id;
    return Promise.all([API.seriesList().catch(function () { return []; }), API.seriesInfo(sid)]).then(function (r) {
      var base = r[0].find(function (x) { return String(x.series_id) === String(sid); }) || {};
      var data = r[1] || {}, info = data.info || {};
      var name = U.cleanName(info.name || base.name || 'Série');
      var cover = info.cover || base.cover;
      var backdrop = (info.backdrop_path && info.backdrop_path[0]) || (base.backdrop_path && base.backdrop_path[0]) || cover;
      var eps = data.episodes || {};
      if (Array.isArray(eps)) { var o = {}; eps.forEach(function (arr) { if (arr && arr[0]) o[arr[0].season] = arr; }); eps = o; }
      var seasons = Object.keys(eps).sort(function (a, b) { return +a - +b; });
      var flat = [];
      seasons.forEach(function (s) { (eps[s] || []).slice().sort(function (a, b) { return +a.episode_num - +b.episode_num; }).forEach(function (e) { flat.push({ s: s, e: e }); }); });
      var last = Hist.lastEpisode(sid);
      var fav = Fav.has('series', sid);

      function epOpts(item) {
        var e = item.e, ei = e.info || {};
        var hh = Hist.get('episode', e.id);
        var start = hh && hh.pos > 30000 && hh.dur && hh.pos < hh.dur * 0.94 ? hh.pos : 0;
        var idx = flat.indexOf(item);
        return {
          kind: 'episode', url: API.episodeUrl(e.id, e.container_extension),
          title: name, sub: 'S' + item.s + ' · É' + e.episode_num + (e.title ? ' · ' + epTitle(e) : ''),
          startMs: start,
          hist: { type: 'episode', id: e.id, name: epTitle(e), img: ei.movie_image || backdrop, ext: e.container_extension, seriesId: sid, seriesName: name, season: item.s, ep: e.episode_num },
          next: flat[idx + 1] ? function () { var o = epOpts(flat[idx + 1]); o.startMs = 0; return o; } : null
        };
      }
      function epTitle(e) {
        var t = String(e.title || '');
        var m = t.match(/S\d+\s*E\d+\s*[-–:]?\s*(.*)$/i);
        return (m && m[1]) ? m[1] : (t || 'Épisode ' + e.episode_num);
      }
      function playItem(item) { Player.start(epOpts(item)); }

      var resumeItem = null, resumeLabel = '';
      if (last) {
        var li = flat.findIndex(function (it) { return String(it.e.id) === String(last.id); });
        if (li >= 0) {
          var done = last.dur && last.pos >= last.dur * 0.94;
          resumeItem = done ? flat[li + 1] || null : flat[li];
          if (resumeItem) resumeLabel = (done ? 'Suivant · ' : 'Reprendre · ') + 'S' + resumeItem.s + ' É' + resumeItem.e.episode_num;
        }
      }
      if (!resumeItem && flat.length) { resumeItem = flat[0]; resumeLabel = 'Regarder · S' + flat[0].s + ' É' + flat[0].e.episode_num; }
      var season = serieSeason[sid] || (resumeItem ? resumeItem.s : seasons[0]);

      page.innerHTML =
        '<div class="detail"><div class="bg"></div><div class="content">' +
          '<div class="cover"><div class="img">' + U.img(cover) + '</div></div>' +
          '<div class="info"><h1>' + U.esc(name) + '</h1>' +
            '<div class="meta">' + [U.year(info.releaseDate || info.release_date || base.releaseDate), info.genre, seasons.length ? seasons.length + ' saison' + (seasons.length > 1 ? 's' : '') : '', ratingOf(info.rating ? info : base) ? '★ ' + ratingOf(info.rating ? info : base) : ''].filter(Boolean).map(function (x) { return '<span>' + U.esc(x) + '</span>'; }).join('') + '</div>' +
            '<div class="plot">' + U.esc(info.plot || 'Aucun résumé disponible.') + '</div>' +
            '<div class="crew">' + (info.cast ? '<b>Avec</b> ' + U.esc(String(info.cast).split(',').slice(0, 6).join(', ')) : '') + '</div>' +
            '<div class="actions nav-group">' +
              (resumeItem ? '<button class="f btn primary" data-a="resume" data-key="resume">' + I.play + ' ' + U.esc(resumeLabel) + '</button>' : '') +
              '<button class="f btn" data-a="fav" data-key="fav">' + (fav ? HEART_ON + ' Dans ma liste' : HEART + ' Ma liste') + '</button>' +
            '</div></div></div>' +
          (seasons.length ? '<div class="seasons"><div class="chips nav-group">' + seasons.map(function (s) { return '<button class="f chip" data-s="' + U.esc(s) + '" data-key="season' + U.esc(s) + '">Saison ' + U.esc(s) + '</button>'; }).join('') + '</div></div>' : '') +
          '<div class="episodes nav-group" id="eps"></div>' +
        '</div>';
      var bg = U.$('.detail .bg', page);
      if (backdrop) bg.style.backgroundImage = 'url("' + String(backdrop).replace(/"/g, '%22') + '")';

      function showSeason(s) {
        season = s; serieSeason[sid] = s;
        U.$$('.chip', page).forEach(function (b) { b.classList.toggle('active', b.dataset.s === String(s)); });
        var box = U.$('#eps', page);
        var list = flat.filter(function (it) { return String(it.s) === String(s); });
        box.innerHTML = list.length ? list.map(function (it) {
          var e = it.e, ei = e.info || {}, hh = Hist.get('episode', e.id);
          var pct = hh && hh.dur ? Math.min(100, Math.round(hh.pos / hh.dur * 100)) : 0;
          var dur = ei.duration_secs ? U.minutesLabel(ei.duration_secs / 60) : U.hmsLabel(ei.duration);
          return '<button class="f ep" data-e="' + e.id + '" data-key="e' + e.id + '"><div class="eimg">' + U.img(ei.movie_image) + (pct ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') + '</div>' +
            '<div style="min-width:0"><div class="et">' + U.esc(e.episode_num + '. ' + epTitle(e)) + '</div><div class="ed">' + U.esc([dur, pct >= 94 ? 'Vu' : pct ? 'En cours' : ''].filter(Boolean).join(' · ')) + (ei.plot ? ' — ' + U.esc(ei.plot) : '') + '</div></div></button>';
        }).join('') : '<div class="empty">Aucun épisode.</div>';
        U.$$('.ep', box).forEach(function (b) {
          b.addEventListener('click', function () {
            var it = flat.find(function (x) { return String(x.e.id) === b.dataset.e; });
            if (it) playItem(it);
          });
        });
      }
      U.$$('.chip', page).forEach(function (b) { b.addEventListener('click', function () { showSeason(b.dataset.s); }); });
      U.$$('[data-a]', page).forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.dataset.a === 'resume' && resumeItem) playItem(resumeItem);
          else if (b.dataset.a === 'fav') {
            var on = Fav.toggle('series', { id: sid, name: name, icon: cover });
            b.innerHTML = on ? HEART_ON + ' Dans ma liste' : HEART + ' Ma liste';
            U.toast(on ? 'Ajoutée à ta liste' : 'Retirée de ta liste');
          }
        });
      });
      if (seasons.length) showSeason(season);
      if (params.resume && resumeItem && !params._restore) setTimeout(function () { playItem(resumeItem); }, 50);
    });
  };

  // ---------- FAVORITES ----------
  V.favorites = function (page) {
    var ch = Fav.list('live'), mv = Fav.list('movie'), se = Fav.list('series');
    var html = '<div class="section" style="margin-top:6px"><h1 style="font-size:26px">Favoris</h1></div>';
    if (ch.length) html += rail('Chaînes', ch.map(chanCard).join(''), ch.length);
    if (mv.length) html += rail('Films', mv.map(function (m) { return posterHtml('movie', { stream_id: m.id, name: m.name, stream_icon: m.icon }); }).join(''), mv.length);
    if (se.length) html += rail('Séries', se.map(function (s) { return posterHtml('series', { series_id: s.id, name: s.name, cover: s.icon }); }).join(''), se.length);
    if (!ch.length && !mv.length && !se.length) html += '<div class="empty">Aucun favori pour l\'instant.<br>Ajoute des films et séries avec le bouton « Ma liste » de leur fiche,<br>et des chaînes en maintenant OK (ou appui long) dans la liste des chaînes.</div>';
    page.innerHTML = html + '<div style="height:40px"></div>';
    V.bindGo(page);
    return Promise.resolve();
  };

  // ---------- SEARCH ----------
  var lastQuery = '';
  V.search = function (page) {
    page.innerHTML =
      '<div class="search-bar nav-group"><input class="f" id="q" type="search" placeholder="Chaîne, film, série…" autocomplete="off" spellcheck="false" value="' + U.esc(lastQuery) + '"></div>' +
      '<div id="res"><div class="empty">Tape au moins 2 lettres.</div></div>';
    var q = U.$('#q', page), res = U.$('#res', page);
    V.bindGo(res);
    var data = null;
    var loading = Promise.all([API.liveStreams().catch(function () { return []; }), API.vodStreams().catch(function () { return []; }), API.seriesList().catch(function () { return []; })])
      .then(function (r) {
        data = r.map(function (list) { return list.map(function (x) { return { x: x, k: U.fold(x.name) }; }); });
        if (q.value.length >= 2) run();
      });
    function run() {
      var t = U.fold(q.value.trim());
      lastQuery = q.value;
      if (t.length < 2) { res.innerHTML = '<div class="empty">Tape au moins 2 lettres.</div>'; return; }
      if (!data) { res.innerHTML = '<div class="spinner"></div>'; return; }
      var words = t.split(/\s+/);
      function match(o) { return words.every(function (w) { return o.k.indexOf(w) >= 0; }); }
      var ch = data[0].filter(match).slice(0, 40).map(function (o) { return o.x; });
      var mv = data[1].filter(match).slice(0, 40).map(function (o) { return o.x; });
      var se = data[2].filter(match).slice(0, 40).map(function (o) { return o.x; });
      var html = '';
      if (ch.length) html += rail('Chaînes', ch.map(function (s) { return chanCard({ id: s.stream_id, name: U.cleanName(s.name), icon: s.stream_icon, num: s.num }); }).join(''));
      if (mv.length) html += rail('Films', mv.map(function (m) { return posterHtml('movie', m); }).join(''));
      if (se.length) html += rail('Séries', se.map(function (s) { return posterHtml('series', s); }).join(''));
      res.innerHTML = html || '<div class="empty">Aucun résultat pour « ' + U.esc(q.value) + ' ».</div>';
    }
    q.addEventListener('input', U.debounce(run, 300));
    q.addEventListener('submit-input', run);
    return loading.then(function () { if (!document.body.classList.contains('kbd')) q.focus(); else Nav.focus(q); });
  };

  // ---------- SETTINGS ----------
  V.settings = function (page) {
    var s = Settings.all(), inf = API.info && API.info.user_info || {};
    var exp = inf.exp_date ? new Date(+inf.exp_date * 1000) : null;
    var fmtLabel = { auto: 'Automatique', m3u8: 'HLS (.m3u8)', ts: 'MPEG-TS (.ts)' };
    page.innerHTML =
      '<div class="settings"><h1>Paramètres</h1>' +
      '<div class="acc">' +
        '<div><small>Serveur</small>' + U.esc(API.account ? API.account.server : '') + '</div>' +
        '<div><small>Utilisateur</small>' + U.esc(API.account ? API.account.user : '') + '</div>' +
        '<div><small>Statut</small>' + U.esc(inf.status || '—') + '</div>' +
        '<div><small>Expiration</small>' + (exp ? exp.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Illimitée') + '</div>' +
        '<div><small>Connexions</small>' + U.esc((inf.active_cons != null ? inf.active_cons : '?') + ' / ' + (inf.max_connections || '?')) + '</div>' +
        '<div><small>Version</small>IPTV+ ' + U.esc(Native.version()) + '</div>' +
      '</div>' +
      '<div class="nav-group">' +
      row('liveFormat', 'Format du direct', 'Change-le si certaines chaînes ne se lancent pas', fmtLabel[s.liveFormat]) +
      row('player', 'Lecteur vidéo', 'Intégré, ou externe (VLC, MX Player…)', s.player === 'external' ? 'Externe' : 'Intégré') +
      row('aspectLive', 'Format d\'image · TV en direct', 'Original, 16:9, 4:3, étirer ou zoom', Aspect.labels[Aspect.get('live')]) +
      row('aspectVod', 'Format d\'image · Films et séries', 'Original, 16:9, 4:3, étirer ou zoom', Aspect.labels[Aspect.get('vod')]) +
      row('autoNext', 'Épisode suivant automatique', 'Enchaîne les épisodes d\'une série', s.autoNext ? 'Oui' : 'Non') +
      row('reload', 'Recharger les listes', 'Récupère les nouvelles chaînes, films et séries', '') +
      row('clearHist', 'Effacer l\'historique', 'Vide « Reprendre la lecture » et les chaînes récentes', '') +
      row('logout', 'Se déconnecter', 'Change de compte ou de serveur', '') +
      '</div></div>';
    function row(k, t, d, v) {
      return '<button class="f srow" data-k="' + k + '"><div class="sl"><div class="st">' + U.esc(t) + '</div><div class="sd">' + U.esc(d) + '</div></div><div class="sv">' + U.esc(v) + '</div></button>';
    }
    U.$$('.srow', page).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.k;
        if (k === 'liveFormat') Modal.choose('Format du direct', ['auto', 'm3u8', 'ts'].map(function (v) { return { label: fmtLabel[v], value: v, selected: Settings.get('liveFormat') === v }; }), function (v) { Settings.set('liveFormat', v); API.workingLiveFormat = null; App.refresh(); });
        else if (k === 'player') Modal.choose('Lecteur vidéo', [{ label: 'Intégré', value: 'internal' }, { label: 'Externe', value: 'external' }].map(function (o) { o.selected = Settings.get('player') === o.value; return o; }), function (v) { Settings.set('player', v); App.refresh(); });
        else if (k === 'aspectLive') Aspect.choose('live', function () { App.refresh(); });
        else if (k === 'aspectVod') Aspect.choose('vod', function () { App.refresh(); });
        else if (k === 'autoNext') { Settings.set('autoNext', !Settings.get('autoNext')); App.refresh(); }
        else if (k === 'reload') { API.cache = {}; API.epgCache = {}; API.refreshInfo().catch(function () { }); U.toast('Listes rechargées'); }
        else if (k === 'clearHist') { Hist.clear(); U.toast('Historique effacé'); }
        else if (k === 'logout') Modal.choose('Se déconnecter ?', [{ label: 'Oui, se déconnecter', value: 1 }, { label: 'Annuler', value: 0 }], function (v) { if (v) { API.logout(); App.go('login'); } });
      });
    });
    API.refreshInfo().catch(function () { });
    return Promise.resolve();
  };

  V.guide = function (page) { return Guide.render(page); };

  window.Views = V;
})();
