// A person's review of the curation candidates (data/curated/knowledge-candidates.json).
// Approved items are copied — text, sources and the reviewer — into
// data/curated/knowledge-review.json, the only curation file the app reads; the app
// then shows an approved description / Korean name on a record that has none
// (never overwriting official text). Nothing is approved automatically.
//
//   node scripts/review-knowledge-candidates.mjs list [kind] [status]     candidates offered for review
//   node scripts/review-knowledge-candidates.mjs show <id>
//   node scripts/review-knowledge-candidates.mjs approve <id> --by <name> [--note "..."]
//   node scripts/review-knowledge-candidates.mjs reject <id> --by <name> [--note "..."]
//   node scripts/review-knowledge-candidates.mjs stats
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CAND = path.join(APP, 'data/curated/knowledge-candidates.json');
const REVIEW = path.join(APP, 'data/curated/knowledge-review.json');
const VALIDATION = path.join(APP, 'data/audit/knowledge-db/candidate-validation.json');
const LABEL = { verified: '검증 완료', multi_source: '복수 자료 확인', single_source: '단일 자료 확인', needs_review: '검토 필요', insufficient: '자료 부족', cannot_generate: '설명 생성 불가' };

const candidates = JSON.parse(fs.readFileSync(CAND, 'utf8')).candidates;
const review = fs.existsSync(REVIEW) ? JSON.parse(fs.readFileSync(REVIEW, 'utf8')) : { version: 1, about: '', decisions: [] };
review.about = 'Decisions of a person on curation candidates. Approved entries carry their own text and sources (the app reads only this file). Written by scripts/review-knowledge-candidates.mjs.';
const errors = new Set((fs.existsSync(VALIDATION) ? JSON.parse(fs.readFileSync(VALIDATION, 'utf8')).issues : []).filter((i) => i.severity === 'error').map((i) => i.id));
const [cmd, a1, a2] = process.argv.slice(2);
const flag = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const decided = (id) => review.decisions.find((d) => d.id === id);
const offerable = (c) => !errors.has(c.id) && c.status !== 'insufficient' && c.status !== 'cannot_generate';

function save() {
  fs.writeFileSync(REVIEW, JSON.stringify(review, null, 1));
}

if (cmd === 'list') {
  const rows = candidates.filter((c) => offerable(c) && !decided(c.id) && (!a1 || c.kind === a1) && (!a2 || c.status === a2));
  for (const c of rows.slice(0, 200)) console.log(`${c.id}\t${LABEL[c.status]}\t${(c.text ?? c.technique?.name ?? c.subcategory?.title ?? c.relation?.toId ?? '').slice(0, 70)}`);
  console.log(`${rows.length} offered (${rows.length > 200 ? 'first 200 shown' : 'all shown'})`);
} else if (cmd === 'show') {
  console.log(JSON.stringify(candidates.find((c) => c.id === a1) ?? null, null, 1), decided(a1) ?? '(no decision)');
} else if (cmd === 'approve' || cmd === 'reject') {
  const c = candidates.find((x) => x.id === a1);
  const by = flag('by');
  if (!c) throw new Error(`no candidate ${a1}`);
  if (!by) throw new Error('--by <reviewer> required');
  if (cmd === 'approve' && !offerable(c)) throw new Error(`${a1} cannot be approved: ${errors.has(c.id) ? 'validation error' : LABEL[c.status]}`);
  review.decisions = review.decisions.filter((d) => d.id !== a1);
  review.decisions.push({ id: c.id, decision: cmd === 'approve' ? 'approved' : 'rejected', by, at: new Date().toISOString(), note: flag('note'), ...(cmd === 'approve' ? { candidate: { ...c, status: 'verified', statusReason: `${by} 검토 승인 (원래 상태: ${LABEL[c.status]})` } } : {}) });
  save();
  console.log(`${cmd}d ${a1}`);
} else if (cmd === 'stats') {
  const by = {};
  for (const c of candidates) by[`${c.kind}/${LABEL[c.status]}`] = (by[`${c.kind}/${LABEL[c.status]}`] ?? 0) + 1;
  console.log(by, { approved: review.decisions.filter((d) => d.decision === 'approved').length, rejected: review.decisions.filter((d) => d.decision === 'rejected').length, validationErrors: errors.size });
} else {
  console.log('usage: list [kind] [status] | show <id> | approve <id> --by <name> | reject <id> --by <name> | stats');
}
