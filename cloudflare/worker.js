const APP_ORIGIN = 'https://kotatsu-map.1lop.ru';
const ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;

function corsHeaders(origin) {
  const headers = new Headers();
  if (origin === APP_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', APP_ORIGIN);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
    headers.set('Vary', 'Origin');
  }
  return headers;
}

function json(data, status, origin = '') {
  const headers = corsHeaders(origin);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

function validViewerUrl(value) {
  try {
    const target = new URL(value);
    return target.origin === APP_ORIGIN && target.pathname === '/' && target.searchParams.get('view') === '1' && /^#(?:z|layout)=/.test(target.hash);
  } catch { return false; }
}

async function createLink(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (origin !== APP_ORIGIN) return json({ error: 'origin_not_allowed' }, 403, origin);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'json_required' }, 415, origin);
  const rate = await env.CREATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
  if (!rate.success) return json({ error: 'rate_limited' }, 429, origin);
  if (Number(request.headers.get('Content-Length')) > 65536) return json({ error: 'request_too_large' }, 413, origin);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 65536) return json({ error: 'request_too_large' }, 413, origin);
  let data;
  try { data = JSON.parse(body); } catch { return json({ error: 'invalid_json' }, 400, origin); }
  if (typeof data.url !== 'string' || !validViewerUrl(data.url)) return json({ error: 'viewer_url_required' }, 400, origin);

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[byte % 62]).join('');
    const result = await env.DB.prepare('INSERT OR IGNORE INTO links (id, target, created_at) VALUES (?, ?, ?)').bind(id, data.url, Date.now()).run();
    if (result.meta.changes) return json({ shortUrl: `${new URL(request.url).origin}/${id}` }, 201, origin);
  }
  return json({ error: 'could_not_allocate_id' }, 503, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname === '/api/links') {
      const origin = request.headers.get('Origin') || '';
      return origin === APP_ORIGIN ? new Response(null, { status: 204, headers: corsHeaders(origin) }) : json({ error: 'origin_not_allowed' }, 403);
    }
    if (url.pathname === '/api/links') return request.method === 'POST' ? createLink(request, env) : json({ error: 'method_not_allowed' }, 405);
    if (request.method !== 'GET' || !ID_PATTERN.test(url.pathname.slice(1))) return new Response('Not found', { status: 404 });
    const row = await env.DB.prepare('SELECT target FROM links WHERE id = ?').bind(url.pathname.slice(1)).first();
    return row ? Response.redirect(row.target, 302) : new Response('Link not found', { status: 404 });
  },
};
