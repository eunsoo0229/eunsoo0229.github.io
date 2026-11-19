// Turns a technique-list curriculum into one that also practises setups,
// combos and connections — using ONLY sequences MARTIALDEX already records.
//
// Per Day, for each new technique (max MAX_DRILLS_PER_DAY in total):
//   setup      a recorded setup that ends in the technique
//   combo      a recorded combo containing it whose every step is already
//              taught by this Day (this Day + earlier Days + review) — so the
//              difficulty grows with the schedule instead of jumping ahead
//   connection the most-recorded follow-up of the technique, if already taught
// Nothing is generated when nothing fits; callers surface that honestly.

import type { CurriculumDay, CurriculumDrill } from '../curriculum/types';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { resolveTechnique } from '../userTechniques/service';
import { gatherTechniqueKnowledge } from './index';
import type { KnowledgeIndex, KnowledgeSequence } from './types';

export const MAX_DRILLS_PER_DAY = 3;

const cid = (id: string) => canonicalTechniqueId(id);

function toDrill(kind: CurriculumDrill['kind'], focus: string, s: KnowledgeSequence): CurriculumDrill {
  return {
    kind,
    focusTechniqueId: focus,
    steps: s.steps.map((st) => ({ techniqueId: st.techniqueId, name: st.name, note: st.note, opponentReaction: st.opponentReaction })),
    title: s.name,
    purpose: s.purpose,
    sequenceId: s.id,
    origin: s.origin,
  };
}

export interface DrillAttachResult {
  days: CurriculumDay[];
  /** Days that teach techniques but got no setup/combo/connection drill. */
  daysWithoutDrills: number[];
  totalDrills: number;
}

export function attachSequenceDrills(days: CurriculumDay[], index: KnowledgeIndex, opts: { art?: string } = {}): DrillAttachResult {
  const taught = new Set<string>();
  const usedSequences = new Set<string>();
  const daysWithoutDrills: number[] = [];
  let totalDrills = 0;
  const out = days.map((day) => {
    for (const id of [...day.techniqueIds, ...day.reviewTechniqueIds]) taught.add(cid(id));
    const drills: CurriculumDrill[] = [];
    for (const raw of day.techniqueIds) {
      if (drills.length >= MAX_DRILLS_PER_DAY) break;
      const k = gatherTechniqueKnowledge(raw, index, opts);
      if (!k) continue;
      const focus = cid(k.technique.id);
      const fresh = (s: KnowledgeSequence) => !usedSequences.has(s.id);
      const untaught = (s: KnowledgeSequence) => [...new Set(s.steps.map((st) => st.techniqueId).filter((t) => t !== focus && !taught.has(t)))];
      const known = (s: KnowledgeSequence) => untaught(s).length === 0;
      // A setup may introduce at most one new move (usually a feint or step), shown as such.
      const setup = k.setupsInto.find((s) => fresh(s) && known(s)) ?? k.setupsInto.find((s) => fresh(s) && untaught(s).length === 1);
      if (setup && drills.length < MAX_DRILLS_PER_DAY) {
        const intro = untaught(setup);
        drills.push({ ...toDrill('setup', focus, setup), ...(intro.length ? { newStepIds: intro } : {}) });
        usedSequences.add(setup.id);
      }
      const combo = k.combos.map((c) => c.sequence).find((s) => fresh(s) && known(s));
      if (combo && drills.length < MAX_DRILLS_PER_DAY) {
        drills.push(toDrill('combo', focus, combo));
        usedSequences.add(combo.id);
      }
      const next = k.followUps.find((f) => taught.has(f.techniqueId) && f.techniqueId !== focus);
      const nextTech = next && resolveTechnique(next.techniqueId);
      const connId = nextTech ? `follow:${focus}>${next!.techniqueId}` : '';
      if (nextTech && !usedSequences.has(connId) && drills.length < MAX_DRILLS_PER_DAY && !drills.some((d) => d.steps.length === 2 && d.steps[1].techniqueId === next!.techniqueId)) {
        drills.push({
          kind: 'connection',
          focusTechniqueId: focus,
          steps: [
            { techniqueId: focus, name: k.technique.name },
            { techniqueId: next!.techniqueId, name: nextTech.name },
          ],
          title: `${k.technique.name} → ${nextTech.name}`,
          purpose: `기록된 연결 동작 ${next!.count}건에서 ${k.technique.name} 다음에 이어진 기술`,
          sequenceId: connId,
          origin: 'technique_db',
        });
        usedSequences.add(connId);
      }
    }
    if (day.techniqueIds.length && !drills.length) daysWithoutDrills.push(day.day);
    totalDrills += drills.length;
    return drills.length ? { ...day, drills } : day;
  });
  return { days: out, daysWithoutDrills, totalDrills };
}

/** Did the learner explicitly ask for setups / combos / connections? */
export function goalAsksForSequences(goalText: string): boolean {
  return /(셋업|셋 업|콤보|콤비네이션|연결|연계|체인|setup|set-up|combo|combination|chain|follow[- ]?up)/i.test(goalText);
}

export const DRILL_KIND_LABEL: Record<CurriculumDrill['kind'], string> = { setup: '셋업', combo: '콤보', connection: '연결' };
