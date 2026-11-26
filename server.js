// David x Dave HQ: a small shared task board.
// Plain Node HTTP server: static front end, JSON API, a single team passcode
// (carried by a private link, so nobody types an email or password), and
// server-sent events so every open page updates live.

import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PgStore, MemoryStore } from './store.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

// ---- configuration ---------------------------------------------------------
// ACCESS_CODE: the one team passcode (12+ characters). Whoever has it can open
// and edit the board, so treat the private link that carries it like a key.
// Changing it signs every device out.
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const CODE_OK = ACCESS_CODE.length >= 12;
const SESSION_DAYS = 365;
const COOKIE = 'hq_session';
const KINDS = new Set(['tasks', 'weeks', 'routine']);
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const MAX_BODY = 64 * 1024;

let store;
if (process.env.DATABASE_URL) {
  store = await PgStore.connect(process.env.DATABASE_URL);
} else if (process.env.MEMORY_STORE === '1') {
  console.warn('MEMORY_STORE=1: data is kept in memory only and is lost on restart.');
  store = new MemoryStore();
} else {
  console.error('DATABASE_URL is not set. Refusing to start without a database.');
  process.exit(1);
}
await store.init();

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const files = {};
for (const [route, [name, type]] of Object.entries(STATIC)) {
  files[route] = { body: await readFile(path.join(DIR, 'public', name)), type };
}

// ---- helpers ---------------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const sha256hex = (s) => sha256(s).toString('hex');

// Sessions remember which passcode they were created under.
const CODE_FP = sha256hex('hq-fp:' + ACCESS_CODE).slice(0, 16);

// Failed-attempt limiter, keyed by a string, over a fixed window.
const attempts = new Map();
function blocked(key, max) {
  const a = attempts.get(key);
  return Boolean(a && a.reset > Date.now() && a.count >= max);
}
function recordFail(key, windowMs) {
  const now = Date.now();
  let a = attempts.get(key);
  if (!a || a.reset < now) {
    a = { count: 0, reset: now + windowMs };
    attempts.set(key, a);
  }
  a.count += 1;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of attempts) if (a.reset < now) attempts.delete(k);
}, 60_000).unref();

const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https';

function securityHeaders(req) {
  const h = {
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  if (isHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000';
  return h;
}

function send(req, res, status, body, extra = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    ...securityHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}
function sessionCookie(req, value, maxAgeSec) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;
}
async function currentUser(req) {
  const token = getCookie(req, COOKIE);
  if (!CODE_OK || !token || token.length > 200) return null;
  const session = await store.getSession(sha256hex(token));
  if (!session || session.code_fp !== CODE_FP) return null;
  return { name: session.name };
}
async function startSession(req, name) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await store.createSession(sha256hex(token), name, CODE_FP, expires);
  return sessionCookie(req, token, SESSION_DAYS * 86400);
}

// Item bodies are flat objects of short strings, numbers and booleans.
function cleanData(body) {
  const keys = Object.keys(body);
  if (keys.length > 24) return null;
  const out = {};
  for (const k of keys) {
    if (!KEY_RE.test(k)) return null;
    const v = body[k];
    if (typeof v === 'string') {
      if (v.length > 4000) return null;
      out[k] = v;
    } else if (typeof v === 'number') {
      if (!Number.isFinite(v)) return null;
      out[k] = v;
    } else if (typeof v === 'boolean' || v === null) {
      out[k] = v;
    } else return null;
  }
  return out;
}

// ---- live updates ----------------------------------------------------------
let version = Date.now();
const listeners = new Set();
function broadcast() {
  version += 1;
  for (const res of listeners) res.write(`event: change\ndata: ${version}\n\n`);
}
setInterval(() => {
  for (const res of listeners) res.write(': ping\n\n');
}, 25_000).unref();

// ---- request handling ------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const method = req.method;

  if (p === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (method === 'GET' && files[p]) {
    res.writeHead(200, { ...securityHeaders(req), 'Content-Type': files[p].type, 'Cache-Control': 'no-cache' });
    return res.end(files[p].body);
  }

  if (!p.startsWith('/api/')) return send(req, res, 404, { error: 'Not found' });

  // Anything that changes data must come from our own page: a custom header
  // (which other sites cannot send) and, when present, a matching Origin.
  if (method !== 'GET') {
    const origin = req.headers.origin;
    let sameOrigin = true;
    if (origin) {
      try {
        sameOrigin = new URL(origin).host === req.headers.host;
      } catch {
        sameOrigin = false;
      }
    }
    if (!sameOrigin || req.headers['x-requested-with'] !== 'hq') {
      return send(req, res, 403, { error: 'Request not allowed' });
    }
  }

  // ---- entry: the team passcode (usually delivered by the private link) ----
  if (p === '/api/enter' && method === 'POST') {
    const b = await readJson(req);
    if (!CODE_OK) return send(req, res, 503, { error: 'The board is not set up yet (no passcode configured).' });
    // The passcode is the only secret, so wrong guesses are tightly limited for everyone.
    if (blocked('enter', 30)) {
      return send(req, res, 429, { error: 'Too many wrong attempts. Try again in an hour.' });
    }
    const code = String(b.code || '').slice(0, 300);
    const name = String(b.name || '').trim().slice(0, 30);
    if (!crypto.timingSafeEqual(sha256(code), sha256(ACCESS_CODE))) {
      recordFail('enter', 60 * 60_000);
      return send(req, res, 401, { error: 'That passcode isn’t right. Use the private link you were sent.' });
    }
    if (!name) return send(req, res, 400, { error: 'Choose who you are.' });
    const cookie = await startSession(req, name);
    return send(req, res, 200, { user: { name } }, { 'Set-Cookie': cookie });
  }

  if (p === '/api/logout' && method === 'POST') {
    const token = getCookie(req, COOKIE);
    if (token) await store.deleteSession(sha256hex(token));
    return send(req, res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // ---- everything below needs a remembered device ----
  const user = await currentUser(req);
  if (!user) return send(req, res, 401, { error: 'Open the board with your private link first.' });

  if (p === '/api/state' && method === 'GET') {
    const state = { version, me: user, tasks: [], weeks: [], routine: [] };
    for (const row of await store.listItems()) {
      if (KINDS.has(row.kind)) state[row.kind].push({ ...row.data, id: row.id });
    }
    return send(req, res, 200, state);
  }

  if (p === '/api/events' && method === 'GET') {
    if (listeners.size >= 50) return send(req, res, 503, { error: 'Too many open connections' });
    res.writeHead(200, {
      ...securityHeaders(req),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\nevent: hello\ndata: ${version}\n\n`);
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return;
  }

  const m = p.match(/^\/api\/items\/([a-z]+)(?:\/([^/]+))?$/);
  if (m && KINDS.has(m[1])) {
    const kind = m[1];
    const id = m[2];
    if (id !== undefined && !ID_RE.test(id)) return send(req, res, 400, { error: 'Bad id' });

    if (method === 'DELETE' && id) {
      await store.deleteItem(kind, id);
      broadcast();
      return send(req, res, 200, { ok: true });
    }

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const data = cleanData(await readJson(req));
      if (!data) return send(req, res, 400, { error: 'That change could not be saved (unexpected content).' });
      delete data.id;
      if (method === 'POST' && !id) {
        const newId = crypto.randomBytes(9).toString('base64url');
        await store.putItem(kind, newId, data, user.name);
        broadcast();
        return send(req, res, 201, { id: newId });
      }
      if (method === 'PUT' && id) {
        await store.putItem(kind, id, data, user.name);
        broadcast();
        return send(req, res, 200, { id });
      }
      if (method === 'PATCH' && id) {
        const found = await store.mergeItem(kind, id, data, user.name);
        if (!found) return send(req, res, 404, { error: 'That item no longer exists.' });
        broadcast();
        return send(req, res, 200, { id });
      }
    }
  }

  return send(req, res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err.status || 500;
    if (status === 500) console.error('request failed:', err);
    if (!res.headersSent) send(req, res, status, { error: status === 500 ? 'Something went wrong.' : err.message });
    else res.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HQ listening on ${PORT}. Passcode configured: ${CODE_OK}.`);
  if (!CODE_OK) console.warn('ACCESS_CODE is missing or shorter than 12 characters: nobody can open the board.');
});
