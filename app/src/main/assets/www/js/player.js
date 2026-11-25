/* IPTV+ — native video player bridge + VOD player screen (films / épisodes) */
(function () {
  'use strict';

  var I = {
    play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M7 4h3v16H7zM14 4h3v16h-3z"/></svg>',
    rew: '<svg viewBox="0 0 24 24"><path d="M11 6 4 12l7 6zM20 6l-7 6 7 6z"/></svg>',
    ff: '<svg viewBox="0 0 24 24"><path d="m13 6 7 6-7 6zM4 6l7 6-7 6z"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M5 5l10 7-10 7zM18 5v14"/></svg>'
  };
  window.ICONS = I;

  // Native -> JS events are routed to whichever screen owns the player.
  window.NativeEvents = {
    owner: null,
    player: function (type, data) { if (this.owner && this.owner.onEvent) this.owner.onEvent(type, data || {}); }
  };

  // Picture format shared by live TV and the VOD player
  var Aspect = {
    modes: ['auto', '16:9', '4:3', 'fill', 'zoom'],
    labels: { auto: 'Original (auto)', '16:9': '16:9', '4:3': '4:3', fill: 'Étirer (plein écran)', zoom: 'Zoom (remplir l\'écran)' },
    key: function (kind) { return kind === 'live' ? 'aspectLive' : 'aspectVod'; },
    get: function (kind) { var m = Settings.get(this.key(kind)); return this.labels[m] ? m : 'auto'; },
    apply: function (kind) { if (Native.setAspect) Native.setAspect(this.get(kind)); },
    choose: function (kind, cb) {
      var self = this, cur = self.get(kind);
      Modal.choose('Format d\'image' + (kind === 'live' ? ' (TV en direct)' : ' (films et séries)'), self.modes.map(function (m) {
        return { label: self.labels[m], value: m, selected: m === cur };
      }), function (v) {
        Settings.set(self.key(kind), v);
        self.apply(kind);
        U.toast('Image : ' + self.labels[v]);
        if (cb) cb(v);
      });
    }
  };
  window.Aspect = Aspect;

  var P = { open: false };
  var skipState = {};
  var el, opts, poll, idleTimer, saveTimer, seekTarget = null, seekTimer, state = { pos: 0, dur: 0, playing: false, buffering: true }, ended = false, nextTimer;

  function readState() {
    try { var s = JSON.parse(Native.state()); state = s; } catch (e) { }
    return state;
  }

  P.start = function (o) {
    // o: {kind, id, url, title, sub, startMs, hist, ext, next:function()->o|null, onClose}
    opts = o; ended = false; seekTarget = null; skipState = { intro: false, credits: false, subsDone: false };
    var oldSkip = document.querySelector('#layer .skipbtn'); if (oldSkip) oldSkip.remove();
    if (Settings.get('player') === 'external') {
      if (Native.openExternal(o.url, o.title)) { saveHist(o.startMs || 0, 0); return; }
      U.toast('Aucun lecteur externe trouvé, lecture dans IPTV+');
    }
    if (!P.open) build();
    P.open = true;
    NativeEvents.owner = P;
    render();
    Native.setLandscape(true);
    Aspect.apply('vod');
    Native.play(o.url, o.startMs || 0);
    clearInterval(poll); poll = setInterval(tick, 500);
    clearInterval(saveTimer); saveTimer = setInterval(function () { if (state.pos > 0) saveHist(state.pos, state.dur); }, 10000);
    showControls();
  };

  function build() {
    P._prevFocus = Nav.current;
    var layer = document.getElementById('layer');
    layer.innerHTML = '';
    el = U.html('<div class="pl"></div>');
    layer.appendChild(el);
    layer.classList.add('on');
    document.documentElement.classList.add('playing');
    Nav.pushRoot(layer);
    Nav.handler = onKey;
    el.addEventListener('click', function (e) {
      if (e.target === el || e.target.classList.contains('center') || e.target.classList.contains('top') || e.target.classList.contains('bottom')) {
        if (el.classList.contains('idle')) showControls(); else hideControls();
      }
    });
  }

  function render() {
    var o = opts;
    el.innerHTML =
      '<div class="top"><button class="f cb" data-a="close" aria-label="Retour">' + I.back + '</button>' +
      '<div><h2>' + U.esc(o.title) + '</h2>' + (o.sub ? '<div class="sub">' + U.esc(o.sub) + '</div>' : '') + '</div></div>' +
      '<div class="center"><div class="spinner"></div></div>' +
      '<div class="bottom nav-group">' +
        '<div class="prog"><span class="cur">0:00</span><div class="track f" data-a="track"><i></i><b></b></div><span class="tot">--:--</span></div>' +
        '<div class="ctrls">' +
          '<button class="f cb" data-a="rew" aria-label="Reculer de 10 secondes">' + I.rew + '</button>' +
          '<button class="f cb big" data-a="toggle" aria-label="Lecture / pause">' + I.pause + '</button>' +
          '<button class="f cb" data-a="ff" aria-label="Avancer de 30 secondes">' + I.ff + '</button>' +
          '<button class="f cb txt" data-a="audio">Audio</button>' +
          '<button class="f cb txt" data-a="subs">Sous-titres</button>' +
          '<button class="f cb txt" data-a="aspect">Image</button>' +
          (o.next ? '<button class="f cb txt" data-a="next">' + I.next + ' Suivant</button>' : '') +
          '<button class="f cb txt" data-a="ext">Lecteur externe</button>' +
        '</div></div>';
    U.$$('[data-a]', el).forEach(function (b) { b.addEventListener('click', function (e) { action(b.dataset.a, e); }); });
    Nav.focus(U.$('[data-a="toggle"]', el), { noScroll: true });
  }

  function action(a, e) {
    showControls();
    if (a === 'close') P.close();
    else if (a === 'toggle') togglePause();
    else if (a === 'rew') seekBy(-10000);
    else if (a === 'ff') seekBy(30000);
    else if (a === 'next') playNext();
    else if (a === 'ext') { Native.pause(); if (!Native.openExternal(opts.url, opts.title)) U.toast('Aucun lecteur externe installé (ex. VLC)'); }
    else if (a === 'audio') audioMenu();
    else if (a === 'aspect') Aspect.choose('vod');
    else if (a === 'subs') subsMenu();
    else if (a === 'track' && e && e.clientX) {
      var r = e.currentTarget.getBoundingClientRect();
      if (state.dur > 0) { seekTarget = Math.round((e.clientX - r.left) / r.width * state.dur); commitSeek(); }
    }
  }

  function togglePause() {
    readState();
    if (state.playing) { Native.pause(); state.playing = false; }
    else { Native.resume(); state.playing = true; }
    updateUi();
  }

  function seekBy(ms) {
    readState();
    if (!state.dur) return;
    var base = seekTarget != null ? seekTarget : state.pos;
    seekTarget = Math.max(0, Math.min(state.dur - 2000, base + ms));
    updateUi();
    clearTimeout(seekTimer);
    seekTimer = setTimeout(commitSeek, 700);
  }
  function commitSeek() {
    clearTimeout(seekTimer);
    if (seekTarget == null) return;
    Native.seekTo(seekTarget);
    state.pos = seekTarget;
    setTimeout(function () { seekTarget = null; }, 800);
  }

  function tick() {
    readState();
    updateUi();
    skipButtons();
    autoSubs();
  }

  // ---------- "Passer l'intro" / "Épisode suivant" pendant le générique ----------
  function skipBtn() { return document.querySelector('#layer .skipbtn'); }
  function showSkip(kind, label, onClick) {
    var b = skipBtn();
    if (b && b.dataset.kind === kind) return;
    if (b) b.remove();
    b = U.html('<button class="f skipbtn" data-kind="' + kind + '">' + (kind === 'next' ? I.next : I.ff) + ' ' + U.esc(label) + '</button>');
    b.addEventListener('click', function () { b.remove(); onClick(); });
    document.getElementById('layer').appendChild(b);
    Nav.focus(b, { noScroll: true });
  }
  function hideSkip(kind) {
    var b = skipBtn();
    if (b && (!kind || b.dataset.kind === kind)) {
      var had = Nav.current === b;
      b.remove();
      if (had && el) Nav.focus(U.$('[data-a="toggle"]', el), { noScroll: true });
    }
  }
  function skipButtons() {
    if (!opts || opts.kind !== 'episode' || !state.prepared || !state.dur || U.$('.pl-msg', el) || U.$('.next-up', el) || Modal.isOpen()) { hideSkip(); return; }
    var pos = state.pos, dur = state.dur, intro = +Settings.get('introSkip') || 0;
    // Intro: first minutes of the episode
    if (intro && !skipState.intro && pos > 3000 && pos < Math.min(300000, dur * 0.3)) {
      showSkip('intro', 'Passer l\'intro', function () { skipState.intro = true; seekTarget = null; Native.seekTo(Math.min(dur - 5000, pos + intro * 1000)); state.pos += intro * 1000; showControls(); });
      return;
    }
    hideSkip('intro');
    // End credits: last 2 minutes (or last 4 %) when there is a next episode
    var creditsAt = dur - Math.max(60000, Math.min(150000, dur * 0.04));
    if (opts.next && !skipState.credits && pos >= creditsAt && pos < dur - 3000) {
      showSkip('next', 'Épisode suivant', function () { skipState.credits = true; playNext(); });
      return;
    }
    hideSkip('next');
  }

  // ---------- sous-titres ----------
  function isFrench(name) { return /(\bfr\b|fre\b|fra\b|fran[cç]ais|french|\bvf\b|vff|vfq)/i.test(String(name || '')); }
  function autoSubs() {
    if (skipState.subsDone || !state.prepared || !Settings.get('subAuto') || opts.kind === 'replay') return;
    var subs = [], audio = [];
    try { subs = JSON.parse(Native.subTracks ? Native.subTracks() : '[]'); audio = JSON.parse(Native.audioTracks()); } catch (e) { }
    if (!audio.length && state.pos < 4000) return; // tracks not known yet
    skipState.subsDone = true;
    var curAudio = audio.filter(function (t) { return t.selected; })[0] || audio[0];
    if (!curAudio || isFrench(curAudio.lang)) return;           // already French audio
    if (subs.some(function (t) { return t.selected && t.index >= 0; })) return; // subtitles already on
    var fr = subs.filter(function (t) { return t.index >= 0 && isFrench(t.lang) && !/forc/i.test(t.lang); })[0] || subs.filter(function (t) { return t.index >= 0 && isFrench(t.lang); })[0];
    if (fr) { Native.selectSub(fr.index); U.toast('Sous-titres français activés'); }
  }
  function subsMenu() {
    var subs = [];
    try { subs = JSON.parse(Native.subTracks ? Native.subTracks() : '[]'); } catch (e) { }
    if (subs.filter(function (t) { return t.index >= 0; }).length === 0) { U.toast('Aucun sous-titre dans cette vidéo'); return; }
    Modal.choose('Sous-titres', subs.map(function (t, i) {
      return { label: t.index < 0 ? 'Désactivés' : (t.lang || 'Piste ' + i), value: t.index, selected: t.selected };
    }), function (v) { Native.selectSub(v); skipState.subsDone = true; U.toast(v < 0 ? 'Sous-titres désactivés' : 'Sous-titres activés'); });
  }

  function updateUi() {
    if (!el) return;
    var pos = seekTarget != null ? seekTarget : state.pos, dur = state.dur;
    var cur = U.$('.cur', el), tot = U.$('.tot', el), bar = U.$('.track i', el), knob = U.$('.track b', el);
    if (cur) cur.textContent = U.dur(pos);
    if (tot) tot.textContent = dur ? U.dur(dur) : '--:--';
    var pct = dur ? Math.min(100, pos / dur * 100) : 0;
    if (bar) bar.style.width = pct + '%';
    if (knob) knob.style.left = pct + '%';
    var tg = U.$('[data-a="toggle"]', el);
    if (tg) { var want = state.playing ? 'pause' : 'play'; if (tg.dataset.icon !== want) { tg.innerHTML = I[want]; tg.dataset.icon = want; } }
    var sp = U.$('.center', el);
    if (sp) sp.style.display = (state.buffering || !state.prepared) && !ended ? '' : 'none';
  }

  function showControls() {
    if (!el) return;
    el.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { if (state.playing) hideControls(); }, 4500);
  }
  function hideControls() { if (el && !U.$('.pl-msg', el) && !U.$('.next-up', el)) el.classList.add('idle'); }

  function onKey(e, act) {
    if (U.$('.modal-bg', document.getElementById('layer'))) return false; // let modal navigate
    if (Nav.current && Nav.current.classList.contains('skipbtn')) {
      if (act === 'ok') return false;
      if (act === 'up' || act === 'left') { showControls(); Nav.focus(U.$('[data-a="toggle"]', el), { noScroll: true }); return true; }
      return true;
    }
    var idle = el.classList.contains('idle');
    var onTrack = Nav.current && Nav.current.dataset.a === 'track';
    if (act === 'left' || act === 'right') {
      if (idle || onTrack) { seekBy(act === 'left' ? -10000 : 10000); showControls(); return true; }
    }
    if (idle && (act === 'up' || act === 'down' || act === 'ok')) {
      showControls();
      if (act === 'ok') togglePause();
      return true;
    }
    if (act === 'ok' && onTrack) { togglePause(); showControls(); return true; }
    showControls();
    return false;
  }

  P.mediaKey = function (k) {
    showControls();
    if (k === 'playpause') togglePause();
    else if (k === 'play') { Native.resume(); }
    else if (k === 'pause') { Native.pause(); }
    else if (k === 'ff' || k === 'next' && !opts.next) seekBy(30000);
    else if (k === 'rew' || k === 'prev') seekBy(-10000);
    else if (k === 'next' && opts.next) playNext();
    else if (k === 'stop') P.close();
  };

  P.onEvent = function (type, data) {
    if (type === 'prepared') {
      state.prepared = true; state.buffering = false; if (data.duration) state.dur = data.duration; updateUi();
      if (data.audioProblem) audioWarning(data.audioProblem);
    }
    else if (type === 'buffering') { state.buffering = true; updateUi(); }
    else if (type === 'buffered' || type === 'rendering') { state.buffering = false; updateUi(); }
    else if (type === 'completed') onCompleted();
    else if (type === 'error') showError(data);
  };

  function saveHist(pos, dur) {
    if (!opts || !opts.hist) return;
    var h = {};
    for (var k in opts.hist) h[k] = opts.hist[k];
    h.pos = pos; h.dur = dur || h.dur || 0;
    Hist.save(h);
  }

  function onCompleted() {
    ended = true;
    if (opts.hist) saveHist(state.dur, state.dur);
    var nx = opts.next && opts.next();
    if (nx && Settings.get('autoNext')) {
      var left = 8;
      var box = U.html('<div class="next-up nav-group"><div><div class="muted" style="font-size:12px">Épisode suivant dans <b class="cd">' + left + '</b> s</div><div style="font-weight:600;margin-top:3px">' + U.esc(nx.title) + '</div></div>' +
        '<button class="f btn primary" data-n="go">' + I.play + ' Lire</button><button class="f btn" data-n="no">Annuler</button></div>');
      el.appendChild(box); el.classList.remove('idle');
      box.querySelector('[data-n="go"]').onclick = function () { clearInterval(nextTimer); P.start(nx); };
      box.querySelector('[data-n="no"]').onclick = function () { clearInterval(nextTimer); P.close(); };
      Nav.focus(box.querySelector('[data-n="go"]'));
      clearInterval(nextTimer);
      nextTimer = setInterval(function () {
        left--; var c = box.querySelector('.cd'); if (c) c.textContent = left;
        if (left <= 0) { clearInterval(nextTimer); P.start(nx); }
      }, 1000);
    } else {
      P.close();
    }
  }

  function playNext() {
    var nx = opts.next && opts.next();
    if (!nx) { U.toast('Pas d\'épisode suivant'); return; }
    saveHist(state.pos, state.dur);
    P.start(nx);
  }

  function showError(data) {
    if (!el) return;
    var old = U.$('.pl-msg', el); if (old) old.remove();
    var box = U.html('<div class="pl-msg nav-group"><h3>Lecture impossible</h3><p>Le flux n\'a pas pu être lu par le lecteur intégré (code ' + U.esc(data.what) + '/' + U.esc(data.extra) + '). Le format est peut-être non pris en charge par cet appareil.</p>' +
      '<div class="actions"><button class="f btn primary" data-m="retry">Réessayer</button><button class="f btn" data-m="ext">Lecteur externe</button><button class="f btn" data-m="close">Fermer</button></div></div>');
    el.appendChild(box); el.classList.remove('idle');
    U.$('.center', el).style.display = 'none';
    box.querySelector('[data-m="retry"]').onclick = function () { box.remove(); Native.play(opts.url, state.pos || opts.startMs || 0); };
    box.querySelector('[data-m="ext"]').onclick = function () { if (!Native.openExternal(opts.url, opts.title)) U.toast('Aucun lecteur externe installé (ex. VLC)'); };
    box.querySelector('[data-m="close"]').onclick = function () { P.close(); };
    Nav.focus(box.querySelector('[data-m="retry"]'));
  }

  function audioWarning(codec) {
    if (!el) return;
    var old = U.$('.pl-msg', el); if (old) old.remove();
    var box = U.html('<div class="pl-msg nav-group"><h3>Son non pris en charge</h3><p>Le son de cette vidéo est en <b>' + U.esc(codec) + '</b>, un format que cet appareil ne sait pas décoder. L\'image est lue sans le son.<br>Pour avoir le son, ouvre-la dans VLC (gratuit sur le Play Store), qui décode ce format.</p>' +
      '<div class="actions"><button class="f btn primary" data-m="ext">Ouvrir dans VLC / autre lecteur</button><button class="f btn" data-m="go">Continuer sans le son</button></div></div>');
    el.appendChild(box); el.classList.remove('idle');
    box.querySelector('[data-m="ext"]').onclick = function () {
      readState();
      if (opts.hist && state.pos) saveHist(state.pos, state.dur);
      Native.pause();
      if (!Native.openExternal(opts.url, opts.title)) U.toast('Aucun lecteur externe installé : installe VLC depuis le Play Store');
      box.remove();
    };
    box.querySelector('[data-m="go"]').onclick = function () { box.remove(); showControls(); Nav.focus(U.$('[data-a="toggle"]', el)); };
    Nav.focus(box.querySelector('[data-m="ext"]'));
  }

  function audioMenu() {
    var tracks = [];
    try { tracks = JSON.parse(Native.audioTracks()); } catch (e) { }
    if (!tracks.length) { U.toast('Aucune piste audio détectée'); return; }
    Modal.choose('Piste audio', tracks.map(function (t, i) {
      var lang = t.lang && t.lang !== 'und' ? t.lang : 'Piste ' + (i + 1);
      var label = lang + (t.codec ? ' · ' + t.codec : '') + (t.supported === false ? ' (non pris en charge)' : '');
      return { label: label, value: t.index, selected: t.selected };
    }), function (v) { Native.selectAudio(v); U.toast('Piste audio changée'); });
  }

  P.close = function () {
    if (!P.open) return;
    try { closeInner(); } catch (e) {
      try { Native.log('player close: ' + e.message); Native.stop(); } catch (e2) { }
      P.open = false; NativeEvents.owner = null; Nav.handler = null;
      var ly = document.getElementById('layer'); Nav.popRoot(ly); ly.classList.remove('on'); ly.innerHTML = '';
      document.documentElement.classList.remove('playing');
      if (window.App) App.go(App.route || 'home');
    }
  };
  function closeInner() {
    readState();
    var sb = document.querySelector('#layer .skipbtn'); if (sb) sb.remove();
    if (window.Sync) setTimeout(Sync.soon, 0);
    if (!ended && state.pos > 0) saveHist(state.pos, state.dur);
    clearInterval(poll); clearInterval(saveTimer); clearInterval(nextTimer); clearTimeout(idleTimer);
    Native.stop();
    Native.setLandscape(false);
    P.open = false;
    NativeEvents.owner = null;
    var layer = document.getElementById('layer');
    Nav.popRoot(layer);
    layer.classList.remove('on'); layer.innerHTML = '';
    document.documentElement.classList.remove('playing');
    Nav.handler = null;
    el = null;
    var cb = opts && opts.onClose; opts = null;
    if (window.App) App.afterOverlay(P._prevFocus);
    if (cb) cb();
  }

  P.back = function () {
    if (Modal.isOpen()) { Modal.close(); return true; }
    P.close();
    return true;
  };

  window.Player = P;

  // ---------- simple modal chooser ----------
  var Modal = {
    _el: null, _prevFocus: null, _prevHandler: null,
    isOpen: function () { return !!this._el; },
    choose: function (title, options, cb) {
      var self = this;
      self.close();
      var host = document.getElementById('layer');
      var standalone = !host.classList.contains('on');
      if (standalone) { host.classList.add('on'); }
      self._standalone = standalone;
      self._prevFocus = Nav.current;
      self._prevHandler = Nav.handler;
      Nav.handler = null;
      var bg = U.html('<div class="modal-bg"><div class="modal"><h3>' + U.esc(title) + '</h3>' +
        options.map(function (o, i) { return '<button class="f opt' + (o.selected ? ' sel' : '') + '" data-i="' + i + '">' + U.esc(o.label) + (o.selected ? ' ✓' : '') + '</button>'; }).join('') +
        '</div></div>');
      host.appendChild(bg);
      self._el = bg;
      Nav.pushRoot(bg);
      bg.addEventListener('click', function (e) { if (e.target === bg) self.close(); });
      U.$$('.opt', bg).forEach(function (b) {
        b.onclick = function () { var o = options[+b.dataset.i]; self.close(); cb(o.value); };
      });
      Nav.focus(U.$('.opt.sel', bg) || U.$('.opt', bg));
    },
    prompt: function (title, help, value, cb) {
      var self = this;
      self.close();
      var host = document.getElementById('layer');
      var standalone = !host.classList.contains('on');
      if (standalone) host.classList.add('on');
      self._standalone = standalone;
      self._prevFocus = Nav.current;
      self._prevHandler = Nav.handler;
      Nav.handler = null;
      var bg = U.html('<div class="modal-bg"><div class="modal nav-group"><h3>' + U.esc(title) + '</h3>' +
        '<p class="muted" style="margin:0 0 12px;font-size:13px;line-height:1.5">' + U.esc(help) + '</p>' +
        '<label class="field"><input class="f" type="text" autocapitalize="off" autocomplete="off" spellcheck="false" data-submit="1" value="' + U.esc(value) + '"></label>' +
        '<div style="display:flex;gap:10px"><button class="f btn primary" data-p="ok">Enregistrer</button><button class="f btn" data-p="no">Annuler</button></div></div></div>');
      host.appendChild(bg);
      self._el = bg;
      Nav.pushRoot(bg);
      var inp = U.$('input', bg);
      function ok() { var v = inp.value; self.close(); cb(v); }
      U.$('[data-p="ok"]', bg).onclick = ok;
      U.$('[data-p="no"]', bg).onclick = function () { self.close(); };
      inp.addEventListener('submit-input', ok);
      inp.addEventListener('keydown', function (e) { if (e.keyCode === 13 && !document.body.classList.contains('kbd')) ok(); });
      Nav.focus(inp);
    },
    close: function () {
      if (!this._el) return;
      Nav.popRoot(this._el);
      this._el.remove(); this._el = null;
      if (this._standalone) document.getElementById('layer').classList.remove('on');
      Nav.handler = this._prevHandler;
      if (this._prevFocus && this._prevFocus.isConnected) Nav.focus(this._prevFocus, { noScroll: true });
    }
  };
  window.Modal = Modal;
})();
