// Decides, in code, what a conversation turn needs: what kind of request it is,
// which tools serve it (MARTIALDEX DB, web / video / paper search, fighter
// research, lesson engine), which MARTIALDEX techniques it names (in the art the
// learner named), and which queries to send. The local model is not trusted to
// pick tools — it only writes text from what these steps actually collected.
//
// Order matters and was set from real failures: a fighter's style question that
// asked for "근거 자료" used to be sent to paper search; "레슬링 싱글렉" used to
// resolve to a sambo record because the art in the question was ignored.

import type { Technique } from '../../types';
import { artIn } from '../coachKnowledge/featureCatalog';
import { exactTechniquesInText } from '../coachKnowledge/lookup';
import type { ResearchKind } from '../selfResearch/types';
import { personalQueryOf } from '../personalCoach/personalAnswers';
import type { TrainingType } from './trainingPlanner';
import { readCombatTerms } from './combatTerms';
import { categoryTopicsInText } from '../knowledgeBase/topics';

export type TurnIntent =
  | 'smalltalk' // 일반 대화
  | 'motivation'
  | 'technique' // 기술 설명
  | 'compare' // 기술 비교
  | 'sequence' // 셋업·콤보 연구
  | 'fighter' // 선수 스타일 분석 / 선수별 기술·콤비네이션
  | 'video'
  | 'paper'
  | 'web' // 실시간 웹 검색
  | 'curriculum' // 커리큘럼 생성
  | 'lesson' // 수업 시작 요청
  | 'practice' // 기술 연습 의도 ("체크훅 연습하고 싶어") — 설명이 아니라 수업 제안으로
  | 'lesson_question' // 수업 중 질문
  | 'lesson_add' // 수업에 새 기술 추가
  | 'prerequisite' // 배우기 전에 알아야 할 것 (선행 기술)
  | 'related' // 연결·이어지는 기술
  | 'review' // 수업 중 복습
  | 'training_plan' // 훈련 요청 → 수업(솔로·파트너·종목·복습·약점)
  | 'my_progress' // 내 학습 상태 질문(배운·안 배운·부족·향상·복습·콤보·다음·실력 분석)
  | 'continue_lesson' // 하던 수업 이어하기
  | 'pose_check' // 내 자세 확인·측정 요청
  | 'improve' // "이 기술을 더 잘하려면 뭘 연습해야 해?" — 내 기록 기반
  | 'training'
  | 'general';

/** What serves the turn. Chosen here, never by the model. */
export type TurnTool = 'db' | 'web_search' | 'video_search' | 'paper_search' | 'fighter_research' | 'lesson_plan' | 'lesson_engine' | 'curriculum_builder';

export interface TurnPlan {
  intent: TurnIntent;
  tools: TurnTool[];
  /** The art the question is about: named in it, else the conversation's. */
  art: string | null;
  techniques: Technique[];
  /** Phrases that name several techniques (e.g. 잽 in boxing and kickboxing). */
  ambiguous: { phrase: string; candidates: { techniqueId: string; name: string; martialArt: string }[] }[];
  research: { needed: boolean; kind: ResearchKind; queries: string[]; reason: string };
  /** The person a fighter question is about, as typed ("코너 맥그리거", "Ilia Topuria"). */
  fighter: string | null;
  /** "최근 / 최신 / 요즘": newest material first. */
  recent: boolean;
  wantsLesson: boolean;
  wantsAddToLesson: boolean;
  /** training_plan: which training. */
  trainingType?: import('./trainingPlanner').TrainingType;
  /** my_progress: which question. */
  personal?: import('../personalCoach/personalAnswers').PersonalQuery;
  /** How the learner's words were read (격투기 용어 · 번호 펀치 · 복합 패턴) — shown with the answer. */
  readingNotes?: string[];
  /** Multi-technique patterns named as one ("슬립 어퍼"). */
  patterns?: { phrase: string; parts: string[] }[];
  /** "페인트" read as a feint. */
  feint?: boolean;
}

const SMALLTALK = /^(안녕(하세요|하십니까)?|하이|hi|hello|고마워(요)?|감사(합니다|해요)?|ㅎㅇ|반가워(요)?|반갑습니다|잘 ?자(요)?|ㅋ+|ㅎ+)[\s!.?~]*$/i;
const MOTIVATION = /(동기부여|의욕|힘들|지쳤|포기하고|자신감|슬럼프|그만두고|우울|멘탈)/;
const LESSON = /(수업|레슨|가르쳐|알려 ?줘.*(단계|순서)|배우고 ?싶|배워 ?보고|연습시켜|코칭해)/;
const ADD_TO_LESSON = /(수업에 (추가|넣)|추가해 ?줘|이것도 (넣|추가)|함께 (배우|연습)하게)/;
const VIDEO = /(영상|동영상|비디오|유튜브|하이라이트|video|youtube|highlight|footage)/i;
// Papers only when papers are asked for — "근거 자료", "연구해 줘" are not papers.
const PAPER = /(논문|학술|저널|학회지|스포츠\s*과학|운동\s*과학|체계적\s*문헌|메타\s*분석|연구\s*(결과|논문|자료)|paper|journal|systematic review|meta-analysis|sports science|\bstudy\b|\bstudies\b)/i;
const FIGHTER_WORD = /(선수|파이터|챔피언|ufc|one championship|pfl|bellator|전적)/i;
const STYLE_ANALYSIS = /(스타일|경기 운영|경기 분석|파이팅 스타일|style|breakdown)/i;
// A topic ABOUT athletes in general ("격투기 선수 급격한 체중 감량 위험성") is not a fighter analysis: the subject
// is the topic, "선수" only says whose. Measured 2026-11-07: this went to 'fighter' and was labelled 선수·경기 분석.
const ATHLETE_TOPIC = /(감량|체중|계체|워터\s*컷|수분|탈수|부상|뇌진탕|회복|수면|영양|식단|보충제|건강|위험|안전|규정|규칙|룰|도핑|약물|훈련법|컨디셔닝|체력|심리|멘탈|은퇴|수입|연봉)/;
const ANALYZE = /(분석|정리|특징|어떤 기술|자주 쓰|주무기|무기|패턴)/;
const OWN_STYLE = /(내|나의|제|저의)\s*(스타일|경기)/;
// "코너 맥그리거는 어떤 콤보를 자주 써?" — a person named first, asked about their techniques (no "선수" in it)
const PERSON_ASKS = /^([가-힣]{2,}(?:\s+[가-힣]{2,})?)(?:\s*선수)?(?:는|은|이|가)\s.*(어떤 (콤보|콤비네이션|기술|셋업|펀치|킥)|자주 (쓰|써|사용)|주무기|특기)/;
const NOT_A_PERSON = /^(상대|선수|사람|프로|챔피언|코치|저|제가|나|나는|우리|초보|초보자|아마추어|수업|이것|그것|오늘)/;
const CURRICULUM = /(커리큘럼|로드맵|\d+\s*(주|일|개월)\s*(동안|과정|계획|커리큘럼)|(훈련|학습|수련)\s*계획\s*(짜|만들|세워))/;
const COMPARE = /(차이|비교|다른 점|뭐가 달라|vs\.?|versus)/i;
const SEQUENCE = /(셋업|콤보|콤비네이션|연결 기술|연계|체인|setup|combo|combination)/i;
const FRESH = /(최근|최신|요즘|올해|작년|이번|지난|202\d|뉴스|결과|랭킹)/;
const REAL_USE = /(실제 경기|실제 선수|선수들은|실전에서|어떤 상황|언제 쓰|누가 (잘|자주)|사례|활용(해|하|하나|돼))/;
const ASKS_SEARCH = /(찾아|검색|자료|출처|근거)/;
// In a lesson: the opponent's reaction to what is being learned
const OPPONENT_REACTION = /(방어하면|막으면|막히면|피하면|대응|카운터|역공|반격|빠져나가면|버티면)/;
const TRAINING = /(훈련|루틴|컨디셔닝|체력|스파링|드릴|연습법|웨이트|감량|부상)/;
const LESSON_QUESTION = /[?？]|어떻게|왜|뭐|언제|어떤|알려|설명|찾아/;
const PREREQUISITE = /(배우기 전에|배우기 전|먼저 (알아야|배워야|익혀야)|선행 ?(기술|지식)|사전 ?지식|기초 ?지식|미리 알아)/;
const RELATED = /(연결되는|이어지는|이어서 (쓰|할|나가)|연계되는|관련(된)? (다른 )?기술|다음 (기술|동작)|연결 기술)/;
const REVIEW = /(복습|지금까지 배운|배운 (내용|것|거)\s*(정리|요약|복습)|오늘 배운)/;
// in a lesson: "이 기술과 연결되는 다른 기술도 배우고 싶어" = add to THIS lesson (with consent), not a new lesson
const ALSO_LEARN = /(도|까지)\s*(같이|함께)?\s*(배우|공부하|연습하|익히)(고 ?싶|자|면 좋)|(추가|넣어)\s*(해|줘|주세요)/;
// "이 기술", "지금 배우는 것", "방금 그거" — the technique being taught
// training requests — "레슬링 솔로 드릴 훈련을 하고 싶어", "오늘 주짓수 연습하자", "내가 부족한 기술 위주로 수업해 줘"
const SOLO = /(솔로|혼자|파트너\s*없이|섀도|쉐도우)/;
const PARTNER = /(파트너|짝\s*(이랑|과|와)|둘이서?|상대(랑|와)\s*같이)/;
const TRAIN_WORD = /(훈련|연습|드릴|수련|트레이닝)/;
const WANT_TRAIN = /(하고\s*싶|하자|할래|해\s*볼래|시켜|만들어|짜\s*줘|해\s*줘|하려고|수업)/;
const WEAK_TRAIN = /(부족한|약한|약점|못하는).{0,10}(위주|수업|훈련|연습|보강|드릴)/;
const REVIEW_TRAIN = /복습.{0,8}(하고\s*싶|하자|할래|수업|훈련|시켜|해\s*줘)/;
const CONTINUE = /(이어서|이어\s*하기|이어하기|계속|하던).{0,8}(수업|레슨|훈련)|(수업|레슨).{0,6}(이어서|계속)/;
// "내 잽 자세가 맞는지 확인하고 싶어", "싱글렉 자세를 영상으로 평가해 줘", "이 기술을 제대로 수행하는지 측정해 줘"
const POSE_CHECK = /(자세|폼|동작|수행).{0,14}(맞는지|정확한지|제대로|확인|평가|측정|체크|봐\s*줘|분석)|(측정|평가)해\s*줘|카메라로|촬영해서/;
// 기술 연습 의도: "이 기술을 연습/훈련/익히고 싶다". A named technique + a practice wish used to fall through to
// a dry 'technique' explanation (or a "자료를 찾지 못했습니다" dead end), so the learner was never offered the
// lesson they were asking for — the words below are the wish, not a command form.
const PRACTICE_WORD = /(연습|훈련|드릴|수련|트레이닝|익히|익혀|배우|배워|마스터)/;
const PRACTICE_WISH = /(싶|할래|볼까|보자|시켜|하려고|해\s*줘)/;
// "어떻게 연습해야 해?" 는 설명 요청이지 수업 요청이 아니다 — 묻는 말이 들어오면 연습 의도로 가로채지 않는다
// (2026-11-08 회귀: "더블렉 테이크다운 어떻게 연습해야 해?" 가 수업 제안으로 바뀌어 모델 답변이 사라졌다)
const HOW_QUESTION = /(어떻게|어떡|어떤\s*(식|방법|순서)|무슨\s*방법|방법\s*(을|이|은)?\s*(알려|가르|설명|궁금)|뭐야|무엇|왜\s|언제)/;
const IMPROVE = /(더 잘하려면|잘하고 싶|늘리려면|향상시키려면|실력을 올리려면|뭘 연습해야|무엇을 연습해야|어떤 연습을 해야)/;
const DEICTIC = /(이 ?기술|지금 ?(배우는|하는)|방금|이거|이걸|이것|그 ?기술)/;

// Korean → English terms, so searches reach English material (and paper indexes,
// which are mostly English: a Korean sentence returned Korean education papers).
const EN_TERMS: [RegExp, string][] = [
  [/스포츠\s*과학/, 'sports science'],
  [/운동\s*과학/, 'exercise science'],
  [/그래플링/, 'grappling'],
  [/타격/, 'striking'],
  [/생리/, 'physiology'],
  [/근력/, 'strength'],
  [/체력|컨디셔닝/, 'conditioning'],
  [/부상/, 'injury'],
  [/회복/, 'recovery'],
  [/영양/, 'nutrition'],
  [/감량|체중\s*조절/, 'weight cutting'],
  [/반응\s*속도/, 'reaction time'],
  [/심박/, 'heart rate'],
  [/유산소/, 'aerobic'],
  [/무산소/, 'anaerobic'],
  [/퍼포먼스|경기력/, 'performance'],
  [/싱글\s*렉|싱글\s*레그/, 'single leg'],
  [/더블\s*렉|더블\s*레그/, 'double leg'],
  [/테이크다운/, 'takedown'],
  [/서브미션/, 'submission'],
  [/셋업/, 'setup'],
  [/펀치/, 'punch'],
  [/속도|스피드/, 'speed'],
  [/파워|힘/, 'power'],
  [/콤보|콤비네이션/, 'combination'],
  [/카운터/, 'counter'],
  [/풋워크/, 'footwork'],
  [/연습|드릴/, 'drill'],
  [/디펜스|방어/, 'defense'],
  [/스타일/, 'style'],
  [/분석/, 'analysis'],
  [/킥복싱/, 'kickboxing'],
  [/복싱/, 'boxing'],
  [/무에타이/, 'muay thai'],
  [/주짓수/, 'bjj'],
  [/레슬링/, 'wrestling'],
  [/유도/, 'judo'],
  [/삼보/, 'sambo'],
  [/종합격투기|mma/i, 'mma'],
];

// Words that describe the request, not its topic (dropped from search queries).
const KO_FILLER = /^(좀|어떤|무슨|관한|대한|관련|관련된|있어|있어요|있나요|알려|알려줘|보여|보여줘|해줘|찾아|찾아줘|찾아서|싶어|배우고|배울|영상|동영상|논문|연구|자료|에서|하는|할|때|수|있는|최근|최신|요즘|제목|연도|발표|핵심|내용|원문|링크|정리|정리해|정리해줘|구분해서|구분|근거|대표적인|대표|기초부터|실전|응용까지|체계적으로|체계적|그리고|및|등|줘|주세요|설명|설명해|교육|강의|지금|배우는|배우|기술에서|기술|방법|어떻게|상대가|상대|하면|해야|대응해야)$/;
const KO_PARTICLE = /(은|는|이|가|을|를|의|에|와|과|도|로|으로|에서|이랑|하고|부터|까지)$/;
const LEARNING = /(배우|배울|교육|강의|강좌|튜토리얼|tutorial|how to|기초|초보)/i;

/**
 * Hangul words of the question that carry its topic (no request words, no particles).
 * `untranslated`: only the words the English term list does not cover (a fighter's
 * name like 로마첸코) — those must stay in an English query so it keeps its subject.
 */
function topicWords(text: string, techniques: Technique[], opts: { untranslated?: boolean } = {}): string[] {
  const techNames = techniques.flatMap((t) => [t.koreanName ?? '', t.name]).filter(Boolean);
  const source = opts.untranslated ? EN_TERMS.reduce((acc, [re]) => acc.replace(new RegExp(re.source, 'g'), ' '), text) : text;
  return [
    ...new Set(
      (source.match(/[가-힣]+/g) ?? [])
        .map((w) => (w.length > 2 ? w.replace(KO_PARTICLE, '') : w))
        .filter((w) => w.length >= 2 && !KO_FILLER.test(w) && !techNames.some((n) => n.includes(w) || w.includes(n)))
    ),
  ];
}

function englishTerms(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  for (const [re, en] of EN_TERMS) {
    if (!re.test(rest)) continue;
    out.push(en);
    rest = rest.replace(re, ' '); // "킥복싱" is not also "복싱"
  }
  return [...new Set(out)];
}

const latinWords = (text: string) => text.match(/[A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+)*/g) ?? [];

/** The person a fighter question names: Latin words as typed, else the Hangul words before "의 … 스타일". */
function fighterName(text: string, techniques: Technique[]): string | null {
  const latin = latinWords(text).filter((w) => !/^(ufc|mma|one|pfl|bjj|vs|style|breakdown)$/i.test(w));
  if (latin.length) return latin.sort((a, b) => b.length - a.length)[0];
  const m = text.match(/([가-힣]{2,}(?:\s+[가-힣]{2,}){0,2}?)\s*(?:선수)?(?:의|이|가|는|은)?\s*(?:타격|그래플링|레슬링|복싱|킥|경기|파이팅)?\s*(?:스타일|경기 운영|전적|주무기)/);
  const words = (m ? m[1] : '')
    .split(/\s+/)
    .map((w) => w.replace(/(의|이|가|는|은|선수)$/, ''))
    .filter((w) => w.length >= 2 && !KO_FILLER.test(w) && !EN_TERMS.some(([re]) => re.test(w)) && !techniques.some((t) => (t.koreanName ?? '').includes(w)));
  return words.length ? words.join(' ') : null;
}

function webQueries(text: string, techniques: Technique[]): string[] {
  const en = [...techniques.slice(0, 2).map((t) => t.name), ...englishTerms(text), ...latinWords(text)];
  const queries = [text.trim().slice(0, 200)];
  const mixed = [...new Set([...topicWords(text, techniques, { untranslated: true }), ...en])].join(' ').trim();
  if (mixed.split(/\s+/).length >= 2 && mixed.toLowerCase() !== text.toLowerCase()) queries.push(mixed);
  return queries;
}

/** Paper indexes are English: topic terms in English first, the Korean topic as a second try. */
export function paperQueries(text: string, techniques: Technique[]): string[] {
  const en = [...new Set([...techniques.slice(0, 2).map((t) => t.name.toLowerCase()), ...englishTerms(text).filter((x) => x !== 'analysis' && x !== 'style'), ...latinWords(text).filter((w) => !/^(study|studies|paper|journal)$/i.test(w))])];
  const ko = topicWords(text, techniques);
  const out: string[] = [];
  // one topic word alone ("grappling") is too broad for a paper index
  if (en.length === 1) out.push(`${en[0]} athletes`);
  else if (en.length) out.push(en.join(' '));
  if (ko.length) out.push(`${ko.join(' ')} 논문`);
  return out.length ? out : [text.trim().slice(0, 200)];
}

export function videoQueries(text: string, techniques: Technique[]): string[] {
  // "배울 수 있는 교육 영상": a tutorial, not highlights
  const learning = LEARNING.test(text);
  const ko = topicWords(text, techniques);
  // the named technique always leads the Korean query: topicWords drops technique names, and "잽 연습 영상"
  // used to search YouTube for "연습" alone (measured 2026-11-07: piano and dance practice videos)
  const korean = [...new Set([...techniques.slice(0, 1).filter((t) => t.koreanName).map((t) => t.koreanName!), ...ko])];
  const en = [...new Set([...topicWords(text, techniques, { untranslated: true }), ...techniques.slice(0, 1).map((t) => t.name.toLowerCase()), ...englishTerms(text).filter((x) => x !== 'style' && x !== 'analysis'), ...latinWords(text)])];
  const out: string[] = [];
  if (korean.length) out.push(`${korean.join(' ')}${learning ? ' 강좌' : ''}`);
  // a practice video is a drill, not highlights
  if (en.length) out.push(learning ? `${en.join(' ')} tutorial` : en.includes('drill') ? en.join(' ') : `${en.join(' ')} highlights`);
  return out.length ? [...new Set(out)] : [text.trim().slice(0, 120)];
}

export function planTurn(text: string, opts: { martialArt?: string | null; inLesson?: boolean; lessonTechnique?: Technique | null } = {}): TurnPlan {
  const t = text.trim();
  const named = artIn(t);
  const art = named ?? opts.martialArt ?? null;
  // The art the learner NAMED limits the lookup ("레슬링 싱글렉" is not the sambo record).
  // 격투기 현장 용어("투", "허리후리기", "슬립 어퍼")는 DB 이름으로 옮겨서 찾는다 (combatTerms.ts).
  const reading = readCombatTerms(t);
  let found = exactTechniquesInText(reading.lookupText, named ?? opts.martialArt ?? null);
  // the conversation's art is only a preference: "암바" asked in a chat that started with 잽 (kickboxing) is still
  // the armbar — when the learner did not NAME an art and nothing matches in the conversation's art, look everywhere
  if (!named && opts.martialArt && !found.matches.length && !found.ambiguous.length) found = exactTechniquesInText(reading.lookupText, null);
  let techniques = found.matches.slice(0, 4);
  const readingNotes = [...reading.notes];
  // 대표 레코드의 종목과 질문한 종목의 계열이 다를 때는 그 사실을 밝힌다 ("MMA 싱글렉" → 삼보 Single Leg 레코드 + 레슬링 계열)
  if (techniques[0]) {
    // the learner named no art (a named art already gets the family answer) — and only when no technique found is in the family's own art (then the record already is that art's)
    // and not when the learner named that family's own art ("레슬링 싱글렉" already gets the family answer)
    const fam = categoryTopicsInText(t, null).find((f) => f.art !== named && !techniques.some((x) => x.martialArt === f.art));
    if (fam) readingNotes.push(`MARTIALDEX의 '${techniques[0].name}' 대표 기록은 ${techniques[0].martialArt} 분류입니다. ${fam.art}에는 「${fam.category}」 계열 기록 ${fam.members.length}개가 따로 있습니다${fam.members.length ? ` (${fam.members.slice(0, 4).map((m) => m.name).join(', ')}${fam.members.length > 4 ? ' 등' : ''})` : ''}.`);
  }
  const inLesson = !!opts.inLesson;
  // In a lesson a question that names no technique ("이 기술의 원리는?", "관련 영상 찾아 줘") is about
  // the technique being taught — it goes first, so searches and records are about it.
  const cur = inLesson ? opts.lessonTechnique ?? null : null;
  if (cur && (!techniques.length || DEICTIC.test(t))) techniques = [cur, ...techniques.filter((x) => x.id !== cur.id)].slice(0, 4);
  const wantsAddToLesson = inLesson && (ADD_TO_LESSON.test(t) || ALSO_LEARN.test(t));
  const person = PERSON_ASKS.exec(t)?.[1] ?? null;
  const personName = person && !NOT_A_PERSON.test(person) && !artIn(person) && !exactTechniquesInText(person, null).matches.length && !EN_TERMS.some(([re]) => re.test(person)) ? person : null;
  const fighterAsked = !OWN_STYLE.test(t) && (FIGHTER_WORD.test(t) || (STYLE_ANALYSIS.test(t) && ANALYZE.test(t)) || !!personName);
  const fighter = fighterAsked ? fighterName(t, techniques) ?? personName : null;
  const recent = FRESH.test(t);

  const personal = personalQueryOf(t);
  const trainingType: TrainingType | undefined = !inLesson && WANT_TRAIN.test(t) && (TRAIN_WORD.test(t) || WEAK_TRAIN.test(t) || REVIEW_TRAIN.test(t))
    ? WEAK_TRAIN.test(t) ? 'weakness' : REVIEW_TRAIN.test(t) && !techniques.length ? 'review' : SOLO.test(t) ? 'solo' : PARTNER.test(t) ? 'partner' : named && !techniques.length ? 'art' : undefined
    : undefined;
  let intent: TurnIntent = 'general';
  if (SMALLTALK.test(t)) intent = 'smalltalk';
  else if (wantsAddToLesson) intent = 'lesson_add';
  else if (POSE_CHECK.test(t) && (techniques.length || !!cur || /(내|나의|제)\s/.test(t) || /자세/.test(t)) && !/(영상|동영상).{0,6}(찾아|보여|검색)/.test(t)) intent = 'pose_check';
  else if (trainingType && (WEAK_TRAIN.test(t) || REVIEW_TRAIN.test(t))) intent = 'training_plan';
  else if (IMPROVE.test(t) && (techniques.length || !!cur)) intent = 'improve';
  else if (personal) intent = 'my_progress';
  else if (!inLesson && CONTINUE.test(t)) intent = 'continue_lesson';
  else if (trainingType) intent = 'training_plan';
  else if (VIDEO.test(t)) intent = 'video';
  else if (fighterAsked && fighter) intent = 'fighter';
  else if (PAPER.test(t)) intent = 'paper';
  else if (inLesson && REVIEW.test(t)) intent = 'review';
  else if (PREREQUISITE.test(t) && techniques.length) intent = 'prerequisite';
  else if (RELATED.test(t) && techniques.length) intent = 'related';
  else if (inLesson && cur && COMPARE.test(t)) intent = 'compare';
  else if (inLesson && cur && SEQUENCE.test(t)) intent = 'sequence';
  else if (inLesson && LESSON_QUESTION.test(t)) intent = 'lesson_question';
  else if (CURRICULUM.test(t)) intent = 'curriculum';
  else if (!inLesson && LESSON.test(t)) intent = 'lesson';
  else if (MOTIVATION.test(t)) intent = 'motivation';
  else if (techniques.length >= 2 && COMPARE.test(t)) intent = 'compare';
  else if (SEQUENCE.test(t) && (techniques.length || /연구|찾아|알려|분석|정리/.test(t))) intent = 'sequence';
  else if (!inLesson && techniques.length && PRACTICE_WORD.test(t) && PRACTICE_WISH.test(t) && !HOW_QUESTION.test(t)) intent = 'practice';
  else if (techniques.length) intent = 'technique';
  else if (FIGHTER_WORD.test(t) && ATHLETE_TOPIC.test(t)) intent = 'web'; // a topic about athletes, no fighter named
  else if (FIGHTER_WORD.test(t)) intent = 'fighter';
  else if (TRAINING.test(t)) intent = 'training';
  else if (FRESH.test(t) || ASKS_SEARCH.test(t)) intent = 'web';

  let needed = false;
  let reason = '';
  let kind: ResearchKind = 'web';
  let queries: string[] = [];
  const tools: TurnTool[] = [];
  const web = (why: string) => {
    needed = true;
    reason = why;
    queries = webQueries(t, techniques);
    tools.push('web_search');
  };
  switch (intent) {
    case 'video':
      needed = true;
      kind = 'video';
      reason = '영상 요청';
      queries = videoQueries(t, techniques);
      tools.push('video_search');
      if (techniques.length) tools.push('db');
      break;
    case 'paper':
      needed = true;
      kind = 'paper';
      reason = '논문·연구 자료 요청';
      queries = paperQueries(t, techniques);
      tools.push('paper_search');
      break;
    case 'fighter':
      tools.push('fighter_research', 'db');
      web('선수·경기 분석은 MARTIALDEX DB에 없는 정보 — 선수·경기 분석 자료 검색');
      break;
    case 'lesson_question':
      tools.push('db', 'lesson_engine');
      // the opponent's reaction / "자료도 찾아서": the records first, then the web
      if (OPPONENT_REACTION.test(t) || ASKS_SEARCH.test(t) || FRESH.test(t) || REAL_USE.test(t)) web(OPPONENT_REACTION.test(t) ? '수업 기술에 대한 상대 대응 질문 — MARTIALDEX 연결 기록 + 웹 자료' : '수업 중 자료 요청');
      break;
    case 'lesson_add':
      tools.push('db', 'lesson_engine');
      // "이 선수의 대표 콤보를 추가해 줘": the combos come from the fighter's analysis
      if (fighterAsked) tools.push('fighter_research');
      break;
    case 'training_plan':
      tools.push('db', 'lesson_plan');
      break;
    case 'my_progress':
    case 'continue_lesson':
      tools.push('db');
      break;
    case 'pose_check':
      tools.push('db', 'video_search');
      break;
    case 'improve':
      tools.push('db');
      break;
    case 'prerequisite':
    case 'related':
      tools.push('db');
      break;
    case 'review':
      tools.push('db', 'lesson_engine');
      break;
    case 'lesson':
      tools.push('lesson_plan', 'db');
      web('수업 참고 자료 (수업 내용은 MARTIALDEX 기록으로만 구성)');
      break;
    case 'practice':
      // the technique is already in the records and the learner wants to train it — the lesson is built from the
      // DB, so no web search: it only adds waiting time and off-topic results to a request that doesn't need it
      tools.push('lesson_plan', 'db');
      break;
    case 'curriculum':
      tools.push('curriculum_builder', 'db');
      break;
    case 'compare':
    case 'technique':
      tools.push('db');
      if (FRESH.test(t) || REAL_USE.test(t) || ASKS_SEARCH.test(t)) web(FRESH.test(t) ? '최신 정보 질문' : REAL_USE.test(t) ? '실제 활용 사례 질문' : '자료 검색 요청');
      break;
    case 'sequence':
      // recorded setups/combos first; the web for what the records lack
      tools.push('db');
      web('셋업·콤보 연구 — MARTIALDEX 기록 + 웹 자료');
      break;
    case 'web':
      web(FIGHTER_WORD.test(t) && ATHLETE_TOPIC.test(t) ? '선수 관련 주제 자료 검색 (특정 선수 분석 아님)' : FRESH.test(t) ? '최신 정보 질문' : '자료 검색 요청');
      break;
    case 'training':
      if (FRESH.test(t) || ASKS_SEARCH.test(t)) web('훈련 자료 검색 요청');
      break;
    case 'general':
      if (!inLesson && t.length > 12) web('MARTIALDEX DB에서 해당 내용을 찾지 못함');
      break;
    default:
      break;
  }
  return { readingNotes, patterns: reading.patterns, feint: reading.feint, intent, tools, art, techniques, ambiguous: found.ambiguous, research: { needed, kind, queries, reason }, fighter, recent, wantsLesson: intent === 'lesson' || intent === 'practice', wantsAddToLesson, ...(intent === 'training_plan' ? { trainingType } : {}), ...(intent === 'my_progress' && personal ? { personal } : {}) };
}

/**
 * In a lesson: should this text go to the conversation coach (search / add items /
 * the opponent's reaction) instead of the lesson engine? While the coach waits for
 * an answer to its own question, only text that is clearly a new question qualifies.
 */
export function isLessonSideRequest(plan: TurnPlan, text: string, pendingQuestion: boolean): boolean {
  if (plan.wantsAddToLesson) return true;
  if (!plan.research.needed) return false;
  return !pendingQuestion || /(\?|어떤|언제|왜|누가|누구|뭐|무엇|어떻게|있어|있나요|알려|보여|찾아)/.test(text);
}
