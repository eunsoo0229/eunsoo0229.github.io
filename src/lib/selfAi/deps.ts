// Real dependencies of the conversation coach inside the app.

import { answerCoachQuestion } from '../coachKnowledge/questions';
import { localModelEnabled } from '../coachProvider/localModel';
import { getMartialArt } from '../loadData';
import { listLessonLog } from '../coachLesson/lessonLog';
import { userCoachContext } from '../coachContext/userContext';
import { answerPersonalFact, lessonFitText, personalFactQuery } from '../coachContext/personalFacts';
import { analysisQuery, answerAnalysis, isPersonalComposite } from '../coachContext/coachAnalysis';
import { goalSlots } from '../goals/store';
import { exactTechniquesInText } from '../coachKnowledge/lookup';
import { fixTerminology } from './terminology';
import { loadKnowledgeIndex } from '../martialdexKnowledge/loadIndex';
import { selfResearchProvider } from '../selfResearch/provider';
import { analyzeFighterStyleWithEvidence } from '../fighterStyle/evidenceStyle';
import type { CoachAgentDeps } from './coachAgent';
import type { SelfAiChatResult } from './types';
import { selfAiBackend } from './transport';
import { loadLearnerModel } from '../personalCoach/learnerStore';
import { getCoachDayRun } from '../aiCoachDay/sessionStore';
import { getCurriculum } from '../curriculum/curriculumService';
import { resolveTechnique } from '../userTechniques/service';
import { styleProfileOf } from '../fighterProfile/styleTraits';
import { listConversations } from './conversationStore';
import { pastTopicsLine } from './conversationMemory';
import { getActiveCurriculum } from '../trainingEcosystem/curriculumStore';
import { answerEcosystem, ecosystemQuery } from '../trainingEcosystem/coachBridge';
import { appRefreshDeps, computeEcoStates } from '../trainingEcosystem/useEco';
import { computePerformance } from '../trainingEcosystem/performance';
import { stateOf } from '../trainingEcosystem/learningState';
import { safetyContextLine } from '../safety/techniqueSafety';
import { getTechniqueConnections } from '../techniqueGraph/buildGraph';
import { computeSkillProgress } from '../skillProgress/computeSkillProgress';
import { listTrainingHistory } from '../trainingHistory/service';
import { getAllRecords } from '../poseAnalysis/recordsService';
import { listGoals } from '../goals/store';
import { deriveEntryMartialArt } from '../trainingAnalytics/historyView';
import { socialTrending } from '../social/trendingService';
import { getProfile } from '../fighterProfile/store';
import { valueOf } from '../fighterProfile/catalog';

// 대화하기의 사용자 데이터 = 수업하기와 같은 공통 컨텍스트 (coachContext/userContext): 프로필 · 개인 목표 ·
// 학습 기록 · 최근 수업. 여기서 따로 모으지 않는다.
function learnerContext(art: string | null, topic: string): string {
  return userCoachContext({ martialArt: art, topic, budget: { profile: 600, goals: 700, learning: 800 }, detailBudget: 900 }).text;
}

export function appCoachDeps(lessonContext?: () => string | null): CoachAgentDeps {
  return {
    research: (req) => selfResearchProvider.search(req),
    // the desktop's own model, or the self-AI server the user connected (transport.ts) — never another provider
    chat: async (req, onDelta): Promise<SelfAiChatResult> => {
      try {
        return await selfAiBackend().chat(req, onDelta);
      } catch {
        return { ok: false, code: 'UNKNOWN', message: '로컬 AI 요청 중 오류가 발생했습니다.' };
      }
    },
    knowledgeIndex: () => loadKnowledgeIndex(),
    learnerContext,
    learner: () => loadLearnerModel(),
    lessonLogs: () => listLessonLog(),
    activeLesson: () => {
      const run = getCoachDayRun();
      if (!run || run.finishedAt) return null;
      const c = getCurriculum(run.curriculumId);
      if (!c) return null;
      const cur = resolveTechnique(run.techniqueIds[run.index] ?? '');
      return { title: c.title, route: `/learning/${c.martialArt}/${c.id}/coach/${run.day}?mode=${run.mode}`, current: cur?.name ?? null, stepLabel: run.step };
    },
    lessonContext,
    dataAnswer: async (technique, text, art) => {
      const a = await answerCoachQuestion(technique, text, { useModel: localModelEnabled(), martialArt: art });
      return a.text?.trim() ? a.text : null;
    },
    artName: (art) => getMartialArt(art)?.nameKo ?? art,
    // 인기 콘텐츠는 MARTIALDEX 내부 테이블 집계다 — 웹 검색으로 대체하지 않는다 (§16).
    socialTrending: (period) => socialTrending(period),
    personalFact: (text) => {
      const q = personalFactQuery(text);
      return q ? answerPersonalFact(q) : null;
    },
    lessonFit: (ids) => lessonFitText(ids),
    personalAnalysis: async (text, art) => {
      const kind = analysisQuery(text);
      return kind ? answerAnalysis(kind, { index: () => loadKnowledgeIndex(), art }) : null;
    },
    goalText: (question) => {
      const order = /이번\s*달/.test(question) ? ['month', 'week', 'year', 'long_term'] : /올해/.test(question) ? ['year', 'month', 'week', 'long_term'] : ['week', 'month', 'year', 'long_term'];
      const slots = goalSlots(new Date());
      for (const o of order) {
        const s = slots.find((x) => x.slot === o);
        if (s?.entry?.text.trim()) return { label: s.label, text: s.entry.text };
      }
      return null;
    },
    terminology: (text, context) => fixTerminology(text, exactTechniquesInText(`${context ?? ''}\n${text}`, null).matches),
    namedIn: (text) => exactTechniquesInText(text, null).matches.slice(0, 12),
    personalComposite: (text) => isPersonalComposite(text),
    ecosystem: (text) => {
      const plan = getActiveCurriculum();
      const q = ecosystemQuery(text, !!plan);
      if (!q) return null;
      const states = computeEcoStates();
      return answerEcosystem(q, {
        plan,
        states,
        deps: appRefreshDeps(),
        performance: () => computePerformance({ period: '30d', entries: listTrainingHistory(), poseRecords: getAllRecords(), lessonLogs: listLessonLog(), states, plan, goals: listGoals().map((g) => ({ scope: g.scope, text: g.text, updatedAt: g.updatedAt ?? g.createdAt })), artOfEntry: deriveEntryMartialArt, artName: (a) => getMartialArt(a)?.nameKo ?? a }),
      });
    },
    safetyLine: (t) => {
      // only the technique's prerequisites need a state (cheap: one skill computation each)
      const states = new Map();
      try {
        for (const p of getTechniqueConnections(t).prerequisite.slice(0, 5)) {
          const pt = resolveTechnique(p.techniqueId);
          if (pt) states.set(pt.id, stateOf(pt, computeSkillProgress(pt.id)));
        }
      } catch {
        /* no graph → no prerequisite line */
      }
      return safetyContextLine(t, states);
    },
    styleProfile: () => styleProfileOf(),
    styleRecords: async () => (await answerAnalysis('style', { index: () => loadKnowledgeIndex(), art: null }))?.text ?? null,
    // the conversation being answered is the most recently updated one — its own topics are in the turn's memory
    pastTopics: () => {
      const all = listConversations();
      return pastTopicsLine(all, all[0]?.id ?? null);
    },
    // 체격 비교 — the stored profile values only (read; never written by the coach)
    bodyProfile: () => {
      try {
        const p = getProfile();
        const num = (k: string) => {
          const v = valueOf(p, k);
          return typeof v === 'number' ? v : null;
        };
        const st = valueOf(p, 'body.stance');
        return { heightCm: num('body.height'), reachCm: num('body.wingspan'), weightKg: num('body.weight'), stance: st === 'orthodox' || st === 'southpaw' || st === 'switch' ? st : null };
      } catch {
        return { heightCm: null, reachCm: null, weightKg: null, stance: null };
      }
    },
    activeLessonTechniqueIds: () => {
      const run = getCoachDayRun();
      return run && !run.finishedAt ? run.techniqueIds : null;
    },
    resolveName: (name) => selfResearchProvider.entity(name),
    fighterStyle: (fighter, art, opts) =>
      analyzeFighterStyleWithEvidence(
        fighter,
        art,
        {
          research: (req) => selfResearchProvider.search(req),
          chat: (req) => selfAiBackend().chat(req),
          knowledgeIndex: () => loadKnowledgeIndex(),
        },
        opts
      ),
  };
}
