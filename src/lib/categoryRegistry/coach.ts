import { findTaxonomyNodesInText } from '../techniqueTaxonomy';
import { exactTechniquesInText, namesOf } from '../coachKnowledge/lookup';
import { categoryPickerTree, flattenPicker } from './service';

// AI 코치: "하프 가드에서 쓸 수 있는 새로운 스윕 기술을 추가하고 싶어" → answered from the category data, never by
// creating anything: (1) the named category (2) its sub-categories (3) whether the named technique already exists
// (4) where a new one would go (5) a link to the registration screen with the art + category pre-selected. The
// registration screen does the duplicate check and creates only on the user's own confirmation.

export const ADD_TECHNIQUE_Q = /(기술|테크닉|technique).{0,12}(추가|등록|넣)|(추가|등록)\s*(하고\s*싶|할래|해\s*줘|하려|할\s*수)|새\s*(기술|카테고리)/i;

export interface TechniqueAddAnswer {
  text: string;
  techniqueIds: string[];
  /** Registration screen with the art / category preselected. */
  link: string | null;
}

export function techniqueAddAnswer(question: string, art: string | null): TechniqueAddAnswer | null {
  if (!ADD_TECHNIQUE_Q.test(question)) return null;
  const nodes = findTaxonomyNodesInText(question, art ? [art] : undefined).filter((n) => n.kind !== 'other');
  // a named technique — but not one that only names the category itself ("하프 가드" is also a position record)
  const flat = (x: string) => x.toLowerCase().replace(/[\s\-_.()]/g, '');
  const nodeNames = nodes.flatMap((n) => [n.ko, n.en, n.fullKo, n.fullEn]).map(flat);
  const existing = exactTechniquesInText(question, art)
    .matches.filter((t) => !namesOf(t).some((n) => nodeNames.some((x) => x.includes(flat(n)) || flat(n).includes(x))))
    .map((t) => ({ id: t.id, name: t.koreanName || t.name, path: t.category }));
  if (!nodes.length && !existing.length) return null;
  const lines: string[] = [];
  const ids: string[] = [];
  if (existing.length) {
    const e = existing[0];
    ids.push(e.id);
    lines.push(`"${e.name}"은(는) 이미 MARTIALDEX에 있는 기술입니다 (${e.path}). 새로 만들지 않고 그 기술을 보시면 됩니다. 다른 무술에도 쓰인다면 기술 추가 화면에서 그 무술에 연결할 수 있습니다.`);
  }
  const node = nodes[0];
  let link: string | null = null;
  if (node) {
    const picker = flattenPicker(categoryPickerTree(node.art));
    const p = picker.find((x) => x.id === node.id);
    const path = p?.path ?? node.fullKo;
    const subs = p?.children.map((c) => `${c.ko}${c.count ? ` ${c.count}개` : ''}`) ?? [];
    lines.push(`${path} 카테고리에는 지금 기술 ${node.count}개가 있습니다.${subs.length ? ` 하위 분류: ${subs.join(', ')}.` : ''}`);
    lines.push('새 기술은 기술 추가 화면에서 이 카테고리를 선택해 등록할 수 있어요. 등록 전에 같은 기술이 있는지 검사하고, 맞는 하위 카테고리가 없을 때만 새 카테고리를 만들 수 있습니다 (만들기 전에 비슷한 카테고리가 있는지도 확인합니다). 제가 임의로 기술이나 카테고리를 만들지는 않습니다.');
    link = `/techniques/request?art=${encodeURIComponent(node.art)}&node=${encodeURIComponent(node.id)}`;
  }
  return { text: lines.join(' '), techniqueIds: ids, link };
}
