import { ALL_FIELDS, SECTIONS, SECTION_LABEL, fieldOf, formatValue, type FieldSpec } from './catalog';
import { commandOf, readAnswer, soundsUnknown } from './parse';
import { emptyInterview, liveItem, validateValue, withItem, withoutItem } from './store';
import { analyzeStyle } from './style';
import type { FighterProfile, InterviewMessage, Measurement, ProfileValue, Proposal } from './types';

// 프로필 인터뷰 엔진. The APPLICATION owns the interview: which field is asked
// next, what counts as a valid answer, what gets saved. The AI (optional) only
// words a short acknowledgement + the next question and reads a free answer
// into the field's value; its reading is validated here and anything it
// noticed about OTHER fields becomes a proposal the user must confirm.
//
// With no AI (MARTIALDEX 자체 엔진, or the AI failing / answering nonsense) the
// interview still works on the deterministic reader (parse.ts).

export type AskJson = <T>(p: { systemInstruction: string; contextText: string; question: string; validate?: (d: unknown) => d is T }) => Promise<{ ok: true; data: T } | { ok: false; code: string; message: string }>;
export interface InterviewDeps {
  /** null/undefined → rules only. */
  askJson?: AskJson | null;
}

const SECTION_ORDER = SECTIONS.map((s) => s.id);
const ORDERED = ALL_FIELDS.filter((f) => f.order !== undefined).sort((a, b) => {
  // Goals (order ≥ 50) are asked last, after every other section.
  const sa = a.section === 'training' && a.order! >= 50 ? 99 : SECTION_ORDER.indexOf(a.section);
  const sb = b.section === 'training' && b.order! >= 50 ? 99 : SECTION_ORDER.indexOf(b.section);
  return sa - sb || a.order! - b.order!;
});

const at = () => new Date().toISOString();
const msg = (role: InterviewMessage['role'], text: string, key: string | null = null): InterviewMessage => ({ role, text, at: at(), key });

/** Fields the interview would ask for this profile (gating applied), answered or not. */
export function applicableFields(p: FighterProfile): FieldSpec[] {
  return ORDERED.filter((f) => !f.when || f.when(p));
}

/** The next field to ask: applicable, never answered / marked unknown / skipped. */
export function nextField(p: FighterProfile, except: string[] = []): FieldSpec | null {
  return applicableFields(p).find((f) => !liveItem(p, f.key) && !except.includes(f.key)) ?? null;
}

export function questionFor(f: FieldSpec, p: FighterProfile): string {
  return f.ask?.(p) ?? f.question;
}

// ---------------- progress (scope of the profile — not a score)

export interface SectionProgress {
  section: string;
  label: string;
  answered: number;
  unknown: number;
  skipped: number;
  /** Applicable fields still open (skipped / unknown are NOT counted as missing). */
  open: number;
  total: number;
}
export function progress(p: FighterProfile): { sections: SectionProgress[]; answered: number; total: number } {
  const fields = applicableFields(p);
  const sections = SECTIONS.filter((s) => s.id !== 'style').map((s) => {
    const fs = fields.filter((f) => f.section === s.id);
    const items = fs.map((f) => liveItem(p, f.key));
    // Items filled outside the interview (detail editing) also count toward their section.
    const extra = Object.values(p.items).filter((it) => !it.deletedAt && it.state === 'answered' && fieldOf(it.key)?.section === s.id && !fs.some((f) => f.key === it.key) && it.key !== 'body.apeIndex').length;
    const answeredHere = items.filter((i) => i?.state === 'answered').length;
    const unknown = items.filter((i) => i?.state === 'unknown').length;
    const skipped = items.filter((i) => i?.state === 'skipped').length;
    return { section: s.id, label: s.label, answered: answeredHere + extra, unknown, skipped, open: fs.length - answeredHere - unknown - skipped, total: fs.length + extra };
  });
  return { sections, answered: sections.reduce((a, s) => a + s.answered, 0), total: sections.reduce((a, s) => a + s.total, 0) };
}

// ---------------- flow

function withInterview(p: FighterProfile, patch: Partial<FighterProfile['interview']>, messages: InterviewMessage[] = []): FighterProfile {
  return { ...p, interview: { ...p.interview, ...patch, messages: [...p.interview.messages, ...messages], updatedAt: at() } };
}

function askNext(p: FighterProfile, lead: string | null, phrased?: { key: string; text: string } | null): FighterProfile {
  const f = nextField(p);
  if (!f) return finishInterview(p, lead);
  const prevSection = p.interview.currentKey ? fieldOf(p.interview.currentKey)?.section : null;
  const sectionNote = prevSection && prevSection !== f.section ? `(${SECTION_LABEL[f.section]}) ` : '';
  const q = phrased && phrased.key === f.key ? phrased.text : questionFor(f, p);
  return withInterview(p, { status: 'active', currentKey: f.key, clarifying: false }, [msg('coach', [lead, `${sectionNote}${q}`].filter(Boolean).join(' '), f.key)]);
}

export function startInterview(p: FighterProfile): FighterProfile {
  if (p.interview.status === 'active' && p.interview.currentKey) return p;
  const base = p.interview.status === 'idle' || p.interview.status === 'finished' ? { ...p, interview: { ...emptyInterview(), startedAt: at() } } : p;
  const resumed = p.interview.status === 'paused';
  const greet = resumed
    ? '다시 이어서 할게요. 이미 답한 건 다시 묻지 않아요.'
    : '안녕하세요! 코치처럼 하나씩 물어보면서 파이터 프로필을 만들게요. 모르는 건 "모르겠어요", 답하기 싫은 건 "건너뛰기"라고 하면 돼요. 언제든 멈추면 지금까지 내용이 저장됩니다.';
  return askNext(base, greet);
}

export function pauseInterview(p: FighterProfile): FighterProfile {
  return withInterview(p, { status: 'paused' }, [msg('coach', '여기까지 저장했어요. 다음에 이어서 하면 남은 질문부터 물어볼게요.')]);
}

export function finishInterview(p: FighterProfile, lead: string | null = null): FighterProfile {
  const style = analyzeStyle(p);
  const styleNote = style.tags.length
    ? ` 답변을 바탕으로 스타일을 분석해 봤어요 — ${style.tags.filter((t) => t.role !== 'tendency').map((t) => t.label).join(', ') || style.tags[0].label}. 프로필 화면에서 맞는지 확인해 주세요. 확인 전까지는 코치가 "확인 안 된 분석"으로만 참고합니다.`
    : '';
  const out = withInterview(p, { status: 'finished', currentKey: null, clarifying: false }, [msg('coach', [lead, `인터뷰를 마쳤어요. 지금까지 답한 내용은 모두 저장됐고, 언제든 항목별로 고칠 수 있어요.${styleNote}`].filter(Boolean).join(' '))]);
  // Keep a user-confirmed analysis; otherwise offer the fresh one (unconfirmed).
  return out.style?.status === 'confirmed' ? out : { ...out, style: style.tags.length ? style : out.style };
}

/** Re-open a previous answer: the field is asked again; on a new answer related items go to review. */
export function editAnswer(p: FighterProfile, key: string): FighterProfile {
  const f = fieldOf(key);
  if (!f) return p;
  const prev = liveItem(p, key);
  const shown = prev?.state === 'answered' ? ` (지금 기록: ${formatValue(f, prev.value)})` : '';
  return withInterview(p, { status: 'active', currentKey: key, clarifying: false }, [msg('coach', `${f.label}을(를) 다시 물어볼게요${shown}. ${questionFor(f, p)}`, key)]);
}

function mark(p: FighterProfile, key: string, state: 'unknown' | 'skipped', note: string | null): FighterProfile {
  const r = withItem(p, key, { state, note }, 'interview');
  return r.ok ? r.profile : p;
}

export function skipCurrent(p: FighterProfile): FighterProfile {
  const key = p.interview.currentKey;
  if (!key) return p;
  return askNext(withInterview(mark(p, key, 'skipped', null), {}, [msg('user', '건너뛰기', key)]), '네, 그 질문은 넘어갈게요.');
}

// ---------------- answering

interface AiReading {
  value?: unknown;
  understood?: boolean;
  summary?: string | null;
  clarify?: string | null;
  measurement?: { method?: string | null; measuredAt?: string | null; side?: string | null; conditions?: string | null } | null;
  extras?: { key?: unknown; value?: unknown; evidence?: unknown }[];
  nextQuestion?: string | null;
}
const isAiReading = (d: unknown): d is AiReading => !!d && typeof d === 'object' && !Array.isArray(d);

const SYSTEM = [
  '너는 격투기 코치로서 선수와 1:1 상담을 하며 "개인 파이터 프로필"을 채우고 있다. 한 번에 질문 하나만 한다.',
  '할 일: (1) 선수의 답변을 [현재 항목]의 값으로 읽는다. (2) 짧게(한 문장) 이해한 내용을 요약한다. (3) [다음 항목] 질문을 이전 답변을 자연스럽게 이어 받아 한 문장으로 묻는다.',
  'value: [현재 항목]의 형식에 맞는 값. choice는 옵션 value 하나, multi는 옵션 value 배열, boolean은 true/false, number/measurement는 숫자, text는 선수가 한 말을 다듬지 말고 핵심만. 선수가 말하지 않은 것은 절대 채우지 않는다. 모르면 null.',
  'understood: 값을 확실히 읽었으면 true. 모호하면 false로 하고 clarify에 짧은 확인 질문 하나.',
  'measurement(측정 항목일 때만): method/measuredAt/side/conditions — 선수가 말한 것만. 말하지 않았으면 null. 측정 방법을 추측하지 않는다.',
  'extras: 선수가 이번 답변에서 [다른 항목] 중 하나에 대해 직접 말한 것만 {key, value, evidence(선수의 말 인용)}. 추론·짐작은 넣지 않는다.',
  'summary는 "…로 기록할게요" 형태의 존댓말 한 문장. nextQuestion은 존댓말 질문 한 문장(설명 없이). 실력·숙련도를 평가하거나 단정하지 않는다.',
  '출력: {"value","understood","summary","clarify","measurement","extras":[],"nextQuestion"}',
].join('\n');

function fieldBrief(f: FieldSpec): string {
  const opts = f.options ? ` 옵션: ${f.options.map((o) => `${o.value}=${o.label}`).join(', ')}` : '';
  const unit = f.unit ? ` 단위: ${f.unit}` : '';
  const mk = f.measureKind ? ` 측정 종류: ${f.measureKind}${f.limb ? `/${f.limb}` : ''}` : '';
  return `${f.key} (${f.label}) 형식: ${f.kind}${unit}${mk}${opts}`;
}

const METHODS = new Set(['tape_self', 'tape_helper', 'official', 'estimate', 'wall_static', 'partner_static', 'floor_marker', 'partner_mitt', 'video']);

export interface AnswerResult {
  profile: FighterProfile;
  /** Where the reading came from (transparency + tests). */
  readBy: 'rules' | 'ai' | 'ai+rules' | 'command' | 'unread';
}

/** One user answer → validated save (or a clarification) → the next question. Never throws; a bad AI reply can't damage the profile. */
export async function answerInterview(p0: FighterProfile, text: string, deps: InterviewDeps = {}): Promise<AnswerResult> {
  const t = text.trim();
  const key = p0.interview.currentKey;
  if (!t) return { profile: p0, readBy: 'unread' };
  if (!key || p0.interview.status !== 'active') return { profile: startInterview(p0), readBy: 'unread' };
  const f = fieldOf(key)!;
  let p = withInterview(p0, {}, [msg('user', t, key)]);

  const cmd = commandOf(t);
  if (cmd === 'pause') return { profile: pauseInterview(p), readBy: 'command' };
  if (cmd === 'finish') return { profile: finishInterview(p), readBy: 'command' };
  if (cmd === 'skip') return { profile: askNext(mark(p, key, 'skipped', null), '네, 그 질문은 넘어갈게요.'), readBy: 'command' };
  if (cmd === 'unknown') return { profile: askNext(mark(p, key, 'unknown', t), '괜찮아요, 미확인으로 남겨 둘게요.'), readBy: 'command' };

  const rules = readAnswer(f, t);
  let value: ProfileValue | null = rules.value !== null ? validateValue(f, rules.value) : null;
  let measurement: Partial<Measurement> | undefined = rules.measurement;
  let readBy: AnswerResult['readBy'] = value !== null ? 'rules' : 'unread';
  let lead: string | null = null;
  let clarify: string | null = null;
  let phrased: { key: string; text: string } | null = null;
  let extras: Proposal[] = [];

  if (deps.askJson) {
    // The question the app will ask next if this answer is saved as read by the rules.
    const candidate = value !== null ? (() => { const r = withItem(p, key, { value, measurement }, 'interview'); return r.ok ? nextField(r.profile) : null; })() : nextField(p, [key]);
    const others = applicableFields(p).filter((x) => x.key !== key && !liveItem(p, x.key)).slice(0, 40);
    const r = await deps.askJson<AiReading>({
      systemInstruction: SYSTEM,
      contextText: [
        `[현재 항목]\n${fieldBrief(f)}\n질문: ${p.interview.messages.filter((m) => m.role === 'coach').at(-1)?.text ?? questionFor(f, p)}`,
        `[다음 항목]\n${candidate ? `${fieldBrief(candidate)}\n기본 질문: ${questionFor(candidate, p)}` : '없음 (인터뷰 마무리)'}`,
        `[다른 항목]\n${others.map(fieldBrief).join('\n') || '없음'}`,
        `[최근 대화]\n${p.interview.messages.slice(-8).map((m) => `${m.role === 'coach' ? '코치' : '선수'}: ${m.text}`).join('\n')}`,
      ].join('\n\n'),
      question: `선수의 답변: "${t}"`,
      validate: isAiReading,
    }).catch(() => null);
    if (r && r.ok) {
      const a = r.data;
      // An AI reading with ANY value outside the field's options is rejected whole (not trimmed into something valid).
      const outside = f.kind === 'multi' && f.options && Array.isArray(a.value) && a.value.some((x) => !f.options!.some((o) => o.value === x));
      const aiValue = a.value !== undefined && a.value !== null && !outside ? validateValue(f, a.value) : null;
      if (f.kind === 'text' && value !== null) {
        // Free text is stored in the user's own words — the AI's tidier wording is not a different reading.
        readBy = 'ai+rules';
      } else if (aiValue !== null && a.understood !== false) {
        if (value !== null && JSON.stringify(value) !== JSON.stringify(aiValue)) {
          // The rules and the AI read it differently — ask instead of guessing.
          clarify = `제가 "${formatValue(f, aiValue)}"(으)로 이해했는데 맞나요? 아니면 "${formatValue(f, value)}"인가요?`;
          value = null;
        } else {
          readBy = value !== null ? 'ai+rules' : 'ai';
          value = aiValue;
        }
      } else if (value === null && typeof a.clarify === 'string' && a.clarify.trim()) {
        clarify = a.clarify.trim().slice(0, 200);
      }
      if (f.kind === 'measurement' && a.measurement) {
        const m = a.measurement;
        measurement = {
          ...measurement,
          // Only fill what the rules didn't catch, and only valid shapes.
          method: measurement?.method ?? (typeof m.method === 'string' && METHODS.has(m.method) ? (m.method as Measurement['method']) : null),
          measuredAt: measurement?.measuredAt ?? (typeof m.measuredAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.measuredAt) ? m.measuredAt : null),
          side: measurement?.side ?? (m.side === 'left' || m.side === 'right' ? m.side : null),
          conditions: typeof m.conditions === 'string' ? m.conditions : null,
        };
      }
      if (typeof a.summary === 'string' && a.summary.trim() && value !== null) lead = a.summary.trim().slice(0, 160);
      if (typeof a.nextQuestion === 'string' && a.nextQuestion.trim() && candidate) phrased = { key: candidate.key, text: a.nextQuestion.trim().slice(0, 220) };
      for (const x of Array.isArray(a.extras) ? a.extras : []) {
        const xf = typeof x?.key === 'string' ? fieldOf(x.key) : undefined;
        if (!xf || xf.key === key || liveItem(p, xf.key) || typeof x.evidence !== 'string' || !x.evidence.trim()) continue;
        const v = validateValue(xf, x.value);
        if (v !== null && !extras.some((e) => e.key === xf.key)) extras.push({ key: xf.key, value: v, evidence: x.evidence.trim().slice(0, 160) });
      }
    }
  }

  if (value === null) {
    if (!p.interview.clarifying) {
      const opts = f.options ? ` (${f.options.map((o) => o.label).join(' / ')})` : f.unit ? ` 숫자(${f.unit})로 알려 주세요.` : '';
      const q = clarify ?? (rules.ambiguous ? `${rules.ambiguous.map((v) => formatValue(f, v)).join('와(과) ')} 중 어느 쪽에 더 가까운가요?` : `제가 잘 이해했는지 확인할게요. ${questionFor(f, p)}${opts}`);
      return { profile: withInterview(p, { clarifying: true, pending: mergePending(p.interview.pending, extras) }, [msg('coach', q, key)]), readBy };
    }
    // Asked once already — keep the user's words, mark it 미확인 for later review, move on.
    const kept = withItem(p, key, { state: 'unknown', note: t, status: 'needs_review' }, 'interview');
    p = kept.ok ? kept.profile : p;
    return { profile: askNext(withInterview(p, { pending: mergePending(p.interview.pending, extras) }), '답변을 그대로 메모해 두고, 나중에 프로필 화면에서 정리할 수 있게 "확인 필요"로 남겨 둘게요.'), readBy };
  }

  const saved = withItem(p, key, { value, measurement, note: f.kind === 'text' ? null : t, source: f.kind === 'measurement' ? 'measured' : 'self_report' }, 'interview');
  if (!saved.ok) return { profile: withInterview(p, { clarifying: true }, [msg('coach', `${saved.message} ${questionFor(f, p)}`, key)]), readBy };
  p = withInterview(saved.profile, { pending: mergePending(saved.profile.interview.pending, extras) });
  const measureNote = f.kind === 'measurement' && !measurement?.method ? ' 측정 방법을 말하지 않아서 신뢰도는 "낮음"으로 두었어요 — 프로필 화면에서 측정 방법을 고를 수 있어요.' : '';
  lead = (lead ?? `${f.label}: "${formatValue(f, value)}"(으)로 기록할게요.`) + measureNote;
  if (extras.length) lead += ` 말씀 중에 다른 내용도 있었는데, 아래에서 기록해도 되는지 확인해 주세요.`;
  return { profile: askNext(p, lead, phrased), readBy };
}

function mergePending(cur: Proposal[], add: Proposal[]): Proposal[] {
  return [...cur.filter((c) => !add.some((a) => a.key === c.key)), ...add];
}

/** A proposal the user confirmed → saved as their own answer. */
export function acceptProposal(p: FighterProfile, key: string): FighterProfile {
  const pr = p.interview.pending.find((x) => x.key === key);
  if (!pr) return p;
  const r = withItem(p, key, { value: pr.value, note: pr.evidence, source: 'self_report', status: 'confirmed' }, 'interview');
  const out = r.ok ? r.profile : p;
  const next = { ...out, interview: { ...out.interview, pending: out.interview.pending.filter((x) => x.key !== key), updatedAt: at() } };
  // If the question being asked right now was just answered this way, move on.
  return next.interview.currentKey === key && next.interview.status === 'active' ? askNext(next, '확인했어요.') : next;
}
export function rejectProposal(p: FighterProfile, key: string): FighterProfile {
  return { ...p, interview: { ...p.interview, pending: p.interview.pending.filter((x) => x.key !== key), updatedAt: at() } };
}

/** Delete one answer from the profile (and let the interview ask it again later). */
export function forgetAnswer(p: FighterProfile, key: string): FighterProfile {
  return withoutItem(p, key, 'user');
}
