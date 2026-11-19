// MARTIALDEX self-AI server — the same self-hosted AI the desktop app runs in its main
// process (model runner + SearXNG search + page extraction + name lookup), over HTTP
// for clients that cannot run it themselves (Android, web, another computer).
//
// What it decides and what it does not: intent routing, tools, MARTIALDEX DB answers,
// the lesson engine and fighter analysis stay in the client code (src/lib/selfAi/*),
// exactly as on desktop — the server provides the two capabilities a phone or browser
// lacks (the model and the search), with per-user access control. User data (lessons,
// records, conversations) never leaves the client.
//
// Security defaults: binds 127.0.0.1 (SELF_AI_SERVER_HOST to change — exposing it beyond
// this computer needs TLS in front and is the owner's decision); every route except
// /v1/health needs a bearer token (server/self-ai/auth.cjs); CORS only for listed origins;
// 256 KB bodies; one model generation at a time per user, a bounded queue for all users;
// search rate-limited per user; logs carry user / route / status / time, never content.
//
// Run: node server/self-ai/server.cjs
//   env: SELF_AI_SERVER_HOST (127.0.0.1) SELF_AI_SERVER_PORT (8787) SELF_AI_SERVER_TOKENS_FILE
//        SELF_AI_SERVER_ORIGINS (comma list) SELF_AI_MAX_PARALLEL (1) SELF_AI_MAX_WAITING (6)
//        SELF_AI_RUNNER (ollama | openai-compatible) SELF_AI_RUNNER_URL SELF_AI_MODEL
//        OLLAMA_HOST_URL SEARXNG_URL

const http = require('node:http');
const path = require('node:path');
const { createRunner } = require('./runners.cjs');
const { tokensFile, verifier } = require('./auth.cjs');

const MAX_BODY = 256 * 1024;
const REQUEST_ID = /^[\w-]{1,48}$/;
const crypto = require('node:crypto');
/** The runner's request id: the user's own namespace (runner ids allow [\\w-], ≤ 64). */
const runnerId = (user, requestId) => `u${crypto.createHash('sha256').update(user).digest('hex').slice(0, 10)}-${requestId}`;
const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://localhost', 'https://localhost', 'capacitor://localhost'];

/** One model generation at a time (CPU-bound); one request per user in flight; a bounded wait line. */
class ModelQueue {
  constructor(maxParallel, maxWaiting) {
    this.maxParallel = maxParallel;
    this.maxWaiting = maxWaiting;
    this.active = new Set();
    this.waiting = [];
  }
  get size() {
    return { active: this.active.size, waiting: this.waiting.length };
  }
  busyFor(user) {
    return [...this.active].some((x) => x.user === user) || this.waiting.some((x) => x.user === user);
  }
  /** → 'started' | 'queued' | 'full' | 'user_busy'; `go` runs when a slot frees. */
  enter(user, go, onPosition) {
    if (this.busyFor(user)) return 'user_busy';
    const slot = { user };
    if (this.active.size < this.maxParallel) {
      this.active.add(slot);
      go(() => this.leave(slot));
      return 'started';
    }
    if (this.waiting.length >= this.maxWaiting) return 'full';
    this.waiting.push({ user, slot, go, onPosition });
    onPosition(this.waiting.length);
    return 'queued';
  }
  leave(slot) {
    this.active.delete(slot);
    const next = this.waiting.shift();
    this.waiting.forEach((w, i) => w.onPosition(i + 1));
    if (next) {
      this.active.add(next.slot);
      next.go(() => this.leave(next.slot));
    }
  }
  drop(user) {
    const i = this.waiting.findIndex((w) => w.user === user);
    if (i >= 0) this.waiting.splice(i, 1);
  }
}

/** n requests per window per user. */
function rateLimiter(n, windowMs) {
  const hits = new Map();
  return (user) => {
    const now = Date.now();
    const list = (hits.get(user) || []).filter((t) => now - t < windowMs);
    if (list.length >= n) {
      hits.set(user, list);
      return false;
    }
    list.push(now);
    hits.set(user, list);
    return true;
  };
}

function createServer(env = process.env, deps = {}) {
  const runner = deps.runner || createRunner(env);
  const selfSearch = deps.selfSearch || require(path.join(__dirname, '../../electron/selfSearch/index.cjs'));
  const entity = deps.entity || require(path.join(__dirname, '../../electron/selfSearch/entity.cjs'));
  const verify = deps.verify || verifier(tokensFile(env));
  const origins = (env.SELF_AI_SERVER_ORIGINS ? env.SELF_AI_SERVER_ORIGINS.split(',') : DEFAULT_ORIGINS).map((s) => s.trim()).filter(Boolean);
  const queue = new ModelQueue(Math.max(1, Number(env.SELF_AI_MAX_PARALLEL) || 1), Math.max(0, Number(env.SELF_AI_MAX_WAITING ?? 6)));
  const searchAllowed = rateLimiter(Number(env.SELF_AI_SEARCH_PER_MIN) || 30, 60000);
  const owners = new Map(); // namespaced requestId → user
  const log = deps.log || ((line) => console.log(line));

  function cors(req, res) {
    const o = req.headers.origin;
    if (o && origins.includes(o)) {
      res.setHeader('access-control-allow-origin', o);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'authorization, content-type, x-session-id');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-max-age', '600');
    }
  }
  const send = (res, status, body) => {
    if (res.headersSent) return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  function readJson(req) {
    return new Promise((resolve) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          resolve({ tooLarge: true });
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve({ body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
        } catch {
          resolve({ bad: true });
        }
      });
      req.on('error', () => resolve({ bad: true }));
    });
  }

  async function handle(req, res, user) {
    const url = new URL(req.url, 'http://x');
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /v1/status') {
      const [model, search] = await Promise.all([runner.status().catch(() => ({ ok: false })), selfSearch.searxStatus().catch(() => ({ ok: false }))]);
      return send(res, 200, { ok: true, user, runner: runner.name, model: { ok: !!model.ok, running: !!model.running, model: model.model ?? null, reason: model.reason ?? null }, search: { ok: !!search.ok }, queue: queue.size });
    }
    if (req.method !== 'POST') return send(res, 404, { ok: false, code: 'NOT_FOUND' });
    const { body, tooLarge, bad } = await readJson(req);
    if (tooLarge) return send(res, 413, { ok: false, code: 'TOO_LARGE', message: '요청이 너무 큽니다.' });
    if (bad || !body || typeof body !== 'object') return send(res, 400, { ok: false, code: 'BAD_REQUEST', message: '요청 형식이 잘못되었습니다.' });

    if (url.pathname === '/v1/research/search') {
      if (!searchAllowed(user)) return send(res, 429, { ok: false, code: 'RATE_LIMITED', message: '검색 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
      try {
        return send(res, 200, await selfSearch.research(body));
      } catch {
        return send(res, 200, { ok: false, code: 'UNKNOWN', message: '자체 검색 중 알 수 없는 오류가 발생했습니다.' });
      }
    }
    if (url.pathname === '/v1/research/entity') {
      if (!searchAllowed(user)) return send(res, 429, { ok: false, code: 'RATE_LIMITED', message: '검색 요청이 너무 많습니다.' });
      try {
        return send(res, 200, await entity.resolvePerson(String(body.name || '')));
      } catch {
        return send(res, 200, { ok: false, query: String(body.name || ''), reason: '이름 확인 중 오류가 발생했습니다.' });
      }
    }
    if (url.pathname === '/v1/chat/cancel') {
      const id = runnerId(user, String(body.requestId || ''));
      // a user can cancel only their own request
      return send(res, 200, { ok: owners.get(id) === user && runner.cancel(id) });
    }
    if (url.pathname === '/v1/chat') {
      if (!REQUEST_ID.test(String(body.requestId || ''))) return send(res, 400, { ok: false, code: 'BAD_REQUEST', message: 'requestId가 필요합니다.' });
      const id = runnerId(user, body.requestId);
      // NDJSON stream: queued / started / waiting (heartbeat until the first token) / delta / result
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      const line = (o) => {
        if (!res.writableEnded) res.write(`${JSON.stringify(o)}\n`);
      };
      let closed = false;
      res.on('close', () => {
        closed = true;
        queue.drop(user);
        if (owners.has(id)) runner.cancel(id);
      });
      const state = queue.enter(
        user,
        async (done) => {
          if (closed) return done();
          owners.set(id, user);
          line({ type: 'started' });
          const t0 = Date.now();
          let first = false;
          const beat = setInterval(() => {
            if (!first) line({ type: 'waiting', seconds: Math.round((Date.now() - t0) / 1000) });
          }, 5000);
          try {
            const result = await runner.chat({ ...body, requestId: id }, (delta) => {
              first = true;
              line({ type: 'delta', delta });
            });
            line({ type: 'result', result });
          } catch {
            line({ type: 'result', result: { ok: false, code: 'UNKNOWN', message: '자체 AI 요청 중 알 수 없는 오류가 발생했습니다.' } });
          } finally {
            clearInterval(beat);
            owners.delete(id);
            done();
            res.end();
          }
        },
        (position) => line({ type: 'queued', position })
      );
      if (state === 'full' || state === 'user_busy') {
        line({ type: 'result', result: { ok: false, code: 'BUSY', message: state === 'full' ? '자체 AI 서버가 다른 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.' : '이전 질문의 답변을 아직 만드는 중입니다.' } });
        res.end();
      }
      return;
    }
    return send(res, 404, { ok: false, code: 'NOT_FOUND' });
  }

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    cors(req, res);
    let user = '-';
    res.on('finish', () => log(`${new Date().toISOString()} ${user} ${req.method} ${req.url.split('?')[0]} ${res.statusCode} ${Date.now() - t0}ms`));
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if (req.url === '/v1/health' && req.method === 'GET') return send(res, 200, { ok: true, service: 'martialdex-self-ai', runner: runner.name });
    const who = verify(req.headers.authorization);
    if (!who) return send(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '자체 AI 서버 접근 토큰이 없거나 올바르지 않습니다.' });
    user = who;
    try {
      await handle(req, res, who);
    } catch {
      send(res, 500, { ok: false, code: 'UNKNOWN', message: '서버 오류' });
    }
  });
  return { server, queue, runner };
}

module.exports = { createServer, ModelQueue, rateLimiter };

if (require.main === module) {
  const host = process.env.SELF_AI_SERVER_HOST || '127.0.0.1';
  const port = Number(process.env.SELF_AI_SERVER_PORT) || 8787;
  const { server, runner } = createServer();
  server.listen(port, host, () => {
    console.log(`MARTIALDEX self-AI server on http://${host}:${port} (runner: ${runner.name}, tokens: ${tokensFile()})`);
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) console.log('WARNING: listening beyond this computer. Put TLS (a reverse proxy) in front and keep tokens private — see docs/self-ai/SERVER.md.');
  });
  // browsers resolve "localhost" to ::1 first — the IPv6 loopback too (still this computer only)
  if (host === '127.0.0.1') http.createServer(server.listeners('request')[0]).on('error', () => {}).listen(port, '::1');
}
