// 성장 리포트 (사양 §3-3, §3-5): the numbers come from performance.ts (code); the AI only interprets them, and every
// statement it makes must cite fact ids (F1, F2 …) that exist — anything citing nothing real is dropped in code, the
// same rule as sparringAnalysis/coachingSynthesis. With little data the report says so instead of judging. When no AI
// engine answers, a rule-based interpretation of the same facts is used and labelled as such. The AI goes through the
// app's provider (설정 > AI 엔진 — local by default, never an automatic Gemini fallback).

import { askGeminiForJson } from '../fighterStyle/geminiJson';
import type { Fact, Performance } from './performance';

export interface ReportPoint {
  text: string;
  facts: string[];
}

export interface GrowthReport {
  period: string;
  generatedAt: string;
  source: 'ai' | 'rules';
  /** Too few records for firm conclusions — the report says so and stays descriptive. */
  limited: boolean;
  activitySummary: string;
  improvements: ReportPoint[];
  needsWork: ReportPoint[];
  plateaus: ReportPoint[];
  focus: ReportPoint[];
  nextWeek: ReportPoint[];
  facts: Fact[];
  notes: string[];
}

const SYSTEM = [
  '너는 MARTIALDEX 훈련 성과 분석가다. 아래 [기록 사실] 목록만 근거로 한국어 존댓말로 쓴다.',
  '모든 항목에 근거 사실 id(F1 형식)를 facts 배열로 붙인다. 근거가 없는 내용은 쓰지 않는다.',
  '측정하지 않은 속도·파워·반응시간·체력 수치를 말하지 않는다. 기록에 없는 경기 결과나 점수를 만들지 않는다.',
  '서로 다른 평가 방식(자세 측정, 기준 영상 비교, 수업 평가)의 점수를 합치거나 비교하지 않는다.',
  '기록이 적으면 단정하지 말고 "기록이 적어 판단하기 어렵습니다"라고 쓴다.',
  '출력 JSON: {"improvements":[{"text":"","facts":["F1"]}],"needsWork":[...],"plateaus":[...],"focus":[...],"nextWeek":[...]} — 각 배열 0~3개.',
].join('\n');

type Raw = Record<'improvements' | 'needsWork' | 'plateaus' | 'focus' | 'nextWeek', { text: string; facts: string[] }[]>;
const isRaw = (v: unknown): v is Raw => !!v && typeof v === 'object' && ['improvements', 'needsWork', 'focus'].every((k) => Array.isArray((v as Record<string, unknown>)[k]));

/** Keep only points that cite real fact ids (and drop those that mention unmeasured qualities). */
export function keepCited(points: unknown, factIds: Set<string>): { kept: ReportPoint[]; dropped: number } {
  const list = Array.isArray(points) ? points : [];
  const kept: ReportPoint[] = [];
  let dropped = 0;
  for (const p of list) {
    const text = typeof p?.text === 'string' ? p.text.trim() : '';
    const facts = Array.isArray(p?.facts) ? (p.facts as unknown[]).map(String).filter((f) => factIds.has(f)) : [];
    if (!text || !facts.length || /(속도|스피드|파워|반응\s*속도|반응\s*시간|근력|심폐|체력\s*수치)/.test(text)) {
      dropped++;
      continue;
    }
    kept.push({ text: text.slice(0, 240), facts });
  }
  return { kept: kept.slice(0, 3), dropped };
}

/** The rule-based interpretation (also the fallback when no AI engine answers). */
export function rulesReport(perf: Performance, name: (id: string) => string): Omit<GrowthReport, 'period' | 'generatedAt' | 'facts'> {
  const fid = (re: RegExp) => perf.facts.filter((f) => re.test(f.text)).map((f) => f.id);
  const limited = perf.activity.sessions + perf.series.length + perf.lessonAssessments.length < 3;
  const improvements = perf.improved.slice(0, 3).map((x) => ({ text: `${name(x.techniqueId)}의 ${x.method} 점수가 ${x.from}점에서 ${x.to}점으로 올랐습니다.`, facts: fid(new RegExp(`^${x.techniqueId}: .*→`)) }));
  const needsWork = perf.repeatedlyLow.slice(0, 3).map((x) => ({ text: `${name(x.techniqueId)}은(는) ${x.method}에서 60점 미만이 ${x.count}번 나왔습니다 — 기초 동작을 다시 확인할 필요가 있습니다.`, facts: fid(new RegExp(`^${x.techniqueId}: .*60점 미만`)) }));
  const plateaus: ReportPoint[] = [];
  if (perf.notEvaluated.length) plateaus.push({ text: `연습은 했지만 평가 기록이 없는 기술이 ${perf.notEvaluated.length}개라 실력 변화를 판단할 수 없습니다.`, facts: fid(/평가 기록이 없는/) });
  if (perf.habits.stale.length) plateaus.push({ text: `${perf.habits.stale.length}개 기술은 21일 넘게 연습 기록이 없어 복습이 필요합니다.`, facts: fid(/21일 이상/) });
  const focus: ReportPoint[] = [];
  if (perf.repeatedlyLow[0]) focus.push({ text: `${name(perf.repeatedlyLow[0].techniqueId)}의 기초 동작`, facts: needsWork[0]?.facts ?? [] });
  if (perf.notEvaluated[0]) focus.push({ text: `${name(perf.notEvaluated[0])} 평가해 보기`, facts: fid(/평가 기록이 없는/) });
  const nextWeek: ReportPoint[] = [];
  if (perf.curriculum) nextWeek.push({ text: `커리큘럼 "${perf.curriculum.goal}" 현재 단계 기술 ${perf.curriculum.total - perf.curriculum.done}개 중 다음 기술 학습`, facts: fid(/^커리큘럼/) });
  if (perf.habits.stale[0]) nextWeek.push({ text: `${name(perf.habits.stale[0])} 복습`, facts: fid(/21일 이상/) });
  const a = perf.activity;
  const activitySummary = a.sessions
    ? `기간 내 ${a.sessions}회 · ${a.minutes}분 훈련했고 훈련한 날은 ${a.trainingDays}일입니다.${a.previous ? ` 직전 같은 기간은 ${a.previous.sessions}회 · ${a.previous.minutes}분이었습니다.` : ''}`
    : '이 기간에 저장된 훈련 기록이 없습니다.';
  const clean = (xs: ReportPoint[]) => xs.filter((x) => x.facts.length);
  return { source: 'rules', limited, activitySummary, improvements: clean(improvements), needsWork: clean(needsWork), plateaus: clean(plateaus), focus: clean(focus), nextWeek: clean(nextWeek), notes: limited ? ['기록이 적어(훈련·평가 합계 3건 미만) 확정적인 평가를 하지 않았습니다.'] : [] };
}

export async function generateGrowthReport(perf: Performance, name: (id: string) => string, opts: { useAi?: boolean; now?: Date } = {}): Promise<GrowthReport> {
  const base = rulesReport(perf, name);
  const head = { period: perf.range.label, generatedAt: (opts.now ?? new Date()).toISOString(), facts: perf.facts };
  if (!opts.useAi || base.limited || !perf.facts.length) return { ...head, ...base, notes: [...base.notes, ...(opts.useAi && base.limited ? ['기록이 적어 AI 해석을 요청하지 않았습니다.'] : [])] };
  const ids = new Set(perf.facts.map((f) => f.id));
  const context = perf.facts.map((f) => `${f.id}. ${f.text.replace(/\b([a-z-]+__[\w-]+)\b/g, (m) => name(m))} (근거: ${f.basis})`).join('\n');
  const r = await askGeminiForJson<Raw>({ systemInstruction: SYSTEM, contextText: `[기록 사실]\n${context}`, question: '이 기간의 성장 리포트를 JSON으로 작성해 주세요.', validate: isRaw, temperature: 0.2, maxOutputTokens: 900 });
  if (!r.ok) return { ...head, ...base, notes: [...base.notes, `AI 해석을 받지 못해 규칙 기반 해석으로 작성했습니다 (${r.message}).`] };
  const parts = (['improvements', 'needsWork', 'plateaus', 'focus', 'nextWeek'] as const).map((k) => [k, keepCited(r.data[k], ids)] as const);
  const dropped = parts.reduce((n, [, v]) => n + v.dropped, 0);
  const out = Object.fromEntries(parts.map(([k, v]) => [k, v.kept])) as Record<(typeof parts)[number][0], ReportPoint[]>;
  return {
    ...head,
    source: 'ai',
    limited: false,
    activitySummary: base.activitySummary,
    improvements: out.improvements.length ? out.improvements : base.improvements,
    needsWork: out.needsWork.length ? out.needsWork : base.needsWork,
    plateaus: out.plateaus,
    focus: out.focus.length ? out.focus : base.focus,
    nextWeek: out.nextWeek.length ? out.nextWeek : base.nextWeek,
    notes: dropped ? [`근거 기록을 인용하지 않았거나 측정하지 않은 항목을 말한 AI 문장 ${dropped}개를 뺐습니다.`] : [],
  };
}

/** The report as plain text (for saving / sharing). */
export function reportText(r: GrowthReport, title: string): string {
  const sec = (h: string, xs: ReportPoint[]) => (xs.length ? `\n■ ${h}\n${xs.map((x) => `- ${x.text} [${x.facts.join(', ')}]`).join('\n')}` : '');
  return [
    `${title}`,
    `분석 기간: ${r.period} · 작성: ${r.generatedAt.slice(0, 16).replace('T', ' ')} · ${r.source === 'ai' ? 'AI 해석 (근거 인용 확인됨)' : '규칙 기반 해석'}`,
    `\n■ 학습 활동 요약\n${r.activitySummary}`,
    sec('주요 개선 사항', r.improvements),
    sec('개선이 필요한 영역', r.needsWork),
    sec('정체·확인 필요', r.plateaus),
    sec('앞으로 집중할 영역', r.focus),
    sec('다음 주 추천 학습 목표', r.nextWeek),
    `\n■ 근거 기록\n${r.facts.map((f) => `${f.id}. ${f.text} — ${f.basis}`).join('\n')}`,
    r.notes.length ? `\n※ ${r.notes.join(' ')}` : '',
  ].join('\n');
}
