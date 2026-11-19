import type { Technique } from '../../types';
import type { WebSearchOutcome } from '../webSearch/types';
import type { GeminiJsonOutcome } from '../userTechniques/geminiJson';
import { getMartialArt, getTechniquesByMartialArt } from '../loadData';
import { matchOfficialCategory } from './category';
import { linkCategoryFor } from './artLink';
import { libraryTechniques } from './index';

// 새 기술의 다른 무술 — a technique is added under the ONE art the user
// picked ("미들킥" → 킥복싱), but the same technique is often a standard
// technique of sibling arts too (무에타이, MMA). Before saving, the other arts
// are researched once (same evidence rule as Gi / No-Gi: web search, else
// Gemini with Google Search grounding) and every confirmed art is recorded on
// the technique itself (martialArts + categoryByArt), so it shows up in each
// art's list. Accepted only with sources and confidence high/medium; an art
// that already has a technique with the same name is never given a second copy.

const STRIKING = ['boxing', 'kickboxing', 'muay-thai', 'karate', 'taekwondo'];
const GRAPPLING = ['bjj', 'judo', 'wrestling', 'sambo'];
const MMA = 'mixed-martial-arts';
const STRIKE_WORDS = /(펀치|킥|니|무릎|팔꿈치|엘보|타격|잽|훅|어퍼|punch|kick|knee|strike|elbow|jab|hook|uppercut)/i;
const ART_EN: Record<string, string> = { boxing: 'boxing', kickboxing: 'kickboxing', 'muay-thai': 'Muay Thai', karate: 'karate', taekwondo: 'taekwondo', bjj: 'BJJ', judo: 'judo', wrestling: 'wrestling', sambo: 'sambo', [MMA]: 'MMA' };

export interface OtherArtsResearch {
  arts: { martialArt: string; category: string; reason: string | null }[];
  method: 'ai_grounded' | 'ai_web_sources' | 'skipped';
  reason: string | null;
  sources: { title: string; url: string }[];
  checkedAt: string;
}

/** The sibling arts worth checking for a technique filed under `art`. */
export function siblingArtsOf(art: string, t?: Pick<Technique, 'category' | 'positions'>): string[] {
  if (STRIKING.includes(art)) return [...STRIKING, MMA].filter((a) => a !== art);
  if (GRAPPLING.includes(art)) return [...GRAPPLING, MMA].filter((a) => a !== art);
  if (art === MMA) return STRIKE_WORDS.test(`${t?.category ?? ''} ${(t?.positions ?? []).join(' ')}`) ? STRIKING : GRAPPLING;
  return [];
}

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Does this art already list a technique with the same name? (then linking would be a second copy) */
function artHasSameName(art: string, t: Technique): boolean {
  const names = new Set([t.name, t.koreanName].map(norm).filter(Boolean));
  const { addTeq, mine } = libraryTechniques();
  const inArt = (x: Technique) => x.martialArt === art || (x.martialArts?.includes(art) ?? false);
  return [...getTechniquesByMartialArt(art), ...addTeq.filter(inArt), ...mine.filter(inArt)].some((x) => x.id !== t.id && [x.name, x.koreanName].some((n) => names.has(norm(n))));
}

export interface OtherArtsDeps {
  search: (query: string) => Promise<WebSearchOutcome>;
  askJson: <T>(p: { systemInstruction: string; contextText: string; question: string; useSearchGrounding?: boolean; validate?: (d: unknown) => d is T }) => Promise<GeminiJsonOutcome<T>>;
}

async function defaultDeps(): Promise<OtherArtsDeps> {
  const [{ webSearchProvider }, { askGeminiForJsonWithGrounding }] = await Promise.all([import('../webSearch/provider'), import('../userTechniques/geminiJson')]);
  return { search: (q) => webSearchProvider.search(q), askJson: askGeminiForJsonWithGrounding };
}

interface RawArt {
  art?: unknown;
  used?: unknown;
  confidence?: unknown;
  category?: unknown;
  reason?: unknown;
  sourceIds?: unknown;
}
interface RawAnswer {
  arts?: unknown;
}
const isRaw = (d: unknown): d is RawAnswer => !!d && typeof d === 'object' && !Array.isArray(d) && Array.isArray((d as RawAnswer).arts);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const SYSTEM = [
  '너는 여러 무술을 아는 코치다. 한 무술에 새로 추가되는 기술이 다른 무술에서도 표준 기술로 실제로 쓰이는지 무술별로 판단한다.',
  'used: true = 그 무술의 커리큘럼이나 경기에서 실제로 가르치고 쓰는 기술이며 수행 방식이 본질적으로 같음. false = 규칙상 금지·없음, 그 무술 고유가 아님, 이름만 같고 다른 기술.',
  '"격투기라 다 쓰인다", "비슷한 기술이 있다"는 이유로 true로 하지 않는다. 앞손/뒷손/좌우/타깃 변형은 서로 다른 기술이다.',
  'confidence: "high" | "medium" | "low". category: 그 무술의 [분류 목록] 중 하나를 그대로(없으면 null). reason: 한국어 한 문장.',
].join('\n');

/**
 * Researches which sibling arts also use a newly added technique. Never
 * throws; no evidence / no AI → no extra arts (method 'skipped', reason says why).
 */
export async function researchOtherArts(t: Technique, deps?: OtherArtsDeps): Promise<OtherArtsResearch> {
  const checkedAt = new Date().toISOString();
  const already = new Set([t.martialArt, ...(t.martialArts ?? [])]);
  const candidates = siblingArtsOf(t.martialArt, t).filter((a) => !already.has(a) && getMartialArt(a));
  const rec: OtherArtsResearch = { arts: [], method: 'skipped', reason: null, sources: [], checkedAt };
  if (!candidates.length) {
    rec.reason = '함께 확인할 다른 무술이 없습니다.';
    return rec;
  }
  const d = deps ?? (await defaultDeps());

  let web: { id: string; title: string; url: string; text: string }[] = [];
  try {
    const r = await d.search(`"${t.name}" technique ${[t.martialArt, ...candidates].map((a) => ART_EN[a] ?? a).join(' ')}`);
    if (r.ok) web = r.results.slice(0, 6).map((x, i) => ({ id: `S${i + 1}`, title: x.title, url: x.url, text: (x.snippet || x.content || '').replace(/\s+/g, ' ').slice(0, 400) })).filter((x) => x.url && x.text);
  } catch {
    web = [];
  }
  const useGrounding = web.length === 0;
  const context = [
    `[기술]\n이름: ${t.name}${t.koreanName ? ` / ${t.koreanName}` : ''}\n추가하는 무술: ${ART_EN[t.martialArt] ?? t.martialArt} · 분류: ${t.category}\n설명: ${(t.posture?.overview ?? t.description ?? '').slice(0, 400)}`,
    `[확인할 무술과 분류 목록]\n${candidates.map((a) => `${a} (${ART_EN[a] ?? a}): ${(getMartialArt(a)?.categories ?? []).join(' / ')}`).join('\n')}`,
    useGrounding ? '' : `[웹 자료]\n${web.map((w) => `[${w.id}] ${w.title} (${w.url})\n${w.text}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const r = await d.askJson<RawAnswer>({
    systemInstruction: [
      SYSTEM,
      useGrounding ? '웹 검색으로 확인한 내용만 근거로 쓴다.' : '근거는 [웹 자료]와 그 무술의 널리 알려진 커리큘럼·규칙이다. sourceIds에 근거가 된 자료 id(S1 등)를 넣는다.',
      `출력: {"arts":[{"art":"<무술 id>","used":true|false,"confidence","category","reason"${useGrounding ? '' : ',"sourceIds"'}}]} — [확인할 무술]마다 하나씩.`,
    ].join('\n'),
    contextText: context,
    question: `"${t.name}"이(가) ${candidates.map((a) => ART_EN[a] ?? a).join(', ')}에서도 쓰이는 기술인지 무술별로 판단해 줘.`,
    useSearchGrounding: useGrounding,
    validate: isRaw,
  });
  if (!r.ok) {
    rec.reason = `다른 무술 확인을 하지 못했습니다(${r.code === 'RATE_LIMIT' ? 'AI 사용량 한도' : 'AI 응답 실패'}).`;
    return rec;
  }
  const sources = useGrounding
    ? r.groundingSources.map((s) => ({ title: s.title ?? '', url: s.uri ?? '' })).filter((s) => s.url).slice(0, 6)
    : web.filter((w) => (r.data.arts as RawArt[]).some((a) => Array.isArray(a?.sourceIds) && a.sourceIds.some((x) => String(x).replace(/^.*:/, '') === w.id))).map((w) => ({ title: w.title, url: w.url }));
  if (!sources.length) {
    rec.reason = '웹 근거 자료가 확인되지 않아 다른 무술에는 추가하지 않았습니다.';
    return rec;
  }
  rec.method = useGrounding ? 'ai_grounded' : 'ai_web_sources';
  rec.sources = sources;
  for (const a of r.data.arts as RawArt[]) {
    const art = str(a?.art);
    if (!art || !candidates.includes(art) || rec.arts.some((x) => x.martialArt === art)) continue;
    if (a.used !== true || (a.confidence !== 'high' && a.confidence !== 'medium')) continue;
    if (artHasSameName(art, t)) continue;
    const category = (str(a.category) && matchOfficialCategory(art, str(a.category)!)) || linkCategoryFor(t, art);
    rec.arts.push({ martialArt: art, category, reason: str(a.reason) });
  }
  rec.reason = rec.arts.length ? null : '다른 무술에서 표준 기술로 쓰인다는 근거가 확인되지 않았습니다.';
  return rec;
}

/** The technique with every confirmed sibling art attached (martialArts + categoryByArt) — unchanged on failure. */
export async function withOtherArts(t: Technique, deps?: OtherArtsDeps): Promise<Technique> {
  // 홈·헬스 운동 and other non-martial-art domains have no sibling arts.
  if (t.otherArtsResearch || !siblingArtsOf(t.martialArt, t).length) return t;
  try {
    const research = await researchOtherArts(t, deps);
    if (!research.arts.length) return { ...t, otherArtsResearch: research };
    return {
      ...t,
      martialArts: [...new Set([t.martialArt, ...(t.martialArts ?? []), ...research.arts.map((a) => a.martialArt)])],
      categoryByArt: { [t.martialArt]: t.categoryByArt?.[t.martialArt] ?? t.category, ...t.categoryByArt, ...Object.fromEntries(research.arts.map((a) => [a.martialArt, a.category])) },
      otherArtsResearch: research,
    };
  } catch {
    return t;
  }
}
