/* IPTV+ — téléchargement des films et séries (en arrière-plan, file d'attente, reprise) */
(function () {
  'use strict';

  var D = {};
  D.supported = function () { return !!(window.Native && Native.dlAdd && window.Recordings && Recordings.supported()); };

  function acc() { return API.account ? API.account.id : ''; }
  function key(type, id) { return acc() + ':' + type + ':' + id; }
  function clean(s) { return String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  D.list = function () { return Recordings.all().filter(function (r) { return r.mode === 'vod' && (!r.acc || r.acc === acc()); }); };
  D.find = function (type, id) {
    if (!D.supported()) return null;
    var k = key(type, id);
    return D.list().filter(function (r) { return r.vodKey === k && r.status !== 'cancelled'; })[0] || null;
  };
  /** Local copy to play instead of streaming, if the film / episode is downloaded. */
  D.localUrl = function (type, id) {
    var r = D.find(type, id);
    if (!r || r.status !== 'done' || r.exists === false || !r.file) return null;
    try { return Native.recPlayUrl(r.id) || r.file; } catch (e) { return r.file; }
  };

  function add(o, quiet) {
    if (!D.supported()) { U.toast('Téléchargement disponible dans l\'appli Android'); return null; }
    o.acc = acc();
    var id = Native.dlAdd(JSON.stringify(o));
    Recordings.invalidate();
    if (!id) { U.toast('Impossible d\'ajouter le téléchargement'); return null; }
    if (!quiet) U.toast('⬇ « ' + o.title + ' » ajouté aux téléchargements');
    return id;
  }

  D.movie = function (m, year) {
    var ext = m.container_extension || 'mp4';
    var name = U.noYear(U.cleanName(m.name));
    return add({
      vodKey: key('movie', m.stream_id), vodType: 'movie', vodId: String(m.stream_id),
      title: name, channel: year ? 'Film · ' + year : 'Film', icon: U.imgUrl(m.stream_icon),
      url: API.movieUrl(m.stream_id, ext),
      fileName: clean(name) + (year ? ' (' + year + ')' : '') + '.' + ext,
      hist: { type: 'movie', id: m.stream_id, name: U.cleanName(m.name), img: m._backdrop || m.stream_icon, ext: ext },
      sub: m._sub || ''
    });
  };

  // ep: { id, ext, season, num, title, img }, serie: { id, name, cover }
  D.episode = function (serie, ep, quiet) {
    var ext = ep.ext || 'mp4';
    var code = 'S' + U.pad(+ep.season) + 'E' + U.pad(+ep.num);
    return add({
      vodKey: key('episode', ep.id), vodType: 'episode', vodId: String(ep.id), seriesId: String(serie.id),
      title: serie.name + ' · S' + ep.season + ' É' + ep.num + (ep.title ? ' · ' + ep.title : ''), channel: 'Série', icon: U.imgUrl(serie.cover),
      url: API.episodeUrl(ep.id, ext),
      fileName: clean(serie.name) + ' - ' + code + (ep.title ? ' - ' + clean(ep.title) : '') + '.' + ext,
      hist: { type: 'episode', id: ep.id, name: ep.title || ('Épisode ' + ep.num), img: ep.img || serie.cover, ext: ext, seriesId: serie.id, seriesName: serie.name, season: ep.season, ep: ep.num },
      sub: 'S' + ep.season + ' · É' + ep.num + (ep.title ? ' · ' + ep.title : '')
    }, quiet);
  };

  D.season = function (serie, eps) {
    var n = 0;
    eps.forEach(function (ep) { var r = D.find('episode', ep.id); if (!r || r.status === 'failed' || r.status === 'paused') { if (D.episode(serie, ep, true)) n++; } });
    U.toast(n ? '⬇ ' + n + ' épisode' + (n > 1 ? 's' : '') + ' ajouté' + (n > 1 ? 's' : '') + ' aux téléchargements' : 'Cette saison est déjà téléchargée ou en cours');
  };

  D.play = function (r) {
    var h = r.hist || {};
    var url = D.localUrl(h.type, h.id);
    if (!url) { U.toast('Fichier introuvable (clé USB débranchée ?)'); return; }
    var prev = Hist.get(h.type, h.id);
    var start = prev && prev.pos > 30000 && prev.dur && prev.pos < prev.dur * 0.94 ? prev.pos : 0;
    Player.start({ kind: h.type || 'movie', url: url, title: h.type === 'episode' ? h.seriesName : h.name, sub: r.sub || '', startMs: start, hist: h });
  };

  /** Short label for the buttons on the film / episode pages. */
  D.state = function (type, id) {
    var r = D.find(type, id);
    if (!r) return null;
    if (r.status === 'done') return { r: r, label: r.exists === false ? 'Fichier introuvable' : 'Téléchargé', done: r.exists !== false };
    if (r.status === 'recording' || r.active) {
      var p = Recordings.util.progress()[r.id];
      return { r: r, label: p && p.total > 0 ? Math.floor(p.written * 100 / p.total) + ' %' : 'En cours', busy: true };
    }
    if (r.status === 'queued') return { r: r, label: 'En attente', busy: true };
    if (r.status === 'paused') return { r: r, label: 'En pause', busy: true };
    if (r.status === 'failed') return { r: r, label: 'Échec', failed: true };
    return null;
  };

  /** Menu for a downloaded / downloading item (film page, episode long press). */
  D.menu = function (r, onChange, playStream) {
    var opts = [];
    var running = r.status === 'recording' || r.active;
    if (r.status === 'done' && r.exists !== false) opts.push({ label: '▶ Regarder (copie téléchargée)', value: 'play' });
    else if (playStream) opts.push({ label: '▶ Regarder (en streaming)', value: 'stream' });
    if (running) opts.push({ label: '❚❚ Mettre en pause', value: 'pause' });
    if (r.status === 'paused' || r.status === 'failed') opts.push({ label: '⬇ Reprendre le téléchargement', value: 'resume' });
    opts.push({ label: 'Voir les téléchargements', value: 'list' });
    opts.push({ label: r.status === 'done' ? 'Supprimer le fichier téléchargé' : 'Annuler et supprimer', value: 'del' });
    Modal.choose(r.title || 'Téléchargement', opts, function (v) {
      if (v === 'play') D.play(r);
      else if (v === 'stream') playStream();
      else if (v === 'pause') { Native.dlPause(r.id); U.toast('Téléchargement en pause'); }
      else if (v === 'resume') { Native.dlResume(r.id); U.toast('Téléchargement repris'); }
      else if (v === 'list') App.go('downloads');
      else if (v === 'del') { Native.recDelete(r.id, true); U.toast('Téléchargement supprimé'); }
      Recordings.invalidate();
      if (onChange) setTimeout(onChange, 400);
    });
  };

  // ---------- page "Téléchargements" ----------
  var timer = null;
  D.view = function (page) {
    clearInterval(timer);
    if (!D.supported()) {
      page.innerHTML = '<div class="section" style="margin-top:6px"><h1 style="font-size:26px">Téléchargements</h1></div><div class="empty">Les téléchargements fonctionnent dans l\'appli Android (TV ou téléphone).</div>';
      return Promise.resolve();
    }
    if (Native.recCheck) Native.recCheck();
    draw(page, true);
    var tick = 0, was = -1;
    timer = setInterval(function () {
      if (!page.isConnected) { clearInterval(timer); return; }
      tick++;
      var prog = Recordings.util.progress(), n = Object.keys(prog).length;
      U.$$('.rrow[data-id]', page).forEach(function (row) {
        var box = U.$('.prog', row);
        if (box && prog[row.dataset.id]) box.innerHTML = Recordings.util.bar(Recordings.util.progressInfo(null, prog[row.dataset.id]));
      });
      if ((n !== was && was !== -1) || tick % 7 === 0) { if (!Modal.isOpen()) draw(page, false); }
      was = n;
    }, 1500);
    return Promise.resolve();
  };

  function draw(page, first) {
    Recordings.invalidate();
    var all = D.list(), u = Recordings.util, prog = u.progress();
    var replays = Recordings.list().filter(function (r) { return r.mode === 'replay' && (r.status === 'recording' || r.active || r.status === 'scheduled'); });
    var focusKey = Nav.current && page.contains(Nav.current) ? Nav.current.dataset.key : null;
    var groups = [
      { t: 'En cours', f: function (r) { return r.status === 'recording' || r.active; } },
      { t: 'En attente', f: function (r) { return r.status === 'queued' && !r.active; }, asc: 1 },
      { t: 'En pause', f: function (r) { return r.status === 'paused' && !r.active; } },
      { t: 'Échecs', f: function (r) { return r.status === 'failed' && !r.active; } },
      { t: 'Téléchargés', f: function (r) { return r.status === 'done' && !r.active; } }
    ];
    var html = '<div class="recs"><div class="rhead"><div><h1>Téléchargements</h1><p class="muted">' + U.esc(u.storageLine()) + '</p></div>' +
      '<div class="nav-group" style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="f btn" data-a="share" data-key="dshare">Partage sur le réseau</button>' +
      '<button class="f btn" data-a="folder" data-key="dfolder">Emplacement</button></div></div>';
    var any = false;
    function row(r, extra) {
      var running = r.status === 'recording' || r.active;
      var status = running ? '⬇ Téléchargement' : r.status === 'queued' ? 'En attente' : r.status === 'paused' ? 'En pause' + (r.size ? ' · ' + u.size(r.size) + (r.total ? ' / ' + u.size(r.total) : '') : '') :
        r.status === 'failed' ? 'Échec' + (r.error ? ' : ' + r.error : '') : r.status === 'scheduled' ? 'Replay à télécharger' :
        (r.exists === false ? 'Fichier introuvable (clé débranchée ?)' : u.size(r.size || r.total)) ;
      return '<button class="f rrow st-' + (running ? 'recording' : r.status) + '" data-id="' + U.esc(r.id) + '" data-key="d' + U.esc(r.id) + '">' +
        '<span class="lg poster">' + (r.icon ? U.img(r.icon) : '') + '</span>' +
        '<span class="tx"><span class="t">' + U.esc(r.title || '') + '</span>' +
        '<span class="d">' + U.esc(extra || r.channel || '') + '</span>' +
        '<span class="s">' + U.esc(status) + '</span>' +
        (r.note ? '<span class="nt">' + U.esc(r.note) + '</span>' : '') +
        (running ? '<span class="prog">' + u.bar(u.progressInfo(r, prog[r.id])) + '</span>' : '') +
        '</span></button>';
    }
    groups.forEach(function (g) {
      var items = all.filter(g.f).sort(function (a, b) { return g.asc ? a.created - b.created : (b.finished || b.created || 0) - (a.finished || a.created || 0); });
      if (!items.length) return;
      any = true;
      html += '<h2 class="sh">' + g.t + ' <span class="count">' + items.length + '</span></h2><div class="nav-group rlist">' + items.map(function (r) { return row(r); }).join('') + '</div>';
    });
    if (replays.length) {
      any = true;
      html += '<h2 class="sh">Replays <span class="count">' + replays.length + '</span></h2><div class="nav-group rlist">' + replays.map(function (r) { return row(r, r.channel + ' · ' + u.dateLabel(r.progStart || r.start)); }).join('') + '</div>';
    }
    if (!any) html += '<div class="empty" style="margin-top:30px">Aucun téléchargement.<br><br>Sur la fiche d\'un film, choisis « Télécharger ».<br>Sur une série : « Télécharger la saison », ou maintiens OK sur un épisode.</div>';
    html += '<p class="muted rnote">Les téléchargements continuent en arrière-plan, même si tu quittes l\'appli, un à la fois. S\'ils sont coupés (réseau, appareil éteint), ils reprennent là où ils s\'étaient arrêtés.</p></div>';
    page.innerHTML = html;
    U.$('[data-a="share"]', page).onclick = function () { Recordings.share(); };
    U.$('[data-a="folder"]', page).onclick = function () { Recordings.chooseFolder(function () { draw(page, false); }); };
    U.$$('.rrow', page).forEach(function (b) {
      b.addEventListener('click', function () {
        var r = all.concat(replays).filter(function (x) { return x.id === b.dataset.id; })[0];
        if (!r) return;
        if (r.mode === 'replay') return App.go('recordings');
        D.menu(r, function () { if (page.isConnected) draw(page, false); });
      });
    });
    var f = focusKey && U.$('[data-key="' + focusKey + '"]', page);
    if (f) Nav.focus(f, { noScroll: true });
    else if (first && document.body.classList.contains('kbd')) Nav.focus(U.$('.rrow', page) || U.$('.f', page));
  }

  window.Downloads = D;
  if (window.Views) Views.downloads = D.view;
})();
