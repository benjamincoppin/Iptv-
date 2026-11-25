/* IPTV+ — enregistrements (clé USB / disque dur), programmation et plan B replay */
(function () {
  'use strict';

  var R = {};
  var DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  R.supported = function () { return !!(window.Native && Native.recAdd && Native.recList); };

  var cache = null, cacheAt = 0;
  R.all = function () {
    if (!R.supported()) return [];
    if (cache && Date.now() - cacheAt < 2000) return cache;
    try { cache = JSON.parse(Native.recList()) || []; } catch (e) { cache = []; }
    cacheAt = Date.now();
    return cache;
  };
  // recordings page = live recordings + replay downloads (films / episodes are on the Downloads page)
  R.list = function () { return R.all().filter(function (r) { return r.mode !== 'vod'; }); };
  R.invalidate = function () { cache = null; };
  function invalidate() { cache = null; }

  function live(r) { return r.status === 'scheduled' || r.status === 'recording'; }
  R.activeFor = function (streamId) {
    return R.list().filter(function (r) { return r.status === 'recording' && r.mode !== 'replay' && String(r.channelId) === String(streamId); })[0] || null;
  };
  R.findProg = function (streamId, start) {
    return R.list().filter(function (r) { return live(r) && String(r.channelId) === String(streamId) && Math.abs((r.progStart || r.start) - start) < 90000; })[0] || null;
  };

  function dateLabel(ms) {
    var d = new Date(ms), t = new Date(); t.setHours(0, 0, 0, 0);
    var x = new Date(ms); x.setHours(0, 0, 0, 0);
    var diff = Math.round((x - t) / 86400000);
    var day = diff === 0 ? 'Aujourd\'hui' : diff === 1 ? 'Demain' : diff === -1 ? 'Hier' : DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    return day + ' ' + U.hm(ms);
  }
  R.dateLabel = dateLabel;
  function size(b) {
    if (!b) return '';
    if (b > 1e9) return (b / 1e9).toFixed(1).replace('.', ',') + ' Go';
    return Math.max(1, Math.round(b / 1e6)) + ' Mo';
  }

  function build(s, prog) {
    var o = {
      title: prog.title || U.cleanName(s.name), channel: U.cleanName(s.name), channelId: String(s.stream_id),
      icon: U.imgUrl(s.stream_icon), desc: prog.desc || '',
      start: prog.start, end: prog.end, progStart: prog.start,
      url: API.liveUrl(s.stream_id, 'ts'), hlsUrl: API.liveUrl(s.stream_id, 'm3u8'),
      acc: API.account ? API.account.id : ''
    };
    // Plan B: the provider's replay of the same programme, if the channel has one
    if (API.hasArchive(s) && prog.title) {
      o.replayUrl = API.replayUrl(s.stream_id, prog);
      o.replayUntil = prog.end + (+s.tv_archive_duration || 1) * 86400000 - 3600000;
    }
    return o;
  }

  var hinted = false;
  function storageHint() {
    if (hinted) return;
    hinted = true;
    try {
      var st = JSON.parse(Native.recSettings());
      if (st.folder !== 'Automatique') return;
      var vols = JSON.parse(Native.recVolumes());
      if (!vols.some(function (v) { return v.removable; })) setTimeout(function () { U.toast('Aucune clé USB détectée : enregistrement dans la mémoire de l\'appareil'); }, 2600);
    } catch (e) { }
  }
  function connectionsHint(o) {
    var max = +(API.info && API.info.user_info && API.info.user_info.max_connections) || 0;
    var overlap = R.list().filter(function (r) { return live(r) && r.mode !== 'replay' && r.start < o.end && r.end > o.start; }).length;
    if (max && overlap + 1 > max - 1) setTimeout(function () { U.toast('Attention : ton abonnement autorise ' + max + ' connexion' + (max > 1 ? 's' : '') + '. Regarder une autre chaîne pendant l\'enregistrement pourra être refusé.'); }, 2600);
  }
  function add(o, msg) {
    if (!R.supported()) { U.toast('Enregistrement disponible dans l\'appli Android'); return null; }
    connectionsHint(o);
    var id = Native.recAdd(JSON.stringify(o));
    invalidate();
    if (!id) { U.toast('Impossible de programmer l\'enregistrement'); return null; }
    U.toast(msg);
    storageHint();
    if (window.Live && Live.open && Live.refreshInfo) setTimeout(Live.refreshInfo, 1500);
    return id;
  }

  // Record the programme being aired now (from now until its end)
  R.recordNow = function (s, cb) {
    API.epg(s.stream_id, 4).then(function (ep) {
      var nn = API.nowNext(ep), now = Date.now();
      if (nn.now && nn.now.end - now > 60000) {
        var o = build(s, nn.now);
        o.start = now;
        add(o, '● Enregistrement de « ' + o.title + ' » jusqu\'à ' + U.hm(o.end));
        if (cb) cb();
        return;
      }
      Modal.choose('Enregistrer ' + U.cleanName(s.name) + ' pendant…', [30, 60, 90, 120, 180].map(function (m) { return { label: U.minutesLabel(m), value: m }; }), function (m) {
        var o = build(s, { title: U.cleanName(s.name), start: now, end: now + m * 60000 });
        delete o.replayUrl;
        add(o, '● Enregistrement de ' + o.channel + ' jusqu\'à ' + U.hm(o.end));
        if (cb) cb();
      });
    });
  };

  // Programme from the guide: recorded now if on air, otherwise scheduled
  R.schedule = function (s, prog) {
    if (prog.start <= Date.now()) {
      var o = build(s, prog);
      o.start = Date.now();
      return add(o, '● Enregistrement de « ' + o.title + ' » jusqu\'à ' + U.hm(o.end));
    }
    return add(build(s, prog), 'Enregistrement programmé : « ' + (prog.title || '') + ' » ' + dateLabel(prog.start).replace(/^A/, 'a').replace(/^D/, 'd'));
  };

  // Download an aired programme from the replay
  R.downloadReplay = function (s, prog) {
    var o = build(s, prog);
    o.mode = 'replay';
    o.replayUrl = API.replayUrl(s.stream_id, prog);
    o.replayUntil = 0;
    return add(o, 'Téléchargement du replay « ' + o.title + ' » lancé');
  };

  R.stop = function (id) { Native.recStop(id); invalidate(); };

  R.play = function (r) {
    var url = r.file;
    try { if (Native.recPlayUrl) url = Native.recPlayUrl(r.id) || r.file; } catch (e) { }
    Player.start({ kind: 'recording', url: url, title: r.title, sub: r.channel + ' · ' + dateLabel(r.progStart || r.start), startMs: 0 });
  };

  // ---------- progression ----------
  function progress() {
    try { return Native.recProgress ? JSON.parse(Native.recProgress()) : {}; } catch (e) { return {}; }
  }
  function eta(sec) {
    sec = Math.round(sec);
    if (sec < 60) return 'moins d\'1 min';
    var m = Math.round(sec / 60);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + U.pad(m % 60);
  }
  // { pct (0-100 or -1 when unknown), text }
  function progressInfo(r, p) {
    var now = Date.now();
    if (!p) return null;
    if (p.mode === 'replay') {
      var speed = p.speed > 0 ? size(p.speed) + '/s' : '';
      if (p.total > 0) {
        var pct = Math.min(100, Math.floor(p.written * 100 / p.total));
        return { pct: pct, text: pct + ' % · ' + size(p.written) + ' / ' + size(p.total) + (speed ? ' · ' + speed : '') + (p.speed > 0 ? ' · reste ' + eta((p.total - p.written) / p.speed) : '') };
      }
      return { pct: -1, text: size(p.written) + ' reçus' + (speed ? ' · ' + speed : '') };
    }
    var st = p.start, en = p.end, span = en - st;
    var pc = span > 0 ? Math.max(0, Math.min(100, Math.floor((now - st) * 100 / span))) : -1;
    return { pct: pc, text: Math.max(0, Math.round((now - st) / 60000)) + ' min sur ' + Math.round(span / 60000) + ' · ' + (size(p.written) || '0 Mo') + ' · fin à ' + U.hm(en) };
  }
  function bar(info) {
    if (!info) return '';
    return '<span class="pbar' + (info.pct < 0 ? ' ind' : '') + '"><i style="width:' + (info.pct < 0 ? 30 : info.pct) + '%"></i></span><span class="ptx">' + U.esc(info.text) + '</span>';
  }
  function updateBars(page) {
    var prog = progress(), ids = Object.keys(prog);
    U.$$('.rrow[data-id]', page).forEach(function (row) {
      var p = prog[row.dataset.id], box = U.$('.prog', row);
      if (!box) return;
      box.innerHTML = bar(progressInfo(null, p));
    });
    return ids.length;
  }

  function statusLabel(r) {
    if (r.status === 'recording' || r.active) return r.mode === 'replay' ? '⬇ Téléchargement du replay' : '● Enregistrement en cours';
    if (r.status === 'scheduled') return r.mode === 'replay' ? 'Replay à télécharger' : 'Programmé';
    if (r.status === 'done') return (r.exists === false ? 'Fichier introuvable (clé débranchée ?)' : 'Terminé') + (r.size ? ' · ' + size(r.size) : '') + (r.mode === 'replay' ? ' · depuis le replay' : '') + (r.error ? ' · ' + r.error : '');
    if (r.status === 'cancelled') return 'Annulé';
    var base = r.status === 'missed' ? 'Manqué (appareil éteint ?)' : 'Échec' + (r.error ? ' : ' + r.error : '');
    if (r.replayPending) base += ' · récupération par le replay prévue';
    else if (r.status === 'missed' && r.error) base += ' · ' + r.error;
    return base;
  }

  // ---------- page "Enregistrements" ----------
  var timer = null;
  R.view = function (page) {
    clearInterval(timer);
    if (!R.supported()) {
      page.innerHTML = '<div class="section" style="margin-top:6px"><h1 style="font-size:26px">Enregistrements</h1></div><div class="empty">Les enregistrements fonctionnent dans l\'appli Android (TV ou téléphone).</div>';
      return Promise.resolve();
    }
    if (Native.recCheck) Native.recCheck();
    draw(page, true);
    var tick = 0, wasActive = false;
    timer = setInterval(function () {
      if (!page.isConnected) { clearInterval(timer); return; }
      tick++;
      var active = updateBars(page);
      // full redraw when a job starts / ends, and every 10 s for the statuses
      if ((active > 0) !== wasActive || tick % 7 === 0) { if (!Modal.isOpen()) draw(page, false); }
      wasActive = active > 0;
    }, 1500);
    return Promise.resolve();
  };

  function storageLine() {
    try {
      var st = JSON.parse(Native.recSettings()), vols = JSON.parse(Native.recVolumes());
      var usb = vols.filter(function (v) { return v.removable; })[0];
      var label = st.folder;
      if (label === 'Automatique') label = usb ? usb.label + ' (automatique)' : 'Mémoire de l\'appareil (aucune clé USB détectée)';
      var v = vols.filter(function (x) { return st.folder !== 'Automatique' && x.label === st.folder; })[0] || (st.folder === 'Automatique' ? (usb || vols[0]) : null);
      return 'Stockage : ' + label + (v && v.free ? ' · ' + size(v.free) + ' libres' : '');
    } catch (e) { return ''; }
  }

  function draw(page, first) {
    invalidate();
    var list = R.list();
    var focusKey = Nav.current && page.contains(Nav.current) ? Nav.current.dataset.key : null;
    var groups = [
      { t: 'En cours', f: function (r) { return r.status === 'recording' || r.active; } },
      { t: 'Programmés', f: function (r) { return r.status === 'scheduled' && !r.active; }, sort: 1 },
      { t: 'Terminés', f: function (r) { return r.status === 'done' && !r.active; } },
      { t: 'Problèmes', f: function (r) { return (r.status === 'failed' || r.status === 'missed') && !r.active; } }
    ];
    var html = '<div class="recs"><div class="rhead"><div><h1>Enregistrements</h1><p class="muted">' + U.esc(storageLine()) + '</p></div>' +
      '<div class="nav-group" style="display:flex;gap:10px;flex-wrap:wrap"><button class="f btn' + (shareOn() ? ' primary' : '') + '" data-a="share" data-key="rshare">' + (shareOn() ? 'Partage actif' : 'Partage sur le réseau') + '</button><button class="f btn" data-a="settings" data-key="rset">Réglages</button><button class="f btn" data-a="guide" data-key="rguide">Programmer depuis le guide</button></div></div>';
    var prog = progress();
    var any = false;
    groups.forEach(function (g) {
      var items = list.filter(g.f).sort(function (a, b) { return g.sort ? a.start - b.start : (b.progStart || b.start) - (a.progStart || a.start); });
      if (!items.length) return;
      any = true;
      html += '<h2 class="sh">' + g.t + ' <span class="count">' + items.length + '</span></h2><div class="nav-group rlist">' + items.map(function (r) {
        return '<button class="f rrow st-' + r.status + (r.active ? ' st-recording' : '') + '" data-id="' + U.esc(r.id) + '" data-key="r' + U.esc(r.id) + '">' +
          '<span class="lg">' + (r.icon ? U.img(r.icon) : '') + '</span>' +
          '<span class="tx"><span class="t">' + U.esc(r.title || '') + '</span>' +
          '<span class="d">' + U.esc(r.channel + ' · ' + dateLabel(r.progStart || r.start) + ' – ' + U.hm(r.end)) + '</span>' +
          '<span class="s">' + U.esc(statusLabel(r)) + '</span>' +
          (r.note ? '<span class="nt">' + U.esc(r.note) + '</span>' : '') +
          (r.status === 'recording' || r.active ? '<span class="prog">' + bar(progressInfo(r, prog[r.id])) + '</span>' : '') +
          '</span></button>';
      }).join('') + '</div>';
    });
    if (!any) html += '<div class="empty" style="margin-top:30px">Aucun enregistrement.<br><br>Dans le <b>Guide TV</b>, choisis un programme puis « Enregistrer ».<br>En <b>TV en direct</b>, maintiens OK sur une chaîne puis « Enregistrer le programme en cours ».</div>';
    html += '<p class="muted rnote">Pour un enregistrement programmé, laisse l\'appareil en veille normale (pas débranché). L\'appli le réveille à l\'heure prévue ; s\'il était éteint, le programme est récupéré depuis le replay quand la chaîne le propose.</p></div>';
    page.innerHTML = html;
    U.$('[data-a="settings"]', page).onclick = function () { R.settings(function () { draw(page, false); }); };
    U.$('[data-a="share"]', page).onclick = function () { R.share(function () { draw(page, false); }); };
    U.$('[data-a="guide"]', page).onclick = function () { App.go('guide'); };
    U.$$('.rrow', page).forEach(function (b) {
      b.addEventListener('click', function () { actions(list.filter(function (r) { return r.id === b.dataset.id; })[0], page); });
    });
    var f = focusKey && U.$('[data-key="' + focusKey + '"]', page);
    if (f) Nav.focus(f, { noScroll: true });
    else if (first && document.body.classList.contains('kbd')) Nav.focus(U.$('.rrow', page) || U.$('.f', page));
  }

  function actions(r, page) {
    if (!r) return;
    var opts = [];
    var running = r.status === 'recording' || r.active;
    if (r.status === 'done' && r.exists !== false) opts.push({ label: 'Regarder', value: 'play' });
    if (running && r.file) opts.push({ label: 'Regarder depuis le début', value: 'play' });
    if (running) opts.push({ label: 'Arrêter l\'enregistrement', value: 'stop' });
    if (r.status === 'scheduled' && !running) opts.push({ label: 'Annuler la programmation', value: 'cancel' });
    if (r.file) opts.push({ label: 'Supprimer l\'enregistrement et le fichier', value: 'delfile' });
    opts.push({ label: r.file ? 'Retirer de la liste (garder le fichier)' : 'Retirer de la liste', value: 'del' });
    Modal.choose(r.title || 'Enregistrement', opts, function (v) {
      if (v === 'play') R.play(r);
      else if (v === 'stop') { R.stop(r.id); U.toast('Enregistrement arrêté'); }
      else if (v === 'cancel') { R.stop(r.id); Native.recDelete(r.id, false); U.toast('Programmation annulée'); }
      else if (v === 'delfile' || v === 'del') { Native.recDelete(r.id, v === 'delfile'); U.toast(v === 'delfile' ? 'Enregistrement supprimé' : 'Retiré de la liste'); }
      setTimeout(function () { if (page.isConnected) draw(page, false); }, 300);
    });
  }

  // ---------- partage sur le réseau local ----------
  function shareState() { try { return Native.shareState ? JSON.parse(Native.shareState()) : {}; } catch (e) { return {}; } }
  function shareOn() { return !!shareState().running; }

  R.share = function (done) {
    if (!Native.shareStart) { U.toast('Disponible dans l\'appli Android'); return; }
    var st = shareState();
    if (!st.running) {
      st = JSON.parse(Native.shareStart());
      if (!st.running) { U.toast(st.error || 'Impossible de démarrer le partage'); return; }
    }
    Modal.form('Partage sur le réseau',
      '<p class="muted" style="font-size:13px;line-height:1.55;margin:0 0 14px">Sur ton ordinateur (connecté à la même box), ouvre le navigateur à cette adresse puis saisis le code :</p>' +
      '<div class="sharebox"><div class="su">' + U.esc(st.url) + '</div><div class="sp">Code <b>' + U.esc(st.pin) + '</b></div></div>' +
      '<p class="muted" style="font-size:12px;line-height:1.5;margin:14px 0 4px">Tu y trouveras tes enregistrements terminés avec un bouton « Télécharger ». Le partage reste actif quand tu quittes cette page et s\'arrête tout seul après 1 h sans activité.</p>',
      null,
      [{ label: 'OK', value: 'ok', primary: true }, { label: 'Arrêter le partage', value: 'stop' }],
      function (v) {
        if (v === 'stop') { Native.shareStop(); U.toast('Partage arrêté'); }
        if (done) setTimeout(done, 50);
      });
  };

  // ---------- dossier partagé d'un ordinateur / NAS ----------
  R.smbSetup = function (cb) {
    var c = {};
    try { c = JSON.parse(Native.smbConfig()); } catch (e) { }
    Modal.form('Dossier partagé d\'un ordinateur',
      '<p class="muted" style="font-size:13px;line-height:1.55;margin:0 0 12px">Les enregistrements seront écrits directement dans ce dossier. L\'ordinateur doit être allumé pendant l\'enregistrement ; sinon, il est fait sur l\'appareil à la place.</p>',
      [
        { key: 'address', label: 'Adresse du dossier partagé', value: c.address || '', placeholder: '\\\\192.168.1.20\\Videos' },
        { key: 'user', label: 'Utilisateur de l\'ordinateur', value: c.user || '', placeholder: 'ex. benjamin ou adresse Microsoft' },
        { key: 'pass', label: c.hasPass ? 'Mot de passe (laisser vide pour garder l\'actuel)' : 'Mot de passe', value: '', type: 'password' }
      ],
      [{ label: 'Tester et utiliser', value: 'save', primary: true }, { label: 'Annuler', value: 'no' }],
      function (v, vals, dlg) {
        if (v !== 'save') return true;
        if (!vals.address.trim()) { dlg.error('Indique l\'adresse du dossier partagé'); return false; }
        dlg.error(''); dlg.busy(true, 'Test en cours…');
        API.nativeCall('smbSave', JSON.stringify(vals)).then(function (label) {
          dlg.close();
          U.toast('Enregistrements : ' + label);
          if (cb) cb();
        }, function (e) {
          dlg.busy(false, 'Tester et utiliser');
          dlg.error(e.message);
        });
        return false;
      });
  };

  // ---------- réglages ----------
  R.settings = function (done) {
    var st = {};
    try { st = JSON.parse(Native.recSettings()); } catch (e) { }
    Modal.choose('Réglages des enregistrements', [
      { label: 'Emplacement : ' + (st.folder || 'Automatique'), value: 'folder' },
      { label: 'Commencer ' + (st.before || 0) + ' min avant', value: 'before' },
      { label: 'Continuer ' + (st.after || 0) + ' min après', value: 'after' },
      { label: 'Plan B (replay si l\'enregistrement échoue) : ' + (st.planB ? 'activé' : 'désactivé'), value: 'planB' }
    ], function (v) {
      function back() { setTimeout(function () { R.settings(done); }, 0); if (done) done(); }
      if (v === 'planB') { Native.recSetSettings(JSON.stringify({ planB: !st.planB })); back(); }
      else if (v === 'before' || v === 'after') setTimeout(function () {
        Modal.choose(v === 'before' ? 'Marge avant le début' : 'Marge après la fin', [0, 1, 2, 5, 10, 15, 30].map(function (m) { return { label: m + ' min', value: m, selected: m === st[v] }; }), function (m) {
          var o = {}; o[v] = m; Native.recSetSettings(JSON.stringify(o)); back();
        });
      }, 0);
      else if (v === 'folder') setTimeout(function () { R.chooseFolder(back); }, 0);
    });
  };

  R.chooseFolder = function (cb) {
    var vols = [];
    try { vols = JSON.parse(Native.recVolumes()); } catch (e) { }
    var opts = [{ label: 'Automatique (la clé USB si elle est branchée)', value: '' }].concat(vols.map(function (v) {
      return { label: v.label + (v.free ? ' · ' + size(v.free) + ' libres' : ''), value: v.spec };
    })).concat([{ label: 'Choisir un dossier…', value: '__pick' }])
      .concat(Native.smbSave ? [{ label: 'Dossier partagé d\'un ordinateur (réseau)…', value: '__smb' }] : []);
    Modal.choose('Emplacement des enregistrements', opts, function (spec) {
      if (spec === '__smb') return R.smbSetup(cb);
      if (spec === '__pick') {
        R.onFolder = function () { R.onFolder = null; if (cb) cb(); };
        if (!Native.recPickFolder()) { R.onFolder = null; U.toast('Le sélecteur de dossier n\'est pas disponible sur cet appareil : choisis un stockage dans la liste'); }
        return;
      }
      Native.recSetFolder(spec);
      U.toast('Emplacement enregistré');
      if (cb) cb();
    });
  };

  R.util = { bar: bar, progressInfo: progressInfo, progress: progress, size: size, storageLine: storageLine, dateLabel: dateLabel };
  window.Recordings = R;
  if (window.Views) Views.recordings = R.view;
})();
