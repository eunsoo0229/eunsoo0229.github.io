import type { Technique } from '../../types';
import { findTaxonomyNodesInText, getArtTaxonomy, taxonomyBreadcrumb, techniquesForNode, type TaxonomyNode } from '../techniqueTaxonomy';
import { getUnifiedMartialArt } from '../userTechniques/service';
import { derivedRelations, ledFrom } from './relations';
import { exactTechniquesInText } from './lookup';
import { getUnifiedAllTechniques } from '../userTechniques/service';

// "하프 가드 스윕 뭐 있어?" / "하프 가드 스윕만 집중적으로 배우고 싶어" — answered from the technique taxonomy
// (techniqueTaxonomy/): the category's real techniques, each with its difficulty, the techniques its own data says
// lead into it / follow it, and whether study material (video / search query) exists. Only list-type questions about
// a named category reach this; a single technique question never does.

export const TAXONOMY_LIST_Q = /(뭐\s*있|무엇이\s*있|어떤\s*(게|것|기술)(들)?\s*있|목록|리스트|종류|전부|모두\s*알려|다\s*알려|기술들|만\s*(집중|배우|공부)|집중적으로|배우고\s*싶|공부하고\s*싶)/;
const CATEGORY_WORD = /카테고리|분류|계열|모음/;

const DIFF_KO: Record<string, string> = { beginner: '초급', intermediate: '중급', advanced: '고급' };

function name(t: Technique): string {
  return t.koreanName && t.koreanName !== t.name ? `${t.name}(${t.koreanName})` : t.name;
}

export interface TaxonomyListAnswer {
  text: string;
  techniqueIds: string[];
  node: TaxonomyNode;
}

export function taxonomyListAnswer(question: string, art: string | null): TaxonomyListAnswer | null {
  if (!TAXONOMY_LIST_Q.test(question)) return null;
  const nodes = findTaxonomyNodesInText(question, art ? [art] : undefined).filter((n) => n.kind === 'split' || n.kind === 'member' || (n.kind === 'group' && CATEGORY_WORD.test(question)));
  if (nodes.length === 0) return null;
  const node = nodes[0];
  const techniques = techniquesForNode(node.id);
  if (techniques.length === 0) return null;
  // "암바 카운터 뭐 있어?" asks about ONE technique's relations, not the 카운터 category: a technique named
  // outside the category's own words (and not a member of it) hands the question back to the relation answers.
  const rest = taxonomyBreadcrumb(node.id).reduce((q, n) => q.split(n.ko).join(' '), question);
  const inNodeIds = new Set(techniques.map((t) => t.id));
  if (exactTechniquesInText(rest, art).matches.some((t) => !inNodeIds.has(t.id))) return null;
  const artName = getUnifiedMartialArt(node.art)?.nameKo ?? node.art;
  const path = taxonomyBreadcrumb(node.id).map((n) => n.ko).join(' › ');
  const tax = getArtTaxonomy(node.art);
  const inNode = new Set(techniques.map((t) => t.id));
  const byId = new Map(getUnifiedAllTechniques().map((t) => [t.id, t]));
  const order = (t: Technique) => ({ beginner: 0, intermediate: 1, advanced: 2 })[t.difficulty as 'beginner'] ?? 1;
  const shown = [...techniques].sort((a, b) => order(a) - order(b)).slice(0, 8);
  const lines = shown.map((t, i) => {
    const parts: string[] = [DIFF_KO[t.difficulty as string] ?? '난이도 정보 없음'];
    const before = ledFrom(t).map((r) => byId.get(r.sourceId)).filter((x): x is Technique => !!x).slice(0, 2);
    const after = derivedRelations(t).filter((r) => r.kind === 'next').map((r) => byId.get(r.techniqueId)).filter((x): x is Technique => !!x).slice(0, 2);
    if (before.length) parts.push(`자료상 앞 동작: ${before.map(name).join(', ')}`);
    if (after.length) parts.push(`자료상 이어지는 기술: ${after.map(name).join(', ')}`);
    const evidence = (tax.techniqueAssignments.get(t.id) ?? []).find((a) => a.nodeId === node.id || a.nodeId.startsWith(`${node.id}/`));
    if (evidence && evidence.confidence === 'MEDIUM') parts.push('기술명 기준 분류');
    parts.push((t.videos?.length ?? 0) > 0 ? '영상 있음' : t.youtubeSearchQuery ? '영상 검색어 있음' : '영상 자료 없음');
    const sameNode = [...before, ...after].filter((x) => inNode.has(x.id));
    if (sameNode.length) parts.push('같은 분류 안에서 연결됨');
    return `${i + 1}) ${name(t)} — ${parts.join(' · ')}`;
  });
  const more = techniques.length > shown.length ? ` 외 ${techniques.length - shown.length}개` : '';
  const text = [
    `MARTIALDEX 분류 '${path}'(${artName})에는 기술 ${techniques.length}개가 있습니다${more ? '' : ''}. 쉬운 것부터 보면:`,
    ...lines,
    more ? `(${more.trim()}는 기술 목록에서 '${node.fullKo}' 분류로 볼 수 있습니다.)` : '',
    '기술 이름을 말씀하시면 단계별 수행 방법을 자료대로 설명해 드립니다.',
  ]
    .filter(Boolean)
    .join('\n');
  return { text, techniqueIds: shown.map((t) => t.id), node };
}
