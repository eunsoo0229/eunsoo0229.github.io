import { askGeminiForJsonWithGrounding } from '../userTechniques/geminiJson';
import type { SearchResult } from '../webSearch/types';
import type { Difficulty, PostureInfo } from '../../types';
import type { TechniqueCategory } from './types';

// Every Gemini call in this file is deliberately useSearchGrounding:false —
// real Tavily content is already in hand (see service.ts's callers), so
// grounding here would just add a billing-gated call for no benefit, same
// reasoning as aiCurriculum/techniqueResearch.ts's extraction calls. This
// file NEVER asks Gemini to "search" or "recall from memory" — only to
// extract/judge from the real content it's handed, and every validator
// below requires real evidence (sourceUrls + a non-empty snippet) to even
// type-check, matching techniqueResearch.ts's isWebSearchResearchArray
// pattern.

const RETRYABLE_CODES = new Set(['EMPTY_RESPONSE', 'PARSE_ERROR', 'UNKNOWN']);

function buildSourcesBlock(sources: SearchResult[]): string {
  return sources
    .map((r, i) => `[${i + 1}] title: ${r.title}\nurl: ${r.url}\ncontent: ${(r.content ?? r.snippet ?? '(내용 없음)').slice(0, 1500)}`)
    .join('\n\n');
}

// ===== Shared candidate validation =====

interface RawPosture {
  overview: string;
  startingPosition?: string;
  bodyPosition?: { head?: string; upperBody?: string; arms?: string; hips?: string; legs?: string; feet?: string; weightDistribution?: string; distance?: string };
  steps?: string[];
  keyPoints?: string[];
  commonMistakes?: string[];
}

const VALID_CATEGORIES = new Set<TechniqueCategory>(['strike', 'kick', 'defense', 'evasion', 'takedown', 'clinch', 'grip', 'other']);
const VALID_DIFFICULTIES = new Set(['beginner', 'intermediate', 'advanced']);

function isRawPosture(v: unknown): v is RawPosture {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.overview === 'string' && o.overview.trim().length > 0;
}

// ===== Single requested-technique verification (Part B "없는 기술 요청") =====

interface RawRequestedTechniqueCandidate {
  name: string;
  nameKo: string | null;
  category: string;
  description: string;
  evidenceIndexes: number[];
  confidence: number;
  posture: RawPosture | null;
  difficulty: string | null;
}

interface RawRequestedTechniqueVerification {
  verdict: string;
  likelyMartialArt: string | null;
  candidates: RawRequestedTechniqueCandidate[];
  reason: string;
}

const VALID_REQUEST_VERDICTS = new Set(['confirmed', 'wrong_martial_art', 'not_a_technique', 'insufficient_evidence']);

function isRawRequestedTechniqueCandidate(v: unknown): v is RawRequestedTechniqueCandidate {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    o.name.trim().length > 0 &&
    (o.nameKo === null || typeof o.nameKo === 'string') &&
    typeof o.category === 'string' &&
    typeof o.description === 'string' &&
    Array.isArray(o.evidenceIndexes) &&
    o.evidenceIndexes.length > 0 &&
    o.evidenceIndexes.every((i) => typeof i === 'number') &&
    typeof o.confidence === 'number' &&
    (o.posture === null || o.posture === undefined || isRawPosture(o.posture)) &&
    (o.difficulty === null || o.difficulty === undefined || typeof o.difficulty === 'string')
  );
}

function isRawRequestedTechniqueVerification(v: unknown): v is RawRequestedTechniqueVerification {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.verdict === 'string' &&
    (o.likelyMartialArt === null || typeof o.likelyMartialArt === 'string') &&
    Array.isArray(o.candidates) &&
    o.candidates.every(isRawRequestedTechniqueCandidate) &&
    typeof o.reason === 'string'
  );
}

export interface RequestedTechniqueVerdict {
  verdict: 'confirmed' | 'wrong_martial_art' | 'not_a_technique' | 'insufficient_evidence';
  likelyMartialArt: string | null;
  candidates: { name: string; nameKo: string | null; category: TechniqueCategory; description: string; sourceIndexes: number[]; confidence: number; posture: PostureInfo | null; difficulty: Difficulty }[];
  reason: string;
}

/**
 * Spec "MARTIALDEX — 신규 무술 미등록 기술 요청" sections 8-13/19 — judges ONE
 * user-requested technique (a specific name OR a natural-language
 * description) against a SPECIFIC target martial art, purely from real
 * Tavily evidence. Distinguishes, from the evidence itself (never Gemini's
 * own prior knowledge):
 *  - "confirmed": a real, named technique of the TARGET martial art. May
 *    return multiple `candidates` when the input was a natural-language
 *    description that matches more than one distinct real technique in the
 *    evidence (section 19) — every candidate still requires its own
 *    evidenceIndexes.
 *  - "wrong_martial_art": the evidence shows a real technique, but of a
 *    DIFFERENT martial art than the one requested (section 12) — never
 *    silently registered under the wrong art.
 *  - "not_a_technique": the input is a general exercise/rule/equipment/
 *    category name, not an actual named technique (section 13).
 *  - "insufficient_evidence": too little/unclear evidence to decide either
 *    way (section 11).
 */
export async function verifyRequestedTechniqueFromEvidence(
  martialArtNameKo: string,
  martialArtNameEn: string | null,
  requestedInput: string,
  sources: SearchResult[]
): Promise<{ ok: true; verdict: RequestedTechniqueVerdict } | { ok: false; code: string; message: string }> {
  const sourcesBlock = buildSourcesBlock(sources);
  const artLabel = martialArtNameEn ? `${martialArtNameKo} (${martialArtNameEn})` : martialArtNameKo;
  const systemInstruction = [
    `사용자가 "${artLabel}" 무술에 아직 등록되지 않은 기술을 요청했다. 요청 내용은 정확한 기술명일 수도 있고,`,
    '자연어 설명일 수도 있다. 아래 실제 웹 검색 자료만 근거로 이 요청이 실제로 존재하는, 그리고 정확히',
    `"${artLabel}"의 기술인지 엄격하게 검증한다. 당신이 이미 알고 있는 지식이 아니라 아래 자료에 실제로`,
    '나온 내용만 근거로 판단한다.',
    '',
    'verdict는 다음 중 하나:',
    `- "confirmed": 자료에서 실제로 확인되는, "${artLabel}"의 구체적이고 명명된 기술(들)임. 요청이 자연어`,
    '  설명이라 자료상 여러 개의 서로 다른 실제 기술이 그 설명에 부합할 수 있으면 candidates에 각각을 담는다',
    '  (근거 없는 후보는 절대 포함하지 않는다).',
    `- "wrong_martial_art": 자료에서 실제로 확인되는 기술이지만, "${artLabel}"이 아니라 다른 무술의 기술로`,
    '  보임. likelyMartialArt에 자료상 확인되는 실제 무술명을 적는다.',
    '- "not_a_technique": 특정 이름을 가진 기술이 아니라 일반 운동/스트레칭/체력훈련/경기 규칙/장비 이름 등으로 보임.',
    '- "insufficient_evidence": 자료만으로는 실존 여부나 소속 무술을 판단하기 어려움.',
    '',
    'candidates는 verdict가 "confirmed"일 때만 채운다(그 외에는 빈 배열). 각 후보:',
    '- name: 표준 영문/로마자 기술명',
    '- nameKo: 한국어 명칭(자료/일반적으로 알려진 표기가 있으면, 없으면 null)',
    '- category: "strike"(손기술/타격) | "kick"(발기술) | "defense"(방어) | "evasion"(회피) | "takedown"(테이크다운/던지기) | "clinch"(클린치/그립) | "grip"(잡기) | "other" 중 하나',
    '- description: 이 기술이 무엇인지 자료 내용을 바탕으로 한 한국어 1문장 설명(지어내지 않는다)',
    '- evidenceIndexes: 이 기술이 실제로 언급된 자료의 번호 배열(최소 1개)',
    '- confidence: 0-100, 제공된 자료만으로 이 기술이 실존하며 정확히 이 무술의 기술이라고 확신하는 정도',
    '- posture: 이 기술의 자세 설명. 자료에 구체적인 수행 방법이 실제로 나와 있을 때만 채우고, 자신 없으면 null(overview는 posture를 채운다면 필수, 나머지는 선택):',
    '  {"overview": string, "startingPosition"?: string, "bodyPosition"?: {"head"?,"upperBody"?,"arms"?,"hips"?,"legs"?,"feet"?,"weightDistribution"?,"distance"?: string}, "steps"?: string[], "keyPoints"?: string[], "commonMistakes"?: string[]}',
    '- difficulty: "beginner"|"intermediate"|"advanced" 중 하나(복잡도/협응력/균형/타이밍/선행기술 기준), 판단 어려우면 null',
    '',
    '절대 자료에 없는 내용으로 confirmed를 주지 않는다. 최대 5개의 candidates만 담는다.',
    'likelyMartialArt: wrong_martial_art일 때만 자료상 확인되는 무술명, 그 외에는 null.',
    'reason: 판단 이유를 한국어로 1~2문장.',
    '',
    '출력 형식: {"verdict": string, "likelyMartialArt": string|null, "candidates": [{"name": string, "nameKo": string|null, "category": string, "description": string, "evidenceIndexes": number[], "confidence": number, "posture": object|null, "difficulty": string|null}, ...], "reason": string}',
  ].join('\n');

  const question = `무술: "${artLabel}"\n요청한 기술: "${requestedInput}"\n\n=== 실제 검색 결과 자료 ===\n${sourcesBlock}`;

  async function attempt() {
    return askGeminiForJsonWithGrounding<RawRequestedTechniqueVerification>({
      systemInstruction,
      contextText: '',
      question,
      useSearchGrounding: false,
      validate: isRawRequestedTechniqueVerification,
    });
  }

  let result = await attempt();
  if (!result.ok && RETRYABLE_CODES.has(result.code)) result = await attempt();
  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  const verdict = VALID_REQUEST_VERDICTS.has(result.data.verdict) ? (result.data.verdict as RequestedTechniqueVerdict['verdict']) : 'insufficient_evidence';
  return {
    ok: true,
    verdict: {
      verdict,
      likelyMartialArt: result.data.likelyMartialArt,
      candidates: result.data.candidates.slice(0, 5).map((c) => ({
        name: c.name,
        nameKo: c.nameKo,
        category: VALID_CATEGORIES.has(c.category as TechniqueCategory) ? (c.category as TechniqueCategory) : 'other',
        description: c.description,
        sourceIndexes: c.evidenceIndexes,
        confidence: Math.max(0, Math.min(100, Math.round(c.confidence))),
        posture: c.posture ?? null,
        difficulty: c.difficulty && VALID_DIFFICULTIES.has(c.difficulty) ? (c.difficulty as Difficulty) : null,
      })),
      reason: result.data.reason,
    },
  };
}
