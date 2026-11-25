const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  'Cache-Control': 'no-store'
};
const MAX_ITEMS = 400;
let tableReady = false;

async function ensureTable(db) {
  if (tableReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS sync (k TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)').run();
  tableReady = true;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, HEADERS)
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: HEADERS });

    const url = new URL(request.url);
    const key = url.searchParams.get('key') || '';
    if (!/^[a-f0-9]{64}$/.test(key)) return new Response(null, { status: 404, headers: HEADERS });

    await ensureTable(env.DB);
    const row = await env.DB.prepare('SELECT data FROM sync WHERE k = ?').bind(key).first();
    let items = {};
    if (row) {
      try { items = JSON.parse(row.data).items || {}; } catch (e) { items = {}; }
    }

    if (request.method === 'POST') {
      let input = null;
      try {
        const raw = await request.text();
        if (raw.length <= 1048576) input = JSON.parse(raw);
      } catch (e) { input = null; }

      if (input && input.items && typeof input.items === 'object') {
        let changed = false;
        for (const k of Object.keys(input.items)) {
          const v = input.items[k];
          if (k.length > 80 || !v || typeof v !== 'object' || JSON.stringify(v).length > 4000) continue;
          const ts = Number(v.ts) || 0;
          if (!items[k] || (Number(items[k].ts) || 0) < ts) { items[k] = v; changed = true; }
        }
        if (changed) {
          const kept = Object.keys(items)
            .sort((a, b) => (Number(items[b].ts) || 0) - (Number(items[a].ts) || 0))
            .slice(0, MAX_ITEMS);
          const pruned = {};
          for (const k of kept) pruned[k] = items[k];
          items = pruned;
          await env.DB.prepare('INSERT INTO sync (k, data, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET data = excluded.data, updated = excluded.updated')
            .bind(key, JSON.stringify({ items }), Date.now()).run();
        }
      }
    }

    return json({ items, time: Date.now() });
  }
};
