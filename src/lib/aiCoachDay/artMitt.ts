import type { Technique } from '../../types';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { resolveTechnique } from '../userTechniques/service';
import { listDbCombos, listVisualizableTechniques, reviewConnections, stepsForIds } from '../visualMitt/combos';
import { allowedKeys, attackSingles, combosFor, defenseSingles, drillProfile, type DrillProfile } from '../visualMitt/artDrills';
import { wrestlingChains } from '../visualMitt/wrestlingChains';

// 종목에 맞춘 수업 미트 — a lesson item that has no mitt motion of its own
// (stance, footwork, distance, a counter, a combination record, the clinch,
// a tactic or rule) is still practised on the Visualizing Mitt, with what
// THAT art's pads look like (visualMitt/artDrills.ts profiles):
//   복싱 → punches only (+ punch defenses), 킥복싱 → punches + kicks,
//   무에타이 → + knees / elbows, MMA → strikes + takedown entries,
//   레슬링 → shots, level change, snap down (+ sprawl to the holder's shot),
//   other striking arts → their own drawable techniques.
// Ground grappling (guards, mounts, submissions, escapes, top/bottom) has no
// pad version — those stay on the solo drill or the timer.
// Every step is a REAL technique; a combo is a real DB combo record or a
// chain whose order the reviewed connection rules accept.

export type LessonTopic = 'combo' | 'defense' | 'clinch' | 'base';

const GROUND = /가드|guard|마운트|mount|사이드 컨트롤|side control|탑 포지션|바텀|top position|bottom|네와자|ne-?waza|파르테르|관절기|조르기|choke|암바|armbar|레그락|leg ?lock|트라이앵글|triangle|기무라|kimura|탈출|escape|리버설|reversal|스윕|sweep|백 컨트롤|back control|크루시픽스|crucifix|홀드다운|우제르자니예|shime|osaekomi|김우라/i;
const DEFENSE = /카운터|counter|방어|defen[cs]e|막기|block|uke\b|캐치|catch|회피|sabaki|슬립|slip|패리|parry|위빙|롤링|커버|go no sen/i;
const CLINCH = /클린치|clinch|니킥|\bknee|khao|근거리|인파이팅|infight|바디락|body ?lock|plum|chika-?ma/i;
const COMBO = /조합|콤비네이션|combination|연결|renzoku|연속|combo/i;
/** Grappling arts get pads only for STANDING items (stance, grips, takedowns, throws, clinch). */
const GRAPPLING_ARTS = new Set(['wrestling', 'bjj', 'judo', 'sambo']);
const STANDING = /스탠딩|standing|카운터|counter|리샷|re-?shot|스프롤|sprawl|핸드 ?파이팅|손싸움|칼라 ?타이|collar|테이크다운|takedown|그립|grip|잡기|kumi|자세|서기|stance|이동|풋워크|footwork|거리|distance|던지기|투사|throw|nage|클린치|clinch|바디락|body ?lock|싱글|더블|single|double|진입|셋업|페이크|feint|hand ?fight|kuzushi|균형 무너뜨리기/i;
/** Combos recorded under these arts read naturally in a lesson of the key art (names, rules). */
const CLOSE_ARTS: Record<string, string[]> = {
  boxing: ['boxing', 'kickboxing'],
  kickboxing: ['kickboxing', 'boxing', 'muay-thai'],
  'muay-thai': ['muay-thai', 'kickboxing', 'boxing'],
  'mixed-martial-arts': ['mixed-martial-arts', 'kickboxing', 'boxing', 'wrestling', 'muay-thai'],
};
/** Bottom / mat movements of grappling arts that categories file under "기본 움직임". */
const MAT_MOVES = /bridge|브릿지|switch|스위치|sit-?out|싯아웃|stand-?up|스탠드업|granby|그랜비|hip ?heist|힙 헤이스트|shrimp|새우|roll|구르기|낙법|ukemi|break ?fall/i;
const sourceArt = (c: { id: string }) => c.id.match(/^db:(.+?)__/)?.[1] ?? null;

/** Lesson art → the drill profile art id ('mma' curricula use the MMA profile). */
function profileArt(art: string | null | undefined): string | null {
  if (!art) return null;
  return art === 'mma' ? 'mixed-martial-arts' : art;
}

export function lessonTopic(text: string, art?: string | null): LessonTopic | null {
  if (GROUND.test(text)) return null;
  if (art && GRAPPLING_ARTS.has(art) && (!STANDING.test(text) || MAT_MOVES.test(text))) return null;
  if (COMBO.test(text)) return 'combo';
  if (DEFENSE.test(text)) return 'defense';
  if (CLINCH.test(text)) return 'clinch';
  return 'base';
}

/** Stable pick so different lessons get different (but repeatable) drills. */
function pickBy<T>(xs: T[], seed: string): T | null {
  if (!xs.length) return null;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return xs[h % xs.length];
}

function natural(ids: string[]): string[] | null {
  const steps = stepsForIds(ids);
  if (steps.length !== ids.length || reviewConnections(steps).length) return null;
  return steps.map((s) => s.techniqueId);
}

/** "잽은" / "스탠스는" — 은/는 by the last syllable (non-Hangul names take 는). */
export function topicOf(name: string): string {
  const ch = name.trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  return `${name}${code >= 0 && code < 11172 && code % 28 !== 0 ? '은' : '는'}`;
}

const nameOf = (id: string) => {
  const t = resolveTechnique(id);
  return t ? t.koreanName || t.name : id;
};
const arrow = (ids: string[]) => ids.map(nameOf).join(' → ');

export interface ArtLessonMitt {
  topic: LessonTopic | 'record';
  ids: string[];
  name: string;
  purpose: string;
  intro: string;
  profile: DrillProfile;
}

/**
 * The art's pad drill for a lesson item without its own mitt motion, or null
 * (ground grappling, or the art has nothing drawable).
 * `item` = the technique (or, for a one-off lesson, just a title/topic text).
 */
export function artLessonMitt(item: { id?: string; name: string; category?: string; keyPoint?: string | null }, art: string | null | undefined): ArtLessonMitt | null {
  const pArt = profileArt(art);
  if (!pArt) return null;
  const visualizable = listVisualizableTechniques();
  const profile = drillProfile(pArt, visualizable);
  const kicks = profile.kicks !== 'off';
  const keys = allowedKeys(profile, { range: 'wide', withKicks: kicks, withDefense: true });
  if (!keys.size) return null;
  const dbCombos = listDbCombos();
  const label = profile.label;
  const text = `${item.category ?? ''} ${item.name}`;

  // 1. The item IS a combination record of the DB → its own steps, if they fit this art's pads.
  if (item.id) {
    const cid = canonicalTechniqueId(item.id);
    const own = dbCombos.find((c) => {
      const src = c.id.replace(/^db:/, '').replace(/#\d+$/, '');
      return (src === item.id || canonicalTechniqueId(src) === cid) && c.steps.length >= 2 && c.steps.every((s) => keys.has(s.motion.archetype.key));
    });
    if (own) {
      const ids = own.steps.map((s) => s.techniqueId);
      return { topic: 'record', ids, name: own.name, purpose: `${item.name} 그대로 치기`, profile, intro: `${topicOf(item.name)} MARTIALDEX에 등록된 실제 조합(${arrow(ids)})이라 그대로 ${label} 미트로 칩니다.` };
    }
  }

  const topic = lessonTopic(text, pArt);
  if (!topic) return null;
  const seed = item.id ?? item.name;
  const basicOpts = { range: 'basic' as const, withKicks: kicks, withDefense: false };
  const keep = item.keyPoint ? ` 치는 동안 "${item.keyPoint.replace(/[.。]$/, '')}"를 계속 지켜 주세요.` : '';

  if (topic === 'defense') {
    const defenses = defenseSingles(profile, { range: 'basic', withKicks: kicks });
    if (defenses.length) {
      // the defense this lesson names (슬립, 패리, 체크 …) when there is one
      const named = defenses.find((d) => text.toLowerCase().includes(d.steps[0].technique.name.toLowerCase()) || (!!d.steps[0].technique.koreanName && text.includes(d.steps[0].technique.koreanName))) ?? null;
      const closeArts = CLOSE_ARTS[pArt] ?? [pArt];
      const withDef = combosFor(profile, { range: 'wide', withKicks: kicks, withDefense: true }, dbCombos).filter((c) => c.steps.some((s) => s.motion.archetype.kind === 'defense') && closeArts.includes(sourceArt(c) ?? ''));
      const real = named ? withDef.find((c) => c.steps.some((s) => s.techniqueId === named.steps[0].techniqueId)) : pickBy(withDef, seed);
      if (real) {
        const ids = real.steps.map((s) => s.techniqueId);
        return { topic, ids, name: real.name, purpose: `${item.name} — 막고 바로 반격`, profile, intro: `${topicOf(item.name)} 미트로 연습하겠습니다. 미트를 든 코치가 공격하면 ${arrow(ids)} 순서로 막고 바로 반격합니다 (MARTIALDEX에 등록된 실제 조합).${keep}` };
      }
      const def = named ?? pickBy(defenses, seed)!;
      const counter = attackSingles(profile, { range: 'basic', withKicks: false })[0];
      const ids = (counter && natural([def.steps[0].techniqueId, counter.steps[0].techniqueId])) ?? [def.steps[0].techniqueId];
      return { topic, ids, name: arrow(ids), purpose: `${item.name} — 막고 반격`, profile, intro: `${topicOf(item.name)} 미트로 연습하겠습니다. 미트를 든 코치가 공격하면 ${arrow(ids)}로 막고 반격합니다.${keep}` };
    }
  }

  if (topic === 'clinch') {
    const close = attackSingles(profile, { range: 'wide', withKicks: kicks }).filter((c) => ['knee', 'elbow'].includes(c.steps[0].motion.archetype.limb) || ['bodyLock', 'snapDown'].includes(c.steps[0].motion.archetype.key));
    if (close.length) {
      const a = close[0].steps[0].techniqueId;
      const b = close.find((c) => c.steps[0].motion.archetype.limb !== close[0].steps[0].motion.archetype.limb)?.steps[0].techniqueId;
      const ids = (b ? natural([a, b]) : null) ?? [a];
      return { topic, ids, name: arrow(ids), purpose: `${item.name} — 근거리에서 치기`, profile, intro: `${topicOf(item.name)} 근거리(클린치) 상황을 가정해 ${label} 미트로 ${arrow(ids)}를 칩니다.${keep}` };
    }
  }

  // combo / base (stance, footwork, distance, rules, tactics …): a real basic combo of this art's pads
  // a real basic combo recorded under this art first, then a close art (boxing ↔ kickboxing …), never a far one
  const real = combosFor(profile, basicOpts, dbCombos, 2, topic === 'combo' ? 4 : 3);
  const close = CLOSE_ARTS[pArt] ?? [pArt];
  const ranked = close.map((a) => real.filter((c) => sourceArt(c) === a)).find((xs) => xs.length) ?? [];
  const chosen = pickBy(ranked, seed);
  if (chosen) {
    const ids = chosen.steps.map((s) => s.techniqueId);
    return {
      topic,
      ids,
      name: chosen.name,
      purpose: `${item.name}에 집중하며 기본 조합 치기`,
      profile,
      intro: topic === 'combo' ? `${topicOf(item.name)} ${label}의 실제 조합 ${arrow(ids)}로 미트에서 연습합니다.${keep}` : `${topicOf(item.name)} 따로 미트로 그릴 동작이 없어서, ${item.name}에 집중하며 ${label} 미트로 기본 조합 ${arrow(ids)}를 칩니다.${keep}`,
    };
  }
  // a grappling art with no real standing combos of its own (e.g. 삼보): the wrestling pads
  if (GRAPPLING_ARTS.has(pArt) && pArt !== 'wrestling') {
    const w = artLessonMitt(item, 'wrestling');
    return w ? { ...w, intro: w.intro.replace('레슬링 미트', `${label} 수업의 스탠딩 미트(레슬링 형식)`) } : null;
  }
  // an art without real combos of its pads (e.g. wrestling): chain its basic attacks
  const singles = attackSingles(profile, { range: 'basic', withKicks: kicks });
  if (!singles.length) return null;
  // 레슬링: a long chain of shots and answers to the holder's shot (태클 → 스프롤 → 다운블락 → 태클)
  if (profile.id === 'wrestling') {
    const chains = wrestlingChains(profile, { range: 'basic', withKicks: false, withDefense: true }, { count: 24, minSteps: 4, maxSteps: 6 });
    const ch = pickBy(chains, seed);
    if (ch) {
      const ids = ch.steps.map((s) => s.techniqueId);
      return { topic, ids, name: ch.name, purpose: `${item.name} — 연속 레슬링 드릴`, profile, intro: `${topicOf(item.name)} 레슬링 연속 드릴로 연습합니다: 코치가 "${ch.name}"처럼 부르면 끊지 말고 이어서 움직입니다 — 내가 태클하고, 코치가 태클하면 스프롤·다운블락으로 막은 뒤 바로 다시 들어갑니다.${keep}` };
    }
  }
  // feint / level change → a shot, varied per lesson (only natural pairs)
  const feints = singles.filter((c) => c.steps[0].motion.archetype.kind === 'feint');
  const entries = singles.filter((c) => c.steps[0].motion.archetype.kind === 'entry');
  const pairs = feints.flatMap((f) => entries.map((e) => natural([f.steps[0].techniqueId, e.steps[0].techniqueId]))).filter((x): x is string[] => !!x);
  const ids = pickBy(pairs, seed) ?? [(pickBy(entries, seed) ?? singles[0]).steps[0].techniqueId];
  return { topic, ids, name: arrow(ids), purpose: `${item.name}에서 바로 이어지는 동작`, profile, intro: `${item.name}에 집중하며 ${label} 미트로 ${arrow(ids)}를 연습합니다.${keep}` };
}

/** Technique → the item shape artLessonMitt reads. */
export function lessonItem(t: Technique): { id: string; name: string; category: string; keyPoint: string | null } {
  return { id: t.id, name: t.koreanName || t.name, category: t.category, keyPoint: t.posture?.keyPoints?.[0] ?? null };
}

