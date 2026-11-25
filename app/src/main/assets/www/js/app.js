/* IPTV+ — routeur et démarrage */
(function () {
  'use strict';

  var TOP = ['home', 'guide', 'replay', 'movies', 'series', 'favorites', 'search', 'settings', 'profiles', 'recordings'];
  var profileAsked = false;
  var page = document.getElementById('page');
  var stack = [];       // [{route, params, scroll, key}]
  var exitArmed = 0;

  var App = { route: null, prevRoute: null };

  function setActive(route) {
    U.$$('[data-route]').forEach(function (b) { b.classList.toggle('active', b.dataset.route === route); });
    document.getElementById('topbar').classList.toggle('hidden', route === 'login');
    document.getElementById('bottombar').classList.toggle('hidden', route === 'login');
  }

  function leave() {
    if (App.route === 'guide') Guide.leave();
  }

  function render(entry, focusTab) {
    leave();
    App.route = entry.route;
    setActive(entry.route === 'movie' ? 'movies' : entry.route === 'serie' ? 'series' : entry.route);
    page.scrollTop = 0;
    document.getElementById('topbar').classList.remove('solid');
    page.style.overflowY = entry.route === 'guide' ? 'hidden' : '';
    var view = Views[entry.route];
    var params = entry.params || {};
    if (entry.key || entry.scroll) params._restore = { key: entry.key, scroll: entry.scroll };
    var token = {};
    App._token = token;
    // Each page draws into its own container: a slow page that finishes loading after the user
    // has moved on writes into a detached element and can no longer overwrite the new page.
    page.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'view view-' + entry.route;
    page.appendChild(box);
    return Promise.resolve(view(box, params)).then(function () {
      if (App._token !== token) return;
      if (params._restore) {
        page.scrollTop = params._restore.scroll || 0;
        var el = params._restore.key && U.$('[data-key="' + params._restore.key + '"]', page);
        if (el) { Nav.focus(el); return; }
      }
      if (focusTab && Nav.current && Nav.current.isConnected && !page.contains(Nav.current)) return;
      if (entry.route === 'login' || entry.route === 'search') return;
      var first = U.$('#hero-play', page) || U.$('.detail [data-a]', page) || U.$('.chip.active', page) || U.$('.f', page);
      if (first && document.body.classList.contains('kbd')) Nav.focus(first, { noScroll: entry.route !== 'movie' && entry.route !== 'serie' });
      else if (first) { Nav.current = first; }
      page.scrollTop = 0;
    }).catch(function (e) {
      console.error(e);
      if (App._token !== token) return;
      box.innerHTML = '<div class="empty">Erreur : ' + U.esc(e.message || e) + '<br><br><button class="f btn" id="retry">Réessayer</button></div>';
      var r = U.$('#retry', box); r.onclick = function () { API.cache = {}; render(entry); };
      Nav.focus(r);
    });
  }

  function saveCurrent() {
    var top = stack[stack.length - 1];
    if (!top) return;
    top.scroll = page.scrollTop;
    top.key = Nav.current && page.contains(Nav.current) ? Nav.current.dataset.key : null;
  }

  App.go = function (route, params, opts) {
    opts = opts || {};
    exitArmed = 0;
    if (route === 'live') {
      if (Player.open) Player.close();
      App.prevRoute = App.route;
      saveCurrent();
      Live.start(params || {});
      return;
    }
    if (Live.open) Live.close();
    if (Player.open) Player.close();
    if (route !== 'login' && !API.account) route = 'login';
    var entry = { route: route, params: params || {} };
    var isTop = (TOP.indexOf(route) >= 0 && !(route === 'replay' && entry.params.id) && !(route === 'profiles' && entry.params.manage)) || (route === 'login' && !entry.params.add);
    if (isTop) {
      stack = [entry];
    } else if (opts.replace && stack.length) {
      stack[stack.length - 1] = entry;
    } else {
      saveCurrent();
      stack.push(entry);
    }
    App.prevRoute = App.route;
    return render(entry, opts.fromTab);
  };

  App.refresh = function () {
    saveCurrent();
    var top = stack[stack.length - 1];
    if (top) render(top);
  };

  App.afterOverlay = function (prevFocus) {
    App.syncWatchNext();
    // Player closed: re-render detail/home pages so progress bars and resume buttons are up to date
    if (App.route === 'movie' || App.route === 'serie' || App.route === 'home') {
      var top = stack[stack.length - 1];
      top.scroll = page.scrollTop;
      top.key = prevFocus && prevFocus.dataset ? prevFocus.dataset.key : null;
      render(top);
    } else if (prevFocus && prevFocus.isConnected) Nav.focus(prevFocus, { noScroll: true });
    else Nav.first(null, page);
  };

  // Back from the live overlay: show the page that was open before (with its focus)
  App.returnFromOverlay = function () {
    var top = stack[stack.length - 1];
    if (top) render(top); else App.go('home');
  };

  // Returns true when handled; false lets Android close the app.
  App.back = function () {
    try { return backInner(); } catch (e) {
      try { Native.log('back: ' + e.message); } catch (e2) { }
      App.recover();
      return true;
    }
  };
  // Bring the interface back to a usable state after an unexpected error (never leave a black screen)
  App.recover = function () {
    try { if (Modal.isOpen()) Modal.close(); } catch (e) { }
    try { if (Player.open) Player.close(); } catch (e) { }
    try { if (Live.open) Live.close(); } catch (e) { }
    var layer = document.getElementById('layer');
    layer.classList.remove('on'); layer.innerHTML = '';
    document.documentElement.classList.remove('playing');
    Nav.roots.length = 0; Nav.handler = null;
    try { Native.stop(); } catch (e) { }
    App.go(App.route && App.route !== 'login' ? App.route : 'home');
  };
  function backInner() {
    if (Modal._report) { var r = Modal._report; Modal._report = null; r(); return true; }
    if (Modal.isOpen()) { Modal.close(); return true; }
    if (Player.open) return Player.back();
    if (Live.open) return Live.back();
    if (document.activeElement && /INPUT/.test(document.activeElement.tagName)) { document.activeElement.blur(); return true; }
    if (stack.length > 1) {
      stack.pop();
      var prev = stack[stack.length - 1];
      App.prevRoute = App.route;
      render(prev);
      return true;
    }
    if (App.route !== 'home' && App.route !== 'login') { App.go('home'); return true; }
    var now = Date.now();
    if (now - exitArmed < 2500) return false;
    exitArmed = now;
    U.toast('Appuie encore sur Retour pour quitter');
    return true;
  }

  App.mediaKey = function (k) {
    if (Player.open) return Player.mediaKey(k);
    if (Live.open) return Live.mediaKey(k);
    if (k === 'guide') App.go('guide');
    else if (k === 'chup' || k === 'chdown') App.go('live');
  };

  App.onAppPause = function () {
    if (Player.open) { try { var s = JSON.parse(Native.state()); if (s.pos) Player._pausedAt = s.pos; } catch (e) { } }
  };
  // Reload the catalogue when it is more than 12 hours old (checked every 10 min and when the app comes back).
  // With the on-device copy the new lists are downloaded in the background; the pages pick them up
  // on their next display (the home page is redrawn right away when nothing is playing).
  App.checkCatalog = function () {
    if (!API.account || !API.isStale()) return;
    if (!API.diskCache && (Player.open || Live.open || Modal.isOpen())) return; // never interrupt playback
    API.reloadCatalog().then(function (changed) {
      if (changed && App.route === 'home' && !Player.open && !Live.open && !Modal.isOpen()) App.refresh();
    });
  };
  setInterval(App.checkCatalog, 10 * 60 * 1000);

  // ---------- Android TV home screen: "Continuer à regarder" ----------
  var wnTimer = null;
  App.syncWatchNext = function () {
    clearTimeout(wnTimer);
    wnTimer = setTimeout(function () {
      try {
        if (!Native.watchNextSupported || !Native.watchNextSupported() || !API.account) return;
        var items = Hist.resumeList().map(function (h) {
          var ep = h.type === 'episode';
          return {
            key: API.account.id + ':' + (ep ? 's' + h.seriesId : 'm' + h.id),
            type: ep ? 'episode' : 'movie',
            title: ep ? (h.seriesName || h.name || '') : (h.name || ''),
            subtitle: ep ? 'S' + h.season + ' É' + h.ep + (h.name && h.name !== h.seriesName ? ' · ' + h.name : '') : '',
            image: U.imgUrl ? U.imgUrl(h.img) : h.img,
            pos: Math.round(h.pos || 0), dur: Math.round(h.dur || 0), ts: h.watched || h.ts || Date.now(),
            link: ep ? 'iptvplus://play?type=episode&series=' + encodeURIComponent(h.seriesId) + '&id=' + encodeURIComponent(h.id) + '&acc=' + API.account.id
                     : 'iptvplus://play?type=movie&id=' + encodeURIComponent(h.id) + '&acc=' + API.account.id
          };
        });
        Native.watchNext(JSON.stringify(items));
      } catch (e) { }
    }, 1500);
  };

  // Links from the Android TV home screen / notifications
  App.deepLink = function (link) {
    if (!link || !API.account) return;
    var m = String(link).match(/^iptvplus:\/\/([^\/?#]+)\/?\??(.*)$/);
    if (!m) return;
    var q = {};
    (m[2] || '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || ''); });
    if (q.acc && q.acc !== API.account.id && Accounts.list().some(function (a) { return a.id === q.acc; })) {
      API.switchAccount(q.acc);
      if (window.Sync) Sync.now();
    }
    if (Modal.isOpen()) Modal.close();
    if (m[1] === 'recordings') return App.go('recordings');
    if (m[1] !== 'play') return;
    if (q.type === 'movie' && q.id) App.go('movie', { id: q.id, resume: true });
    else if (q.type === 'episode' && q.series) App.go('serie', { id: q.series, resume: true });
    else if (q.type === 'live' && q.id) App.go('live', { id: q.id });
  };

  // Recording folder chosen with the system picker
  App.recFolderPicked = function (ok, label) {
    if (ok) U.toast('Enregistrements : ' + label);
    if (window.Recordings && Recordings.onFolder) Recordings.onFolder(ok, label);
  };

  App.onAppResume = function () {
    App.checkCatalog();
    if (window.Sync) Sync.refresh(10000);
    if (Live.open) Live.onResume();
    if (Native.recCheck) Native.recCheck();
  };

  App.start = function () {
    if (!API.account) return App.go('login');
    profileAsked = false;
    App.updateAvatar();
    if (window.Views && Views.applySubStyle) Views.applySubStyle();
    if (window.Sync) setTimeout(function () { Sync.now().then(function () { App.updateAvatar(); }); }, 500);
    setTimeout(function () { if (window.Update) Update.check(false); }, 8000);
    setTimeout(function () {
      if (!API.account) return;
      API.loadGuide();
      App.checkCatalog();
      App.syncWatchNext();
      if (Native.requestNotifications) Native.requestNotifications();
    }, 4000);
    var link = '';
    try { link = Native.takeDeepLink ? Native.takeDeepLink() : ''; } catch (e) { }
    if (link && /^iptvplus:\/\/play/.test(link)) {
      if (Profiles.list().length > 1 && Settings.get('askProfile') !== false) App._pendingLink = link;
      else { setTimeout(function () { App.deepLink(link); }, 300); return App.go('home'); }
    }
    if (link && /^iptvplus:\/\/recordings/.test(link)) return App.go('recordings');
    if (Profiles.list().length > 1 && Settings.get('askProfile') !== false) { profileAsked = true; return App.go('profiles'); }
    return App.go(Settings.get('startLive') ? 'live' : 'home');
  };

  // After choosing a profile on "Qui regarde ?"
  App.afterProfileChange = function () {
    App.updateAvatar();
    U.toast('Profil : ' + Profiles.current().name);
    var pl = App._pendingLink; App._pendingLink = null;
    App.go(Settings.get('startLive') && profileAsked && !pl ? 'live' : 'home');
    profileAsked = false;
    if (pl) setTimeout(function () { App.deepLink(pl); }, 300);
    App.syncWatchNext();
  };

  App.updateProgress = function (state, pct, msg) { if (window.Update) Update.progress(state, pct, msg); };

  App.updateAvatar = function () {
    var b = document.querySelector('.prof-btn');
    if (!b) return;
    if (!API.account) { b.innerHTML = ''; return; }
    var p = Profiles.current();
    b.innerHTML = Views.avatar(p, 30);
    b.setAttribute('aria-label', 'Profil : ' + p.name + ' (changer)');
  };

  // Tabs (top bar on TV / tablet, bottom bar on phones)
  U.$$('[data-route]').forEach(function (b) {
    b.addEventListener('click', function () {
      var r = b.dataset.route;
      if (r === App.route && r !== 'live') { page.scrollTop = 0; return; }
      App.go(r, {}, { fromTab: true });
    });
  });

  page.addEventListener('scroll', function () {
    document.getElementById('topbar').classList.toggle('solid', page.scrollTop > 40);
  }, { passive: true });

  window.App = App;

  // ---------- errors & crash report ----------
  window.addEventListener('error', function (e) {
    try { Native.log((e.message || 'erreur') + ' @' + String(e.filename || '').replace(/.*\//, '') + ':' + e.lineno); } catch (x) { }
  });
  window.addEventListener('unhandledrejection', function (e) {
    try { Native.log('promesse: ' + (e.reason && e.reason.message || e.reason)); } catch (x) { }
  });

  App.showReport = function (title, text) {
    var host = document.getElementById('layer');
    var standalone = !host.classList.contains('on');
    if (standalone) host.classList.add('on');
    var bg = U.html('<div class="modal-bg"><div class="modal nav-group" style="max-width:640px"><h3>' + U.esc(title) + '</h3>' +
      '<pre style="white-space:pre-wrap;font-size:11px;line-height:1.4;background:#111;padding:10px;border-radius:8px;max-height:46vh;overflow:auto;color:var(--soft)">' + U.esc(text || '(vide)') + '</pre>' +
      '<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap"><button class="f btn primary" data-r="share">Envoyer / copier le rapport</button><button class="f btn" data-r="close">Fermer</button></div></div></div>');
    host.appendChild(bg);
    var prevH = Nav.handler; Nav.handler = null;
    Nav.pushRoot(bg);
    function close() { Nav.popRoot(bg); bg.remove(); if (standalone) host.classList.remove('on'); Nav.handler = prevH; Nav.first(null, document.getElementById('page')); }
    U.$('[data-r="share"]', bg).onclick = function () { Native.share(text); U.toast('Rapport prêt à être envoyé'); };
    U.$('[data-r="close"]', bg).onclick = close;
    Modal._report = close;
    Nav.focus(U.$('[data-r="close"]', bg));
  };

  // ---------- boot ----------
  var tv = false;
  try { tv = Native.isTv(); } catch (e) { }
  document.body.classList.toggle('tv', tv);
  if (tv) document.body.classList.add('kbd');

  setTimeout(function () {
    var crash = '';
    try { crash = Native.lastCrash(); } catch (e) { }
    if (crash) App.showReport('IPTV+ s\'est fermée de façon inattendue', crash);
  }, 1500);

  if (API.account) {
    // Validate the saved account in the background; show the app immediately.
    App.start();
    API.refreshInfo().then(function (r) {
      if (r && r.user_info && String(r.user_info.auth) !== '1') { U.toast('Session expirée, reconnecte-toi'); API.logout(); App.go('login'); }
    }).catch(function () { U.toast('Serveur injoignable pour le moment'); });
  } else {
    App.go('login');
  }
})();
