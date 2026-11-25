/* IPTV+ — Guide TV (grille des programmes) */
(function () {
  'use strict';

  var G = {};
  var PX = 5;            // pixels per minute
  var HOURS = 6;
  var root, cats = [], all = [], byCat = {}, rows = [], catId, winStart, rendered = 0, io, sio, clock;

  G.render = function (page) {
    root = page;
    page.innerHTML = '<div class="spinner"></div>';
    if (window.matchMedia('(max-width:720px)').matches) PX = 4; else PX = 5;
    return Promise.all([API.categories('live'), API.liveStreams()]).then(function (r) {
      all = Cats.filterItems('live', r[1]); byCat = {};
      all.forEach(function (s) { (byCat[s.category_id] = byCat[s.category_id] || []).push(s); });
      cats = Cats.apply('live', r[0]).filter(function (c) { return byCat[c.category_id]; }).map(function (c) { return { id: c.category_id, name: c.category_name }; });
      if (Fav.list('live').length) cats.unshift({ id: '__fav', name: 'Favoris' });
      var saved = AS.get('guideCat', null) || AS.get('lastLiveCat', null);
      catId = cats.some(function (c) { return String(c.id) === String(saved); }) ? saved : (cats[0] && cats[0].id);
      build();
    }).catch(function (e) {
      page.innerHTML = '<div class="empty">Impossible de charger le guide : ' + U.esc(e.message) + '</div>';
    });
  };

  function build() {
    var now = new Date();
    var d = new Date(now); d.setSeconds(0, 0); d.setMinutes(now.getMinutes() < 30 ? 0 : 30);
    winStart = d.getTime() - 30 * 60000;
    var width = HOURS * 60 * PX;
    var times = '';
    for (var t = 0; t < HOURS * 2; t++) times += '<span style="width:' + (30 * PX) + 'px">' + U.hm(winStart + t * 30 * 60000) + '</span>';
    root.innerHTML =
      '<div class="gd">' +
        '<div class="head"><div class="pv"><span class="badge-live">DIRECT</span><span class="pvl"></span></div>' +
          '<div class="pi"><div class="c"></div><h2>Guide TV</h2><div class="t">Sélectionne un programme</div><div class="d"></div></div>' +
          '<div class="clock">' + U.hm(now) + '</div></div>' +
        '<div class="chips nav-group" style="padding-left:var(--pad);padding-right:var(--pad);margin:0">' +
          (all.some(API.hasArchive) ? '<button class="f chip" data-replay="1">↺ Replay</button>' : '') +
          cats.map(function (c) { return '<button class="f chip" data-c="' + U.esc(c.id) + '">' + U.esc(c.name) + '</button>'; }).join('') + '</div>' +
        '<div class="body"><div class="scroller" data-pad-left="' + (window.matchMedia('(max-width:720px)').matches ? 130 : 200) + '" data-pad-top="34">' +
          '<div class="times"><div class="corner"></div>' + times + '</div>' +
          '<div class="rows" style="position:relative;width:' + (width + 200) + 'px"></div>' +
        '</div></div>' +
      '</div>';
    U.$$('.gd .chip[data-c]', root).forEach(function (b) { b.addEventListener('click', function () { selectCat(b.dataset.c, true); }); });
    var rp = U.$('.gd .chip[data-replay]', root); if (rp) rp.addEventListener('click', function () { App.go('replay'); });
    selectCat(catId, false);
    var sc = U.$('.scroller', root);
    sc.scrollLeft = 30 * PX - 10;
    Nav.onFocus = onFocus;
    clearInterval(clock);
    clock = setInterval(tick, 30000);
    var first = U.$('.pg.now', root) || U.$('.pg', root) || U.$('.chip.active', root);
    if (first && document.body.classList.contains('kbd')) Nav.focus(first);
  }

  function selectCat(id, focus) {
    catId = id;
    AS.set('guideCat', id);
    U.$$('.gd .chip[data-c]', root).forEach(function (b) { b.classList.toggle('active', String(b.dataset.c) === String(id)); });
    if (id === '__fav') {
      rows = Fav.list('live').map(function (f) { return all.find(function (s) { return String(s.stream_id) === String(f.id); }); }).filter(Boolean);
    } else rows = byCat[id] || [];
    API.clearEpgQueue();
    if (io) io.disconnect(); io = null;
    if (sio) sio.disconnect(); sio = null;
    var box = U.$('.rows', root);
    box.innerHTML = '<div class="nowline"></div>';
    rendered = 0;
    U.$('.scroller', root).scrollTop = 0;
    renderRows(40);
    tick();
    if (focus) {
      var f = U.$('.pg.now', root) || U.$('.pg', root);
      if (f) Nav.focus(f);
    }
  }

  function renderRows(n) {
    var box = U.$('.rows', root);
    var end = Math.min(rows.length, rendered + (n || 40));
    var html = '';
    for (var i = rendered; i < end; i++) {
      var s = rows[i];
      html += '<div class="row" data-id="' + s.stream_id + '">' +
        '<button class="f rch" data-id="' + s.stream_id + '"><span class="n">' + U.esc(s.num || '') + '</span><span class="lg">' + (s.stream_icon ? U.img(s.stream_icon) : '') + '</span><span class="nm">' + U.esc(U.cleanName(s.name)) + '</span></button>' +
        '<div class="progs" style="width:' + (HOURS * 60 * PX) + 'px"><button class="f pg none" data-id="' + s.stream_id + '" style="left:0;width:' + (HOURS * 60 * PX - 4) + 'px"><div class="pt">Chargement…</div></button></div>' +
        '</div>';
    }
    var old = U.$('.sentinel', box); if (old) old.remove();
    box.insertAdjacentHTML('beforeend', html);
    var newRows = U.$$('.row', box).slice(rendered);
    rendered = end;
    newRows.forEach(function (r) {
      bindRow(r);
      if ('IntersectionObserver' in window) {
        if (!io) io = new IntersectionObserver(function (ents) {
          ents.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); loadRow(en.target); } });
        }, { root: U.$('.scroller', root), rootMargin: '150px 0px' });
        io.observe(r);
      } else loadRow(r);
    });
    if (rendered < rows.length) {
      var sen = U.html('<div class="sentinel" style="height:1px"></div>');
      box.appendChild(sen);
      if (!sio) sio = new IntersectionObserver(function (ents) { ents.forEach(function (en) { if (en.isIntersecting) renderRows(); }); }, { root: U.$('.scroller', root), rootMargin: '300px 0px' });
      sio.observe(sen);
    }
    if (!rows.length) box.insertAdjacentHTML('beforeend', '<div class="empty">Aucune chaîne dans cette catégorie.</div>');
  }

  function bindRow(r) {
    U.$$('.f', r).forEach(function (b) { b.addEventListener('click', function () { openProg(b); }); });
  }

  function loadRow(r) {
    var id = r.dataset.id;
    API.epgQueued(id, 14).then(function (list) {
      if (!r.isConnected) return;
      var wEnd = winStart + HOURS * 3600000, now = Date.now();
      var progs = list.filter(function (p) { return p.end > winStart && p.start < wEnd; });
      var box = U.$('.progs', r);
      var hadFocus = Nav.current && box.contains(Nav.current);
      var chan = all.find(function (x) { return String(x.stream_id) === String(id); }) || {};
      if (!progs.length) {
        box.innerHTML = '<button class="f pg none" data-id="' + id + '" style="left:0;width:' + (HOURS * 60 * PX - 4) + 'px"><div class="pt">Aucune information de programme</div></button>';
      } else {
        box.innerHTML = progs.map(function (p, i) {
          var st = Math.max(p.start, winStart), en = Math.min(p.end, wEnd);
          var left = (st - winStart) / 60000 * PX, w = Math.max(8, (en - st) / 60000 * PX - 4);
          var isNow = p.start <= now && p.end > now, isPast = p.end <= now;
          var canReplay = isPast && API.hasArchive(chan) && p.start >= now - (+chan.tv_archive_duration) * 86400000;
          return '<button class="f pg' + (isNow ? ' now' : '') + (isPast ? ' past' : '') + (canReplay ? ' replay' : '') + '" data-id="' + id + '" data-p="' + i + '" style="left:' + left + 'px;width:' + w + 'px">' +
            '<div class="pt">' + U.esc(p.title) + '</div><div class="ph">' + U.hm(p.start) + ' – ' + U.hm(p.end) + '</div></button>';
        }).join('');
        box._progs = progs;
      }
      bindRow(box);
      if (hadFocus) Nav.focus(U.$('.pg.now', box) || U.$('.pg', box), { noScroll: true });
    });
  }

  function progOf(b) {
    var box = b.closest('.progs');
    return box && box._progs && b.dataset.p != null ? box._progs[+b.dataset.p] : null;
  }

  function onFocus(b) {
    if (!root || !root.isConnected || !b.closest('.gd')) return;
    var id = b.dataset.id; if (!id) return;
    var s = all.find(function (x) { return String(x.stream_id) === String(id); });
    if (!s) return;
    var p = progOf(b);
    var head = U.$('.head', root);
    U.$('.c', head).textContent = (s.num ? s.num + ' · ' : '') + U.cleanName(s.name);
    U.$('.pvl', head).innerHTML = s.stream_icon ? U.img(s.stream_icon) : '';
    if (!p) {
      var rowProgs = U.$('.row[data-id="' + id + '"] .progs', root);
      p = rowProgs && rowProgs._progs ? API.nowNext(rowProgs._progs).now : null;
    }
    U.$('h2', head).textContent = p ? p.title : U.cleanName(s.name);
    var live = p && p.start <= Date.now() && p.end > Date.now();
    U.$('.t', head).textContent = p ? U.hm(p.start) + ' – ' + U.hm(p.end) + (live ? ' · En cours' : p.start > Date.now() ? ' · À venir' : ' · Terminé') : 'Appuie sur OK pour regarder';
    U.$('.d', head).textContent = p ? (p.desc || '') : '';
    U.$('.badge-live', head).style.display = live ? '' : 'none';
  }

  function openProg(b) {
    var p = progOf(b);
    if (p && b.classList.contains('replay')) {
      var ch = all.find(function (x) { return String(x.stream_id) === String(b.dataset.id); });
      // short EPG has no server-local start string: fetch the full EPG to get it
      API.fullEpg(ch.stream_id).then(function (full) {
        var m = full.filter(function (x) { return Math.abs(x.start - p.start) < 60000; })[0] || p;
        Views.playReplay(ch, m);
      }).catch(function () { Views.playReplay(ch, p); });
      return;
    }
    if (p && p.end <= Date.now()) { U.toast('Programme terminé (pas de replay sur cette chaîne). Lancement du direct…'); }
    if (p && p.start > Date.now()) {
      U.toast('« ' + p.title + ' » commence à ' + U.hm(p.start) + '. Lancement de la chaîne…');
    }
    App.go('live', { id: b.dataset.id, cat: catId === '__fav' ? '__fav' : catId });
  }

  function tick() {
    if (!root || !root.isConnected) { clearInterval(clock); return; }
    var nl = U.$('.nowline', root), c = U.$('.clock', root);
    var off = window.matchMedia('(max-width:720px)').matches ? 125 : 195;
    if (nl) nl.style.left = (off + (Date.now() - winStart) / 60000 * PX) + 'px';
    if (c) c.textContent = U.hm(new Date());
  }

  G.leave = function () {
    clearInterval(clock);
    if (io) io.disconnect(); io = null;
    if (sio) sio.disconnect(); sio = null;
    API.clearEpgQueue();
    if (Nav.onFocus === onFocus) Nav.onFocus = null;
    root = null;
  };

  window.Guide = G;
})();
