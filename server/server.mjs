import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SERVER_DIR, '..');
const DATA_DIR = path.join(SERVER_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'links.json');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8788);
const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
const SHORT_ORIGIN = process.env.SHORT_ORIGIN || APP_ORIGIN;
const ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;
const MIME = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.pbf': 'application/x-protobuf', '.png': 'image/png', '.svg': 'image/svg+xml' };

await mkdir(DATA_DIR, { recursive: true });
let links = {};
try { links = JSON.parse(await readFile(DATA_FILE, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
let writeQueue = Promise.resolve();

function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function validViewerUrl(value) {
  try {
    const target = new URL(value);
    return target.origin === APP_ORIGIN && target.pathname === '/' && target.searchParams.get('view') === '1' && /^#(?:z|layout)=/.test(target.hash);
  } catch { return false; }
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw Object.assign(new Error('request_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

function persist() {
  writeQueue = writeQueue.then(async () => {
    const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
    await writeFile(tempFile, JSON.stringify(links), 'utf8');
    await rename(tempFile, DATA_FILE);
  });
  return writeQueue;
}

async function handle(request, response) {
  const url = new URL(request.url, APP_ORIGIN);
  if (request.method === 'POST' && url.pathname === '/api/links') {
    if (request.headers.origin && request.headers.origin !== APP_ORIGIN) return send(response, 403, { error: 'origin_not_allowed' });
    if (!request.headers['content-type']?.startsWith('application/json')) return send(response, 415, { error: 'json_required' });
    try {
      const data = await readJson(request);
      if (typeof data.url !== 'string' || !validViewerUrl(data.url)) return send(response, 400, { error: 'viewer_url_required' });
      let id;
      do { id = randomBytes(9).toString('base64url'); } while (links[id]);
      links[id] = { target: data.url, createdAt: Date.now() };
      await persist();
      return send(response, 201, { shortUrl: `${SHORT_ORIGIN.replace(/\/$/, '')}/${id}` });
    } catch (error) { return send(response, error.status || 500, { error: error.status ? error.message : 'storage_error' }); }
  }
  if (request.method === 'GET' && ID_PATTERN.test(url.pathname.slice(1))) {
    const entry = links[url.pathname.slice(1)];
    if (!entry) return send(response, 404, 'Link not found', 'text/plain; charset=utf-8');
    response.writeHead(302, { Location: entry.target, 'Cache-Control': 'no-store' });
    return response.end();
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, { error: 'method_not_allowed' });
  let relative;
  try { relative = decodeURIComponent(url.pathname.slice(1) || 'index.html'); }
  catch { return send(response, 400, { error: 'invalid_path' }); }
  if (relative.split(/[\\/]/).some((part) => part.startsWith('.')) || !(['index.html', 'app.js', 'styles.css', 'favicon.svg', 'build-version.txt'].includes(relative) || relative.startsWith('assets/') || relative.startsWith('data/'))) {
    return send(response, 404, 'Not found', 'text/plain; charset=utf-8');
  }
  const file = path.resolve(PROJECT_DIR, relative);
  if (!file.startsWith(`${PROJECT_DIR}${path.sep}`)) return send(response, 403, 'Forbidden', 'text/plain; charset=utf-8');
  try {
    if (!(await stat(file)).isFile()) return send(response, 404, 'Not found', 'text/plain; charset=utf-8');
    response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    if (request.method === 'HEAD') return response.end();
    createReadStream(file).pipe(response);
  } catch { send(response, 404, 'Not found', 'text/plain; charset=utf-8'); }
}

createServer((request, response) => { handle(request, response).catch(() => send(response, 500, { error: 'internal_error' })); })
  .listen(PORT, HOST, () => process.stdout.write(`Kotatsu local server: ${APP_ORIGIN}\n`));
