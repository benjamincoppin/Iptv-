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
      '<div class="img"><div class="ph">' + U.esc(name) + '</div>' + U.img(img) + (r ? '<span class="rate">★ ' + r + '</span>' : '') + (isMovie && Hist.isWatched('movie', id) ? '<span class="seen">Vu</span>' : '') + '</div>' +
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
    return '<button class="f card" data-go="' + go + '" data-resume="1" data-longpress="1" data-h="' + U.esc(h.type + ':' + h.id) + '" data-key="r' + h.type + h.id + '">' +
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
  V.login = function (page, params) {
    var adding = !!(params && params.add);
    var a = adding ? {} : (API.account || {});
    page.innerHTML =
      '<div class="login"><div class="box nav-group">' +
        '<div class="logo">IPTV<span>+</span></div>' +
        '<p>' + (adding ? 'Ajoute un autre abonnement Xtream Codes. Tu pourras passer de l\'un à l\'autre dans Paramètres → Comptes Xtream.' : 'Connecte-toi avec les identifiants Xtream Codes fournis par ton abonnement.') + '</p>' +
        '<label class="field"><span>Adresse du serveur</span><input class="f" id="lg-s" type="url" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="http://exemple.com:8080" value="' + U.esc(a.server || '') + '"></label>' +
        '<label class="field"><span>Nom d\'utilisateur</span><input class="f" id="lg-u" type="text" autocapitalize="off" autocomplete="off" spellcheck="false" value="' + U.esc(a.user || '') + '"></label>' +
        '<label class="field"><span>Mot de passe</span><input class="f" id="lg-p" type="password" autocomplete="off" data-submit="1" value=""></label>' +
        '<label class="field"><span>Clé API TMDB <span class="muted">(facultatif, pour les images des épisodes)</span></span><input class="f" id="lg-t" type="text" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="Clé gratuite sur themoviedb.org" value="' + U.esc(API.account ? TMDB.key() : '') + '"></label>' +
        '<button class="f btn primary" id="lg-go">' + (adding ? 'Ajouter le compte' : 'Se connecter') + '</button>' +
        (adding ? '<button class="f btn" id="lg-cancel" style="margin-top:10px;width:100%">Annuler</button>' : '') +
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
        var tk = U.$('#lg-t', page).value.trim();
        if (tk && tk !== TMDB.key()) TMDB.setKey(tk);
        U.toast('Connecté');
        App.start();
      }).catch(function (e) {
        err.textContent = e.message || 'Connexion impossible';
        go.disabled = false; go.textContent = 'Se connecter';
      });
    }
    go.addEventListener('click', submit);
    var cancel = U.$('#lg-cancel', page);
    if (cancel) cancel.addEventListener('click', function () { App.back(); });
    p.addEventListener('submit-input', submit);
    p.addEventListener('keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); submit(); } });
    return Promise.resolve().then(function () { Nav.focus(a.server ? (a.user ? p : u) : s); });
  };

  // ---------- HOME (style Cinéma) ----------
  V.home = function (page) {
    page.innerHTML = '<div class="spinner" style="margin-top:160px"></div>';
    return Promise.all([API.vodStreams().catch(function () { return []; }), API.seriesList().catch(function () { return []; })]).then(function (r) {
      var vod = Cats.filterItems('vod', r[0]).slice().sort(byAdded), ser = Cats.filterItems('series', r[1]).slice().sort(byModified);
      // Carousel: 5 newest movies + 5 newest series, alternating
      var mv5 = vod.filter(function (m) { return m.stream_icon; }).slice(0, 5);
      var se5 = ser.filter(function (s) { return s.cover; }).slice(0, 5);
      var slides = [];
      for (var si = 0; si < 5; si++) {
        if (mv5[si]) slides.push({ kind: 'movie', x: mv5[si] });
        if (se5[si]) slides.push({ kind: 'series', x: se5[si] });
      }
      var html = '';
      if (slides.length) {
        html += '<section class="hero" data-reveal-top="1"><div class="bg"></div><div class="bg bg2"></div><div class="in nav-group">' +
          '<div class="kicker"></div><h1></h1><div class="meta"></div><div class="plot"></div>' +
          '<div class="actions"><button class="f btn primary" id="hero-play">' + I.play + ' Lecture</button>' +
          '<button class="f btn" id="hero-info">Plus d\'infos</button></div></div>' +
          (slides.length > 1 ? '<div class="dots">' + slides.map(function (s, i) { return '<button class="dot" data-i="' + i + '" aria-label="Nouveauté ' + (i + 1) + '"></button>'; }).join('') + '</div>' : '') +
          '</section>';
      } else {
        html += '<div style="height:20px"></div>';
      }
      var resume = Hist.resumeList();
      html += '<div id="resume-sec">' + (resume.length ? rail('Reprendre la lecture', resume.map(resumeCard).join('')) : '') + '</div>';
      html += '<div id="reco-sec"></div>';
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
      if (slides.length) V.heroCarousel(page, slides);
      bindResume(page);
      V.recommendations(vod, ser).then(function (rows) {
        var sec = U.$('#reco-sec', page);
        if (!sec || !sec.isConnected || !rows.length) return;
        sec.innerHTML = rows.map(function (r) {
          return rail('Parce que tu as regardé « ' + U.noYear(U.cleanName(r.title || '')) + ' »', r.items.slice(0, 20).map(function (it) { return posterHtml(it.kind, it.x); }).join(''));
        }).join('');
      }).catch(function () { });
      Sync.onChange = function () { V.updateResume(page); };
      Sync.refresh(30000);
    });
  };

  // "Reprendre la lecture": long press (remote OK held / long tap) to remove an item
  function bindResume(page) {
    var sec = U.$('#resume-sec', page);
    if (!sec || sec.__bound) return;
    sec.__bound = true;
    sec.addEventListener('longpress', function (e) {
      var b = e.target.closest('[data-h]');
      if (!b) return;
      var h = Hist.all()[b.dataset.h];
      if (!h) return;
      var label = h.type === 'episode' ? (h.seriesName || 'cette série') : (h.name || 'ce film');
      Modal.choose(label, [
        { label: 'Retirer de « Reprendre la lecture »', value: 'rm' },
        { label: 'Annuler', value: 'no' }
      ], function (v) {
        if (v !== 'rm') return;
        Hist.dismiss(h);
        U.toast('Retiré de « Reprendre la lecture »');
        V.updateResume(page);
      });
    });
  }
  // Redraw only the "Reprendre la lecture" row (after a removal or a sync from another device)
  V.updateResume = function (page) {
    if (App.syncWatchNext) App.syncWatchNext();
    var sec = U.$('#resume-sec', page);
    if (!sec || !sec.isConnected) return;
    var list = Hist.resumeList();
    var focusedIdx = -1;
    if (Nav.current && sec.contains(Nav.current)) focusedIdx = U.$$('.card', sec).indexOf(Nav.current);
    sec.innerHTML = list.length ? rail('Reprendre la lecture', list.map(resumeCard).join('')) : '';
    if (focusedIdx >= 0) {
      var cards = U.$$('.card', sec);
      var f = cards[Math.min(focusedIdx, cards.length - 1)];
      if (f) Nav.focus(f); else Nav.first(null, page);
    }
  };

  // ---------- home banner carousel ----------
  V.heroCarousel = function (page, slides) {
    var hero = U.$('.hero', page), cur = -1, timer = null, layer = 0;
    var bgs = U.$$('.hero .bg', page);
    function details(s) {
      if (s.info) return Promise.resolve(s.info);
      var p = s.kind === 'movie' ? API.vodInfo(s.x.stream_id) : API.seriesInfo(s.x.series_id);
      return p.then(function (r) {
        var info = (r && r.info) || {};
        s.info = {
          backdrop: (info.backdrop_path && info.backdrop_path[0]) || (s.x.backdrop_path && s.x.backdrop_path[0]) || '',
          plot: info.plot || s.x.plot || '',
          meta: s.kind === 'movie'
            ? [U.year(info.releasedate || s.x.name), info.genre, info.duration_secs ? U.minutesLabel(info.duration_secs / 60) : '', ratingOf(s.x) ? '★ ' + ratingOf(s.x) : '']
            : [U.year(info.releaseDate || s.x.releaseDate), info.genre || s.x.genre, ratingOf(s.x) ? '★ ' + ratingOf(s.x) : '']
        };
        return s.info;
      }).catch(function () { s.info = { backdrop: '', plot: s.x.plot || '', meta: [] }; return s.info; });
    }
    function show(i) {
      if (!hero.isConnected) { clearInterval(timer); return; }
      i = (i + slides.length) % slides.length;
      if (i === cur) return;
      cur = i;
      var s = slides[i], name = U.noYear(U.cleanName(s.x.name));
      U.$('.kicker', hero).textContent = 'Nouveauté · ' + (s.kind === 'movie' ? 'Film' : 'Série');
      U.$('h1', hero).textContent = name;
      U.$('.meta', hero).textContent = [U.year(s.x.year || s.x.releaseDate || s.x.name), ratingOf(s.x) ? '★ ' + ratingOf(s.x) : ''].filter(Boolean).join(' · ');
      U.$('.plot', hero).textContent = s.x.plot || '';
      U.$$('.dot', hero).forEach(function (d) { d.classList.toggle('on', +d.dataset.i === i); });
      setBg(U.imgUrl(s.kind === 'movie' ? s.x.stream_icon : s.x.cover));
      details(s).then(function (d) {
        if (cur !== i || !hero.isConnected) return;
        if (d.backdrop) setBg(U.imgUrl(d.backdrop));
        if (d.plot) U.$('.plot', hero).textContent = d.plot;
        var m = d.meta.filter(Boolean); if (m.length) U.$('.meta', hero).textContent = m.join(' · ');
      });
      details(slides[(i + 1) % slides.length]); // prefetch the next one
    }
    function setBg(url) {
      if (!url) return;
      var next = bgs[1 - layer], prev = bgs[layer];
      var img = new Image();
      img.onload = function () {
        next.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
        next.classList.add('on'); prev.classList.remove('on');
        layer = 1 - layer;
      };
      img.src = url;
    }
    function restart() { clearInterval(timer); if (slides.length > 1) timer = setInterval(function () { show(cur + 1); }, 8000); }
    function current() { return slides[cur]; }
    U.$('#hero-play', hero).addEventListener('click', function () {
      var s = current();
      if (s.kind === 'movie') V.playMovie(s.x); else App.go('serie', { id: s.x.series_id, resume: true });
    });
    U.$('#hero-info', hero).addEventListener('click', function () {
      var s = current();
      App.go(s.kind === 'movie' ? 'movie' : 'serie', { id: s.kind === 'movie' ? s.x.stream_id : s.x.series_id });
    });
    U.$$('.dot', hero).forEach(function (d) { d.addEventListener('click', function () { show(+d.dataset.i); restart(); }); });
    // Remote: ← on "Lecture" = previous, → on "Plus d'infos" = next
    hero.setAttribute('data-navhook', '1');
    hero.__navHook = function (dir, el) {
      if (dir === 'left' && el.id === 'hero-play') { show(cur - 1); restart(); return true; }
      if (dir === 'right' && el.id === 'hero-info') { show(cur + 1); restart(); return true; }
      return false;
    };
    // Touch: swipe
    var x0 = null;
    hero.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener('touchend', function (e) {
      if (x0 == null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) { show(cur + (dx < 0 ? 1 : -1)); restart(); }
    }, { passive: true });
    show(0);
    restart();
  };

  // ---------- catalog grid (films / séries) ----------
  var catState = { movie: { cat: '__recent' }, series: { cat: '__recent' } };

  var SORTS = { auto: 'Par défaut', added: 'Ajout récent', az: 'A → Z', rating: 'Mieux notés', year: 'Plus récents (année)' };
  function catalog(page, kind, params) {
    var isMovie = kind === 'movie', ckind = isMovie ? 'vod' : 'series';
    page.innerHTML = '<div class="spinner" style="margin-top:140px"></div>';
    var st = catState[kind];
    if (!st.sort) { st.sort = 'auto'; st.minRating = 0; st.decade = ''; st.genre = ''; st.hideSeen = false; }
    return Promise.all([API.categories(ckind), isMovie ? API.vodStreams() : API.seriesList()]).then(function (r) {
      var cats = Cats.apply(ckind, r[0]), items = Cats.filterItems(ckind, r[1]);
      var byCat = {};
      items.forEach(function (x) { (byCat[x.category_id] = byCat[x.category_id] || []).push(x); });
      var chips = [{ id: '__recent', name: 'Nouveautés' }, { id: '__all', name: 'Tout' }, { id: '__fav', name: 'Ma liste' }]
        .concat(cats.filter(function (c) { return byCat[c.category_id]; }).map(function (c) { return { id: c.category_id, name: c.category_name }; }));
      // Genres (when the provider gives them, mostly for series)
      var genres = {};
      items.forEach(function (x) { String(x.genre || '').split(/[,\/|]/).forEach(function (g) { g = g.trim(); if (g && g.length < 30) genres[g] = (genres[g] || 0) + 1; }); });
      var genreList = Object.keys(genres).filter(function (g) { return genres[g] >= 3; }).sort(function (a, b) { return a.localeCompare(b, 'fr'); });
      page.innerHTML =
        '<div class="section" style="margin-top:6px"><div class="tools"><h1 style="font-size:26px;margin-right:6px">' + (isMovie ? 'Films' : 'Séries') + ' <span class="muted" style="font-size:14px;font-family:IN;font-weight:500" id="cnt"></span></h1>' +
          '<span class="nav-group" style="display:flex;gap:8px"><button class="f tool-btn" id="flt" data-key="flt"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18M6 12h12M10 19h4"/></svg><span></span></button></span></div></div>' +
        '<div class="section" style="margin-top:8px"><div class="chips nav-group">' + chips.map(function (c) { return '<button class="f chip" data-c="' + U.esc(c.id) + '" data-key="cat' + U.esc(c.id) + '">' + U.esc(c.name) + '</button>'; }).join('') + '</div></div>' +
        '<div class="grid nav-group" id="grid"></div>';
      var grid = U.$('#grid', page), list = [], shown = 0, sio = null;
      function idOf(x) { return isMovie ? x.stream_id : x.series_id; }
      function rating(x) { var v = parseFloat(x.rating_5based ? x.rating_5based * 2 : x.rating); return isNaN(v) ? 0 : v; }
      function yearOf(x) { return +U.year(x.year || x.releaseDate || x.release_date || x.name) || 0; }
      function seen(x) { return isMovie ? Hist.isWatched('movie', x.stream_id) : Hist.seriesStarted(x.series_id); }
      function baseList(id) {
        if (id === '__recent') return items.slice().sort(isMovie ? byAdded : byModified).slice(0, 150);
        if (id === '__all') return items.slice();
        if (id === '__fav') return Fav.list(isMovie ? 'movie' : 'series').map(function (f) {
          return items.find(function (x) { return String(idOf(x)) === String(f.id); }) || (isMovie ? { stream_id: f.id, name: f.name, stream_icon: f.icon } : { series_id: f.id, name: f.name, cover: f.icon });
        });
        return byCat[id] || [];
      }
      function listFor(id) {
        var l = baseList(id);
        if (st.minRating) l = l.filter(function (x) { return rating(x) >= st.minRating; });
        if (st.decade) l = l.filter(function (x) { var y = yearOf(x); return st.decade === 'old' ? (y && y < 1990) : (y >= +st.decade && y < +st.decade + 10); });
        if (st.genre) l = l.filter(function (x) { return String(x.genre || '').indexOf(st.genre) >= 0; });
        if (st.hideSeen) l = l.filter(function (x) { return !seen(x); });
        var s = st.sort === 'auto' ? (id === '__all' ? 'az' : '') : st.sort;
        if (s === 'az') l.sort(function (a, b) { return U.noYear(U.cleanName(a.name)).localeCompare(U.noYear(U.cleanName(b.name)), 'fr'); });
        else if (s === 'added') l.sort(isMovie ? byAdded : byModified);
        else if (s === 'rating') l.sort(function (a, b) { return rating(b) - rating(a); });
        else if (s === 'year') l.sort(function (a, b) { return yearOf(b) - yearOf(a); });
        return l;
      }
      function filterLabel() {
        var parts = [];
        if (st.sort !== 'auto') parts.push(SORTS[st.sort]);
        if (st.minRating) parts.push('★ ' + st.minRating + '+');
        if (st.decade) parts.push(st.decade === 'old' ? 'Avant 1990' : 'Années ' + st.decade);
        if (st.genre) parts.push(st.genre);
        if (st.hideSeen) parts.push(isMovie ? 'Non vus' : 'Non commencées');
        var b = U.$('#flt', page);
        U.$('span', b).textContent = parts.length ? parts.join(' · ') : 'Trier et filtrer';
        b.classList.toggle('on', parts.length > 0);
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
        filterLabel();
        if (!list.length) grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' + (id === '__fav' ? 'Ta liste est vide. Ajoute des ' + (isMovie ? 'films' : 'séries') + ' depuis leur fiche.' : 'Rien ne correspond.') + '</div>';
        else more(Math.max(60, minCount || 0));
      }
      // "Trier et filtrer" menu
      function filterMenu() {
        var yes = function (b) { return b ? 'Oui' : 'Non'; };
        Modal.choose('Trier et filtrer', [
          { label: 'Tri : ' + SORTS[st.sort], value: 'sort' },
          { label: 'Note minimale : ' + (st.minRating ? st.minRating + '/10' : 'toutes'), value: 'rating' },
          { label: 'Période : ' + (st.decade ? (st.decade === 'old' ? 'avant 1990' : 'années ' + st.decade) : 'toutes'), value: 'decade' }
        ].concat(genreList.length ? [{ label: 'Genre : ' + (st.genre || 'tous'), value: 'genre' }] : []).concat([
          { label: (isMovie ? 'Masquer les films déjà vus : ' : 'Masquer les séries commencées : ') + yes(st.hideSeen), value: 'seen' },
          { label: 'Tout réinitialiser', value: 'reset' }
        ]), function (v) {
          setTimeout(function () {
            var again = function () { select(st.cat); filterMenu(); };
            if (v === 'sort') Modal.choose('Tri', Object.keys(SORTS).map(function (k) { return { label: SORTS[k], value: k, selected: st.sort === k }; }), function (x) { st.sort = x; again(); });
            else if (v === 'rating') Modal.choose('Note minimale', [0, 5, 6, 7, 8].map(function (n) { return { label: n ? n + '/10 et plus' : 'Toutes les notes', value: n, selected: st.minRating === n }; }), function (x) { st.minRating = x; again(); });
            else if (v === 'decade') Modal.choose('Période', [{ label: 'Toutes', value: '' }, { label: 'Années 2020', value: '2020' }, { label: 'Années 2010', value: '2010' }, { label: 'Années 2000', value: '2000' }, { label: 'Années 1990', value: '1990' }, { label: 'Avant 1990', value: 'old' }].map(function (o) { o.selected = st.decade === o.value; return o; }), function (x) { st.decade = x; again(); });
            else if (v === 'genre') Modal.choose('Genre', [{ label: 'Tous les genres', value: '' }].concat(genreList.map(function (g) { return { label: g, value: g }; })).map(function (o) { o.selected = st.genre === o.value; return o; }), function (x) { st.genre = x; again(); });
            else if (v === 'seen') { st.hideSeen = !st.hideSeen; again(); }
            else if (v === 'reset') { st.sort = 'auto'; st.minRating = 0; st.decade = ''; st.genre = ''; st.hideSeen = false; select(st.cat); }
          }, 0);
        });
      }
      U.$('#flt', page).addEventListener('click', filterMenu);
      U.$$('.chip', page).forEach(function (b) { b.addEventListener('click', function () { select(b.dataset.c); }); });
      if (!chips.some(function (c) { return String(c.id) === String(st.cat); })) st.cat = '__recent';
      var restoreKey = params && params._restore && params._restore.key;
      var need = 0;
      if (restoreKey) {
        var l0 = listFor(st.cat);
        need = l0.findIndex(function (x) { return (kind + idOf(x)) === restoreKey; }) + 20;
      }
      select(st.cat, need);
      V.bindGo(grid);
    });
  }
  V.movies = function (page, params) { return catalog(page, 'movie', params); };
  V.series = function (page, params) { return catalog(page, 'series', params); };

  // ---------- trailers ----------
  V.findTrailer = function (xtreamKey, tmdbFn) {
    var k = String(xtreamKey || '').trim();
    var m = k.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/);
    if (m) k = m[1];
    if (/^[\w-]{11}$/.test(k)) return Promise.resolve(k);
    return tmdbFn ? tmdbFn().catch(function () { return null; }) : Promise.resolve(null);
  };
  V.openTrailer = function (key) {
    if (!key) return;
    if (!Native.openUrl || !Native.openUrl('https://www.youtube.com/watch?v=' + key)) U.toast('Installe l\'appli YouTube pour voir la bande-annonce');
  };

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
              '<button class="f btn hidden" data-a="trailer" data-key="trailer">' + I.play + ' Bande-annonce</button>' +
            '</div></div></div></div>';
      var bg = U.$('.detail .bg', page);
      if (m._backdrop) bg.style.backgroundImage = 'url("' + String(m._backdrop).replace(/"/g, '%22') + '")';
      U.$$('[data-a]', page).forEach(function (b) {
        b.addEventListener('click', function () {
          var a = b.dataset.a;
          if (a === 'play') V.playMovie(m);
          else if (a === 'start') V.playMovie(m, true);
          else if (a === 'trailer') V.openTrailer(b.dataset.yt);
          else if (a === 'fav') {
            var on = Fav.toggle('movie', { id: m.stream_id, name: U.cleanName(m.name), icon: m.stream_icon });
            b.innerHTML = on ? HEART_ON + ' Dans ma liste' : HEART + ' Ma liste';
            U.toast(on ? 'Ajouté à ta liste' : 'Retiré de ta liste');
          }
        });
      });
      if (params.resume && canResume && !params._restore) setTimeout(function () { V.playMovie(m); }, 50);
      V.findTrailer(info.youtube_trailer, TMDB.enabled() ? function () { return TMDB.movieId(m.stream_id, info, m.name).then(function (id) { return id ? TMDB.trailer('movie', id) : null; }); } : null)
        .then(function (k) { var b = U.$('[data-a="trailer"]', page); if (k && b) { b.dataset.yt = k; b.classList.remove('hidden'); } });
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
      // Season posters provided by the server (used when an episode has no picture of its own)
      var seasonImg = {};
      (Array.isArray(data.seasons) ? data.seasons : []).forEach(function (se) {
        if (!se) return;
        var n = se.season_number != null ? se.season_number : se.season;
        seasonImg[String(n)] = [se.cover_big, se.cover, se.cover_tmdb, se.overview_image];
      });
      var tmdbEp = {};   // "season:episode" -> {still, name, overview}
      var generic = {}; [cover, backdrop].concat(info.backdrop_path || []).forEach(function (u) { if (U.imgUrl(u)) generic[U.imgUrl(u)] = 1; });
      function ownImage(ei) {
        var u = U.imgUrl(ei.movie_image) || U.imgUrl(ei.cover_big);
        return u && !generic[u] ? u : ''; // the series poster repeated on every episode is not a real episode picture
      }
      function tmdbOf(item) { return tmdbEp[item.s + ':' + item.e.episode_num] || null; }
      function epImages(item) {
        var ei = item.e.info || {}, t = tmdbOf(item);
        return [ownImage(ei), t && t.still, ei.still_path, item.e.stream_icon, seasonImg[String(item.s)], tmdbEp['_poster' + item.s], info.backdrop_path, backdrop, cover];
      }
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
          hist: { type: 'episode', id: e.id, name: epTitle(e), img: U.imgUrl(ei.movie_image) || U.imgUrl(ei.cover_big) || (seasonImg[String(item.s)] || []).map(U.imgUrl).filter(Boolean)[0] || U.imgUrl(backdrop) || U.imgUrl(cover), ext: e.container_extension, seriesId: sid, seriesName: name, season: item.s, ep: e.episode_num },
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
              '<button class="f btn hidden" data-a="trailer" data-key="trailer">' + I.play + ' Bande-annonce</button>' +
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
          var tm = tmdbOf(it), plot = ei.plot || (tm && tm.overview) || '';
          return '<button class="f ep" data-e="' + e.id + '" data-key="e' + e.id + '"><div class="eimg">' + U.imgChain(epImages(it)) + (pct ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') + '</div>' +
            '<div style="min-width:0"><div class="et">' + U.esc(e.episode_num + '. ' + epTitle(e)) + '</div><div class="ed">' + U.esc([dur, pct >= 94 ? 'Vu' : pct ? 'En cours' : ''].filter(Boolean).join(' · ')) + (plot ? ' — ' + U.esc(plot) : '') + '</div></div></button>';
        }).join('') : '<div class="empty">Aucun épisode.</div>';
        U.$$('.ep', box).forEach(function (b) {
          b.addEventListener('click', function () {
            var it = flat.find(function (x) { return String(x.e.id) === b.dataset.e; });
            if (it) playItem(it);
          });
        });
        loadTmdb(s);
      }

      // Fetch episode pictures from TMDB for this season, then redraw the list keeping the focus
      var tmdbIdP = null, tmdbDone = {};
      function loadTmdb(s) {
        if (!TMDB.enabled() || tmdbDone[s]) return;
        tmdbDone[s] = true;
        if (!tmdbIdP) tmdbIdP = TMDB.tvId(sid, info, base, name);
        tmdbIdP.then(function (id) { return id ? TMDB.season(id, s) : null; }).then(function (eps2) {
          if (!eps2 || !page.isConnected || String(season) !== String(s)) return;
          Object.keys(eps2).forEach(function (n) { if (n === '_poster') tmdbEp['_poster' + s] = eps2[n]; else tmdbEp[s + ':' + n] = eps2[n]; });
          var focusKey = Nav.current && page.contains(Nav.current) ? Nav.current.dataset.key : null;
          var scroll = document.getElementById('page').scrollTop;
          showSeason(s);
          document.getElementById('page').scrollTop = scroll;
          var f = focusKey && U.$('[data-key="' + focusKey + '"]', page);
          if (f) Nav.focus(f, { noScroll: true });
        }).catch(function (e) { console.warn(e); });
      }
      U.$$('.chip', page).forEach(function (b) { b.addEventListener('click', function () { showSeason(b.dataset.s); }); });
      U.$$('[data-a]', page).forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.dataset.a === 'resume' && resumeItem) playItem(resumeItem);
          else if (b.dataset.a === 'trailer') V.openTrailer(b.dataset.yt);
          else if (b.dataset.a === 'fav') {
            var on = Fav.toggle('series', { id: sid, name: name, icon: cover });
            b.innerHTML = on ? HEART_ON + ' Dans ma liste' : HEART + ' Ma liste';
            U.toast(on ? 'Ajoutée à ta liste' : 'Retirée de ta liste');
          }
        });
      });
      if (seasons.length) showSeason(season);
      if (params.resume && resumeItem && !params._restore) setTimeout(function () { playItem(resumeItem); }, 50);
      V.findTrailer(info.youtube_trailer, TMDB.enabled() ? function () { return TMDB.tvId(sid, info, base, name).then(function (id) { return id ? TMDB.trailer('tv', id) : null; }); } : null)
        .then(function (k) { var b = U.$('[data-a="trailer"]', page); if (k && b) { b.dataset.yt = k; b.classList.remove('hidden'); } });
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
        r = [Cats.filterItems('live', r[0]), Cats.filterItems('vod', r[1]), Cats.filterItems('series', r[2])];
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

  V.guide = function (page) { return Guide.render(page); };

  window.Views = V;
})();
