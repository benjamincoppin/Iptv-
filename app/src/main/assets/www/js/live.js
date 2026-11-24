/* IPTV+ — TV en direct, style "Direct d'abord" : plein écran + panneau de zapping */
(function () {
  'use strict';

  var L = { open: false };
  var el, cats = [], all = [], byCat = {}, list = [], catId = null, playing = null, triedAlt = false, retried = false;
  var infoTimer, numBuf = '', numTimer, io, sentinelIo, rendered = 0, okHeld = false, pendingOk = null, clockTimer;
  var CHUNK = 120;
  var ASPECT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9v6M17 9v6"/></svg>';
  function updateAspectBtn() {
    var b = el && el.querySelector('.aspbtn span');
    if (b) b.textContent = Aspect.get('live') === 'auto' ? 'Auto' : Aspect.labels[Aspect.get('live')].replace(/ \(.*/, '');
  }

  function chanObj(s) {
    return { id: s.stream_id, name: U.cleanName(s.name), icon: s.stream_icon, num: s.num, cat: s.category_id };
  }

  L.start = function (o) {
    o = o || {};
    if (L.open) { if (o.id) playById(o.id); return; }
    L.open = true;
    var layer = document.getElementById('layer');
    layer.innerHTML = '';
    el = U.html('<div class="lv"><div class="tapzone"></div><div class="loading"><div class="spinner"></div></div></div>');
    layer.appendChild(el);
    layer.classList.add('on');
    document.documentElement.classList.add('playing');
    Nav.pushRoot(layer);
    Nav.handler = onKey;
    NativeEvents.owner = L;
    Native.setLandscape(true);
    el.querySelector('.tapzone').addEventListener('click', function () { togglePanel(); });

    Promise.all([API.categories('live'), API.liveStreams()]).then(function (r) {
      if (!L.open) return;
      all = r[1]; byCat = {};
      all.forEach(function (s) { (byCat[s.category_id] = byCat[s.category_id] || []).push(s); });
      cats = [{ id: '__fav', name: 'Favoris' }, { id: '__recent', name: 'Récents' }, { id: '__all', name: 'Toutes les chaînes' }]
        .concat(r[0].filter(function (c) { return byCat[c.category_id]; }).map(function (c) { return { id: c.category_id, name: c.category_name }; }));
      var startId = o.id || U.store.get('lastLive', null);
      var start = startId && all.find(function (s) { return String(s.stream_id) === String(startId); });
      if (!start) start = all[0];
      if (!start) { buildUi(); msg('Aucune chaîne disponible sur ce compte.'); return; }
      catId = o.cat || U.store.get('lastLiveCat', null) || start.category_id;
      if (!cats.some(function (c) { return String(c.id) === String(catId); })) catId = start.category_id;
      buildUi();
      selectCat(catId, false);
      play(start);
      if (o.id) hidePanel(); else showPanel(true);
    }).catch(function (e) {
      buildUi();
      msg('Impossible de charger les chaînes : ' + e.message);
    });
  };

  function buildUi() {
    var ld = el.querySelector('.loading'); if (ld) ld.style.display = 'none';
    el.insertAdjacentHTML('beforeend',
      '<div class="panel">' +
        '<div class="cats nav-group" data-pad-top="40"><div class="ph">Catégories</div>' +
          cats.map(function (c) { return '<button class="f cat" data-c="' + U.esc(c.id) + '">' + U.esc(c.name) + '</button>'; }).join('') +
        '</div>' +
        '<div class="chans nav-group" data-pad-top="40"><div class="chead"><button class="ph catpick f"></button><button class="f aspbtn" aria-label="Format d\'image">' + ASPECT_ICON + '<span></span></button></div><div class="clist"></div></div>' +
      '</div>' +
      '<div class="infobar"><div class="l1"><span class="cn"></span><span class="tm"></span><span class="q"></span></div><div class="now"></div><div class="pb"><i style="width:0"></i></div><div class="nx"></div></div>' +
      '<div class="loading" style="display:none"><div class="spinner"></div></div>');
    U.$$('.cat', el).forEach(function (b) { b.addEventListener('click', function () { selectCat(b.dataset.c, true); }); });
    el.querySelector('.aspbtn').addEventListener('click', function () { Aspect.choose('live', updateAspectBtn); });
    updateAspectBtn();
    var cp = el.querySelector('.catpick');
    cp.addEventListener('click', function () {
      Modal.choose('Catégorie', cats.map(function (c) { return { label: c.name, value: c.id, selected: String(c.id) === String(catId) }; }), function (v) { selectCat(v, true); });
    });
    clearInterval(clockTimer);
    clockTimer = setInterval(updateInfo, 30000);
  }

  function listFor(id) {
    if (id === '__fav') {
      var favIds = Fav.list('live').map(function (f) { return String(f.id); });
      return favIds.map(function (fid) { return all.find(function (s) { return String(s.stream_id) === fid; }); }).filter(Boolean);
    }
    if (id === '__recent') {
      return Hist.recentLive().map(function (r) { return all.find(function (s) { return String(s.stream_id) === String(r.id); }); }).filter(Boolean);
    }
    if (id === '__all') return all;
    return byCat[id] || [];
  }

  function selectCat(id, focus) {
    catId = id;
    U.store.set('lastLiveCat', id);
    list = listFor(id);
    U.$$('.cat', el).forEach(function (b) { b.classList.toggle('active', String(b.dataset.c) === String(id)); });
    var c = cats.find(function (x) { return String(x.id) === String(id); });
    el.querySelector('.catpick').innerHTML = U.esc(c ? c.name : '') + ' · ' + list.length + ' chaîne' + (list.length > 1 ? 's' : '') + ' <span class="catarrow">▾</span>';
    API.clearEpgQueue();
    var box = el.querySelector('.clist');
    box.innerHTML = '';
    rendered = 0;
    el.querySelector('.chans').scrollTop = 0;
    if (!list.length) {
      box.innerHTML = '<div class="muted" style="padding:10px;font-size:13px;line-height:1.5">' +
        (id === '__fav' ? 'Aucune chaîne favorite. Maintiens OK (ou appui long) sur une chaîne pour l\'ajouter.' : 'Aucune chaîne.') + '</div>';
      if (focus) Nav.focus(el.querySelector('.cat.active'));
      return;
    }
    var idx = playing ? list.findIndex(function (s) { return s.stream_id === playing.stream_id; }) : -1;
    renderMore(Math.max(CHUNK, idx + 30));
    if (focus) {
      var target = (idx >= 0 && box.querySelector('[data-id="' + playing.stream_id + '"]')) || box.querySelector('.ch');
      Nav.focus(target);
    }
  }

  function renderMore(n) {
    var box = el.querySelector('.clist');
    var end = Math.min(list.length, rendered + (n || CHUNK));
    var html = '';
    for (var i = rendered; i < end; i++) {
      var s = list[i];
      html += '<button class="f ch' + (playing && s.stream_id === playing.stream_id ? ' playing' : '') + '" data-id="' + s.stream_id + '" data-i="' + i + '">' +
        '<span class="n">' + U.esc(s.num || i + 1) + '</span>' +
        '<span class="lg">' + (s.stream_icon ? U.img(s.stream_icon) : U.esc(U.initials(U.cleanName(s.name)).slice(0, 6))) + '</span>' +
        '<span class="tx"><span class="nm" style="display:block">' + U.esc(U.cleanName(s.name)) + '</span><span class="eg" style="display:block"></span></span>' +
        (Fav.has('live', s.stream_id) ? '<span style="color:var(--accent);font-size:12px">★</span>' : '') +
        '<span class="dot"></span></button>';
    }
    var old = box.querySelector('.sentinel'); if (old) old.remove();
    box.insertAdjacentHTML('beforeend', html);
    U.$$('.ch', box).slice(rendered).forEach(function (b) {
      b.addEventListener('click', function () { onChannelClick(b); });
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); channelMenu(list[+b.dataset.i]); });
      observeEpg(b);
    });
    rendered = end;
    if (rendered < list.length) {
      var sen = U.html('<div class="sentinel" style="height:1px"></div>');
      box.appendChild(sen);
      if ('IntersectionObserver' in window) {
        if (!sentinelIo) sentinelIo = new IntersectionObserver(function (ents) { ents.forEach(function (en) { if (en.isIntersecting) renderMore(); }); }, { root: el.querySelector('.chans'), rootMargin: '400px' });
        sentinelIo.observe(sen);
      } else renderMore(list.length);
    }
  }

  function observeEpg(b) {
    if (!('IntersectionObserver' in window)) return;
    if (!io) io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        var btn = en.target; io.unobserve(btn);
        var id = btn.dataset.id;
        API.epgQueued(id, 2).then(function (ep) {
          var nn = API.nowNext(ep), sp = btn.querySelector('.eg');
          if (sp && nn.now) sp.textContent = nn.now.title;
        });
      });
    }, { root: el.querySelector('.chans'), rootMargin: '100px' });
    io.observe(b);
  }

  function onChannelClick(b) {
    var s = list[+b.dataset.i];
    if (!s) return;
    if (playing && s.stream_id === playing.stream_id) { hidePanel(); return; }
    play(s);
  }

  function play(s) {
    playing = s; triedAlt = false; retried = false;
    U.$$('.ch.playing', el).forEach(function (b) { b.classList.remove('playing'); });
    var b = el.querySelector('.ch[data-id="' + s.stream_id + '"]'); if (b) b.classList.add('playing');
    var m = el.querySelector('.lvmsg'); if (m) m.remove();
    el.querySelector('.panel ~ .loading').style.display = '';
    Hist.pushLive(chanObj(s));
    startStream(API.liveFormat());
    updateInfo();
    flashInfo();
  }
  function startStream(fmt) {
    playing._fmt = fmt;
    if (Settings.get('player') === 'external') {
      if (Native.openExternal(API.liveUrl(playing.stream_id, fmt), playing.name)) return;
    }
    Aspect.apply('live');
    Native.play(API.liveUrl(playing.stream_id, fmt), 0);
  }
  function playById(id) {
    var s = all.find(function (x) { return String(x.stream_id) === String(id); });
    if (s) { play(s); hidePanel(); }
  }

  function zap(d) {
    if (!list.length || !playing) return;
    var i = list.findIndex(function (s) { return s.stream_id === playing.stream_id; });
    i = i < 0 ? 0 : (i + d + list.length) % list.length;
    play(list[i]);
  }

  L.onEvent = function (type, data) {
    var ld = el && el.querySelector('.panel ~ .loading');
    if (type === 'prepared' || type === 'rendering' || type === 'buffered') {
      if (ld) ld.style.display = 'none';
      if (playing && Settings.get('liveFormat') === 'auto') API.workingLiveFormat = playing._fmt;
      updateInfo();
    } else if (type === 'buffering') {
      if (ld) ld.style.display = '';
    } else if (type === 'completed') {
      // live streams should not end: reconnect
      if (playing) startStream(playing._fmt);
    } else if (type === 'error') {
      if (!playing) return;
      if (!triedAlt && Settings.get('liveFormat') === 'auto') {
        triedAlt = true;
        startStream(playing._fmt === 'm3u8' ? 'ts' : 'm3u8');
        return;
      }
      if (!retried) { retried = true; setTimeout(function () { if (L.open && playing) startStream(playing._fmt); }, 1500); return; }
      if (ld) ld.style.display = 'none';
      msg('Cette chaîne ne répond pas pour le moment (code ' + data.what + '). Essaie une autre chaîne ou change le format du direct dans les Paramètres.');
    }
  };

  function msg(t) {
    var m = el.querySelector('.lvmsg'); if (m) m.remove();
    el.insertAdjacentHTML('beforeend', '<div class="lvmsg">' + U.esc(t) + '</div>');
  }

  function updateInfo() {
    if (!el || !playing) return;
    var ib = el.querySelector('.infobar'); if (!ib) return;
    var s = playing;
    ib.querySelector('.cn').textContent = (s.num ? s.num + ' · ' : '') + U.cleanName(s.name);
    ib.querySelector('.q').textContent = (s._fmt || '').toUpperCase() + (Fav.has('live', s.stream_id) ? '  ★' : '');
    API.epg(s.stream_id, 4).then(function (ep) {
      if (!el || playing !== s) return;
      var nn = API.nowNext(ep);
      ib.querySelector('.tm').textContent = nn.now ? U.hm(nn.now.start) + ' – ' + U.hm(nn.now.end) : U.hm(new Date());
      ib.querySelector('.now').textContent = nn.now ? nn.now.title : 'Programme non disponible';
      var pct = nn.now ? Math.min(100, (Date.now() - nn.now.start) / (nn.now.end - nn.now.start) * 100) : 0;
      ib.querySelector('.pb i').style.width = pct + '%';
      ib.querySelector('.nx').textContent = nn.next ? 'Ensuite : ' + U.hm(nn.next.start) + ' ' + nn.next.title : '';
    });
  }

  function panelOpen() { return el && !el.classList.contains('nopanel'); }
  function showPanel(focusPlaying) {
    el.classList.remove('nopanel'); el.classList.remove('noinfo');
    clearTimeout(infoTimer);
    var b = playing && el.querySelector('.ch[data-id="' + playing.stream_id + '"]');
    if (!b && playing && list.indexOf(playing) >= 0) { renderMore(list.indexOf(playing) - rendered + 20); b = el.querySelector('.ch[data-id="' + playing.stream_id + '"]'); }
    Nav.focus(b || el.querySelector('.ch') || el.querySelector('.cat.active') || el.querySelector('.cat'));
  }
  function hidePanel() {
    el.classList.add('nopanel');
    flashInfo();
    if (document.activeElement) document.activeElement.blur();
  }
  function togglePanel() { if (panelOpen()) hidePanel(); else showPanel(true); }
  function flashInfo() {
    if (!el) return;
    el.classList.remove('noinfo');
    clearTimeout(infoTimer);
    infoTimer = setTimeout(function () { if (el && !panelOpen()) el.classList.add('noinfo'); }, 5000);
  }

  function channelMenu(s) {
    if (!s) return;
    var fav = Fav.has('live', s.stream_id);
    Modal.choose(U.cleanName(s.name), [
      { label: fav ? 'Retirer des favoris' : 'Ajouter aux favoris', value: 'fav' },
      { label: 'Regarder', value: 'play' },
      { label: 'Format d\'image : ' + Aspect.labels[Aspect.get('live')], value: 'aspect' },
      { label: 'Ouvrir dans un lecteur externe', value: 'ext' }
    ], function (v) {
      if (v === 'fav') {
        var added = Fav.toggle('live', chanObj(s));
        U.toast(added ? 'Ajoutée aux favoris' : 'Retirée des favoris');
        var b = el.querySelector('.ch[data-id="' + s.stream_id + '"]');
        if (catId === '__fav') selectCat('__fav', false);
        else if (b) { var star = b.querySelector('span[style*="accent"]'); if (added && !star) b.querySelector('.dot').insertAdjacentHTML('beforebegin', '<span style="color:var(--accent);font-size:12px">★</span>'); if (!added && star) star.remove(); }
        updateInfo();
      } else if (v === 'play') play(s);
      else if (v === 'aspect') setTimeout(function () { Aspect.choose('live', updateAspectBtn); }, 0);
      else if (v === 'ext') { if (!Native.openExternal(API.liveUrl(s.stream_id), s.name)) U.toast('Aucun lecteur externe installé'); }
    });
  }

  function onKey(e, act) {
    if (Modal.isOpen()) return false;
    if (act === 'digit') {
      numBuf += String(e.keyCode - 48);
      var ne = el.querySelector('.numentry');
      if (!ne) { el.insertAdjacentHTML('beforeend', '<div class="numentry"></div>'); ne = el.querySelector('.numentry'); }
      ne.textContent = numBuf;
      clearTimeout(numTimer);
      numTimer = setTimeout(function () {
        var n = numBuf; numBuf = ''; var x = el.querySelector('.numentry'); if (x) x.remove();
        var s = all.find(function (c) { return String(c.num) === n; });
        if (s) { play(s); } else U.toast('Chaîne ' + n + ' introuvable');
      }, 1400);
      return true;
    }
    if (!panelOpen()) {
      if (act === 'up') { zap(-1); return true; }
      if (act === 'down') { zap(1); return true; }
      if (act === 'ok' || act === 'left') { showPanel(true); return true; }
      if (act === 'right') { if (el.classList.contains('noinfo')) flashInfo(); else el.classList.add('noinfo'); return true; }
      return true;
    }
    var cur = Nav.current;
    if (act === 'ok' && cur && cur.classList.contains('ch')) {
      // Short press = play (on key release), long press = channel menu
      if (e.repeat) {
        if (!okHeld && pendingOk) { okHeld = true; pendingOk = null; channelMenu(list[+cur.dataset.i]); }
        return true;
      }
      pendingOk = cur;
      return true;
    }
    if (act === 'right' && cur && cur.classList.contains('ch')) { hidePanel(); return true; }
    if (act === 'right' && cur && cur.classList.contains('cat')) {
      var b = playing && el.querySelector('.ch.playing');
      Nav.focus(b || el.querySelector('.ch') || cur);
      return true;
    }
    return false;
  }
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== 13 && e.keyCode !== 23) return;
    var p = pendingOk;
    pendingOk = null; okHeld = false;
    if (p && L.open && p.isConnected && !Modal.isOpen()) onChannelClick(p);
  });

  L.mediaKey = function (k) {
    if (k === 'chup' || k === 'next') zap(-1);
    else if (k === 'chdown' || k === 'prev') zap(1);
    else if (k === 'info') flashInfo();
    else if (k === 'guide') { L.close(); App.go('guide'); }
    else if (k === 'menu' || k === 'yellow') { if (playing) channelMenu(playing); }
    else if (k === 'blue') Aspect.choose('live', updateAspectBtn);
    else if (k === 'stop') L.close();
  };

  L.back = function () {
    if (Modal.isOpen()) { Modal.close(); return true; }
    if (!panelOpen() && playing) { showPanel(true); return true; }
    L.close();
    App.returnFromOverlay();
    return true;
  };

  L.close = function () {
    if (!L.open) return;
    L.open = false;
    Native.stop();
    Native.setLandscape(false);
    API.clearEpgQueue();
    clearTimeout(infoTimer); clearInterval(clockTimer);
    if (io) { io.disconnect(); io = null; }
    if (sentinelIo) { sentinelIo.disconnect(); sentinelIo = null; }
    NativeEvents.owner = null;
    var layer = document.getElementById('layer');
    Nav.popRoot(layer);
    Nav.handler = null;
    layer.classList.remove('on'); layer.innerHTML = '';
    document.documentElement.classList.remove('playing');
    el = null; playing = null;
  };

  window.Live = L;
})();
