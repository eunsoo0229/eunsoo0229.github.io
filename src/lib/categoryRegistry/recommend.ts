import type { Technique } from '../../types';
import { classifyDimensions, techniqueTexts } from '../techniqueTaxonomy/classify';
import { TAXONOMY_CONFIG } from '../techniqueTaxonomy/config';
import { DIMENSION_BY_ID } from '../techniqueTaxonomy/dimensions';
import { classificationOf } from '../techniqueTaxonomy';
import { getUnifiedTechniquesByMartialArt } from '../userTechniques/service';
import { categoryPickerTree, findCategoryMatches, flattenPicker, type PickerNode } from './service';

// 카테고리 자동 추천 — where a new technique most likely belongs, from (1) the technique's own data classified by the
// taxonomy's rules (its defining sentence names "스윕" → the group's 스윕 child), (2) the art category its generated
// record already carries, (3) similar existing techniques and where they sit, optionally (4) an AI pick that may
// only choose among the listed existing nodes or PROPOSE a new one. Nothing is decided here: a low-confidence
// result asks the user to choose, and a proposed new category is created only when someone presses create.

export type RecommendConfidence = 'high' | 'medium' | 'low';

export interface CategoryRecommendation {
  nodeId: string | null;
  path: string | null;
  confidence: RecommendConfidence;
  reasons: string[];
  /** true = an existing (or configured) category fits. */
  useExisting: boolean;
  /** A category the AI suggested creating (not created). */
  proposal: { parentId: string | null; ko: string; en: string; reason: string; duplicateOf: string | null } | null;
  similar: { id: string; name: string; path: string }[];
  /** Purpose / type tags the data supports (dimension ids). */
  tags: string[];
  source: 'rules' | 'rules+ai';
}

export type AskJson = <T>(p: { systemInstruction: string; contextText: string; question: string; validate?: (d: unknown) => d is T }) => Promise<{ ok: true; data: T } | { ok: false; code: string; message: string }>;

const tokens = (s: string) => new Set(s.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2));

function similarTechniques(art: string, t: Technique, picker: PickerNode[]): { id: string; name: string; path: string }[] {
  const mine = tokens(`${t.name} ${t.koreanName ?? ''} ${(t.aliases ?? []).join(' ')}`);
  if (!mine.size) return [];
  const byId = new Map(flattenPicker(picker).map((n) => [n.id, n]));
  return getUnifiedTechniquesByMartialArt(art)
    .filter((x) => x.id !== t.id)
    .map((x) => {
      const theirs = tokens(`${x.name} ${x.koreanName ?? ''}`);
      const shared = [...mine].filter((w) => theirs.has(w)).length;
      return { x, score: shared / Math.max(1, Math.min(mine.size, theirs.size)) };
    })
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ x }) => {
      const deepest = classificationOf(x.id, art).filter((c) => c.node.kind !== 'other').sort((a, b) => b.node.level - a.node.level)[0];
      const node = deepest ? byId.get(deepest.node.id) : undefined;
      return { id: x.id, name: x.koreanName || x.name, path: node?.path ?? x.category };
    });
}

/** Rules-only recommendation (no AI). */
export function recommendCategory(art: string, t: Technique): CategoryRecommendation {
  const picker = categoryPickerTree(art);
  const all = flattenPicker(picker);
  const reasons: string[] = [];
  const group = all.find((n) => n.level === 2 && n.categoryString === t.category) ?? all.find((n) => n.kind === 'member' && n.categoryString === t.category);
  const similar = similarTechniques(art, t, picker);
  const cfg = TAXONOMY_CONFIG[art];
  const texts = techniqueTexts(t);
  const tags = cfg ? classifyDimensions(t, cfg.tags, cfg.tags, texts).filter((e) => e.confidence !== 'LOW').map((e) => e.dim) : [];
  if (!group) {
    const fromSimilar = similar[0];
    return {
      nodeId: null,
      path: null,
      confidence: 'low',
      reasons: [`생성된 기록의 카테고리 "${t.category}"가 이 무술의 분류에 없습니다.${fromSimilar ? ` 비슷한 기존 기술 "${fromSimilar.name}"은 ${fromSimilar.path}에 있습니다.` : ''} 직접 선택하거나 새 카테고리를 만들어 주세요.`],
      useExisting: false,
      proposal: null,
      similar,
      tags,
      source: 'rules',
    };
  }
  reasons.push(`기술 데이터의 카테고리 "${t.category}" → ${group.path}`);
  // the group's purpose / type children, judged from the technique's own description (HIGH / MEDIUM only)
  const childDims = group.children.filter((c) => c.dim).map((c) => c.dim!);
  const ev = childDims.length ? classifyDimensions(t, childDims, childDims, texts) : [];
  const best = ev.find((e) => e.confidence === 'HIGH') ?? ev.find((e) => e.confidence === 'MEDIUM');
  let node = group;
  let confidence: RecommendConfidence = 'medium';
  if (best) {
    node = group.children.find((c) => c.dim === best.dim)!;
    confidence = best.confidence === 'HIGH' ? 'high' : 'medium';
    reasons.push(`설명이 ${DIMENSION_BY_ID.get(best.dim)?.ko ?? best.dim}(으)로 정의됨 — ${best.basis}`);
  } else if (childDims.length) {
    const weak = ev.find((e) => e.confidence === 'LOW');
    confidence = 'low';
    reasons.push(weak ? `세부 분류 근거가 약함(${DIMENSION_BY_ID.get(weak.dim)?.ko}: ${weak.basis}) — 확정하지 않음` : '세부 분류 근거가 없어 상위 카테고리까지만 추천');
  }
  const agree = similar.filter((s) => s.path.startsWith(node.path)).length;
  if (agree) {
    reasons.push(`비슷한 기존 기술 ${agree}개가 같은 분류에 있음 (${similar.filter((s) => s.path.startsWith(node.path)).map((s) => s.name).slice(0, 3).join(', ')})`);
    if (confidence === 'medium' && node !== group) confidence = 'high';
  }
  return { nodeId: node.id, path: node.path, confidence, reasons, useExisting: true, proposal: null, similar, tags, source: 'rules' };
}

interface RawAi {
  nodeId?: unknown;
  confidence?: unknown;
  reason?: unknown;
  newCategory?: { parentId?: unknown; ko?: unknown; en?: unknown; reason?: unknown } | null;
}
const isRaw = (d: unknown): d is RawAi => !!d && typeof d === 'object' && !Array.isArray(d);

/**
 * Rules first; then (optional) an AI that sees the art's real category paths and may pick one of them or propose a
 * new one. The AI's pick is accepted only if it is a listed node; a proposal is duplicate-checked and returned as a
 * proposal only. When rules and AI disagree, confidence drops to low (the user decides).
 */
export async function recommendCategoryWithAi(art: string, t: Technique, askJson?: AskJson | null): Promise<CategoryRecommendation> {
  const base = recommendCategory(art, t);
  if (!askJson) return base;
  const nodes = flattenPicker(categoryPickerTree(art));
  const r = await askJson<RawAi>({
    systemInstruction: [
      '너는 무술 기술 분류 담당이다. 새 기술이 이 무술의 기존 카테고리 중 어디에 속하는지 고른다.',
      'nodeId는 [카테고리 목록]에 있는 id 중 하나만. 가장 구체적인 하위 카테고리를 고르되 근거가 없으면 상위를 고른다.',
      '맞는 카테고리가 정말 없을 때만 newCategory {parentId(목록의 id 또는 null), ko, en, reason}를 제안한다. 이름만 비슷한 다른 개념에 억지로 넣지 않는다. 확신이 없으면 confidence "low".',
      '출력: {"nodeId": string|null, "confidence": "high"|"medium"|"low", "reason": string, "newCategory": {...}|null}',
    ].join('\n'),
    contextText: [
      `[무술] ${art}`,
      `[새 기술] ${t.name}${t.koreanName ? ` / ${t.koreanName}` : ''}\n카테고리(생성된 기록): ${t.category}\n포지션: ${t.positions.join(', ')}\n설명: ${(t.posture?.overview ?? t.description ?? '').slice(0, 400)}`,
      `[카테고리 목록]\n${nodes.map((n) => `${n.id} | ${n.path}`).join('\n')}`,
    ].join('\n\n'),
    question: '이 기술의 카테고리를 골라줘.',
    validate: isRaw,
  }).catch(() => null);
  if (!r || !r.ok) return base;
  const a = r.data;
  const out: CategoryRecommendation = { ...base, reasons: [...base.reasons], source: 'rules+ai' };
  const picked = typeof a.nodeId === 'string' ? nodes.find((n) => n.id === a.nodeId) : undefined;
  if (picked) {
    const reason = typeof a.reason === 'string' ? a.reason.slice(0, 160) : '';
    if (!base.nodeId) {
      out.nodeId = picked.id;
      out.path = picked.path;
      out.useExisting = true;
      out.confidence = a.confidence === 'high' ? 'medium' : 'low';
      out.reasons.push(`AI 추천: ${picked.path}${reason ? ` — ${reason}` : ''}`);
    } else if (picked.id === base.nodeId || picked.path.startsWith(base.path!)) {
      if (picked.id !== base.nodeId && base.confidence !== 'low') {
        out.nodeId = picked.id;
        out.path = picked.path;
      }
      out.reasons.push(`AI도 같은 분류를 추천${reason ? ` — ${reason}` : ''}`);
    } else {
      out.confidence = 'low';
      out.reasons.push(`AI는 ${picked.path}를 추천 — 규칙 추천과 달라 직접 확인이 필요합니다${reason ? ` (${reason})` : ''}`);
    }
  }
  const nc = a.newCategory;
  if (nc && typeof nc.ko === 'string' && nc.ko.trim()) {
    const parentId = typeof nc.parentId === 'string' && nodes.some((n) => n.id === nc.parentId) ? nc.parentId : null;
    const en = typeof nc.en === 'string' ? nc.en.trim() : '';
    const dup = findCategoryMatches({ art, parentId, ko: nc.ko.trim(), en }).find((m) => m.kind === 'same');
    out.proposal = { parentId, ko: nc.ko.trim().slice(0, 40), en: en.slice(0, 60), reason: typeof nc.reason === 'string' ? nc.reason.slice(0, 200) : '', duplicateOf: dup?.nodeId ?? null };
    if (!out.nodeId) out.useExisting = false;
  }
  return out;
}
