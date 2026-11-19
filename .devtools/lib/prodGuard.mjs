// Guard for QA scripts that sign up / sign in Supabase accounts (2026-11-07: qa-form-compare.mjs step 9 had created 4
// accounts + profiles rows on the PRODUCTION project). A script that creates accounts runs only against a project
// that is not the app's default one, unless that exact run was approved:
//
//   target  = process.env.VITE_SUPABASE_URL, else .env.local, else .env  (what this script will talk to)
//   prod    = the URL in the repo's .env (the app's default project) or any ref in MARTIALDEX_QA_PROD_REFS
//   allowed = target is not prod, or MARTIALDEX_QA_ALLOW_PROD="<project-ref>:<script-name>" (separate approval)
//
// To run against a test project: start Vite with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY of the test project and
// run the script with the same VITE_SUPABASE_URL. `pageSupabaseUrl(page)` confirms the page really uses that project.
// Local Supabase (`supabase start`) needs Docker, which is not installed on this Mac.
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

function envFileUrl(file) {
  try {
    const m = fs.readFileSync(path.join(APP, file), 'utf8').match(/^\s*VITE_SUPABASE_URL\s*=\s*["']?([^"'\s#]+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const refOf = (url) => {
  try {
    return new URL(url).hostname.split('.')[0];
  } catch {
    return null;
  }
};

export function supabaseTarget() {
  const url = (process.env.VITE_SUPABASE_URL || '').trim() || envFileUrl('.env.local') || envFileUrl('.env');
  const prodRefs = new Set([refOf(envFileUrl('.env')), ...(process.env.MARTIALDEX_QA_PROD_REFS || '').split(',').map((s) => s.trim())].filter(Boolean));
  const ref = url ? refOf(url) : null;
  return { url, ref, prod: !!ref && prodRefs.has(ref) };
}

/** May this script create / sign in accounts on the project it targets? */
export function accountQaAllowed(script) {
  const t = supabaseTarget();
  if (!t.url) return { allowed: false, ...t, reason: 'Supabase URL이 설정되어 있지 않습니다.' };
  if (!t.prod) return { allowed: true, ...t };
  if ((process.env.MARTIALDEX_QA_ALLOW_PROD || '').trim() === `${t.ref}:${script}`) return { allowed: true, ...t, approved: true };
  return {
    allowed: false,
    ...t,
    reason: `운영 Supabase 프로젝트(${t.ref})에 테스트 계정을 만들거나 로그인하는 단계라 차단했습니다. 테스트 프로젝트로 실행하려면 VITE_SUPABASE_URL·VITE_SUPABASE_ANON_KEY를 테스트 프로젝트 값으로 지정해 Vite와 이 스크립트를 실행하세요. 운영에서 실행하려면 별도 승인을 받은 뒤 MARTIALDEX_QA_ALLOW_PROD=${t.ref}:${script} 로 실행합니다.`,
  };
}

/** Whole-script guard: prints SKIP and exits 0 when account QA is not allowed on the target. */
export function requireAccountQaTarget(script) {
  const g = accountQaAllowed(script);
  if (!g.allowed) {
    console.log(`SKIP — ${script}: ${g.reason}`);
    process.exit(0);
  }
  if (g.approved) console.log(`WARN — ${script}: 승인된 운영 프로젝트 실행 (${g.ref})`);
  return g;
}

/** The Supabase URL the running page's client actually uses (the Vite env it was started with). */
export async function pageSupabaseUrl(page) {
  return page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase/client.ts');
    return supabase ? supabase.supabaseUrl ?? supabase.rest?.url ?? null : null;
  });
}

/** Throws when the page talks to a different project than the guard allowed (Vite started with other env). */
export async function assertPageTarget(page, guard) {
  const url = await pageSupabaseUrl(page);
  const ref = url ? refOf(url) : null;
  if (ref !== guard.ref) throw new Error(`page Supabase project (${ref}) ≠ allowed target (${guard.ref}) — restart Vite with the same VITE_SUPABASE_URL`);
  return url;
}
