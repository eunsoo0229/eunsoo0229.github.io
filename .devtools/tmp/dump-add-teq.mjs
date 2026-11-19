// Read-only: current shared library (add_teq) → data/audit/sibling-packs/add-teq-live.json. Never prints secrets.
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter((l) => /^\s*[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
let headers = { apikey: key, Authorization: `Bearer ${key}` };
if (process.env.LOGIN_EMAIL && process.env.LOGIN_PW) {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.LOGIN_EMAIL, password: process.env.LOGIN_PW }) });
  const j = await r.json();
  if (j.access_token) headers.Authorization = `Bearer ${j.access_token}`; else console.log('login failed', r.status);
}
const r = await fetch(`${url}/rest/v1/add_teq?select=id,data`, { headers });
const rows = await r.json();
console.log('status', r.status, 'rows', Array.isArray(rows) ? rows.length : JSON.stringify(rows).slice(0, 200));
if (Array.isArray(rows)) fs.writeFileSync('data/audit/sibling-packs/add-teq-live.json', JSON.stringify(rows.map((x) => x.data)));
