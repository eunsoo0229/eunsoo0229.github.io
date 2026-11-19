// The AI coach ⇄ training ecosystem (사양 §6-2): "내 커리큘럼 어디까지 했어?", "오늘 뭐 배우면 돼?", "다음에 배울 기술",
// "요즘 실력이 늘었어?", "커리큘럼 바꾸고 싶어". Answers are written by code from the same modules the screens use, so the
// chat and the screens never disagree. The coach never changes the curriculum or goals: a change request is answered
// with the suggestions and a button to 나의 학습 커리큘럼, where the learner applies it.

import type { Technique } from '../../types';
import { ECO_STATE_LABEL, type TechniqueState } from './learningState';
import { currentStage, EVALUATION_LABEL, refreshPlan, stageProgress, todayTasks, weeklyProgress, type PersonalCurriculum, type RefreshDeps } from './personalCurriculum';
import type { Performance } from './performance';

export type EcoQuery = 'today' | 'status' | 'next' | 'performance' | 'change';

const MINE = /(내|나의|제|저의|나|저)\s?/;

export function ecosystemQuery(text: string, hasPlan: boolean): EcoQuery | null {
  const t = text.trim();
  const curr = /(커리큘럼|학습 경로|로드맵|학습 계획)/.test(t);
  if (curr && /(바꾸|변경|수정|고치|조정|다시 짜|새로 짜)/.test(t)) return 'change';
  if (/(오늘의? 학습|오늘 (뭘|무엇을|뭐) (배우|연습|공부|하면)|오늘 학습 목표|오늘 할 (학습|훈련))/.test(t)) return 'today';
  if (curr && MINE.test(t) && /(어디까지|진행|상태|현재|몇 단계|보여|알려|어때)/.test(t)) return 'status';
  if (/(성과|성장 리포트|실력이 (늘|좋아|올라)|얼마나 (늘|발전|성장)|발전했|성장했)/.test(t) && MINE.test(t)) return 'performance';
  if (hasPlan && /(다음(에|으로)? (배울|학습할|공부할|할) (기술|것)|다음 학습)/.test(t)) return 'next';
  return null;
}

export interface EcoAnswer {
  text: string;
  stores: string[];
  techniqueIds: string[];
  action?: { label: string; to: string };
}

export function answerEcosystem(q: EcoQuery, input: { plan: PersonalCurriculum | null; states: Map<string, TechniqueState>; deps: RefreshDeps; performance?: () => Performance }): EcoAnswer {
  const { plan, states, deps } = input;
  const nm = (id: string) => deps.resolve(id)?.koreanName ?? deps.resolve(id)?.name ?? id;
  const stores = ['나의 학습 커리큘럼', '기술별 학습 상태(자세 측정·수업 평가·훈련 기록)'];
  const open = { label: '나의 학습 커리큘럼 열기', to: '/my-curriculum' };
  if (q === 'performance') {
    const perf = input.performance?.();
    if (!perf || !perf.hasAnyData) return { text: '성과를 분석할 기록이 아직 없습니다. 훈련을 기록하거나 자세 측정·AI 코치 수업을 하면 성과 대시보드에 쌓입니다.', stores: ['훈련 기록', '자세 측정 기록', '수업 기록'], techniqueIds: [], action: { label: '성과 대시보드 열기', to: '/performance' } };
    const lines = ['최근 30일 기록으로 본 성과입니다 (숫자는 앱이 기록에서 계산했습니다).', ...perf.facts.slice(0, 6).map((f) => `- ${f.text.replace(/\b([a-z-]+__[\w-]+)\b/g, (m) => nm(m))}  (근거: ${f.basis})`)];
    if (!perf.improved.length) lines.push('- 이 기간에 같은 방식으로 두 번 이상 평가한 기술이 없어 "실력이 늘었다"고 말할 근거는 없습니다.');
    return { text: lines.join('\n'), stores: ['훈련 기록', '자세 측정 기록', '수업 기록', '기술별 학습 상태'], techniqueIds: perf.improved.map((x) => x.techniqueId), action: { label: '성과 대시보드 열기', to: '/performance' } };
  }
  if (!plan) {
    return { text: '아직 나의 학습 커리큘럼이 없습니다. 목표(예: 복싱 기본기, 레슬링 기초, 특정 기술 향상)를 정하면 지금 학습 기록에 맞춰 단계별 경로를 만들어 드립니다.', stores, techniqueIds: [], action: { label: '커리큘럼 만들기', to: '/my-curriculum' } };
  }
  const { plan: p, suggestions } = refreshPlan(plan, states, deps);
  const cur = currentStage(p, states);
  if (q === 'today' || q === 'next') {
    const tasks = todayTasks(p, states);
    if (!tasks.length) return { text: `커리큘럼 "${p.goal.label}"에서 오늘 할 항목이 없습니다${cur === null ? ' — 모든 단계를 통과했습니다' : ''}.`, stores, techniqueIds: [], action: open };
    const kind = { review: '복습', learn: '학습', evaluate: '평가' } as const;
    return {
      text: [`커리큘럼 "${p.goal.label}" — 오늘의 학습 목표입니다.`, ...tasks.map((t) => `- [${kind[t.kind]}] ${nm(t.techniqueId)} — ${t.reason} (평가: ${EVALUATION_LABEL[t.evaluation]})`), '\n학습 시작 전 "훈련 전 안전 체크"도 확인해 주세요.'].join('\n'),
      stores,
      techniqueIds: tasks.map((t) => t.techniqueId),
      action: open,
    };
  }
  if (q === 'status') {
    const week = weeklyProgress(p);
    const lines = [`커리큘럼 "${p.goal.label}" (${p.createdAt.slice(0, 10)} 시작)`, `- 현재 ${cur === null ? '모든 단계 통과' : `${cur + 1}단계`} · 이번 주 ${week.done}/${week.target}개 학습 완료`];
    for (const s of p.stages) {
      const sp = stageProgress(p, s.index, states);
      lines.push(`- ${s.title}: ${sp.done}/${sp.total} 학습 완료 이상${sp.repeat ? `, 반복 필요 ${sp.repeat}` : ''}${sp.passed ? ' (통과)' : ''}`);
    }
    const missing = p.items.filter((i) => states.get(i.techniqueId)?.evaluationMissing && states.get(i.techniqueId)?.state !== 'not_started').length;
    if (missing) lines.push(`- 평가 데이터가 없는 기술 ${missing}개는 숙련도를 "확인 완료"로 보지 않았습니다.`);
    return { text: lines.join('\n'), stores, techniqueIds: p.items.map((i) => i.techniqueId).slice(0, 6), action: open };
  }
  // change: never applied from the chat
  const lines = ['커리큘럼 변경은 대화에서 바로 적용하지 않습니다 — "나의 학습 커리큘럼"에서 직접 적용·수정할 수 있습니다.'];
  if (suggestions.length) lines.push('지금 기록으로 본 조정 제안:', ...suggestions.slice(0, 4).map((s) => `- ${s.text}`));
  else lines.push('지금 기록으로는 조정 제안이 없습니다. 목표를 바꾸거나 기술을 추가·제외할 수 있습니다.');
  return { text: lines.join('\n'), stores, techniqueIds: suggestions.flatMap((s) => s.techniqueIds).slice(0, 6), action: open };
}

/** States for a few techniques only (cheap — for the coach's safety line). */
export function stateLabelOf(s: TechniqueState | undefined): string {
  return s ? ECO_STATE_LABEL[s.state] : '기록 없음';
}

export type { Technique };
