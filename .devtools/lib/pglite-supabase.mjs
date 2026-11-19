// 테스트 전용 미니 Supabase — PGlite(메모리 Postgres)에 프로젝트의 모든 마이그레이션을 적용하고,
// supabase-js 가 쓰는 PostgREST·Auth·Storage HTTP 의 일부를 흉내 낸다. 모든 쿼리는 요청자의 JWT sub 로
// `authenticated`(또는 `anon`) 역할에서 실행되므로 실제 RLS·트리거·RPC 가 그대로 적용된다.
// 운영 DB·네트워크와 무관하다. 서명 검증은 하지 않는다(로컬 테스트 전용).
//   const s = await startPgliteSupabase({ pgliteDir, port, users: [{ id, email, password, nickname }] })
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const makeJwt = (sub, email = '') => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub, email, role: sub ? 'authenticated' : 'anon', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`;
// a service_role JWT (what an Edge Function's service client sends) runs as service_role, like PostgREST
const isServiceReq = (req) => {
  try {
    const t = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    return JSON.parse(Buffer.from(t.split('.')[1] ?? '', 'base64url').toString()).role === 'service_role';
  } catch {
    return false;
  }
};
export const makeServiceJwt = () => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`;
const subOf = (req) => {
  const h = req.headers.authorization ?? '';
  const t = h.replace(/^Bearer\s+/i, '');
  try {
    const p = JSON.parse(Buffer.from(t.split('.')[1] ?? '', 'base64url').toString());
    return p.role === 'authenticated' ? p.sub : null;
  } catch {
    return null;
  }
};
const ident = (s) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { status: 400 });
  return `"${s}"`;
};

export async function startPgliteSupabase({ pgliteDir, port = 54399, users = [], appDir, log = false }) {
  const { PGlite } = await import(pathToFileURL(path.join(pgliteDir, '@electric-sql/pglite/dist/index.js')).href);
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text) $$;
    grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant select on auth.users to authenticated;
    create publication supabase_realtime;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
    grant usage on schema storage to anon, authenticated; grant select, insert, delete on storage.objects to anon, authenticated;
  `);
  const migDir = path.join(appDir, 'supabase/migrations');
  const failed = [];
  for (const f of fs.readdirSync(migDir).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
    try {
      await db.exec(fs.readFileSync(path.join(migDir, f), 'utf8'));
    } catch (e) {
      failed.push(`${f}: ${e.message}`);
    }
  }
  await db.exec(`grant usage on schema public to service_role; grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;`);
  for (const u of users) {
    await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3) on conflict do nothing', [u.id, u.email, JSON.stringify({ nickname: u.nickname })]);
    await db.query('insert into public.profiles (user_id, nickname) values ($1, $2) on conflict do nothing', [u.id, u.nickname]);
  }

  // FK map for embedded selects
  const fks = (await db.query(`
    select tc.table_name as t, kcu.column_name as c, ccu.table_name as rt, ccu.column_name as rc
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`)).rows;
  const colTypes = new Map();
  for (const r of (await db.query(`select c.relname t, a.attname col, format_type(a.atttypid, a.atttypmod) typ from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped`)).rows) colTypes.set(`${r.t}.${r.col}`, r.typ);
  const procs = new Map((await db.query(`select p.proname, p.proretset, t.typname, t.typtype from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype where n.nspname = 'public'`)).rows.map((r) => [r.proname, r]));

  // single connection → serialize requests
  let chain = Promise.resolve();
  const exclusive = (fn) => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  };
  async function asService(fn) {
    return exclusive(async () => {
      await db.exec('begin');
      try {
        await db.query(`select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', 'service_role', true)`);
        await db.exec('set local role service_role');
        const r = await fn((q, p) => db.query(q, p));
        await db.exec('commit');
        return r;
      } catch (e) {
        await db.exec('rollback').catch(() => {});
        throw e;
      }
    });
  }
  async function asUser(sub, fn) {
    return exclusive(async () => {
      await db.exec('begin');
      try {
        await db.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`, [sub ?? '', sub ? 'authenticated' : 'anon']);
        await db.exec(`set local role ${sub ? 'authenticated' : 'anon'}`);
        const r = await fn((q, p) => db.query(q, p));
        await db.exec('commit');
        return r;
      } catch (e) {
        await db.exec('rollback').catch(() => {});
        throw e;
      }
    });
  }

  // ---- filter parsing ----
  function splitTop(s) {
    const out = [];
    let depth = 0, cur = '', quote = false;
    for (const ch of s) {
      if (ch === '"') quote = !quote;
      if (!quote && ch === '(') depth++;
      if (!quote && ch === ')') depth--;
      if (!quote && ch === ',' && depth === 0) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }
  function cond(table, col, opExpr, params) {
    let neg = false;
    let e = opExpr;
    if (e.startsWith('not.')) {
      neg = true;
      e = e.slice(4);
    }
    const dot = e.indexOf('.');
    const op = e.slice(0, dot);
    let val = e.slice(dot + 1);
    const c = ident(col);
    const typ = colTypes.get(`${table}.${col}`);
    // every value travels as text and is cast to the column's real type (PostgREST does the same)
    const p = () => {
      params.push(String(val));
      return typ ? `($${params.length}::text)::${typ}` : `$${params.length}::text`;
    };
    let sql;
    switch (op) {
      case 'eq': sql = `${c} = ${p()}`; break;
      case 'neq': sql = `${c} <> ${p()}`; break;
      case 'gt': sql = `${c} > ${p()}`; break;
      case 'gte': sql = `${c} >= ${p()}`; break;
      case 'lt': sql = `${c} < ${p()}`; break;
      case 'lte': sql = `${c} <= ${p()}`; break;
      case 'like': val = val.replace(/\*/g, '%'); sql = `${c}::text like ${p()}`; break;
      case 'ilike': val = val.replace(/\*/g, '%'); sql = `${c}::text ilike ${p()}`; break;
      case 'is': sql = `${c} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`; break;
      case 'in': {
        const items = splitTop(val.replace(/^\(|\)$/g, '')).map((x) => x.replace(/^"|"$/g, ''));
        params.push(items);
        sql = `${c}::text = any($${params.length}::text[])`;
        break;
      }
      case 'cs': sql = `${c} @> ${p()}`; break;
      case 'cd': sql = `${c} <@ ${p()}`; break;
      default: throw Object.assign(new Error(`unsupported operator ${op}`), { status: 400 });
    }
    return neg ? `not (${sql})` : sql;
  }
  function logic(table, kind, inner, params) {
    const parts = splitTop(inner.replace(/^\(|\)$/g, '')).map((x) => {
      const m = x.match(/^(and|or)\((.*)\)$/);
      if (m) return logic(table, m[1], `(${m[2]})`, params);
      const d = x.indexOf('.');
      return cond(table, x.slice(0, d), x.slice(d + 1), params);
    });
    return `(${parts.join(kind === 'or' ? ' or ' : ' and ')})`;
  }
  const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
  function whereOf(table, sp, params) {
    const w = [];
    for (const [k, v] of sp) {
      if (RESERVED.has(k)) continue;
      if (k === 'or' || k === 'and') w.push(logic(table, k, v, params));
      else w.push(cond(table, k, v, params));
    }
    return w.length ? `where ${w.join(' and ')}` : '';
  }
  function orderOf(sp) {
    const o = sp.get('order');
    if (!o) return '';
    return 'order by ' + o.split(',').map((x) => {
      const [col, ...mods] = x.split('.');
      return `${ident(col)} ${mods.includes('desc') ? 'desc' : 'asc'}${mods.includes('nullslast') ? ' nulls last' : mods.includes('nullsfirst') ? ' nulls first' : ''}`;
    }).join(', ');
  }
  function parseSelect(sel) {
    const cols = [];
    const embeds = [];
    for (const part of splitTop(sel || '*').map((x) => x.trim())) {
      const m = part.match(/^(?:(\w+):)?(\w+)(?:!\w+)?\((.*)\)$/);
      if (m) embeds.push({ alias: m[1] ?? m[2], table: m[2], select: m[3] });
      else cols.push(part);
    }
    return { cols: cols.length ? cols : embeds.length ? [] : ['*'], embeds };
  }
  async function embed(q, table, rows, embeds) {
    for (const e of embeds) {
      const sub = parseSelect(e.select);
      const many1 = fks.find((f) => f.t === table && f.rt === e.table);
      const one2many = fks.find((f) => f.t === e.table && f.rt === table);
      for (const r of rows) {
        if (many1) {
          const v = r[many1.c];
          const res = v == null ? [] : (await q(`select ${sub.cols.map((c) => (c === '*' ? '*' : ident(c))).join(', ') || '*'} from public.${ident(e.table)} where ${ident(many1.rc)} = $1`, [v])).rows;
          if (sub.embeds.length) await embed(q, e.table, res, sub.embeds);
          r[e.alias] = res[0] ?? null;
        } else if (one2many) {
          const res = (await q(`select ${sub.cols.map((c) => (c === '*' ? '*' : ident(c))).join(', ') || '*'} from public.${ident(e.table)} where ${ident(one2many.c)} = $1`, [r[one2many.rc]])).rows;
          if (sub.embeds.length) await embed(q, e.table, res, sub.embeds);
          r[e.alias] = res;
        } else r[e.alias] = null;
      }
    }
  }
  const projectCols = (sel, rows) => {
    if (sel.cols.includes('*')) return rows;
    return rows.map((r) => Object.fromEntries([...sel.cols.map((c) => [c, r[c]]), ...sel.embeds.map((e) => [e.alias, r[e.alias]])]));
  };

  async function handleRest(req, url, body) {
    const sub = subOf(req);
    const svc = isServiceReq(req);
    const asCaller = (fn) => (svc ? asService(fn) : asUser(sub, fn));
    const parts = url.pathname.replace(/^\/rest\/v1\//, '').split('/');
    const sp = url.searchParams;
    const prefer = req.headers.prefer ?? '';
    const wantObject = (req.headers.accept ?? '').includes('vnd.pgrst.object');
    if (parts[0] === 'rpc') {
      const fn = parts[1];
      const meta = procs.get(fn);
      if (!meta) throw Object.assign(new Error(`Could not find the function public.${fn} in the schema cache`), { status: 404, code: 'PGRST202' });
      const args = body && typeof body === 'object' ? body : {};
      const params = [];
      const named = Object.entries(args).map(([k, v]) => {
        params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
        return `${ident(k)} => $${params.length}`;
      });
      const call = `public.${ident(fn)}(${named.join(', ')})`;
      const rows = await asCaller(async (q) => {
        if (meta.proretset || meta.typtype === 'c') return (await q(`select * from ${call}`, params)).rows;
        return (await q(`select ${call} as r`, params)).rows;
      });
      if (meta.proretset && meta.typtype !== 'c' && meta.typname !== 'record') return rows.map((r) => Object.values(r)[0]);
      if (meta.proretset || meta.typtype === 'c') return rows;
      return rows[0]?.r ?? null;
    }
    const table = ident(parts[0]);
    const sel = parseSelect(sp.get('select'));
    const returnRep = prefer.includes('return=representation');
    let rows;
    if (req.method === 'GET' || req.method === 'HEAD') {
      const params = [];
      const sql = `select * from public.${table} ${whereOf(parts[0], sp, params)} ${orderOf(sp)} ${sp.get('limit') ? `limit ${Number(sp.get('limit'))}` : ''} ${sp.get('offset') ? `offset ${Number(sp.get('offset'))}` : ''}`;
      rows = await asCaller(async (q) => {
        const r = (await q(sql, params)).rows;
        await embed(q, parts[0], r, sel.embeds);
        return r;
      });
    } else if (req.method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const cols = [...new Set(list.flatMap((r) => Object.keys(r)))];
      const colSql = cols.map(ident).join(', ');
      let sql = `insert into public.${table} (${colSql}) select ${colSql} from json_populate_recordset(null::public.${table}, $1)`;
      if (prefer.includes('resolution=merge-duplicates')) {
        const oc = (sp.get('on_conflict') ?? '').split(',').filter(Boolean);
        const target = oc.length ? oc : (await db.query(`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = $1::regclass and i.indisprimary`, [`public.${parts[0]}`])).rows.map((r) => r.attname);
        const upd = cols.filter((c) => !target.includes(c));
        sql += ` on conflict (${target.map(ident).join(', ')}) do ${upd.length ? `update set ${upd.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}` : 'nothing'}`;
      } else if (prefer.includes('resolution=ignore-duplicates')) sql += ' on conflict do nothing';
      sql += ' returning *';
      rows = await asCaller(async (q) => {
        const r = (await q(sql, [JSON.stringify(list)])).rows;
        await embed(q, parts[0], r, sel.embeds);
        return r;
      });
    } else if (req.method === 'PATCH') {
      const cols = Object.keys(body ?? {});
      const params = [JSON.stringify(body)];
      const src = `json_populate_record(null::public.${table}, $1)`;
      const set = cols.length === 1 ? `${ident(cols[0])} = (select ${ident(cols[0])} from ${src})` : `(${cols.map(ident).join(', ')}) = (select ${cols.map(ident).join(', ')} from ${src})`;
      const sql = `update public.${table} set ${set} ${whereOf(parts[0], sp, params)} returning *`;
      rows = await asCaller((q) => q(sql, params).then((r) => r.rows));
    } else if (req.method === 'DELETE') {
      const params = [];
      rows = await asCaller((q) => q(`delete from public.${table} ${whereOf(parts[0], sp, params)} returning *`, params).then((r) => r.rows));
    } else throw Object.assign(new Error('method'), { status: 405 });
    if (req.method !== 'GET' && !returnRep && !wantObject) return { noContent: true, count: rows.length };
    const out = projectCols(sel, rows);
    if (wantObject) {
      if (out.length !== 1) throw Object.assign(new Error('JSON object requested, multiple (or no) rows returned'), { status: 406, code: 'PGRST116', details: `Results contain ${out.length} rows` });
      return out[0];
    }
    return out;
  }

  // ---- storage (in memory; insert into storage.objects as the user so the bucket policies apply) ----
  const files = new Map();
  async function handleStorage(req, url, rawBody) {
    let raw = rawBody;
    const sub = subOf(req);
    const pub = url.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (pub && req.method === 'GET') {
      const f = files.get(`${pub[1]}/${decodeURIComponent(pub[2])}`);
      return f ? { file: f } : { status: 404, json: { message: 'not found' } };
    }
    const up = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (up && req.method === 'POST') {
      const [, bucket, name] = up;
      const objName = decodeURIComponent(name);
      const b = (await db.query('select * from storage.buckets where id = $1', [bucket])).rows[0];
      if (!b) return { status: 400, json: { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' } };
      let type = req.headers['content-type'] ?? '';
      // storage-js sends File/Blob bodies as multipart/form-data: take the file part and its own content type
      const mp = type.match(/multipart\/form-data;\s*boundary=(.+)$/);
      if (mp) {
        const boundary = Buffer.from(`--${mp[1]}`);
        let start = raw.indexOf(boundary);
        while (start >= 0) {
          const next = raw.indexOf(boundary, start + boundary.length);
          if (next < 0) break;
          const part = raw.subarray(start + boundary.length + 2, next - 2);
          const headEnd = part.indexOf('\r\n\r\n');
          const head = part.subarray(0, headEnd).toString();
          if (/filename=/.test(head) || /name="file"/.test(head) || (/name=""/.test(head))) {
            type = (head.match(/content-type:\s*([^\r\n]+)/i)?.[1] ?? 'application/octet-stream').trim();
            raw = part.subarray(headEnd + 4);
            break;
          }
          start = next;
        }
      }
      if (b.file_size_limit && raw.length > Number(b.file_size_limit)) return { status: 413, json: { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' } };
      if (b.allowed_mime_types && !b.allowed_mime_types.includes(type.split(';')[0])) return { status: 415, json: { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${type} is not supported` } };
      try {
        await asUser(sub, (q) => q('insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', [bucket, objName, sub]));
      } catch (e) {
        return { status: 403, json: { statusCode: '403', error: 'Unauthorized', message: e.message } };
      }
      files.set(`${bucket}/${objName}`, { type, data: raw });
      return { json: { Key: `${bucket}/${objName}`, Id: objName } };
    }
    if (req.method === 'DELETE') return { json: [] };
    return { status: 404, json: { message: 'unsupported storage call' } };
  }

  const byEmail = new Map(users.map((u) => [u.email, u]));
  const session = (u) => ({ access_token: makeJwt(u.id, u.email), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: `rt-${u.id}`, user: userObj(u) });
  const userObj = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: { nickname: u.nickname }, created_at: '2026-01-01T00:00:00Z' });

  const stats = { requests: 0, errors: 0, byPath: new Map() };
  const server = http.createServer(async (req, res) => {
    const cors = { 'access-control-allow-origin': req.headers.origin ?? '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, `http://${req.headers.host}`);
    stats.requests++;
    const key = `${req.method} ${url.pathname.replace(/[0-9a-f-]{36}/g, ':id')}`;
    stats.byPath.set(key, (stats.byPath.get(key) ?? 0) + 1);
    const send = (status, json, extra = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...cors, ...extra });
      res.end(json === undefined ? '' : JSON.stringify(json));
    };
    try {
      if (url.pathname.startsWith('/rest/v1/')) {
        const body = raw.length ? JSON.parse(raw.toString()) : null;
        const out = await handleRest(req, url, body);
        if (out && out.noContent) return send(201, undefined, { 'content-range': `*/${out.count}` });
        return send(200, out, Array.isArray(out) ? { 'content-range': `0-${Math.max(0, out.length - 1)}/${out.length}` } : {});
      }
      if (url.pathname.startsWith('/auth/v1/')) {
        if (url.pathname === '/auth/v1/token') {
          const body = JSON.parse(raw.toString() || '{}');
          const grant = url.searchParams.get('grant_type');
          const u = grant === 'refresh_token' ? users.find((x) => `rt-${x.id}` === body.refresh_token) : byEmail.get(body.email);
          if (!u || (grant === 'password' && u.password !== body.password)) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
          return send(200, session(u));
        }
        if (url.pathname === '/auth/v1/user') {
          const sub = subOf(req);
          const u = users.find((x) => x.id === sub);
          return u ? send(200, userObj(u)) : send(401, { msg: 'invalid JWT' });
        }
        if (url.pathname === '/auth/v1/logout') return send(204, undefined);
        return send(404, { msg: 'unsupported auth call' });
      }
      if (url.pathname.startsWith('/storage/v1/')) {
        const out = await handleStorage(req, url, raw);
        if (log && (out.status ?? 200) >= 400) console.log('   [storage]', req.method, url.pathname, out.status, JSON.stringify(out.json));
        if (out.file) {
          res.writeHead(200, { 'content-type': out.file.type, ...cors });
          return res.end(out.file.data);
        }
        return send(out.status ?? 200, out.json);
      }
      if (url.pathname === '/functions/v1/payment-verify') {
        const sub = subOf(req);
        if (!sub) return send(401, { ok: false, code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' });
        const body = JSON.parse(raw.toString() || '{}');
        const out = (row) => ({ orderId: row.id, listingId: row.listing_id, itemTitle: row.item_title, itemPrice: row.item_price, shippingFee: row.shipping_fee, amount: row.amount, status: row.status, paidAt: row.paid_at ?? null });
        const fail = (status, message) => send(status, { ok: false, code: 'UNKNOWN', message });
        try {
          if (body.action === 'gear_create') {
            const sh = body.shipping ?? {};
            const row = (await asUser(sub, (q) => q('select * from public.create_gear_order($1, $2, $3, $4, $5)', [body.listingId, sh.name ?? '', sh.phone ?? '', sh.address ?? '', sh.memo ?? '']))).rows[0];
            return send(200, { ok: true, order: out(row) });
          }
          if (body.action === 'gear_confirm') {
            const row = (await asUser(sub, (q) => q('select * from public.gear_orders where id = $1', [body.orderId]))).rows[0];
            if (!row) return fail(404, '주문을 찾을 수 없습니다.');
            if (row.buyer_id !== sub) return fail(403, '본인의 주문이 아닙니다.');
            if (['paid', 'shipped', 'delivered'].includes(row.status)) return send(200, { ok: true, order: out(row) });
            // sandbox: no PG secret → the receipt is accepted as-is (real Toss approval runs only in the deployed function)
            const paid = (await asService((q) => q(`select * from public.finalize_gear_order($1, 'paid', null, $2)`, [body.orderId, body.providerReceipt ?? 'TEST_RECEIPT']))).rows[0];
            return send(200, { ok: true, order: out(paid) });
          }
          if (body.action === 'gear_fail') {
            const row = (await asUser(sub, (q) => q(`select * from public.finalize_gear_order($1, 'failed', $2, null)`, [body.orderId, body.reason ?? null]))).rows[0];
            return send(200, { ok: true, order: out(row) });
          }
          if (body.action === 'gear_refund') {
            const row = (await asUser(sub, (q) => q('select * from public.gear_orders where id = $1', [body.orderId]))).rows[0];
            if (!row) return fail(404, '주문을 찾을 수 없습니다.');
            if (row.status !== 'paid') return fail(409, '발송 전 결제 완료 상태에서만 결제를 취소할 수 있습니다.');
            const done = (await asService((q) => q(`select * from public.finalize_gear_order($1, 'refunded', $2, null)`, [body.orderId, `${row.buyer_id === sub ? '구매자' : '판매자'} 요청: ${body.reason ?? ''}`]))).rows[0];
            return send(200, { ok: true, order: out(done) });
          }
          // 수익화 (0061·0062) — the deployed function does the same DB calls; Toss approval is the sandbox receipt here
          const subOut = (row) => ({ orderId: row.id, planId: row.plan_id, cycle: row.cycle, gymId: row.gym_id ?? null, kind: row.kind, amountKrw: row.amount_krw, status: row.status, isTest: row.is_test, paidAt: row.paid_at ?? null });
          const coinOut = (row) => ({ orderId: row.id, packageId: row.package_id, coins: row.coins, bonusCoins: row.bonus_coins, amountKrw: row.amount_krw, status: row.status, isTest: row.is_test, paidAt: row.paid_at ?? null });
          if (body.action === 'sub_create') {
            const row = (await asUser(sub, (q) => q('select * from public.create_subscription_order($1, $2, $3)', [body.planId, body.cycle, body.gymId ?? null]))).rows[0];
            return send(200, { ok: true, order: subOut(row), mode: 'sandbox' });
          }
          if (body.action === 'sub_confirm') {
            const row = (await asUser(sub, (q) => q('select * from public.subscription_payments where id = $1', [body.orderId]))).rows[0];
            if (!row) return fail(404, '주문을 찾을 수 없습니다.');
            if (row.user_id !== sub) return fail(403, '본인의 주문이 아닙니다.');
            if (row.status === 'paid') return send(200, { ok: true, order: subOut(row) });
            const paid = (await asService((q) => q(`select * from public.finalize_subscription_payment($1, 'paid', $2, null, true)`, [body.orderId, body.providerReceipt ?? `TEST_${body.orderId}`]))).rows[0];
            return send(200, { ok: true, order: subOut(paid) });
          }
          if (body.action === 'sub_fail') {
            const row = (await asUser(sub, (q) => q(`select * from public.finalize_subscription_payment($1, 'failed', null, $2)`, [body.orderId, body.reason ?? null]))).rows[0];
            return send(200, { ok: true, order: subOut(row) });
          }
          if (body.action === 'coin_create') {
            const row = (await asUser(sub, (q) => q('select * from public.create_coin_order($1)', [body.packageId]))).rows[0];
            return send(200, { ok: true, order: coinOut(row), mode: 'sandbox' });
          }
          if (body.action === 'coin_confirm') {
            const row = (await asUser(sub, (q) => q('select * from public.coin_orders where id = $1', [body.orderId]))).rows[0];
            if (!row) return fail(404, '주문을 찾을 수 없습니다.');
            if (row.user_id !== sub) return fail(403, '본인의 주문이 아닙니다.');
            if (row.status === 'paid') return send(200, { ok: true, order: coinOut(row) });
            const paid = (await asService((q) => q(`select * from public.finalize_coin_order($1, 'paid', $2, null, true)`, [body.orderId, body.providerReceipt ?? `TEST_${body.orderId}`]))).rows[0];
            return send(200, { ok: true, order: coinOut(paid) });
          }
          if (body.action === 'coin_fail') {
            const row = (await asUser(sub, (q) => q(`select * from public.finalize_coin_order($1, 'failed', null, $2)`, [body.orderId, body.reason ?? null]))).rows[0];
            return send(200, { ok: true, order: coinOut(row) });
          }
          if (body.action === 'coin_refund') {
            const ok = (await asUser(sub, (q) => q('select public.coin_order_refundable($1) r', [body.orderId]))).rows[0]?.r;
            if (!ok) return fail(409, '환불할 수 없는 코인 주문입니다. (결제 후 7일 이내, 지급된 코인을 사용하지 않은 경우만)');
            const done = (await asService((q) => q(`select * from public.finalize_coin_order($1, 'refunded', null, $2)`, [body.orderId, body.reason ?? '사용자 환불']))).rows[0];
            return send(200, { ok: true, order: coinOut(done) });
          }
          return fail(400, '알 수 없는 요청입니다.');
        } catch (e) {
          if (log) console.log('   [payment-verify]', body.action, e.message);
          return fail(400, e.message);
        }
      }
      if (url.pathname.startsWith('/functions/v1/')) return send(503, { error: 'edge functions are not available in the local test backend' });
      return send(404, { message: 'not found' });
    } catch (e) {
      stats.errors++;
      if (log) console.log('   [db]', key, e.message);
      const code = e.code ?? (/row-level security/.test(e.message) ? '42501' : 'P0001');
      return send(e.status ?? (code === '42501' ? 403 : 400), { message: e.message, code, details: e.details ?? null, hint: null });
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://localhost:${port}`,
    db,
    failedMigrations: failed,
    stats,
    session,
    sql: (q, p) => exclusive(() => db.query(q, p)),
    asUser,
    close: () => new Promise((r) => server.close(r)),
  };
}
