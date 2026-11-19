// One request, several pieces of work (사양 §2–§5, §7-1).
//
// "내 파이팅 스타일과 비슷한 선수들의 더블렉 셋업을 찾아보고, 관련 MMA 강의 영상까지 조사해서
//  나에게 맞는 수업으로 만들어 줘" is five jobs: read the profile → find similar fighters →
// research their double-leg setups → find instructional videos → build a lesson. The single-intent
// route answered one of them. Here each job runs on its own (searches in parallel, each with its own
// request so the 10-minute search cache never hands one kind's results to another), each produces a
// section that says what it found and what it could not, and the answer is assembled from them.
// MARTIALDEX records, web pages and videos stay apart (사양 §4, §9-4). The local model only writes a
// short, labelled summary from the sections' own text; facts come from the sections.

import type { Technique } from '../../types';
import type { KnowledgeIndex } from '../martialdexKnowledge/types';
import { gatherTechniqueKnowledge } from '../martialdexKnowledge/index';
import type { ResearchOutcome, ResearchRequest, ResearchResult } from '../selfResearch/types';
import { resolveTechnique } from '../userTechniques/service';
import { categoryTopicsInText } from '../knowledgeBase/topics';
import { sequenceReport } from './sequenceReport';
import { planLesson, lessonPlanText } from './lessonPlanner';
import { guardAnswer } from './guard';
import { checkClaims, dropContradicted } from './evidenceCheck';
import { INTENT_LABEL, type CoachIntent, type IntentAnalysis } from './intents';
import { ASPECT_LABEL, referredTopic, type ConversationMemory, type TopicThread } from './conversationMemory';
import { externalVsDb, externalVsDbText, rankVideos, rarityStats, rarityText, similarFighters, similarFightersText, traitQuery, videoReportText, type ExternalTerm } from './compositeResearch';
import type { StyleProfile } from '../fighterProfile/styleTraits';
import type { ChatSource, CoachChatMessage, LessonProposal, SelfAiChatRequest, SelfAiChatResult, TurnResearchInfo } from './types';
import type { TurnPlan } from './router';

export interface CompositeDeps {
  research: (req: ResearchRequest) => Promise<ResearchOutcome>;
  chat: (req: SelfAiChatRequest, onDelta?: (d: string) => void) => Promise<SelfAiChatResult>;
  artName?: (art: string) => string;
  styleProfile?: () => StyleProfile;
  /** The existing record-based style answer (coachContext/coachAnalysis 'style'). */
  styleRecords?: () => Promise<string | null>;
  lessonFit?: (techniqueIds: string[]) => string;
  /** Is this a real person (a fighter)? — the app's entity lookup (Wikipedia). Names from page text are checked with it. */
  isPerson?: (name: string) => Promise<boolean>;
  toSources: (results: ResearchResult[]) => ChatSource[];
}

export interface CompositeInput {
  text: string;
  plan: TurnPlan;
  analysis: IntentAnalysis;
  memory: ConversationMemory;
  index: KnowledgeIndex | null;
  inLesson: boolean;
  requestId: string;
  onStatus?: (s: string) => void;
  onDelta?: (d: string) => void;
}

type TaskStatus = 'done' | 'partial' | 'failed' | 'skipped';
interface Section {
  intent: CoachIntent;
  title: string;
  text: string;
  status: TaskStatus;
  note?: string;
}

const label = (t: Technique) => (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name);
// the record's English name without catalogue words ("Basic Double Leg" → "Double Leg") — articles don't say "basic"
const enName = (t: Technique) => t.name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/^(basic|standard|traditional|classic|simple|regular)\s+/i, '').trim();

function outcomeNote(o: ResearchOutcome | null, what: string): { status: TaskStatus; note: string; results: ResearchResult[] } {
  if (!o) return { status: 'skipped', note: `${what} 검색 안 함`, results: [] };
  if (!o.ok) {
    const why = o.code === 'DISABLED' ? '자체 검색이 꺼져 있음 (설정 > AI 엔진)' : o.code === 'UNSUPPORTED' ? '이 기기에서는 실시간 검색 불가' : o.message;
    return { status: 'failed', note: `${what} 검색 실패 — ${why}`, results: [] };
  }
  const read = o.results.filter((r) => r.extraction.status === 'ok').length;
  const cached = o.cache ? ` · ${o.cache.searchedAt.slice(11, 16)}에 검색한 결과 재사용(새 검색 아님)` : '';
  return { status: o.results.length ? 'done' : 'partial', note: `${what} ${o.results.length}건 (본문 확인 ${read}건)${cached}`, results: o.results };
}

/** MARTIALDEX records for the topic: the technique, recorded setups into it, combos, follow-ups, counters. */
function dbSection(techniques: Technique[], art: string | null, index: KnowledgeIndex | null, text: string, artName: (a: string) => string): Section {
  const lines: string[] = [];
  for (const t of techniques.slice(0, 2)) {
    const k = index ? gatherTechniqueKnowledge(t.id, index, { art: art ?? undefined }) : null;
    lines.push(`● ${label(t)} — ${artName(t.martialArt)} · ${t.category}`);
    if (t.description) lines.push(`  ${t.description.replace(/\s+/g, ' ').slice(0, 160)}${t.description.length > 160 ? '…' : ''}`);
    const seqs = [...(k?.setupsInto ?? []), ...(k?.combos.map((c) => c.sequence) ?? [])].filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i).slice(0, 5);
    if (seqs.length) lines.push(...seqs.map((s) => `  - [${s.kind === 'setup' ? '셋업' : '콤보'}] ${s.steps.map((x) => x.name).join(' → ')}${s.purpose ? ` — ${s.purpose}` : ''}`));
    else lines.push('  - 기록된 셋업·콤보 없음');
    const follow = (k?.followUps ?? []).slice(0, 3).map((f) => resolveTechnique(f.techniqueId)?.name).filter(Boolean);
    if (follow.length) lines.push(`  - 이어지는 기술(기록): ${follow.join(', ')}`);
    if (t.variations.length) lines.push(`  - 변형: ${t.variations.slice(0, 4).join(', ')}`);
    if (t.counters.length) lines.push(`  - 카운터: ${t.counters.slice(0, 3).join(', ')}`);
  }
  if (!techniques.length) {
    const fam = categoryTopicsInText(text, art)[0];
    if (fam) lines.push(`● ${fam.category} 계열 기록: ${fam.members.slice(0, 8).map((m) => m.koreanName ?? m.name).join(', ')}`);
  }
  if (!lines.length) return { intent: 'TECHNIQUE_SEARCH', title: 'MARTIALDEX 내부 기록', text: '질문에서 MARTIALDEX 기술 이름을 찾지 못해 내부 기록을 조회하지 못했습니다.', status: 'partial' };
  return { intent: 'TECHNIQUE_SEARCH', title: 'MARTIALDEX 내부 기록', text: lines.join('\n'), status: 'done' };
}

/** Lesson proposal from the topic: the planner (records only) + this turn's / the conversation's sources and videos. */
export function proposalFromTopic(input: { topicLabel: string; techniques: Technique[]; art: string | null; index: KnowledgeIndex | null; sourceUrls: string[]; videoUrls: string[]; summary: string[] }): { proposal: LessonProposal | null; planText: string } {
  const names = input.techniques.map((t) => t.koreanName ?? t.name).join(' ');
  const lp = planLesson(`${names} 배우고 싶어`, { art: input.art, index: input.index });
  const ids = [...new Set([...lp.items.map((i) => i.technique.id), ...input.techniques.map((t) => t.id)])];
  if (!ids.length) return { proposal: null, planText: lp.items.length ? lessonPlanText(lp) : '' };
  return {
    proposal: { topic: input.topicLabel.slice(0, 80), martialArt: lp.art ?? input.art, techniqueIds: ids.slice(0, 6), sequenceIds: lp.sequences.map((s) => s.id).slice(0, 4), sourceUrls: input.sourceUrls.slice(0, 8), candidateIds: [], summary: input.summary, videoUrls: input.videoUrls.slice(0, 6) },
    planText: lp.items.length ? lessonPlanText(lp) : '',
  };
}

export function topicSummary(t: TopicThread): string[] {
  return [`대화에서 ${t.turns}번 다룸: ${t.aspects.map((a) => ASPECT_LABEL[a]).join(', ')}`, ...t.questions.slice(-3).map((q) => `질문: "${q}"`), ...(t.sourceUrls.length ? [`찾은 자료 ${t.sourceUrls.length}건`] : []), ...(t.videoUrls.length ? [`찾은 영상 ${t.videoUrls.length}개`] : [])];
}

export async function compositeTurn(input: CompositeInput, deps: CompositeDeps): Promise<{ message: Omit<CoachChatMessage, 'id' | 'createdAt'>; results: ResearchResult[]; topic: { key: string; label: string; techniqueIds: string[]; art: string | null } | null }> {
  const { text, plan, analysis: ia, memory, index } = input;
  const want = (i: CoachIntent) => ia.intents.includes(i);
  const artName = deps.artName ?? ((a: string) => a);

  // ---- topic: named in the question, else the conversation's (사양 §6-2)
  let techniques = plan.techniques.filter((t) => !/^(combination|combo|setup|counter)$/i.test(t.name));
  // one topic: a second record from another art (a loose name match in the sentence) is not part of it unless that art was named
  if (techniques.length > 1 && !plan.art) techniques = techniques.filter((t) => t.martialArt === techniques[0].martialArt);
  let fromTalk: TopicThread | null = null;
  let alternatives: TopicThread[] = [];
  if (!techniques.length && (ia.refersToConversation || ia.compareWithDb || want('LESSON_REQUEST') || want('SETUP_RESEARCH') || want('VIDEO_SEARCH') || want('MMA_STRATEGY_RESEARCH') || want('TECHNIQUE_SEARCH'))) {
    const ref = referredTopic(memory, text);
    fromTalk = ref.topic;
    alternatives = ref.alternatives;
    if (fromTalk) techniques = fromTalk.techniqueIds.map((id) => resolveTechnique(id)).filter((t): t is Technique => !!t);
  }
  // MMA context: asked now, or the topic was being discussed as MMA ("그 셋업 강의 영상도" after an MMA question)
  const mmaTopic = (fromTalk ?? memory.latest)?.aspects.includes('mma') && !plan.art;
  const mma = want('MMA_STRATEGY_RESEARCH') || (!!mmaTopic && (want('VIDEO_SEARCH') || want('SETUP_RESEARCH') || ia.compareWithDb));
  const art = mma && !plan.art ? techniques[0]?.martialArt ?? 'mixed-martial-arts' : plan.art ?? techniques[0]?.martialArt ?? fromTalk?.art ?? null;
  const topicLabel = techniques.length ? label(techniques[0]) : fromTalk?.label ?? (want('FIGHTER_COMPARISON') || want('STYLE_RARITY') || want('STYLE_ANALYSIS') ? '내 파이팅 스타일' : text.slice(0, 30));
  const subjectEn = techniques[0] ? enName(techniques[0]) : '';

  const needsProfile = want('STYLE_ANALYSIS') || want('FIGHTER_COMPARISON') || want('STYLE_RARITY') || ia.personalFit;
  const profile = needsProfile ? deps.styleProfile?.() ?? null : null;
  const sections: Section[] = [];
  // the profile could not be read: say so instead of returning an empty answer (측정 2026-11-15: 섹션이 비어 나감)
  if (needsProfile && !profile) {
    for (const i of ['FIGHTER_COMPARISON', 'STYLE_RARITY', 'STYLE_ANALYSIS'] as CoachIntent[]) {
      if (want(i)) sections.push({ intent: i, title: INTENT_LABEL[i], text: '파이터 프로필을 불러오지 못해 이 분석은 하지 않았습니다. 프로필 정보 없이 추측해서 비교하지 않습니다. "파이터 프로필"에서 스탠스·선호 기술 등을 입력한 뒤 다시 물어봐 주세요.', status: 'failed', note: '프로필 없음' });
    }
  }
  const allResults: ResearchResult[] = [];
  const research: TurnResearchInfo[] = [];
  const search = async (req: ResearchRequest, what: string) => {
    input.onStatus?.(`${what} 검색 중…`);
    const o = await deps.research(req).catch((): ResearchOutcome => ({ ok: false, code: 'UNKNOWN', message: '검색 요청 오류' }));
    research.push({ kind: req.kind ?? 'web', queries: [req.query, ...(req.queries ?? [])], reason: what, searched: o.ok, status: o.ok ? (o.results.length ? 'ok' : 'empty') : o.code === 'DISABLED' ? 'disabled' : o.code === 'UNSUPPORTED' ? 'unsupported' : 'failed', ...(o.ok ? { pagesRead: o.results.filter((r) => r.extraction.status === 'ok').length } : { message: o.message }) });
    return o;
  };

  // ---- 1. profile-based analyses
  if (want('STYLE_ANALYSIS') && profile) {
    const lines: string[] = [];
    const st = profile.traits.filter((t) => t.kind !== 'physical');
    if (st.length) lines.push(`프로필에서 읽은 스타일 특징: ${st.map((t) => `${t.label}${t.confirmed ? '' : '(AI 분석 · 미확인)'}`).join(', ')}`);
    const recorded = await deps.styleRecords?.().catch(() => null);
    if (recorded) lines.push(recorded.split('\n').filter((l) => l.startsWith('- ')).filter((l) => !/개인 파이터 프로필 스타일/.test(l)).join('\n'));
    if (ia.asksWeakness || /약점|단점|보완/.test(text)) {
      lines.push(profile.weakPoints.length ? `프로필에 적힌 약점·불편한 부분:\n${profile.weakPoints.map((w) => `- ${w.label}`).join('\n')}` : '프로필에 불편한 방어·포지션·개선할 부분이 적혀 있지 않아 약점을 기록으로 말할 수 없습니다.');
      if (st.some((t) => t.id === 'tag:kicker') && !profile.weakPoints.some((w) => /킥/.test(w.label))) lines.push('제 판단으로는(기록 아님): 킥 중심 스타일은 킥을 잡히거나 킥 직후 테이크다운을 허용하는 상황을 점검해 볼 만합니다.');
      if (st.some((t) => t.id === 'tag:pressure' || t.id === 'tag:infighter')) lines.push('제 판단으로는(기록 아님): 전진·근거리 성향은 들어갈 때 받는 카운터와 체력 소모를 점검해 볼 만합니다.');
    }
    const ok = lines.filter(Boolean).length > 0;
    sections.push({ intent: 'STYLE_ANALYSIS', title: ia.asksWeakness ? '내 스타일 분석 · 약점' : '내 스타일 분석', text: ok ? lines.filter(Boolean).join('\n') : '개인 파이터 프로필에 스타일을 판단할 답변이 없습니다. 프로필 인터뷰를 하면 그 기록으로 분석합니다.', status: ok ? 'done' : 'partial' });
  }

  // ---- 2. searches, each its own request (parallel)
  const jobs: Promise<void>[] = [];
  let fighterResults: ResearchResult[] = [];
  let matches: ReturnType<typeof similarFighters> = [];
  if (want('FIGHTER_COMPARISON') && profile) {
    jobs.push(
      (async () => {
        const st = profile.traits.filter((t) => t.kind !== 'physical');
        if (!st.length) {
          sections.push({ intent: 'FIGHTER_COMPARISON', title: '비슷한 스타일의 선수', text: similarFightersText([], profile), status: 'partial', note: '프로필 스타일 정보 없음' });
          return;
        }
        // phrasings that bring back pages NAMING fighters (lists, rankings, breakdowns), not style-category explainers
        const stance = st.find((t) => t.kind === 'stance')?.en[0];
        const styleW = st.find((t) => t.kind === 'style' || t.kind === 'range')?.en[0];
        const other = st.find((t) => t.kind === 'grappling' || t.kind === 'kicking')?.en[0];
        const qs = [
          `best ${[stance, styleW].filter(Boolean).join(' ')} fighters in UFC history`,
          `${stance ?? styleW ?? st[0].en[0]} UFC fighters who use ${other ?? 'kicks'}`,
          `UFC ${styleW ?? st[0].en[0]} fighter breakdown ${stance ?? ''}`.trim(),
          traitQuery(st, 'UFC fighters'),
        ];
        const o = await search({ query: qs[0], queries: qs.slice(1), kind: 'web', maxResults: 10, extractTop: 8 }, '비슷한 선수 자료');
        const n = outcomeNote(o, '선수 스타일 자료');
        fighterResults = n.results;
        const cands = similarFighters(n.results, profile, 3);
        // names come from page text: keep only those the entity lookup confirms as people (when it is available)
        if (deps.isPerson) {
          const kept: typeof cands = [];
          for (const c of cands) {
            if (kept.length >= 3) break;
            if (await deps.isPerson(c.name).catch(() => false)) kept.push(c);
          }
          matches = kept;
        } else matches = cands.slice(0, 3);
        sections.push({ intent: 'FIGHTER_COMPARISON', title: '비슷한 스타일의 선수', text: n.status === 'failed' ? `${n.note}. 선수 비교는 공개 자료를 읽어야 해서 하지 못했습니다.` : similarFightersText(matches, profile), status: n.status === 'failed' ? 'failed' : matches.length ? 'done' : 'partial', note: n.note });
      })()
    );
  }
  if (want('STYLE_RARITY') && profile) {
    jobs.push(
      (async () => {
        const st = profile.traits.filter((t) => t.kind !== 'physical');
        if (!st.length) {
          sections.push({ intent: 'STYLE_RARITY', title: '스타일 희귀성', text: rarityText(profile, [], false), status: 'partial' });
          return;
        }
        const stance = st.find((t) => t.kind === 'stance');
        const o = await search({ query: `${(stance ?? st[0]).en[0]} fighters percentage UFC`, queries: [`how common are ${(stance ?? st[0]).en[0]} fighters in MMA`, `${st[0].en[0]} style rare in MMA`], kind: 'web', maxResults: 8 }, '스타일 통계 자료');
        const n = outcomeNote(o, '통계 자료');
        sections.push({ intent: 'STYLE_RARITY', title: '스타일 희귀성', text: rarityText(profile, rarityStats(n.results, profile), n.status !== 'failed'), status: n.status === 'failed' ? 'partial' : 'done', note: n.note });
      })()
    );
  }
  let webResults: ResearchResult[] = [];
  const wantsWeb = (want('SETUP_RESEARCH') || mma || ia.compareWithDb) && !!subjectEn;
  if (wantsWeb) {
    jobs.push(
      (async () => {
        const sport = mma ? 'MMA' : art ? art.replace(/-/g, ' ') : '';
        const queries = mma
          ? [`MMA ${subjectEn} setup`, `${subjectEn} setups MMA strikes`, `wrestling setups for ${subjectEn}`, `MMA takedown entries ${subjectEn}`]
          : [`${subjectEn} setup ${sport}`, `${subjectEn} setups combinations`, `how to set up ${subjectEn}`];
        const o = await search({ query: queries[0], queries: queries.slice(1), kind: 'web', maxResults: 8, extractTop: 6, requireTerms: subjectEn.toLowerCase().split(/\s+/).filter((w) => w.length > 3) }, mma ? 'MMA 셋업 자료' : '셋업 자료');
        const n = outcomeNote(o, mma ? 'MMA 셋업 자료' : '셋업 자료');
        webResults = n.results;
      })()
    );
  }
  let videoRank: ReturnType<typeof rankVideos> = [];
  let videoDropped = 0;
  let videoNote: ReturnType<typeof outcomeNote> | null = null;
  if (want('VIDEO_SEARCH')) {
    jobs.push(
      (async () => {
        const subject = subjectEn || text.replace(/[^A-Za-z가-힣\s]/g, ' ').trim().slice(0, 40);
        const ko = techniques[0]?.koreanName;
        const setupy = want('SETUP_RESEARCH') || /셋업|진입/.test(text);
        // several phrasings — one query finds one corner of YouTube (사양 §5)
        const queries = [
          `${subject}${setupy ? ' setup' : ''} tutorial`,
          ...(mma ? [`MMA ${subject} setup`, `MMA wrestling instructional ${subject}`] : [`${subject} instructional`]),
          `${subject} ${setupy ? 'setups ' : ''}coaching`,
          ...(ko ? [`${ko} ${setupy ? '셋업 ' : ''}강좌`] : []),
        ];
        const o = await search({ query: queries[0], queries: queries.slice(1, 5), kind: 'video', maxResults: 12 }, '유튜브 강의 영상');
        videoNote = outcomeNote(o, '영상');
        const vids = deps.toSources(videoNote.results.slice(0, 12));
        const snippets = new Map(videoNote.results.map((r) => [r.url, r.snippet ?? '']));
        const terms = [...new Set([...subject.toLowerCase().split(/\s+/).filter((w) => w.length > 2), ...(ko ? [ko] : []), ...(setupy ? ['setup'] : [])])];
        videoRank = rankVideos(vids, terms, snippets).slice(0, 6);
        videoDropped = vids.length - videoRank.length;
      })()
    );
  }
  await Promise.all(jobs);

  // ---- 3. the similar fighters' own setups for the topic ("그 선수들의 더블렉 셋업")
  let fighterSetupResults: ResearchResult[] = [];
  if (want('FIGHTER_COMPARISON') && subjectEn && matches.length) {
    const names = matches.slice(0, 2).map((m) => m.name);
    const o = await search({ query: `${names[0]} ${subjectEn} setup`, queries: names.slice(1).map((n) => `${n} ${subjectEn}`), kind: 'web', maxResults: 6, requireTerms: names }, '선수별 셋업 자료');
    const n = outcomeNote(o, '선수별 셋업 자료');
    fighterSetupResults = n.results;
    const rep = sequenceReport(`${names.join(' ')} ${subjectEn} setup`, techniques, art, index, n.results);
    const pageLines = rep.text.split('\n■ 검색 자료')[1];
    sections.push({ intent: 'SETUP_RESEARCH', title: `${names.join(' · ')}의 ${label(techniques[0])} 셋업`, text: n.status === 'failed' ? n.note : `■ 검색 자료${pageLines ?? '\n- 찾지 못함'}`, status: n.status === 'failed' ? 'failed' : 'done', note: n.note });
  }

  // ---- 4. MARTIALDEX records + web setups + DB comparison
  if (want('TECHNIQUE_SEARCH') || want('SETUP_RESEARCH') || want('LESSON_REQUEST') || mma) {
    sections.push(dbSection(techniques, art, index, text, artName));
  }
  let external: ExternalTerm[] = [];
  if (wantsWeb) {
    const n = { results: webResults };
    const rep = sequenceReport(text, techniques, art, index, n.results);
    const pageLines = rep.text.split('\n■ 검색 자료')[1];
    const r0 = research.find((r) => /셋업 자료$/.test(r.reason));
    const failed = r0 && (r0.status === 'failed' || r0.status === 'disabled' || r0.status === 'unsupported');
    sections.push({ intent: mma ? 'MMA_STRATEGY_RESEARCH' : 'SETUP_RESEARCH', title: mma ? `MMA에서 쓰는 ${label(techniques[0])} 셋업 (외부 자료)` : `${label(techniques[0])} 셋업 (외부 자료)`, text: failed ? `검색하지 못했습니다 — ${r0?.message ?? '자체 검색 꺼짐'}. 외부 자료 없이 MARTIALDEX 기록만 보여 드립니다.` : `■ 검색 자료${pageLines ?? '\n- 찾지 못함'}`, status: failed ? 'failed' : webResults.length ? 'done' : 'partial', note: r0 ? `${r0.queries.length}개 검색어 · 결과 ${webResults.length}건 · 본문 확인 ${r0.pagesRead ?? 0}건` : undefined });
    external = externalVsDb([...webResults, ...fighterSetupResults], art ?? 'mixed-martial-arts', index, { exclude: techniques.flatMap((t) => [t.name.toLowerCase(), ...t.aliases.map((a) => a.toLowerCase())]) });
    if (ia.compareWithDb || want('TECHNIQUE_SEARCH') || mma) sections.push({ intent: 'TECHNIQUE_SEARCH', title: '외부 자료 ↔ MARTIALDEX 비교', text: externalVsDbText(external), status: external.length ? 'done' : 'partial' });
  } else if ((ia.compareWithDb || mma) && !subjectEn) {
    sections.push({ intent: 'TECHNIQUE_SEARCH', title: '외부 자료 ↔ MARTIALDEX 비교', text: '어떤 기술을 비교할지 질문과 대화에서 찾지 못했습니다. 기술 이름을 함께 말씀해 주세요.', status: 'partial' });
  }
  if (want('VIDEO_SEARCH')) {
    const vn = videoNote as ReturnType<typeof outcomeNote> | null;
    sections.push({ intent: 'VIDEO_SEARCH', title: '유튜브 강의 영상', text: vn?.status === 'failed' ? `${vn.note}. 영상은 실시간 검색으로만 찾습니다.` : videoReportText(videoRank, videoDropped), status: vn?.status === 'failed' ? 'failed' : videoRank.length ? 'done' : 'partial', note: vn?.note });
  }
  allResults.push(...fighterResults, ...webResults, ...fighterSetupResults);

  // ---- 5. lesson (records only; the button is the existing lesson engine)
  let lessonProposal: LessonProposal | undefined;
  if ((want('LESSON_REQUEST') || want('LEARNING_RECOMMENDATION')) && !input.inLesson) {
    const sourceUrls = [...new Set([...allResults.map((r) => r.url), ...(fromTalk?.sourceUrls ?? [])])];
    const videoUrls = [...new Set([...videoRank.map((v) => v.source.url), ...(fromTalk?.videoUrls ?? [])])];
    const summary = [
      ...(fromTalk ? topicSummary(fromTalk) : []),
      ...sections.filter((s) => s.status === 'done').map((s) => `이번에 조사: ${s.title}`),
      ...(profile && ia.personalFit ? [`내 프로필 기준: ${profile.traits.filter((t) => t.kind !== 'physical').map((t) => t.label).join(', ') || '스타일 정보 없음'}`] : []),
    ];
    // techniques the research resolved to MARTIALDEX records join the lesson (records only — candidates never do)
    const extraIds = external.filter((e) => e.inDb).map((e) => resolveTechnique(e.dbId ?? '')).filter((t): t is Technique => !!t);
    const p = proposalFromTopic({ topicLabel: `${topicLabel}${want('SETUP_RESEARCH') || mma ? ' 셋업과 연계' : ''}`, techniques: [...techniques, ...extraIds].slice(0, 4), art, index, sourceUrls, videoUrls, summary });
    lessonProposal = p.proposal ?? undefined;
    const fit = p.proposal ? deps.lessonFit?.(p.proposal.techniqueIds) ?? '' : '';
    const intro = fromTalk ? `이 대화에서 다룬 「${fromTalk.label}」로 수업을 구성했습니다.${alternatives.length ? ` (다른 주제로 하려면 말씀해 주세요: ${alternatives.map((a) => a.label).join(', ')})` : ''}` : '';
    sections.push({
      intent: 'LESSON_REQUEST',
      title: '수업 구성',
      text: p.proposal
        ? [intro, summary.length ? `수업에 반영한 내용:\n${summary.map((s) => `- ${s}`).join('\n')}` : '', p.planText, fit, '아래 "수업 시작"을 누르면 기존 수업 화면에서 단계별로 진행합니다. 진도·숙련도는 수업 엔진이 기록합니다.'].filter(Boolean).join('\n\n')
        : techniques.length
          ? `${techniques.map(label).join(', ')}의 MARTIALDEX 기록이 수업을 만들기에 부족합니다.`
          : '수업으로 만들 주제를 질문과 대화에서 찾지 못했습니다. 배우고 싶은 기술 이름을 말씀해 주세요.',
      status: p.proposal ? 'done' : 'partial',
    });
  }

  // ---- 6. a short labelled summary from the sections only
  const asked = ia.intents.filter((i) => i !== 'GENERAL_CONVERSATION');
  const facts = sections.map((s) => `[${s.title}]\n${s.text}`).join('\n\n').slice(0, 3600);
  let summaryText = '';
  const guardNotes: string[] = [];
  if (sections.some((s) => s.status === 'done')) {
    input.onStatus?.('조사 결과 정리 중…');
    const sys = [
      '너는 MARTIALDEX AI 코치다. 한국어 존댓말로 3~5문장만 쓴다.',
      '사용자의 질문에 직접 답하되, 아래 [조사 결과]에 있는 내용만 쓴다. 조사 결과에 없는 선수, 기술, 수치, 경기 사례를 만들지 않는다.',
      '확인된 내용과 너의 추론을 구분한다. 추론은 "제 판단으로는"으로 시작한다. 링크를 쓰지 않는다. 검색하지 않은 것을 검색했다고 말하지 않는다.',
      '조사 결과에 없는 빈도·비율·흔한 정도(많다, 드물다, 상위 몇 %)를 추정하지 않는다. 근거가 "불확실"로 표시된 선수를 비슷하다고 단정하지 않는다.',
      `\n[조사 결과]\n${facts}`,
    ].join('\n');
    const res = await deps.chat({ requestId: input.requestId, messages: [{ role: 'system', content: sys }, { role: 'user', content: text }], maxTokens: 280, temperature: 0.2 }, input.onDelta);
    if (res.ok) {
      const g = guardAnswer(res.text, { sourceCount: 0, sourceUrls: [], searched: false });
      const claims = checkClaims(g.text, [{ n: 1, text: facts }]);
      const kept = dropContradicted(g.text, claims);
      if (kept.removed.length) guardNotes.push(`조사 결과와 다른 문장 ${kept.removed.length}개를 정리에서 지웠습니다.`);
      if (g.removedPromises.length) guardNotes.push(`실제로 하지 않는 동작을 약속한 문장 ${g.removedPromises.length}개를 지웠습니다.`);
      summaryText = kept.text.trim();
      // no statistics were found → a sentence that still estimates how rare / common the style is has no basis
      const noStats = sections.some((x) => x.intent === 'STYLE_RARITY' && /통계를 찾지 못했습니다/.test(x.text));
      if (noStats || want('FIGHTER_COMPARISON')) {
        const parts = summaryText.split(/(?<=[.!?。])\s+/);
        // per-fighter claims stay in the comparison section (quoted); the model restating them got traits wrong (live 2026-11-08)
        const fighterNames = matches.map((m) => m.name.split(' ').pop()!).filter(Boolean);
        const dropFighter = (x: string) => fighterNames.some((n) => x.includes(n));
        const nf = parts.filter(dropFighter).length;
        if (nf) guardNotes.push(`선수별 특징을 다시 말한 문장 ${nf}개는 정리에서 뺐습니다 — 선수별 근거는 위 비교 항목의 인용문을 보세요.`);
        const keep = parts.filter((x) => !dropFighter(x) && !(noStats && /(희귀|드물|드문|흔한|흔하|흔치|상위\s*\d|추정|대부분|많은 선수)/.test(x)));
        if (keep.length + nf < parts.length) guardNotes.push(`통계 근거 없이 희귀성·흔한 정도를 추정한 문장 ${parts.length - keep.length}개를 정리에서 지웠습니다.`);
        summaryText = keep.join(' ').trim();
      }
    } else guardNotes.push(`로컬 AI를 쓸 수 없어 요약 없이 조사 결과만 보여 드립니다 (${res.message}).`);
  }

  const order: CoachIntent[] = ['STYLE_ANALYSIS', 'FIGHTER_COMPARISON', 'STYLE_RARITY', 'TECHNIQUE_SEARCH', 'MMA_STRATEGY_RESEARCH', 'SETUP_RESEARCH', 'VIDEO_SEARCH', 'LESSON_REQUEST'];
  sections.sort((a, b) => order.indexOf(a.intent) - order.indexOf(b.intent));
  const head = `요청을 ${asked.length}가지로 나눠 처리했습니다: ${asked.map((i, n) => `${'①②③④⑤⑥⑦⑧'[n] ?? `${n + 1}.`} ${INTENT_LABEL[i]}`).join(' ')}`;
  const body = sections.map((s) => `■ ${s.title}${s.note ? `  (${s.note})` : ''}\n${s.text}`).join('\n\n');
  const coach = summaryText ? `■ 코치 정리 (로컬 AI가 위 조사 결과만 보고 쓴 요약)\n${summaryText}` : '';
  const sources = (() => {
    const seen = new Set<string>();
    const uniq = allResults.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
    return deps.toSources(uniq);
  })();
  const videos = videoRank.map((v, i) => ({ ...v.source, n: i + 1 }));
  const searched = research.filter((r) => r.searched);
  const info: TurnResearchInfo = research.length
    ? { kind: 'web', queries: research.flatMap((r) => r.queries).slice(0, 12), reason: research.map((r) => r.reason).join(' · '), searched: searched.length > 0, status: searched.length ? (allResults.length || videos.length ? 'ok' : 'empty') : research[0].status, pagesRead: research.reduce((n, r) => n + (r.pagesRead ?? 0), 0) }
    : { kind: 'web', queries: [], reason: 'MARTIALDEX 기록·프로필', searched: false, status: 'skipped' };
  const tasks = sections.map((s) => ({ label: s.title, status: s.status, ...(s.note ? { note: s.note } : {}) }));
  const topic = techniques.length ? { key: `tech:${techniques[0].id}`, label: label(techniques[0]), techniqueIds: techniques.slice(0, 4).map((t) => t.id), art } : needsProfile ? { key: 'style:me', label: '내 파이팅 스타일', techniqueIds: [], art } : null;
  return {
    results: allResults,
    topic,
    message: {
      role: 'assistant',
      text: [head, body, coach, input.inLesson ? '질문에 답했습니다. 수업은 하던 단계에서 그대로 이어집니다.' : ''].filter(Boolean).join('\n\n'),
      sources: sources.length ? sources : undefined,
      videos: videos.length ? videos : undefined,
      research: info,
      techniqueIds: [...new Set([...techniques.map((t) => t.id), ...(lessonProposal?.techniqueIds ?? [])])],
      lessonProposal,
      tools: ['composite', ...new Set(research.map((r) => r.kind))],
      model: summaryText ? 'martialdex-composite+local' : 'martialdex-composite',
      tasks,
      ...(external.length ? { candidates: external.map((e) => ({ name: e.name, status: e.status, inDb: e.inDb, note: e.inDb ? `DB: ${e.dbName}` : `${e.sites.length}곳` })) } : {}),
      ...(guardNotes.length ? { guardNotes } : {}),
      ...(profile ? { personalData: { stores: ['개인 파이터 프로필'], loadFailed: false } } : {}),
    },
  };
}
