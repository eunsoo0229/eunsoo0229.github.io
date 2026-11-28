import { askGeminiForJson } from '../fighterStyle/geminiJson';
import { hasMotion3d } from '../motion3d/catalog';
import { BEHAVIOR_LABEL, GOAL_LABEL, MMA_ARTS, RANGE_LABEL } from './lexicon';
import { indexedById } from './techniqueIndex';
import type { Analysis, Behavior, FinderResult, Goal, Range, Recommendation, StepRef } from './types';

// The optional AI step (사용자가 "AI 정밀 분석"을 켰을 때만). It goes through the app's one AI path —
// askGeminiForJson → aiProvider, which uses the engine chosen in 설정 > AI 엔진 (the local engine by default; Gemini only
// when the user picked it; never an automatic switch). Two calls at most per search:
//  1. refine the analysis: the model may only pick values from the fixed lists below, and only fills fields the rule
//     reading left empty — what the user's words already said is never overwritten;
//  2. propose ONE combination from the technique ids already recommended — every id is checked against the DB; the card
//     is labelled AI GENERATED COMBINATION.
// When the model fails or is not set up, the result says so plainly and the DB results stand on their own.

const GOALS = Object.keys(GOAL_LABEL) as Goal[];
const BEHAVIORS = Object.keys(BEHAVIOR_LABEL) as Behavior[];
const RANGES = Object.keys(RANGE_LABEL) as Range[];
const TIMEOUT_MS = 40000;

function withTimeout<T>(p: Promise<T>): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), TIMEOUT_MS))]);
}

interface AiFields {
  goals: string[];
  behaviors: string[];
  range: string | null;
}
const isFields = (d: unknown): d is AiFields => !!d && typeof d === 'object' && Array.isArray((d as AiFields).goals) && Array.isArray((d as AiFields).behaviors);

export async function refineAnalysis(a: Analysis): Promise<Analysis> {
  const out = await withTimeout(
    askGeminiForJson<AiFields>({
      systemInstruction: [
        '격투기 훈련 앱의 입력 분석기다. 사용자의 문장에서 목적, 상대 행동, 거리를 아래 목록의 값으로만 고른다.',
        `goals 후보: ${GOALS.join(', ')}`,
        `behaviors 후보: ${BEHAVIORS.join(', ')}`,
        `range 후보: ${RANGES.join(', ')} 또는 null`,
        '문장에 근거가 없으면 비워 둔다. 추측으로 채우지 않는다.',
        '출력: {"goals": string[], "behaviors": string[], "range": string|null}',
      ].join('\n'),
      contextText: '',
      question: a.text,
      validate: isFields,
      temperature: 0,
      maxOutputTokens: 200,
    }),
  );
  if (out === 'timeout') return { ...a, ai: { used: true, ok: false, message: `AI 분석이 ${TIMEOUT_MS / 1000}초 안에 끝나지 않아 규칙 분석만 사용했습니다.` } };
  if (!out.ok) return { ...a, ai: { used: true, ok: false, message: `AI 분석을 하지 못했습니다 (${out.message}). 규칙 분석만 사용했습니다.` } };
  const goals = [...a.goals];
  const behaviors = [...a.behaviors];
  let range = a.range;
  const added: string[] = [];
  if (!goals.length)
    for (const g of out.data.goals.filter((x): x is Goal => GOALS.includes(x as Goal))) {
      goals.push({ value: g, evidence: ['AI 분석'], source: 'ai' });
      added.push(GOAL_LABEL[g]);
    }
  if (!behaviors.length)
    for (const b of out.data.behaviors.filter((x): x is Behavior => BEHAVIORS.includes(x as Behavior))) {
      behaviors.push({ value: b, evidence: ['AI 분석'], source: 'ai' });
      added.push(BEHAVIOR_LABEL[b]);
    }
  if (!range && out.data.range && RANGES.includes(out.data.range as Range)) {
    range = { value: out.data.range as Range, evidence: ['AI 분석'], source: 'ai' };
    added.push(RANGE_LABEL[range.value]);
  }
  const summary = [...a.summary];
  if (added.length) summary.push({ label: 'AI가 보탠 조건', value: added.join(' · ') });
  return { ...a, goals, behaviors, range, summary, ai: { used: true, ok: true, message: added.length ? null : 'AI 분석 결과가 규칙 분석과 같아 바뀐 조건이 없습니다.' } };
}

interface AiCombo {
  name: string;
  steps: { techniqueId: string; role: string }[];
  why: string;
}
const isCombo = (d: unknown): d is AiCombo => !!d && typeof d === 'object' && Array.isArray((d as AiCombo).steps) && typeof (d as AiCombo).why === 'string';

export async function aiCombination(result: FinderResult): Promise<Recommendation | null> {
  const candidates = [...result.techniques, ...result.alternatives].filter((r) => r.techniqueId).slice(0, 10);
  if (candidates.length < 2) return null;
  const out = await withTimeout(
    askGeminiForJson<AiCombo>({
      systemInstruction: [
        '격투기 코치다. 아래 후보 기술(techniqueId)만 사용해 사용자의 목적에 맞는 2~4개 기술 조합 하나를 만든다.',
        '후보에 없는 기술은 쓰지 않는다. 같은 종목 안에서, 실제 경기 규칙에서 이어 쓸 수 있는 순서로 만든다.',
        '부상을 목적으로 하는 내용은 쓰지 않는다. 성공률이나 확률은 쓰지 않는다.',
        '출력: {"name": string, "steps": [{"techniqueId": string, "role": string}], "why": string}',
      ].join('\n'),
      contextText: candidates.map((c) => `- ${c.techniqueId}: ${c.title} (${c.artLabel})`).join('\n'),
      question: `목적: ${result.query}`,
      validate: isCombo,
      temperature: 0.2,
      maxOutputTokens: 400,
    }),
  );
  if (out === 'timeout' || !out.ok) return null;
  const allowed = new Set(candidates.map((c) => c.techniqueId));
  const steps: StepRef[] = [];
  for (const s of out.data.steps.slice(0, 4)) {
    const it = allowed.has(s.techniqueId) ? indexedById(s.techniqueId) : undefined;
    // a step outside the candidates is kept visibly as "DB 미확인" rather than silently turned into a real record
    steps.push(it ? { name: it.t.name, techniqueId: it.t.id, martialArt: it.t.martialArt, inDb: true, role: String(s.role || '').slice(0, 40) || null, note: null, react: null } : { name: s.techniqueId, techniqueId: null, martialArt: null, inDb: false, role: String(s.role || '').slice(0, 40) || null, note: null, react: null });
  }
  if (steps.filter((s) => s.inDb).length < 2) return null;
  const arts = [...new Set(steps.map((s) => s.martialArt).filter(Boolean))] as string[];
  const artOk = arts.length <= 1 || arts.every((x) => MMA_ARTS.includes(x));
  return {
    key: `ai:${steps.map((s) => s.techniqueId ?? s.name).join('>')}`,
    kind: 'combo',
    techniqueId: null,
    title: out.data.name?.slice(0, 60) || steps.map((s) => s.name).join(' → '),
    martialArt: arts[0] ?? '',
    artLabel: candidates.find((c) => c.martialArt === arts[0])?.artLabel ?? '',
    steps,
    reasons: [out.data.why.slice(0, 300), ...(artOk ? [] : ['주의: 서로 다른 종목의 기술이 섞여 있어 한 경기 규칙에서 모두 쓸 수 없을 수 있습니다.'])],
    situations: [],
    difficulty: null,
    score: 0,
    scoreParts: [],
    origin: 'ai-generated',
    originLabel: 'AI GENERATED COMBINATION — 구성 기술만 DB 확인, 조합 자체는 AI 제안',
    sourceLinks: [],
    purpose: null,
    expectedReaction: null,
    followUps: [],
    successConditions: [],
    ifDifferent: [],
    hasMotion3d: steps.some((s) => s.techniqueId && hasMotion3d(s.techniqueId)),
    mastery: null,
  };
}
