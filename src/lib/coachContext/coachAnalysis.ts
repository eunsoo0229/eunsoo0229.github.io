import { exactTechniquesInText } from '../coachKnowledge/lookup';
import { getProfile } from '../fighterProfile/store';
import { analyzeStyle } from '../fighterProfile/style';
import { fieldOf } from '../fighterProfile/catalog';
import { goalSlots } from '../goals/store';
import { listMyGymRoutines } from '../gymRoutine/service';
import { getCachedMyStyleAnalysis } from '../myStyle/styleAnalysisEngine';
import { listSparringSessions as listSparringAnalyses } from '../sparringAnalysis/sparringSessionService';
import { listTrainingHistory } from '../trainingHistory/service';
import { resolveTechnique } from '../userTechniques/service';
import { WEEKDAY_LABEL } from '../dateUtil';
import { MASTERY_LABEL } from '../skillProgress/types';
import type { KnowledgeIndex } from '../martialdexKnowledge/types';
import { analyzeCombos, analyzeSparring, analyzeTactics, describeFavorites, describeMeals, describeMyTechniques, learnedMap, learnedOf, learningMemory, learningMemoryText, recommendCombos } from './coachData';
import { canonicalTechniqueId } from '../techniqueCanonical';

// 10차 — questions that ask the coach to ANALYSE the learner's own data ("내 콤보 분석해 줘", "최근 스파링 분석",
// "반복적으로 어려워하는 상황", "새로운 콤보 추천", "지난 대화를 참고해 학습 상태" …). Code reads the records and
// writes the facts + the app's labelled judgement (coachData.ts); a model may add a clearly-labelled interpretation
// on top (coachAgent), never replacing the facts. Nothing is written.

export type AnalysisKind =
  | 'combos'
  | 'combo_recommend'
  | 'tactics'
  | 'my_techniques'
  | 'favorites'
  | 'sparring'
  | 'difficulties'
  | 'memory'
  | 'meals'
  | 'style'
  | 'next_training';

export interface AnalysisAnswer {
  kind: AnalysisKind;
  text: string;
  stores: string[];
  /** The facts block a model may interpret (only for kinds where a narrative helps). */
  narrativeFacts?: string;
  loadFailed: boolean;
}

const MINE = /(내|나의|제|저의|내가|제가|나한테|저한테|난|나는)\s?/;

// data domains a question can name — two or more with a "together" ask go to the coach with the whole context
const DOMAINS = [/콤보|콤비네이션|조합/, /전술|전략/, /스파링/, /목표/, /루틴/, /훈련 기록/, /식사|식단|영양/, /즐겨\s*찾기/];

/** "내 콤보와 전술을 보고 다음 연습 방향을 같이 알려줘" — several of the learner's own data domains at once. */
export function isPersonalComposite(text: string): boolean {
  return MINE.test(text) && DOMAINS.filter((re) => re.test(text)).length >= 2 && /(같이|함께|종합|보고|바탕|방향|계획)/.test(text);
}

export function analysisQuery(text: string): AnalysisKind | null {
  const t = text.trim();
  // "최근 스파링 기록을 분석해 줘" names the learner's own records without "내"
  const ownRecords = /(스파링 기록|과거|지난|이전|저장한|즐겨\s*찾기|만든 기술|식사 기록|영양 기록|학습 상태|훈련 기록)/.test(t);
  if (!MINE.test(t) && !ownRecords) return null;
  if (DOMAINS.filter((re) => re.test(t)).length >= 2 && /(같이|함께|종합|보고|바탕|방향|계획)/.test(t)) return null;
  if (/(새로운|새|다른|추천).{0,8}(콤보|콤비네이션|조합)|(콤보|콤비네이션|조합).{0,8}추천/.test(t)) return 'combo_recommend';
  if (/(반복|자주|계속).{0,10}(어려|막히|힘들|안 되|실수)|어려워하는 (상황|부분)/.test(t)) return 'difficulties';
  if (/스파링/.test(t)) return 'sparring';
  if (/(나만의 기술|내가 만든 기술|직접 만든 기술|만든 기술)/.test(t)) return 'my_techniques';
  if (/(즐겨\s*찾기|즐겨찾|관심 기술)/.test(t)) return 'favorites';
  if (/(전술|전략)/.test(t)) return 'tactics';
  if (/(콤보|콤비네이션|기술 조합)/.test(t)) return 'combos';
  if (/(식사|식단|먹은|영양|칼로리|단백질|끼니)/.test(t)) return 'meals';
  if (/((지난|과거|이전|예전).{0,6}(대화|수업|배운|물어)|학습 상태|지금까지 (배운|공부한) 내용)/.test(t)) return 'memory';
  if (/(파이팅\s*)?스타일.{0,6}(분석|알려|뭐|어때)|어떤 스타일/.test(t)) return 'style';
  if (/(다음|오늘|이번 주).{0,6}(훈련|연습).{0,10}(추천|계획|짜|만들|뭐)|훈련 기록.{0,12}(추천|다음)/.test(t)) return 'next_training';
  return null;
}

const day = (iso: string) => iso.slice(0, 10);
const name = (id: string) => resolveTechnique(id)?.name ?? id;

function goalTexts(now: Date): string[] {
  return goalSlots(now)
    .map((s) => s.entry?.text ?? '')
    .filter((x) => x.trim());
}

function styleAnswer(): string {
  const lines: string[] = [];
  const p = getProfile();
  const tags = p.style?.tags ?? [];
  if (tags.length) lines.push(`- 개인 파이터 프로필 스타일: ${tags.map((t) => t.label).join(' · ')} (AI 분석${p.style?.status === 'confirmed' ? ', 사용자 확인함' : ', 사용자 미확인 — 참고만'})`);
  else {
    // the profile was answered but its style was never analysed: the same rules, computed now, never saved
    const computed = analyzeStyle(p).tags;
    if (computed.length) lines.push(`- 개인 파이터 프로필 답변으로 계산한 스타일: ${computed.map((t) => `${t.label}(근거: ${t.basis.slice(0, 3).map((k) => fieldOf(k)?.label ?? k).join(', ')})`).join(' · ')} (앱 계산 · 저장·확인 안 됨)`);
  }
  const my = getCachedMyStyleAnalysis();
  if (my) lines.push(`- 내 스타일 분석 (${day(my.generatedAt)}, ${my.source === 'ai' ? 'AI 분석' : '기록 기반 계산'}): ${my.styleName} — 공격 ${my.attackTendency} · 수비 ${my.defenseTendency} · 거리 ${my.distance}`);
  const a = listSparringAnalyses()[0];
  if (a?.styleObservations.length) lines.push(`- 최근 영상 스파링 분석 관찰 (${a.date}): ${a.styleObservations.slice(0, 2).join(' / ')}`);
  const learned = [...learnedMap().values()].filter((e) => e.progress.status === 'proficient').slice(0, 5);
  if (learned.length) lines.push(`- 숙련 기록이 있는 기술: ${learned.map((e) => e.technique.name).join(', ')}`);
  if (!lines.length) return '스타일을 판단할 저장 데이터(프로필 스타일 · 스타일 분석 · 스파링 분석 · 숙련 기술)가 없습니다. 개인 파이터 프로필 인터뷰나 스파링 기록을 남기면 그 기록으로 분석합니다.';
  return ['저장된 기록으로 본 파이팅 스타일입니다 (각 줄의 출처를 함께 적었습니다).', ...lines].join('\n');
}

function difficultiesAnswer(now: Date): string {
  const parts: string[] = [];
  const sp = analyzeSparring(learnedMap(), goalTexts(now));
  const spRec = sp.split('\n').filter((l) => /여러 번 나온 말|개선할 점에 나옵니다|반복됩니다/.test(l));
  if (spRec.length) parts.push('■ 스파링 기록에서 반복된 것', ...spRec);
  const m = learningMemory();
  if (m.difficulties.length) parts.push('■ AI 코치 대화에서 어렵다고 말한 것', ...m.difficulties.slice(0, 4).map((d) => `- "${d.text.slice(0, 70)}" (${d.at.slice(0, 10)})`));
  if (m.weakConcepts.length) parts.push('■ 수업에서 이해가 부족했던 개념', ...m.weakConcepts.slice(0, 4).map((w) => `- ${w.name}: ${w.label} (${w.at.slice(0, 10)})`));
  const weak = [...learnedMap().values()].filter((e) => e.progress.status === 'needs_improvement').slice(0, 4);
  if (weak.length) parts.push('■ 숙련도 기록상 개선 필요', ...weak.map((e) => `- ${e.technique.name}${e.progress.latestScore !== null ? ` (최근 자세 점수 ${e.progress.latestScore})` : ''}`));
  if (!parts.length) return '반복해서 어려워한 상황을 찾을 기록이 없습니다 (스파링 "개선할 점", 코치 대화, 수업 기록, 숙련도 기록 모두 비어 있음). 기록 없이 추측하지 않습니다.';
  return ['기록에 여러 번 나온 어려움입니다 (출처별로 나눴습니다).', ...parts].join('\n');
}

function memoryAnswer(): string {
  const text = learningMemoryText(null);
  const learned = [...learnedMap().values()].slice(0, 8);
  if (!text && !learned.length) return '참고할 지난 AI 코치 대화나 수업 기록이 없습니다.';
  return [
    text || '지난 AI 코치 대화 기록이 없습니다.',
    learned.length ? `[현재 학습 상태 — 숙련도 기록] ${learned.map((e) => `${e.technique.name}(${MASTERY_LABEL[e.progress.status]})`).join(', ')}` : '',
    '앱의 판단: 자주 묻거나 어렵다고 한 기술 중 숙련도가 "학습 중·개선 필요·기록 없음"인 것을 다음 복습 1순위로 봅니다. 이미 끝낸 수업은 처음부터 다시 만들지 않고 이어서 다룹니다.',
  ]
    .filter(Boolean)
    .join('\n');
}

function nextTrainingAnswer(now: Date): string {
  const learned = learnedMap();
  const recent = listTrainingHistory().filter((e) => now.getTime() - new Date(`${e.date}T00:00:00`).getTime() <= 14 * 86400000);
  const recentIds = new Set(recent.flatMap((e) => e.techniqueIds));
  // the coach's own matcher ("잽" → boxing__jab) finds the techniques a goal names
  const goalTech = goalTexts(now).flatMap((g) => exactTechniquesInText(g, null).matches);
  const weak = [...learned.values()].filter((e) => e.progress.status === 'needs_improvement' || e.progress.status === 'learning');
  const pick: { id: string; why: string }[] = [];
  // 개선 필요 · 학습 중 first (what the records say is weak), then what the goals name — a goal technique already
  // proficient is kept for linking practice, said so
  for (const e of weak) if (!pick.some((p) => p.id === e.technique.id)) pick.push({ id: e.technique.id, why: `${MASTERY_LABEL[e.progress.status]}${recentIds.has(e.technique.id) ? '' : ' · 최근 2주 연습 없음'}` });
  for (const t of goalTech) {
    if (pick.some((p) => canonicalTechniqueId(p.id) === canonicalTechniqueId(t.id))) continue;
    const e = learnedOf(learned, t.id);
    pick.push({ id: t.id, why: `목표에 있음${e ? ` (${MASTERY_LABEL[e.progress.status]}${e.progress.status === 'proficient' ? ' — 연결 연습 위주' : ''})` : ' (학습 기록 없음)'}` });
  }
  const routine = listMyGymRoutines().find((r) => r.active);
  const lines = [
    `최근 2주 훈련 기록 ${recent.length}건 (완료 ${recent.filter((e) => e.completed).length}건)${recent.length ? ` — 연습한 기술: ${[...recentIds].slice(0, 6).map(name).join(', ')}` : ''}.`,
    pick.length ? '다음 훈련 추천 (기록 기준 우선순위):' : '목표·숙련도 기록에서 우선 연습할 기술을 찾지 못했습니다. 목표에 기술 이름을 적거나 기술을 연습하면 그 기록으로 추천합니다.',
    ...pick.slice(0, 5).map((p, i) => `  ${i + 1}. ${name(p.id)} — ${p.why}`),
    routine?.days.length ? `루틴 「${routine.name}」 훈련 요일(${[...routine.days].sort((a, b) => a.weekday - b.weekday).map((d) => WEEKDAY_LABEL[d.weekday]).join('·')})에는 근력 루틴이 있으니, 기술 연습은 그 앞이나 쉬는 날에 짧게 넣는 것을 권장합니다.` : '',
    '이 추천은 계획이며 훈련 기록에 저장되지 않습니다. 실제로 한 훈련만 기록됩니다.',
  ];
  return lines.filter(Boolean).join('\n');
}

const STORES: Record<AnalysisKind, string[]> = {
  combos: ['내 콤보', '배운 기술·숙련도', '기술 연결 기록'],
  combo_recommend: ['내 콤보', '배운 기술·숙련도', 'MARTIALDEX 콤보 기록'],
  tactics: ['내 전술', '내 콤보', '배운 기술·숙련도'],
  my_techniques: ['나만의 기술', '기술 연결 기록'],
  favorites: ['즐겨찾기', '배운 기술·숙련도'],
  sparring: ['스파링 기록', '영상 스파링 분석', '개인 목표', '배운 기술·숙련도'],
  difficulties: ['스파링 기록', 'AI 코치 대화', '수업 기록', '배운 기술·숙련도'],
  memory: ['AI 코치 대화', '수업 기록', '배운 기술·숙련도'],
  meals: ['영양 프로필', '식사 기록'],
  style: ['개인 파이터 프로필', '내 스타일 분석', '영상 스파링 분석', '배운 기술·숙련도'],
  next_training: ['훈련 기록', '개인 목표', '배운 기술·숙련도', '훈련 루틴'],
};

/** Kinds where a model's labelled interpretation helps (장단점 · 개선 방향 · 스타일 해석). */
const NARRATIVE: AnalysisKind[] = ['tactics', 'sparring', 'style'];

export async function answerAnalysis(kind: AnalysisKind, opts: { index?: () => Promise<KnowledgeIndex>; art?: string | null; now?: Date } = {}): Promise<AnalysisAnswer> {
  const now = opts.now ?? new Date();
  try {
    let text: string;
    switch (kind) {
      case 'combos':
        text = analyzeCombos();
        break;
      case 'combo_recommend':
        text = opts.index ? recommendCombos(await opts.index(), opts.art ?? null) : 'MARTIALDEX 콤보 기록을 불러오지 못해 추천하지 않았습니다.';
        break;
      case 'tactics':
        text = analyzeTactics();
        break;
      case 'my_techniques':
        text = describeMyTechniques();
        break;
      case 'favorites':
        text = describeFavorites();
        break;
      case 'sparring':
        text = analyzeSparring(learnedMap(), goalTexts(now));
        break;
      case 'difficulties':
        text = difficultiesAnswer(now);
        break;
      case 'memory':
        text = memoryAnswer();
        break;
      case 'meals':
        text = describeMeals(now);
        break;
      case 'style':
        text = styleAnswer();
        break;
      case 'next_training':
        text = nextTrainingAnswer(now);
        break;
    }
    const empty = /(없습니다|찾지 못했습니다)\.?\s*(\(|$)/.test(text.split('\n')[0]) && text.split('\n').length <= 2;
    return { kind, text, stores: STORES[kind], loadFailed: false, ...(NARRATIVE.includes(kind) && !empty ? { narrativeFacts: text } : {}) };
  } catch {
    return { kind, text: `${STORES[kind][0]} 기록을 읽지 못했습니다. 저장된 내용이 없는 것이 아니라 불러오기에 실패한 것이므로 분석하지 않았습니다.`, stores: STORES[kind], loadFailed: true };
  }
}
