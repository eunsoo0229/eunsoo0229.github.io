import type { FieldOption, FieldSpec } from './catalog';
import type { MeasureMethod, Measurement, ProfileValue } from './types';

// Deterministic reading of an interview answer — works with no AI at all
// (MARTIALDEX 자체 엔진) and is the cross-check for the AI's reading.

export type Command = 'skip' | 'unknown' | 'pause' | 'finish' | null;

const SKIP = /(건너뛰|건너 뛰|패스|넘어가|스킵|다음 질문|말하기 싫|대답 안 할|답 안 할|그건 말 안|비밀)/;
const UNKNOWN = /(모르겠|몰라|잘 모르|기억 안|기억이 안|모름|생각 안 해 봤|생각해본 적 없|재 본 적 없|재본 적 없|안 재 봤|안 재봤)/;
const PAUSE = /(나중에 (계속|할게|이어)|잠깐 멈|일시 ?정지|오늘은 여기까지|여기까지 할게|그만할게|이따 (할게|계속))/;
const FINISH = /(인터뷰 (끝|종료)|이제 끝|그만 (물어|하자)|종료할게|끝낼게)/;

/** Control words — checked before any reading of the answer. */
export function commandOf(text: string): Command {
  const t = text.trim();
  if (FINISH.test(t)) return 'finish';
  if (PAUSE.test(t)) return 'pause';
  if (SKIP.test(t) && t.length <= 30) return 'skip';
  if (UNKNOWN.test(t) && t.length <= 25) return 'unknown';
  return null;
}
export const soundsUnknown = (t: string) => UNKNOWN.test(t);

const norm = (s: string) => s.normalize('NFKC').toLowerCase();

/** "사우스포 아니고 오소독스" → drop the negated part before matching. */
function dropNegated(t: string): string {
  return t.replace(/([^\s,.]+(?:\s+[^\s,.]+)?)\s*(아니고|아니라|말고|는 아니|은 아니|아니야|아님)/g, ' ');
}

/** Where each keyword of the option occurs: [start, end) spans. */
function spans(text: string, o: FieldOption): [number, number][] {
  const t = norm(text);
  const out: [number, number][] = [];
  for (const k of [o.label, ...(o.keywords ?? [])]) {
    const kk = norm(k);
    for (let i = t.indexOf(kk); i >= 0; i = t.indexOf(kk, i + 1)) out.push([i, i + kk.length]);
  }
  return out;
}

function matchedOptions(f: FieldSpec, text: string): string[] {
  const t = dropNegated(text);
  const hits = (f.options ?? []).map((o) => ({ o, s: spans(t, o) })).filter((x) => x.s.length);
  // A match that sits inside a longer match of another option belongs to that option
  // ("앞발 라운드킥" is the lead round kick, not also the plain "라운드킥").
  const inside = (a: [number, number], b: [number, number]) => b[0] <= a[0] && a[1] <= b[1] && b[1] - b[0] > a[1] - a[0];
  return hits
    .filter((h) => h.s.some((sp) => !hits.some((o) => o !== h && o.s.some((os) => inside(sp, os)))))
    .sort((a, b) => Math.min(...a.s.map((x) => x[0])) - Math.min(...b.s.map((x) => x[0])))
    .map((x) => x.o.value);
}

const KO_NUM: Record<string, number> = { 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
function numberIn(text: string): number | null {
  const m = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (m) return Number(m[1]);
  const k = text.match(/(하나|다섯|여섯|일곱|여덟|아홉|한|두|둘|세|셋|네|넷|열)\s*(번|회|일|차례)/);
  return k ? KO_NUM[k[1]] : null;
}

const YES = /^(응|어|네|예|넵|ㅇㅇ|그래|맞아|있어|있습니다|있어요|가능|할 수 있|재 봤|재봤|해 봤|해봤|찍을 수|당연)|(있어요|있어|있습니다|가능해|가능합니다|할 수 있어|돼요|되요)\s*[.!]?$/;
const NO = /^(아니|아뇨|ㄴㄴ|없어|없습니다|없어요|못|안 돼|안돼|불가)|(없어요|없어|없습니다|못 해|못해|안 돼|안돼|안 해요)\s*[.!]?$/;

export function readBoolean(text: string): boolean | null {
  const t = text.trim();
  if (NO.test(t)) return false;
  if (YES.test(t)) return true;
  return null;
}

const METHOD_WORDS: [RegExp, MeasureMethod][] = [
  [/영상|동영상|비디오|촬영/, 'video'],
  [/파트너.*미트|미트.*파트너|미트로|미트 거리/, 'partner_mitt'],
  [/바닥.*(표시|테이프)|실제로 (차|쳐)|스텝/, 'floor_marker'],
  [/파트너|친구가|코치가|관장님이|다른 사람이|도와/, 'tape_helper'],
  [/공식|대회|계체/, 'official'],
  [/벽/, 'wall_static'],
  [/줄자|혼자/, 'tape_self'],
  [/대충|대략|어림|아마|쯤|정도/, 'estimate'],
];

/** Method / date / side mentioned with a measurement — only what was said, nothing filled in. */
export function readMeasurement(f: FieldSpec, text: string, today = new Date()): Partial<Measurement> {
  const out: Partial<Measurement> = {};
  for (const [re, m] of METHOD_WORDS) {
    if (!re.test(text)) continue;
    // A body tape method only makes sense for body measures; a "wall" reach is the static method.
    if (f.measureKind === 'body' && ['floor_marker', 'partner_mitt', 'video', 'wall_static'].includes(m)) {
      out.method = m === 'wall_static' ? 'tape_self' : null;
    } else if (f.measureKind !== 'body' && ['tape_self', 'tape_helper', 'official'].includes(m)) {
      out.method = m === 'tape_helper' ? 'partner_static' : 'wall_static';
    } else out.method = m;
    if (out.method) break;
  }
  if (out.method === undefined) out.method = null;
  const d = text.match(/(20\d{2})[-./년 ]\s*(\d{1,2})[-./월 ]\s*(\d{1,2})/);
  if (d) out.measuredAt = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`;
  else if (/오늘/.test(text)) out.measuredAt = today.toISOString().slice(0, 10);
  if (/왼(쪽|발|손)/.test(text)) out.side = 'left';
  else if (/오른(쪽|발|손)/.test(text)) out.side = 'right';
  return out;
}

export interface Reading {
  value: ProfileValue | null;
  /** More than one option fits — ask which. */
  ambiguous?: string[];
  measurement?: Partial<Measurement>;
}

/** The answer as the field's value, when the words make it unambiguous. */
export function readAnswer(f: FieldSpec, text: string): Reading {
  const t = text.trim();
  switch (f.kind) {
    case 'choice': {
      const hit = [...new Set(matchedOptions(f, t))];
      if (hit.length === 1) return { value: hit[0] };
      return { value: null, ambiguous: hit.length > 1 ? hit : undefined };
    }
    case 'multi': {
      const hit = [...new Set(matchedOptions(f, t))];
      return { value: hit.length ? hit : null };
    }
    case 'boolean':
      return { value: readBoolean(t) };
    case 'number': {
      const n = numberIn(t);
      return { value: n };
    }
    case 'measurement':
      return { value: numberIn(t), measurement: readMeasurement(f, t) };
    case 'text':
      return { value: t.length >= 2 && !soundsUnknown(t) ? t : null };
  }
  return { value: null };
}
