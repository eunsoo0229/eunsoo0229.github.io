// Multi-intent analysis of one chat turn (사양 §2).
//
// router.ts picks ONE intent with a first-match chain — that is right for the many
// single-purpose turns it was tuned on, and wrong for a question that asks several
// things at once: "내 파이팅 스타일과 비슷한 선수들을 찾아보고, 그 선수들의 더블렉 셋업도
// 조사해 줘" was answered as a profile print-out because "스타일" matched first.
// Here every intent is checked independently; the turn is composite when it asks for
// more than one piece of work, or for one of the analyses router.ts has no route for
// (style analysis against the profile, similar fighters, rarity). A word alone never
// decides the whole turn: PROFILE_LOOKUP is only the request to SEE the profile.

export type CoachIntent =
  | 'PROFILE_LOOKUP'
  | 'STYLE_ANALYSIS'
  | 'FIGHTER_COMPARISON'
  | 'STYLE_RARITY'
  | 'TECHNIQUE_SEARCH'
  | 'SETUP_RESEARCH'
  | 'MMA_STRATEGY_RESEARCH'
  | 'VIDEO_SEARCH'
  | 'GENERAL_CONVERSATION'
  | 'LESSON_REQUEST'
  | 'LESSON_CONTINUATION'
  | 'LEARNING_RECOMMENDATION'
  // ---- 42개 문제 통합 개선 (§3-1)에서 추가. 아래 넷은 EXCLUSIVE — 잡히면 다른 의도를
  // 덮어쓴다. 통증·감정 질문을 기술 검색으로 처리하던 것이 이 문서의 17·18번 문제다.
  /** "…쳤는데 팔이 아파" — 기술 설명 요청이 아니라 통증 호소. */
  | 'INJURY_OR_PAIN_QUESTION'
  /** "재능이 없는 것 같아 힘들어" — 기술 목록이 아니라 공감이 먼저. */
  | 'EMOTIONAL_SUPPORT'
  /** "이번 주 하트 많은 콤보·게시물" — 웹 검색이 아니라 내부 소셜 DB 집계. */
  | 'SOCIAL_TRENDING'
  /** "아까 내가 무슨 셋업 물어봤지?" — 대화 기록으로 답한다. 재검색하지 않는다. */
  | 'CONVERSATION_RECALL'
  // ---- 42개 문제 최종 구현에서 추가한 실행 경로 의도 (skillTurn.ts). 분류만 하지 않고 각자 전용 경로로 처리한다.
  /** "내가 학습하지 않은 기술 중 하체 태클" — 기술 DB × 내 학습 기록 교차 조회. */
  | 'UNLEARNED_TECHNIQUE_SEARCH'
  /** "내가 만든 원투 이후 더블렉 셋업 평가해줘" — 사용자가 만든 셋업·콤보 평가. */
  | 'COMBO_EVALUATION'
  /** "슬립 어퍼를 자주 쓰는 상대 대처법" — 상대의 공격 패턴에 대한 대응. */
  | 'COUNTER_STRATEGY'
  /** "허리후리기 하는데 상대 중심이 뒤로 빠질 때", "페인트에 예민하게 반응해" — 상황·반응 분석. */
  | 'OPPONENT_PATTERN_ANALYSIS'
  /** "내 리치는 체급 내에서 긴 편이야?" — 절대값 · 키 대비 비율 · 체급 내 비교를 구분. */
  | 'PHYSICAL_ATTRIBUTE_COMPARISON'
  /** "마우스피스와 신가드 추천해줘" — 실제 제품 조사 (지어낸 모델 금지). */
  | 'PRODUCT_RECOMMENDATION'
  /** "잽 기술 상세 화면 열어줘", "학습 기록 보여줘(화면)" — 앱 기능 실행. */
  | 'APP_ACTION'
  /** "JAB의 3D 프리뷰 띄워줘" — 3D 시연을 연다. */
  | 'TECHNIQUE_3D_PREVIEW'
  /** "이거 말고 다른 셋업" — 직전 주제를 이어 가되 이미 보여 준 것은 뺀다. */
  | 'TOPIC_CONTINUATION'
  /** "토푸리아가 자주 쓰는 콤보" — 선수의 실제 기술·콤보 분석 (선수 분석 경로). */
  | 'FIGHTER_TECHNIQUE_ANALYSIS'
  /** "내 체급이 뭐였지?" — 프로필에 없는 항목: 저장된 값이 없다고 답하고 추정하지 않는다. */
  | 'PERSONAL_CONTEXT_QUERY';

export interface IntentAnalysis {
  intents: CoachIntent[];
  /** The question refers back to the conversation ("아까", "지금까지 이야기한", "이걸 수업으로"). */
  refersToConversation: boolean;
  /** "내 스타일에 맞는 …" — the profile is the yardstick for the other work. */
  personalFit: boolean;
  /** "내부 DB에 없는 기술 / 비교해 줘" — external findings checked against MARTIALDEX. */
  compareWithDb: boolean;
  /** Weaknesses of the style asked ("약점", "단점"). */
  asksWeakness: boolean;
  /** More than one piece of work, or an analysis only the composite pipeline does. */
  composite: boolean;
}

const MINE = /(^|\s)(내|나의|제|저의|나랑|나와|저와|저랑|나한테|나에게|저에게)(\s|$)|^(내|나의|제)\s?/;
const OWN_STYLE = /(내|나의|제|저의)\s*(파이팅\s*)?스타일|(나|저)(와|랑)\s*비슷한/;
const STYLE_WORD = /(파이팅\s*)?스타일|싸우는 방식|경기 운영/;
const SHOW = /(보여|알려|뭐(야|였|지)|확인|출력|정리해 ?줘|요약)/;
const ANALYZE = /(분석|특징|장단점|강점|약점|단점|어떤 스타일|평가|진단)/;
const WEAK = /(약점|단점|취약|부족한 (점|부분)|보완할)/;
const SIMILAR = /(비슷한|닮은|유사한|같은 스타일|스타일이 같은|가까운).{0,14}(선수|파이터|ufc|fighter)|(참고할 만한|참고할|본받을|롤\s*모델|벤치마킹할).{0,8}(선수|파이터)|(선수|파이터).{0,6}(중에|중).{0,10}(비슷|닮)/i;
const RARITY = /(희귀|드문|드물|흔한|흔하|흔치|독특|특이|유니크|얼마나 (특별|흔|드물)|일반적인 (파이터|선수|스타일)(와|과|이랑)?\s*(비교|다른|달리)|평범)/;
const VIDEO = /(영상|동영상|비디오|유튜브|강의 ?영상|강좌|youtube|video)/i;
const SETUP = /(셋업|세트업|setup|진입|엔트리|entry|연계|연결 기술|이어지는 기술|콤보|콤비네이션|combo)/i;
const MMA = /(mma|ufc|종합\s*격투기|케이지|실전|실제 경기|실제로 (쓰|사용|활용)|선수들(이|은|의)|경기에서)/i;
const RESEARCH = /(조사|찾아|검색|알아봐|자료|사례|분석해)/;
const DB = /(martialdex|마샬덱스|내부\s*(db|데이터|기록)|db에|db와|앱에(서| 있는| 등록)|등록된 기술|데이터베이스)/i;
const DB_COMPARE = /((db|데이터베이스|martialdex|마샬덱스|내부).{0,12}(없는|비교|빠진|누락)|없는 기술|새로운 기술 (후보|있는지))/i;
const TECH_FIND = /(관련 기술|기술(을|들을)? (찾|검색|알려|보여)|어떤 기술(이|들이) 있)/;
const LESSON = /(수업|레슨|가르쳐|배우고 ?싶|배워 ?보고|코칭해|커리큘럼으로|강의로 만들)/;
const MAKE_LESSON = /(수업|레슨)(으로|을|를)?\s*(만들|구성|짜|하고 ?싶|하자|해\s*줘|시작|진행)|(수업|레슨)\s*(하고|해)\s*싶/;
const BACK_REF = /(아까|방금|지금까지|여태|앞에서|위에서|이전에|전에)\s*.{0,10}(이야기|얘기|말한|말했던|나눈|논의|대화|다룬|본|찾은|조사한)|(이걸|이것|이거|이 내용|그 내용|그걸|이 주제|그 주제|이야기한 내용|얘기한 내용)(으로|로|을|를)?\s*(수업|레슨|정리|만들)/;
const ALSO_LEARN = /(도|까지)\s*(같이|함께)?\s*(배우|공부하|연습하|익히)(고 ?싶|자|면 좋)|(수업에|레슨에)\s*(추가|넣)/;
const RECOMMEND = /(뭘|무엇을|뭐를|어떤 걸)\s*(배우|연습|공부)(면|하는 게|해야)|(배울|연습할)\s*(만한|거리)|추천해\s*줘.*(기술|수업|훈련)/;

// ---- EXCLUSIVE 의도용 패턴 ----
// 통증: "암바 걸린 것처럼 아프다"는 암바를 알려달라는 뜻이 아니다. 비유('처럼',
// '같이')로 쓰인 기술명을 기술 검색으로 끌고 가지 않게, 통증 표현을 먼저 본다.
const PAIN = /(아파|아프|아픔|통증|쑤시|시큰|결리|저리|부었|붓고|삐|접질|다쳤|다친|부상|염좌|탈구|멍)/;
const PAIN_CTX = /(팔|어깨|손목|무릎|발목|허리|목|등|갈비|정강이|고관절|햄스트링|손가락|발가락|머리|턱)/;
// 감정: 실력·재능에 대한 자기 평가와 무력감. 훈련 계획 요청과 구분한다.
const EMOTION = /(재능이 없|소질이 없|자신이 없|자신감이 (없|떨어)|힘들어|괴로|우울|번아웃|지쳤|지쳐|포기하고 싶|그만두고 싶|슬럼프|실력이 (안 늘|늘지 않)|늘지를 않|창피|부끄|비교돼|비교되)/;
// 소셜: 기간 + 하트/인기 + 콘텐츠 종류. 내부 DB 집계이지 웹 검색이 아니다.
const SOCIAL_METRIC = /(하트|좋아요|인기|많이 받은|top|랭킹|순위)/i;
const SOCIAL_SCOPE = /(이번 ?주|이번 ?달|오늘|최근|요즘|지난 ?주|주간|월간)/;
const SOCIAL_KIND = /(게시물|게시글|포스트|피드|콤보|셋업)/;
// 대화 회상: 과거 발화 자체를 묻는다("무슨 … 물어봤지", "기억해?"). 그 주제로 새
// 작업을 해 달라는 요청(BACK_REF)과는 다르다 — 그건 기존 경로가 이미 처리한다.
const RECALL_ASK = /((무슨|뭐라고|어떤|뭘)\s*.{0,12}(물어|말했|얘기했|이야기했|요청했|찾았|했었|했지))|기억(나|해|하니|하고 있)|(뭐였|무엇이었|뭐라 했)(지|더라|나)/;

const personalFitPlain = (t: string) => /(맞는|맞춘|어울리는|적합)/.test(t);

/** Every intent the text carries (independent checks — a word alone never decides the whole turn). */
export function analyzeIntents(text: string, opts: { inLesson?: boolean; namesTechnique?: boolean; hasConversation?: boolean; hasHistory?: boolean; feint?: boolean } = {}): IntentAnalysis {
  const t = text.trim();
  const set = new Set<CoachIntent>();

  // ---- EXCLUSIVE 의도 (§3-1): 잡히면 여기서 끝낸다.
  // 이 넷은 "기술 단어가 들어 있다"는 이유로 검색 경로에 섞이면 답이 망가지는
  // 종류다. 통증 질문에 암바 설명을 붙이거나, 소셜 집계 질문을 셋업 웹 검색으로
  // 처리하던 것이 실제로 관측된 오분류다 (측정: 42문항 중 17문항 오분류).
  const exclusive = (i: CoachIntent): IntentAnalysis => ({
    intents: [i], refersToConversation: BACK_REF.test(t) || RECALL_ASK.test(t),
    personalFit: false, compareWithDb: false, asksWeakness: false, composite: false,
  });
  if (PAIN.test(t) && PAIN_CTX.test(t)) return exclusive('INJURY_OR_PAIN_QUESTION');
  if (EMOTION.test(t)) return exclusive('EMOTIONAL_SUPPORT');
  if (SOCIAL_METRIC.test(t) && SOCIAL_KIND.test(t) && (SOCIAL_SCOPE.test(t) || /가장|제일/.test(t))) return exclusive('SOCIAL_TRENDING');
  // 회상은 대화가 있을 때만 — 첫 턴에 "기억해?"는 회상할 것이 없다.
  // hasConversation(주제 추출 성공)은 턴 메타데이터에 의존해서 대화 초반에는 비어
  // 있을 수 있다. 메시지가 하나라도 오갔으면 회상으로 본다 — "다룬 주제가 없습니다"
  // 라고 답하는 편이 웹 검색을 도는 것보다 질문에 맞는 동작이다.
  if (RECALL_ASK.test(t) && (!!opts.hasConversation || !!opts.hasHistory)) return exclusive('CONVERSATION_RECALL');
  // 실행 경로 의도 (skillTurn.ts) — 각자 전용 경로가 있어 연구·복합 경로로 보내지 않는다
  const skill = skillIntent(t, { hasConversation: !!opts.hasConversation || !!opts.hasHistory, inLesson: opts.inLesson, feint: opts.feint });
  if (skill) return exclusive(skill);

  const mine = MINE.test(t);
  const ownStyle = OWN_STYLE.test(t) || (mine && STYLE_WORD.test(t));

  if (SIMILAR.test(t) && (ownStyle || mine || /나(와|랑)|저(와|랑)/.test(t))) set.add('FIGHTER_COMPARISON');
  if (RARITY.test(t) && (ownStyle || mine)) set.add('STYLE_RARITY');
  if (ownStyle && (ANALYZE.test(t) || WEAK.test(t))) set.add('STYLE_ANALYSIS');
  const personalFit = ownStyle && /(맞는|맞춘|어울리는|적합|잘 맞|활용할)/.test(t);
  if (personalFit && !set.size && !SETUP.test(t) && !VIDEO.test(t)) set.add('STYLE_ANALYSIS');
  // only an explicit "show me my profile / my style" is a lookup — and only when nothing else is asked
  const wantsProfile = (/(프로필)/.test(t) || ownStyle) && SHOW.test(t) && !ANALYZE.test(t);

  if (SETUP.test(t)) set.add('SETUP_RESEARCH');
  if (MMA.test(t) && (RESEARCH.test(t) || SETUP.test(t) || /전략|전술|활용|사례/.test(t))) set.add('MMA_STRATEGY_RESEARCH');
  if (VIDEO.test(t)) set.add('VIDEO_SEARCH');
  if ((DB.test(t) && (RESEARCH.test(t) || TECH_FIND.test(t) || /기술/.test(t))) || TECH_FIND.test(t)) set.add('TECHNIQUE_SEARCH');
  const compareWithDb = DB_COMPARE.test(t);
  if (compareWithDb) set.add('TECHNIQUE_SEARCH');

  const refersToConversation = BACK_REF.test(t);
  if (opts.inLesson && ALSO_LEARN.test(t)) set.add('LESSON_CONTINUATION');
  else if (MAKE_LESSON.test(t) || (LESSON.test(t) && (refersToConversation || set.size > 0))) set.add('LESSON_REQUEST');
  if (!opts.inLesson && RECOMMEND.test(t)) set.add('LEARNING_RECOMMENDATION');

  if (wantsProfile && !set.size) set.add('PROFILE_LOOKUP');
  if (!set.size) set.add('GENERAL_CONVERSATION');

  const intents = [...set];
  const work = intents.filter((i) => i !== 'GENERAL_CONVERSATION' && i !== 'PROFILE_LOOKUP' && i !== 'LESSON_CONTINUATION');
  // a plain "내 스타일 분석해 줘" stays with the tested record-based analysis (coachAnalysis 'style' — records + a labelled
  // interpretation); weaknesses (which that route printed as the profile's style value) and combined requests come here
  const styleHere = set.has('STYLE_ANALYSIS') && (WEAK.test(t) || work.length > 1 || personalFitPlain(t));
  const onlyComposite = intents.some((i) => i === 'FIGHTER_COMPARISON' || i === 'STYLE_RARITY') || styleHere;
  // a lesson from the conversation needs the conversation's topic — the single-intent lesson route only reads this sentence
  const lessonFromTalk = set.has('LESSON_REQUEST') && refersToConversation && !!opts.hasConversation;
  const searchKinds = ['TECHNIQUE_SEARCH', 'SETUP_RESEARCH', 'MMA_STRATEGY_RESEARCH', 'VIDEO_SEARCH'].filter((i) => set.has(i as CoachIntent)).length;
  // DB + web + video together, or a lesson built from several kinds of research, are one combined job
  const composite = !opts.inLesson
    ? onlyComposite || lessonFromTalk || searchKinds >= 2 || (set.has('MMA_STRATEGY_RESEARCH') && !!opts.namesTechnique) || (compareWithDb && searchKinds >= 1) || (personalFit && searchKinds >= 1) || (work.length >= 3)
    : onlyComposite; // in a lesson the lesson-question route already answers research about the technique being taught
  return { intents, refersToConversation, personalFit, compareWithDb, asksWeakness: WEAK.test(t), composite };
}

export const INTENT_LABEL: Record<CoachIntent, string> = {
  PROFILE_LOOKUP: '개인 파이터 프로필 조회',
  STYLE_ANALYSIS: '파이팅 스타일 분석',
  FIGHTER_COMPARISON: '비슷한 스타일의 선수 비교',
  STYLE_RARITY: '스타일 희귀성 분석',
  TECHNIQUE_SEARCH: 'MARTIALDEX 기술 검색',
  SETUP_RESEARCH: '셋업·연계 조사',
  MMA_STRATEGY_RESEARCH: 'MMA 실전 활용 조사',
  VIDEO_SEARCH: '유튜브 강의 영상 검색',
  GENERAL_CONVERSATION: '일반 대화',
  LESSON_REQUEST: '수업 구성',
  LESSON_CONTINUATION: '진행 중인 수업에 추가',
  LEARNING_RECOMMENDATION: '학습 제안',
  INJURY_OR_PAIN_QUESTION: '통증·부상 상담',
  EMOTIONAL_SUPPORT: '정서적 고민',
  SOCIAL_TRENDING: 'MARTIALDEX 인기 콘텐츠 조회',
  CONVERSATION_RECALL: '이전 대화 회상',
  UNLEARNED_TECHNIQUE_SEARCH: '미학습 기술 조회',
  COMBO_EVALUATION: '내가 만든 셋업·콤보 평가',
  COUNTER_STRATEGY: '상대 공격 패턴 대응',
  OPPONENT_PATTERN_ANALYSIS: '상황·상대 반응 분석',
  PHYSICAL_ATTRIBUTE_COMPARISON: '체격 비교',
  PRODUCT_RECOMMENDATION: '장비 추천',
  APP_ACTION: '앱 기능 실행',
  TECHNIQUE_3D_PREVIEW: '3D 시연 열기',
  TOPIC_CONTINUATION: '이전 주제 이어 가기',
  FIGHTER_TECHNIQUE_ANALYSIS: '선수 기술·콤보 분석',
  PERSONAL_CONTEXT_QUERY: '내 정보 조회 (프로필에 없는 항목)',
};

// ---- 실행 경로 의도 패턴 (skillTurn.ts). 단어 하나로 정하지 않고 "무엇을 + 어떻게"를 함께 본다.
const UNLEARNED = /(학습하지 않은|배우지 않은|안 배운|아직 (안 )?배운 적 없|아직 (안 )?배우지|미학습|안 해 본)/;
const MADE_BY_ME = /(내가|제가|나름|직접)\s*(만든|짠|구성한|생각한|짜 본|만들어 본)|(내|제)\s*(셋업|콤보|콤비네이션)/;
const EVALUATE = /(평가|어때|괜찮(아|을까|은지)|피드백|점검|검토|봐\s*줘|분석해)/;
const OPP_FREQ = /상대(방)?(가|는|의)?.{0,24}(자주|많이|잘|즐겨|계속|매번)\s*(쓰|써|사용|하|나오|들어오)|(자주|많이|잘|즐겨)\s*(쓰|사용하|하)는\s*상대/;
const COUNTER_ASK = /(대처|대응|파훼|공략|카운터|막는 법|막으려면|어떻게 (막|피하|대처|대응|상대))/;
const SITUATION = /상대(방)?(의|가|는)?\s*.{0,10}(중심|무게|체중|자세|반응|움직임).{0,14}(뒤로|앞으로|빠지|빠질|무너|버티|낮아|높아|반응)|(시도|들어가|걸면|걸었는데|하는데).{0,24}상대.{0,20}(빠지|버티|막|반응|피하)|상황(을|을\s)?\s*분석/;
const REACT_TOO_MUCH = /(예민하게|민감하게|과민하게|과하게|너무 (빨리|쉽게|크게))\s*(반응|속|움찔)|(자꾸|계속)\s*(속|걸려|낚여)/;
const BODY_WORD = /(리치|윙스팬|팔 길이|키|키가|키와|키를|키는|신장|체격|신체 (조건|치수))/;
const BODY_COMPARE = /(체급|평균|긴 편|짧은 편|큰 편|작은 편|드문|희귀|흔한|비교|순위|상위|하위|몇\s*%|퍼센트|길어|짧아|유리|불리)/;
const GEAR = /(마우스\s*피스|마우스\s*가드|신\s*가드|정강이\s*보호대|글러브|헤드\s*기어|핸드\s*랩|붕대|낭심\s*보호대|파울\s*컵|래시\s*가드|도복|보호대|미트|샌드백|장비|용품)/;
const GEAR_ASK = /(추천|뭐가 좋|뭘 사|사야|구매|살까|고르|브랜드|어떤 (걸|거|제품))/;
const PREVIEW_3D = /(3\s*d|쓰리\s*디|입체).{0,12}(프리뷰|미리\s*보기|시연|화면|애니메이션|보여|띄워|열어|틀어)|(프리뷰|미리\s*보기)\s*(화면)?\s*(을|를)?\s*(띄워|열어|보여|켜)/i;
const OPEN_SCREEN = /(상세\s*(화면|페이지)|기술\s*(화면|페이지)|학습\s*기록\s*(화면|페이지)|배운 기술 (화면|목록)|자세\s*(측정|분석)\s*(화면|페이지)?)\s*(을|를)?\s*.{0,4}(열어|띄워|보여\s*줘|켜|가\s*줘|이동|시작해)/;
const NOT_THIS = /(이거|이것|그거|그것|저거|이건|그건|방금 (거|것|그거)|위에 (거|것))\s*(말고|빼고|외에|말구)|다른\s*(셋업|콤보|콤비네이션|기술|방법|거|것)\s*(도|은|는|을|를|알려|보여|있어|없어|추천)|(또|더)\s*(다른|없어|있어|알려)/;
const LESSON_ADD = /(수업|레슨)(에|으로)?\s*(추가|넣)/;

export interface SkillOpts { hasConversation?: boolean; inLesson?: boolean; techniqueCount?: number; feint?: boolean }

/**
 * The work-specific intents (skillTurn.ts). Checked after the EXCLUSIVE ones and before the
 * research/composite intents, so "셋업 평가해줘" is not answered as a pose measurement and
 * "하체 태클 중 안 배운 것" is not answered by a web search.
 */
export function skillIntent(text: string, opts: SkillOpts = {}): CoachIntent | null {
  const t = text.trim();
  // 프로필에 항목 자체가 없는 내 정보(체급·소속·전적) — 모델이 지어내지 않게 여기서 답한다
  if (/(내|제|나의)\s*(체급|소속\s*체육관|전적|승률|등급|단증|벨트)/.test(t) && /(뭐|몇|어디|였|이야|인가|알려|기억)/.test(t) && !BODY_COMPARE.test(t.replace(/체급/g, ''))) return 'PERSONAL_CONTEXT_QUERY';
  if (PREVIEW_3D.test(t)) return 'TECHNIQUE_3D_PREVIEW';
  if (OPEN_SCREEN.test(t)) return 'APP_ACTION';
  if (GEAR.test(t) && GEAR_ASK.test(t)) return 'PRODUCT_RECOMMENDATION';
  if (BODY_WORD.test(t) && BODY_COMPARE.test(t) && (MINE.test(t) || /\d{3}\s*(cm|센티)/i.test(t))) return 'PHYSICAL_ATTRIBUTE_COMPARISON';
  if (UNLEARNED.test(t)) return 'UNLEARNED_TECHNIQUE_SEARCH';
  // the learner DESCRIBES the sequence ("원투 이후 더블렉", "잽 → 훅"). "내 콤보 분석해 줘" (no sequence) is the
  // analysis of the stored combos (coachAnalysis) — not this route (test-coach-10th-integration P19)
  if (MADE_BY_ME.test(t) && EVALUATE.test(t) && /(\S+\s*(이후|다음에?|후에|하고 나서)\s*\S+|→|->|원\s*투)/.test(t)) return 'COMBO_EVALUATION';
  if (OPP_FREQ.test(t) && (COUNTER_ASK.test(t) || /(알려|어떻게|방법)/.test(t))) return 'COUNTER_STRATEGY';
  if (SITUATION.test(t) || (opts.feint && REACT_TOO_MUCH.test(t)) || (/페인트|페이크|feint/i.test(t) && REACT_TOO_MUCH.test(t))) return 'OPPONENT_PATTERN_ANALYSIS';
  if (!opts.inLesson && LESSON_ADD.test(t) && (BACK_REF.test(t) || /(방금|아까|이걸|이거|그걸|찾은|조사한|말한)/.test(t))) return 'LESSON_CONTINUATION';
  if (opts.hasConversation && NOT_THIS.test(t) && t.length <= 40) return 'TOPIC_CONTINUATION';
  return null;
}
