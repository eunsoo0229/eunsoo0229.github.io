// 클랜 초대 알림이 당사자에게 보이는지 — offline, fake Supabase (nothing touches the network).
// The notification row was always created server-side (0051 trigger); the app just never looked for it.
//  1. useNotificationAlerts: unread badge count, a new clan invitation announced once, re-checked
//     on screen change / return to foreground, cleared when 알림 marks everything read.
//  2. Header wiring: bell link with the badge + the invitation toast.
// Run: node .devtools/test-notification-alerts.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 240) : '')));

// ---------- fake Supabase: notifications table only ----------
const fakeClient = `
const db = (globalThis.__fakeDb = globalThis.__fakeDb || { notifications: [], queries: 0 });
function query() {
  const f = [];
  let opts = {}, order = null, limit = null, update = null;
  const q = {
    select(_c, o) { opts = o || {}; return q; },
    update(v) { update = v; return q; },
    eq(k, v) { f.push((r) => r[k] === v); return q; },
    is(k, v) { f.push((r) => (r[k] ?? null) === v); return q; },
    order(k, o) { order = [k, o && o.ascending === false ? -1 : 1]; return q; },
    limit(n) { limit = n; return q; },
    in() { return q; },
    then(res, rej) {
      db.queries++;
      let rows = db.notifications.filter((r) => f.every((fn) => fn(r)));
      if (update) { rows.forEach((r) => Object.assign(r, update)); return Promise.resolve({ data: null, error: null }).then(res, rej); }
      if (order) rows = [...rows].sort((a, b) => (a[order[0]] < b[order[0]] ? -1 : 1) * order[1]);
      if (limit != null) rows = rows.slice(0, limit);
      const out = opts.head ? { data: null, count: rows.length, error: null } : { data: rows, count: rows.length, error: null };
      return Promise.resolve(out).then(res, rej);
    },
  };
  return q;
}
export const supabase = { from: () => query() };
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-alerts-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.tsx');
fs.writeFileSync(path.join(dir, 'fakeClient.ts'), fakeClient);
fs.writeFileSync(entry, `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useNotificationAlerts } from ${JSON.stringify(path.join(APP, 'src/lib/social/useNotificationAlerts.ts'))};
import { markAllRead } from ${JSON.stringify(path.join(APP, 'src/lib/social/notificationService.ts'))};
export const state = { current: null };
function Probe({ userId, pathname }) {
  state.current = useNotificationAlerts(userId, pathname);
  return null;
}
export async function mount(el, props) {
  const root = createRoot(el);
  await act(async () => { root.render(React.createElement(Probe, props)); });
  return {
    rerender: (p) => act(async () => { root.render(React.createElement(Probe, p)); }),
    unmount: () => act(async () => root.unmount()),
  };
}
export { act, markAllRead };
`);
const fakePlugin = { name: 'fake-supabase', setup(b) { b.onResolve({ filter: /supabase\/client$/ }, () => ({ path: path.join(dir, 'fakeClient.ts') })); } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', jsx: 'automatic', nodePaths: [path.join(APP, 'node_modules')], define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, plugins: [fakePlugin] });

const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
Object.defineProperty(window, 'localStorage', { value: storage });
Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
globalThis.window = window;
globalThis.document = document;
globalThis.CustomEvent = window.CustomEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const intervals = [];
window.setInterval = (fn) => (intervals.push(fn), intervals.length);
window.clearInterval = () => {};
globalThis.__fakeDb = { notifications: [], queries: 0 };
const db = globalThis.__fakeDb;
const M = await import(pathToFileURL(out).href);
const flush = () => M.act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const ME = 'user-invitee', OTHER = 'user-other';
const note = (id, user, type, extra = {}) => ({ id, user_id: user, type, actor_id: 'user-owner', entity_type: type === 'clan_invite' ? 'clan' : null, entity_id: type === 'clan_invite' ? 'clan-1' : null, body: type === 'clan_invite' ? '강남 MMA' : '', read_at: null, created_at: extra.created_at ?? new Date().toISOString(), ...extra });

// signed out: nothing is queried
const el = document.getElementById('root');
let h = await M.mount(el, { userId: null, pathname: '/' });
check('[1] 로그아웃 상태에서는 조회 안 함', db.queries === 0 && M.state.current.unread === 0);
await h.unmount();

// signed in, nothing yet
h = await M.mount(el, { userId: ME, pathname: '/' });
await flush();
check('[1] 알림 없음 → 배지 0, 안내 없음', M.state.current.unread === 0 && M.state.current.invite === null);

// the owner invites me (0051 trigger writes this row); another user's row must not count
db.notifications.push(note('n-other', OTHER, 'clan_invite', { created_at: '2026-11-08T05:00:00Z' }));
db.notifications.push(note('n1', ME, 'clan_invite', { created_at: '2026-11-08T05:25:52Z' }));
await M.act(async () => { await intervals[0](); });
await flush();
check('[1] 30초 주기 확인으로 새 초대 감지 → 배지 1', M.state.current.unread === 1, M.state.current.unread);
check('[1] 새 클랜 초대 안내 표시 (클랜 이름 포함)', M.state.current.invite?.id === 'n1' && M.state.current.invite?.clanName === '강남 MMA' && M.state.current.invite?.clanId === 'clan-1', M.state.current.invite);

// dismissed → not announced again on the next check, badge stays
await M.act(async () => { M.state.current.dismissInvite(); });
await h.rerender({ userId: ME, pathname: '/clans' });
await flush();
check('[1] 닫은 초대는 다시 안내하지 않음 (배지는 유지)', M.state.current.invite === null && M.state.current.unread === 1);

// app restarted: the same invitation is not announced twice
await h.unmount();
h = await M.mount(el, { userId: ME, pathname: '/' });
await flush();
check('[1] 앱 재시작 후에도 같은 초대는 한 번만 안내', M.state.current.invite === null && M.state.current.unread === 1);

// a second invitation arrives while the app is in the background → announced on return
db.notifications.push(note('n2', ME, 'clan_invite', { created_at: '2026-11-08T06:00:00Z', body: '홍대 주짓수' }));
await M.act(async () => { window.dispatchEvent(new window.Event('focus')); });
await flush();
check('[1] 앱으로 돌아오면 새 초대 안내', M.state.current.invite?.id === 'n2' && M.state.current.unread === 2, { invite: M.state.current.invite, unread: M.state.current.unread });

// screen change re-checks (other notification types count in the badge)
db.notifications.push(note('n3', ME, 'follow'));
await h.rerender({ userId: ME, pathname: '/community' });
await flush();
check('[1] 화면 이동 시 다시 확인 → 배지 3', M.state.current.unread === 3, M.state.current.unread);

// opening 알림 marks all read → badge and toast clear immediately
await M.act(async () => { await M.markAllRead(ME); });
await flush();
check('[1] 알림 화면에서 모두 읽음 → 배지 0, 안내 사라짐', M.state.current.unread === 0 && M.state.current.invite === null);
check('[1] 다른 사용자의 알림은 읽음 처리 안 됨', db.notifications.find((n) => n.id === 'n-other').read_at === null);
await h.unmount();

// ---------- 2. Header wiring ----------
// the site header became the brand AppShell (2026-11 redesign) — same wiring, new markup
const header = fs.readFileSync(path.join(APP, 'src/components/brand/AppShell.tsx'), 'utf8');
check('[2] 헤더가 useNotificationAlerts 사용 (로그인 사용자만)', /useNotificationAlerts\(isConfigured && user \? user\.id : null, pathname\)/.test(header));
check('[2] 헤더에 알림 벨 + 배지', /<Link to="\/notifications" className="mx-tool mx-tool--bell".*data-testid="header-notifications">/.test(header) && header.includes('mx-tool__badge'));
check('[2] 새 초대 토스트 → 알림 화면으로', header.includes('data-testid="clan-invite-toast"') && header.includes("navigate('/notifications')"));
const css = fs.readFileSync(path.join(APP, 'src/styles/global.css'), 'utf8');
const shellCss = fs.readFileSync(path.join(APP, 'src/styles/brand/shell.css'), 'utf8');
check('[2] 배지/토스트 스타일 존재', shellCss.includes('.mx-tool__badge') && css.includes('.notif-toast'));

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
