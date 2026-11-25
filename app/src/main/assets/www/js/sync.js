/* IPTV+ — synchronisation de « Reprendre la lecture » entre appareils.
   Les données sont rangées sur un petit script PHP (sync.php) hébergé par l'utilisateur,
   sous une clé = SHA-256(serveur|utilisateur|mot de passe Xtream) : même compte Xtream = même historique,
   sans compte supplémentaire, et sans que le serveur ne connaisse les identifiants. */
(function () {
  'use strict';

  var S = { busy: false, last: 0, timer: null, onChange: null };

  S.url = function () {
    var u = (Settings.get('syncUrl') || '').trim();
    if (!u && window.IPTV_CONFIG) u = String(IPTV_CONFIG.syncUrl || '').trim();
    return u;
  };
  S.enabled = function () { return !!(S.url() && API.account); };

  function key() {
    var a = API.account;
    var txt = a.server.toLowerCase() + '|' + a.user + '|' + a.pass;
    try { if (Native.sha256) return Native.sha256(txt); } catch (e) { }
    return U.sha256(txt);
  }

  function merge(local, remote) {
    var out = {}, k;
    for (k in local) out[k] = local[k];
    for (k in remote) {
      var r = remote[k];
      if (!r || typeof r !== 'object') continue;
      if (!out[k] || (+r.ts || 0) > (+out[k].ts || 0)) out[k] = r;
    }
    return out;
  }

  // Send local history, receive the merged one
  S.now = function () {
    if (!S.enabled() || S.busy) return Promise.resolve(false);
    S.busy = true;
    clearTimeout(S.timer);
    var before = JSON.stringify(Store.all());
    var keyBefore = TMDB.key();
    return new Promise(function (resolve) {
      var x = new XMLHttpRequest();
      var url = S.url() + (S.url().indexOf('?') >= 0 ? '&' : '?') + 'key=' + key();
      x.open('POST', url, true);
      x.timeout = 15000;
      x.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8'); // simple request: no CORS preflight
      x.onload = function () {
        S.busy = false;
        if (x.status < 200 || x.status >= 300) { S.error = 'HTTP ' + x.status; return resolve(false); }
        try {
          var r = JSON.parse(x.responseText);
          var merged = merge(Store.all(), (r && r.items) || {});
          Store.set(merged);
          if (TMDB.key() !== keyBefore) { AS.del('tmdbIds'); TMDB.mem = {}; }
          S.last = Date.now(); S.error = null;
          AS.set('syncLast', S.last);
          var changed = JSON.stringify(merged) !== before;
          if (changed && S.onChange) S.onChange();
          resolve(changed);
        } catch (e) { S.error = 'réponse invalide'; resolve(false); }
      };
      x.onerror = x.ontimeout = function () { S.busy = false; S.error = 'serveur injoignable'; resolve(false); };
      x.send(JSON.stringify({ items: Store.all() }));
    });
  };

  // Debounced syncs after local changes
  S.later = function () { if (!S.enabled()) return; clearTimeout(S.timer); S.timer = setTimeout(S.now, 20000); };
  S.soon = function () { if (!S.enabled()) return; clearTimeout(S.timer); S.timer = setTimeout(S.now, 1500); };
  // Pull if the last sync is older than maxAge
  S.refresh = function (maxAge) { if (S.enabled() && Date.now() - S.last > (maxAge || 60000)) return S.now(); return Promise.resolve(false); };

  window.Sync = S;
})();
