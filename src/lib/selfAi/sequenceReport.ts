// "잽으로 시작하는 콤비네이션 연구해 줘" — setups / combos written by code:
//   1. MARTIALDEX records: recorded setups into / combos with the technique, follow-ups,
//      the record's own transitions;
//   2. combination / setup SENTENCES found in the fetched pages (rule extraction, the
//      sentence itself as the quote), grouped by how many sites show them.
// Measured before: the model free-wrote five templated combos with wrong technique
// facts and no citations (138 s). Technique facts are never free-generated.

import type { Technique } from '../../types';
import { mergeStyleItems, STYLE_SUPPORT_LABEL, type StyleItem } from '../fighterStyle/evidenceStyle';
import { artsForTopic, ruleBasedItems } from '../fighterStyle/ruleExtract';
import { gatherTechniqueKnowledge } from '../martialdexKnowledge/index';
import type { KnowledgeIndex } from '../martialdexKnowledge/types';
import type { ResearchResult } from '../selfResearch/types';
import { resolveTechnique } from '../userTechniques/service';

const label = (t: Technique) => (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name);

export function sequenceReport(text: string, techniques: Technique[], art: string | null, index: KnowledgeIndex | null, results: ResearchResult[]): { text: string; techniqueIds: string[] } {
  const lines: string[] = [];
  // a record named like a generic word ("Combination") is not the technique being asked about
  const focus = techniques.filter((t) => !/^(combination|combo|setup|counter)$/i.test(t.name)).slice(0, 2);
  const ids = new Set(focus.map((t) => t.id));
  for (const t of focus) {
    const k = index ? gatherTechniqueKnowledge(t.id, index, { art: art ?? undefined }) : null;
    const seqs = [...(k?.setupsInto ?? []), ...(k?.combos.map((c) => c.sequence) ?? []), ...(k?.setupsUsing ?? [])].filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i).slice(0, 6);
    const own = [t.name, ...t.aliases].map((n) => n.toLowerCase());
    const transitions = t.transitions.filter((x) => x.includes('→') && own.includes(x.split('→')[0].trim().toLowerCase())).map((x) => x.trim());
    const followUps = (k?.followUps ?? []).slice(0, 4).map((f) => resolveTechnique(f.techniqueId)?.name).filter(Boolean);
    lines.push(`■ MARTIALDEX 기록 — ${label(t)}`);
    if (seqs.length) {
      lines.push(
        ...seqs.map((s) => {
          const steps = s.steps.map((x) => x.name).join(' → ');
          const named = s.name.replace(/\s+/g, ' ').trim() === steps ? steps : `${s.name}: ${steps}`;
          return `- [${s.kind === 'setup' ? '셋업' : '콤보'}] ${named}${s.purpose ? ` — ${s.purpose}` : ''}`;
        })
      );
    }
    if (transitions.length) lines.push(`- 기록된 전환: ${transitions.join(', ')}`);
    if (followUps.length) lines.push(`- 기록된 순서에서 이어진 기술: ${followUps.join(', ')}`);
    if (!seqs.length && !transitions.length && !followUps.length) lines.push('- 이 기술로 시작하거나 이어지는 셋업·콤보 기록이 아직 없습니다.');
  }
  if (!focus.length) lines.push('■ MARTIALDEX 기록\n- 질문에서 MARTIALDEX 기술 이름을 찾지 못해 기록을 조회하지 못했습니다.');

  const arts = artsForTopic(text, art);
  const perPage = results
    .filter((r) => r.content)
    .map((page) => ({ page, items: ruleBasedItems(page, null, arts).filter((i) => (i.kind === 'combo' || i.kind === 'setup') && (!ids.size || (i.ids ?? []).some((x) => ids.has(x)))) }))
    .filter((p) => p.items.length);
  const items: StyleItem[] = mergeStyleItems(perPage, art ?? 'boxing').filter((i) => i.support !== 'unconfirmed');
  const pages = results.filter((r) => r.content).length;
  lines.push(`\n■ 검색 자료에서 찾은 콤비네이션·셋업 (본문을 읽은 자료 ${pages}곳의 원문 문장)`);
  if (items.length) {
    for (const i of items.sort((a, b) => (a.support === 'multi_source' ? -1 : 0) - (b.support === 'multi_source' ? -1 : 0)).slice(0, 8)) {
      const q = i.quotes.find((x) => x.verified);
      lines.push(`- [${i.kind === 'setup' ? '셋업' : '콤보'}] ${(i.steps ?? []).join(' → ')} · ${STYLE_SUPPORT_LABEL[i.support]}${q ? `\n  근거: ${q.site} "${q.quote.length > 160 ? `${q.quote.slice(0, 159)}…` : q.quote}"` : ''}`);
    }
  } else {
    lines.push(`- 읽은 자료에서 ${focus.length ? `${focus.map(label).join(', ')}이(가) 들어간 ` : ''}콤비네이션·셋업 문장을 찾지 못했습니다. 아래 출처 원문을 참고해 주세요.`);
  }
  lines.push('\n각 항목은 MARTIALDEX 기록이거나 검색 자료의 원문 문장입니다. 원문에 없는 설명은 덧붙이지 않았습니다.');
  return { text: lines.join('\n'), techniqueIds: [...new Set([...ids, ...items.flatMap((i) => i.techniqueIds)])] };
}
