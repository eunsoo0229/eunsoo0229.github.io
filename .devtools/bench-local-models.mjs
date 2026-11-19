// Compares local Ollama models on this machine for the MARTIALDEX 자체 AI.
// Real local inference, no mocks. Requires `ollama serve` on 127.0.0.1:11434.
// Run: node .devtools/bench-local-models.mjs [outJson]   (MODELS=a,b to pick models)
import { writeFileSync } from 'node:fs';

const HOST = process.env.OLLAMA_HOST_URL || 'http://127.0.0.1:11434';
// REPEAT_PENALTY=1.1 = the app's setting (electron/selfAi.cjs); unset = Ollama default
const REPEAT_PENALTY = Number(process.env.REPEAT_PENALTY) || 0;
const MODELS = (process.env.MODELS || 'qwen2.5:3b,exaone3.5:2.4b,gemma3:4b,qwen3:4b,qwen2.5:1.5b,gemma2:2b,llama3.2:1b').split(',');
const SYSTEM = '너는 MARTIALDEX의 격투기 코치다. 한국어 존댓말로 간결하고 정확하게 답한다. 모르면 모른다고 말한다.';

const SOURCE = `Source: boxing coaching article (example.com/jab).
The jab is the most important punch in boxing. Coaches teach the double jab to close distance,
the jab to the body to lower the opponent's guard, and the jab-cross (1-2) as the basic combination.
A common setup is to feint the jab, then throw a lead hook when the opponent raises the rear hand to parry.`;

// kind: fact = any keyword must appear; count = numbered list item count; json = parse + quotes in SOURCE;
// refuse = must say data is missing; recall = multi-turn memory
const TASKS = [
  { id: 'ko-explain', kind: 'korean', q: '복싱에서 잽을 칠 때 초보자가 자주 하는 실수를 설명해 주세요.' },
  { id: 'fact-kimura', kind: 'fact', q: '주짓수의 기무라는 주로 상대의 어느 관절을 공격하나요? 한 문장으로 답하세요.', any: ['어깨', 'shoulder'] },
  { id: 'fact-teep', kind: 'fact', q: '무에타이의 팁(teep)은 어떤 종류의 기술인가요? 한 문장으로 답하세요.', any: ['밀어', '푸시', 'push', '앞차기', '프론트 킥', '프런트 킥', '발바닥'] },
  { id: 'fact-triangle', kind: 'fact', q: '트라이앵글 초크에서 다리로 감싸는 것은 상대의 무엇과 무엇인가요? 한 문장으로.', any: ['목과 팔', '팔과 목', '머리와 팔', '팔과 머리', '목과 한쪽 팔', '목과 한 팔'] },
  { id: 'fact-double-leg', kind: 'fact', q: '레슬링 더블렉 테이크다운 전에 하는 레벨 체인지는 무엇을 뜻하나요? 한 문장으로.', any: ['낮추', '낮게', '무릎을 굽', '자세를 낮'] },
  { id: 'reason-setup', kind: 'fact', q: '상대가 제 잽을 막을 때마다 오른손을 앞으로 뻗어 패리합니다. 이 습관을 이용할 수 있는 왼손 공격 하나와 이유를 두 문장으로 말해 주세요.', any: ['훅', 'hook'] },
  { id: 'instr-3items', kind: 'count', q: '잽 훈련 팁을 정확히 3개, "1." "2." "3." 번호 목록으로만 쓰세요. 다른 문장은 쓰지 마세요.', n: 3 },
  { id: 'json-extract', kind: 'json', q: `다음 자료에서 언급된 셋업과 콤보를 JSON으로 추출하세요. 형식: {"items":[{"name":"...","kind":"setup|combo|technique","quote":"자료 원문 그대로의 짧은 인용(영어)"}]}. 자료에 없는 것은 넣지 마세요.\n\n${SOURCE}` },
  // round 3 (2026-11-01): citation accuracy and sentence repetition
  { id: 'cite-two-sources', kind: 'cite', q: `아래 두 자료만 근거로, 셋업 두 가지를 각각 한 문장으로 설명하세요. 각 문장 끝에 근거 자료 번호 [1] 또는 [2]를 붙이세요.\n\n[1] The jab to the body lowers the opponent's guard, which opens the lead hook to the head.\n[2] Feinting the cross makes the opponent raise the rear hand, opening the body for a liver shot.` },
  { id: 'repeat-combos', kind: 'repeat', q: '잽으로 시작하는 복싱 콤비네이션 다섯 가지를 각각 설명해 주세요.' },
  { id: 'refuse-missing', kind: 'refuse', q: `아래 자료만 근거로 답하세요. 자료에 없으면 "자료 없음"이라고만 답하세요.\n\n${SOURCE}\n\n질문: 이 자료에 따르면 잽은 누가 처음 만들었나요?` },
];

const MEMORY_TURNS = [
  '제 이름은 민준이고 체급은 라이트급, 오소독스입니다. 기억해 주세요.',
  '오늘은 원투를 연습했어요. 짧게 칭찬해 주세요.',
  '훅을 칠 때 팔꿈치 높이는 어느 정도가 좋나요? 한 문장으로.',
  '어퍼컷은 언제 쓰나요? 한 문장으로.',
  '피곤할 때 가드가 내려가요. 한 문장 조언 부탁해요.',
  '제 이름, 체급, 스탠스를 한 줄로 말해 주세요.',
];

async function chat(model, messages, { json = false, num_predict = 300 } = {}) {
  const body = { model, messages, stream: false, keep_alive: '2m', think: false,
    options: { temperature: 0.2, num_ctx: 4096, num_predict, ...(REPEAT_PENALTY ? { repeat_penalty: REPEAT_PENALTY, repeat_last_n: 256 } : {}) } };
  if (json) body.format = 'json';
  const t = Date.now();
  let r = await fetch(`${HOST}/api/chat`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(600000) });
  let j = await r.json();
  if (j.error && /think/i.test(j.error)) { // models without a thinking switch
    delete body.think;
    r = await fetch(`${HOST}/api/chat`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(600000) });
    j = await r.json();
  }
  if (j.error) throw new Error(j.error);
  return { text: (j.message?.content || '').trim(), ms: Date.now() - t, evalCount: j.eval_count || 0,
    evalNs: j.eval_duration || 1, promptNs: j.prompt_eval_duration || 0, loadNs: j.load_duration || 0 };
}

const hangulRatio = (s) => { const h = (s.match(/[가-힣]/g) || []).length; const l = (s.match(/[A-Za-z가-힣]/g) || []).length; return l ? h / l : 0; };
const foreign = (s) => /[一-鿿぀-ヿЀ-ӿ]/.test(s); // CJK ideographs, kana, cyrillic leaking in

function grade(task, text) {
  switch (task.kind) {
    case 'korean': return { pass: hangulRatio(text) > 0.85 && !foreign(text) && text.length > 60, note: `hangul ${hangulRatio(text).toFixed(2)}${foreign(text) ? ' FOREIGN' : ''}` };
    case 'fact': return { pass: task.any.some((k) => text.toLowerCase().includes(k.toLowerCase())) && !foreign(text), note: '' };
    case 'count': { const n = (text.match(/^\s*\d+\./gm) || []).length; return { pass: n === task.n, note: `items ${n}` }; }
    case 'json': {
      try {
        const o = JSON.parse(text); const items = Array.isArray(o.items) ? o.items : [];
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        const src = norm(SOURCE);
        const grounded = items.filter((i) => norm(i.quote).length > 8 && src.includes(norm(i.quote))).length;
        return { pass: items.length >= 2 && grounded === items.length, note: `items ${items.length} grounded ${grounded}` };
      } catch { return { pass: false, note: 'PARSE_ERROR' }; }
    }
    case 'cite': {
      // each sentence about the body jab must cite [1], the feint/liver one [2]; no other numbers
      const sents = text.split(/(?<=[.!?。])\s+|\n+/).map((x) => x.trim()).filter((x) => /[가-힣A-Za-z]/.test(x) && x.length > 8);
      const cited = sents.filter((x) => /\[[12]\]/.test(x));
      const wrong = sents.filter((x) => (/(바디|몸통|body).*(훅|hook)|(훅|hook).*(바디|몸통|body)/i.test(x) && /\[2\]/.test(x) && !/\[1\]/.test(x)) || (/(페인트|feint|간|liver)/i.test(x) && /\[1\]/.test(x) && !/\[2\]/.test(x)));
      const bogus = /\[[3-9]\]/.test(text);
      return { pass: cited.length >= 2 && !wrong.length && !bogus, note: `sentences ${sents.length} cited ${cited.length} wrong ${wrong.length}${bogus ? ' BOGUS' : ''}` };
    }
    case 'repeat': {
      // near-identical sentences (content-word overlap ≥ 0.8) count as repeats
      const sents = text.split(/(?<=[.!?。])\s+|\n+/).map((x) => x.replace(/^[\s\d.\-*]+/, '').trim()).filter((x) => x.length > 12);
      const words = (x) => [...new Set(x.toLowerCase().match(/[가-힣]{2,}|[a-z]{3,}/g) || [])];
      let repeats = 0;
      sents.forEach((x, i) => { const a = words(x); if (sents.slice(0, i).some((y) => { const b = words(y); const inter = a.filter((w) => b.includes(w)).length; return a.length && b.length && inter / Math.max(a.length, b.length) >= 0.8; })) repeats++; });
      return { pass: repeats === 0 && !foreign(text), note: `sentences ${sents.length} repeats ${repeats}${foreign(text) ? ' FOREIGN' : ''}` };
    }
    case 'refuse': return { pass: /자료 ?없음|자료에 없|나와 있지 않|언급되지 않/.test(text) && !/(만들었습니다|창시)/.test(text.replace(/자료.*없.*/, '')), note: '' };
    default: return { pass: false, note: 'unknown' };
  }
}

async function psSize(model) {
  try { const j = await (await fetch(`${HOST}/api/ps`)).json(); const m = (j.models || []).find((x) => x.name === model || x.model === model); return m ? m.size : 0; } catch { return 0; }
}

const report = [];
for (const model of MODELS) {
  const row = { model, tasks: [], pass: 0, total: 0, tokPerSec: 0, loadMs: 0, memMB: 0, error: null };
  try {
    const warm = await chat(model, [{ role: 'user', content: '안녕하세요' }], { num_predict: 8 });
    row.loadMs = Math.round(warm.loadNs / 1e6);
    row.memMB = Math.round((await psSize(model)) / 1048576);
    let toks = 0, ns = 0;
    for (const task of TASKS) {
      const r = await chat(model, [{ role: 'system', content: SYSTEM }, { role: 'user', content: task.q }], { json: task.kind === 'json', num_predict: task.kind === 'korean' || task.kind === 'repeat' ? 500 : 300 });
      toks += r.evalCount; ns += r.evalNs;
      const g = grade(task, r.text);
      row.tasks.push({ id: task.id, pass: g.pass, note: g.note, ms: r.ms, text: r.text.slice(0, 600) });
      row.total++; if (g.pass) row.pass++;
      console.log(`  ${model} ${task.id.padEnd(16)} ${g.pass ? 'PASS' : 'FAIL'} ${String(r.ms).padStart(6)}ms ${g.note}`);
    }
    // multi-turn memory
    const msgs = [{ role: 'system', content: SYSTEM }];
    let last = '';
    for (const turn of MEMORY_TURNS) {
      msgs.push({ role: 'user', content: turn });
      const r = await chat(model, msgs, { num_predict: 120 });
      toks += r.evalCount; ns += r.evalNs;
      msgs.push({ role: 'assistant', content: r.text }); last = r.text;
    }
    const mem = /민준/.test(last) && /라이트/.test(last) && /오소독스/.test(last);
    row.tasks.push({ id: 'memory-6turn', pass: mem, note: '', text: last.slice(0, 300) });
    row.total++; if (mem) row.pass++;
    console.log(`  ${model} memory-6turn     ${mem ? 'PASS' : 'FAIL'}`);
    row.tokPerSec = +(toks / (ns / 1e9)).toFixed(1);
  } catch (e) { row.error = String(e.message || e); }
  report.push(row);
  console.log(`== ${model}: ${row.pass}/${row.total} pass, ${row.tokPerSec} tok/s, load ${row.loadMs}ms, mem ${row.memMB}MB ${row.error || ''}`);
  await fetch(`${HOST}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => {});
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ at: new Date().toISOString(), host: 'Intel i5-7600K 4C, 8GB RAM, CPU only', repeatPenalty: REPEAT_PENALTY || 'ollama default', report }, null, 2));
