import type { Behavior, DifficultyPref, Feature, Goal, QuickCategory, Range } from './types';

// One vocabulary for both sides: the words a user types (Korean / English, common misspellings) and the words the
// technique records use (names, categories, purposes). Patterns run on the lower-cased text AND on the same text with
// spaces removed, so "테이크 다운" and "테이크다운" read the same.

/** Common misspellings / spacing → the spelling the patterns expect (applied before matching). */
export const TYPO_FIXES: [RegExp, string][] = [
  [/테익\s*다운|태익\s*다운|테이크\s*따운|테이크\s+다운|tkd/gi, '테이크다운'],
  [/크린치|클린취|클린치\s*상황/gi, '클린치'],
  [/카운타|카운더|카운트\s*어택/gi, '카운터'],
  [/압바(?!크)|압빡/gi, '압박'],
  [/컴보|꼼보|콤비\b/gi, '콤보'],
  [/젭|쨉|잽잽/gi, '잽'],
  [/스프럴|스프롤|스프레일/gi, '스프롤'],
  [/무아이\s*타이|무에\s*따이|무에\s*타이/gi, '무에타이'],
  [/래슬링|레스링/gi, '레슬링'],
  [/주지수|주짓쑤|주짓\s*수/gi, '주짓수'],
  [/킥\s*복싱/gi, '킥복싱'],
  [/어퍼\s*컷/gi, '어퍼컷'],
  [/로우\s*킥|로킥/gi, '로우킥'],
  [/미들\s*킥/gi, '미들킥'],
  [/하이\s*킥/gi, '하이킥'],
  [/더블\s*렉|더블\s*레그/gi, '더블렉'],
  [/싱글\s*렉|싱글\s*레그/gi, '싱글렉'],
  [/언더\s*훅/gi, '언더훅'],
  [/오버\s*훅/gi, '오버훅'],
  [/백\s*컨트롤/gi, '백컨트롤'],
  [/사이드\s*컨트롤/gi, '사이드컨트롤'],
  [/원\s*투/gi, '원투'],
  [/뒤로\s*빼|뒤로\s*빠/gi, '뒤로빠'],
  [/거리\s*를?\s*유지/gi, '거리유지'],
  [/싶어여|싶어용|싶음|싶다|싶네/gi, '싶어'],
];

export interface Rule<T> {
  value: T;
  re: RegExp;
}

export const GOAL_RULES: Rule<Goal>[] = [
  { value: 'tdDefense', re: /(테이크다운|태클|더블렉|싱글렉|다리\s*잡).{0,12}(방어|막|피하|버티|디펜스)|스프롤|sprawl|takedown defen|whizzer|위저/ },
  { value: 'counter', re: /카운터|반격|되받|받아\s*치|역습|맞받|피한\s*(뒤|다음|후)|흘리고|counter/ },
  { value: 'defense', re: /방어|막(고|기|는|을|아|으)|막고|막아|수비|피하(고|는|기)|회피|디펜스|가드\s*를\s*지키|defen[cs]e|block/ },
  { value: 'distance', re: /거리유지|거리\s*(조절|싸움|관리|재|측정|를\s*(벌리|두|잡|만들|재))|(킥|펀치|클린치)\s*거리|간격|레인지|아웃\s*파이팅|거리를|전진을?\s*(끊|막|멈추)|distance|range|footwork|풋워크/ },
  { value: 'takedown', re: /테이크다운(?!.{0,12}(방어|막|피하|버티))|균형을?\s*(무너|깨)|무너뜨|넘어뜨|메치|던지(?!는\s*공)|넘기(고|기|려)|태클\s*(을|로)\s*(하|들어)|takedown|throw/ },
  { value: 'position', re: /(유리한|좋은|상위|우위|안정적인)\s*(포지션|자세|위치)|포지션을?\s*(잡|만들|차지|가져)|탑\s*포지션|포지션\s*컨트롤|컨트롤(하|을|해|$)|제압|위에서\s*(누르|잡)|백\s*을?\s*잡|better position|control/ },
  { value: 'escape', re: /탈출|빠져\s*나|벗어나|이스케이프|일어나|일어서|escape|get up/ },
  { value: 'sweep', re: /스윕|뒤집|역전|sweep|reversal/ },
  { value: 'submission', re: /서브미션|조르|조르기|꺾(기|어)|관절기|탭\s*(을|받)|피니시|submission|choke|armbar|lock/ },
  { value: 'clinch', re: /클린치\s*(에서|상황|싸움|공격|컨트롤)|클린치/ },
  { value: 'transition', re: /전환|트랜지션|포지션을?\s*(바꾸|옮기)|transition/ },
  { value: 'attack', re: /공격|때리|맞히|타격|연타|콤보|득점|압박하면서|공략|들어가(고|서)|연결(하|해|할|시키)|이어\s*가|attack|strike|combo|score|hit/ },
];

export const BEHAVIOR_RULES: Rule<Behavior>[] = [
  { value: 'retreat', re: /뒤로빠|물러나|후퇴|도망|뒷걸음|백\s*스텝|거리를?\s*벌리|빠지(는|면|고)|retreat|backing up|back up/ },
  { value: 'pressure', re: /(상대가|상대는|상대의).{0,10}(압박|밀고|전진|앞으로|들어와|몰아)|상대\s*(의\s*)?(전진|압박)|압박하는\s*상대|밀고\s*들어오는\s*상대|압박(할|하는|해\s*올|해오)\s*때|밀고\s*들어|몰아붙|pressur|walks? (me )?down|forward/ },
  { value: 'guardHigh', re: /가드(를|가)?\s*(올리|올려|높|굳|단단|잘\s*지키|닫)|하이\s*가드|얼굴을?\s*(막|가리)|high guard|shell/ },
  { value: 'jabReaction', re: /잽(에|을)\s*(반응|막|보고|피하|의식)|잽에/ },
  { value: 'takedownAttempt', re: /(상대가|상대의|상대는)\s*(?:[^\s]+\s){0,2}(테이크다운|태클|더블렉|싱글렉)(을|를|으로|로)?\s*(시도|들어|하려|노리|걸|치고|할\s*때|하면)|테이크다운\s*(시도|을\s*시도)|태클\s*(시도|들어)|상대\s*(의\s*)?(테이크다운|태클)(에|을|이)|(상대가|상대의).{0,8}다리를?\s*잡|들어오는\s*(테이크다운|태클)|shoot|shot attempt/ },
  { value: 'clinch', re: /클린치|붙었|붙어서|엉겨|목을?\s*잡|빰|clinch|plum|collar tie/ },
  { value: 'kicks', re: /(상대가|상대의).{0,10}(킥|발차기|로우킥|미들킥)|킥을?\s*(많이|자주|찬|차)|kick(s|er)?\b/ },
  { value: 'counterWaiting', re: /카운터를?\s*(노리|기다)|기다리(는|고)\s*상대|counter puncher/ },
  { value: 'taller', re: /키\s*(가\s*)?(커|크|큰)|리치\s*(가\s*)?(길|긴)|나보다\s*(크|길)|taller|longer reach/ },
  { value: 'bottom', re: /깔려|깔렸|깔린|밑에|아래\s*(에|깔)|하위|바텀|마운트\s*(당|를\s*당)|사이드\s*(당|를\s*당)|사이드컨트롤\s*(당|에서\s*깔)|bottom|under (mount|side)/ },
  { value: 'top', re: /위에서|상위에서|탑\s*포지션|마운트에서|사이드컨트롤에서|on top|top position/ },
  { value: 'inGuard', re: /가드\s*안|가드에서|클로즈드\s*가드|하프\s*가드|오픈\s*가드|guard pull|in (my|his|their) guard/ },
  { value: 'onBack', re: /백을?\s*(잡|내|뺏)|등\s*(뒤|을)|백컨트롤|back take|back control/ },
  { value: 'punches', re: /상대(가|의|는)?\s(?!내\s)(?:[^내\s]+\s){0,2}?(잽|펀치|주먹|원투|훅|스트레이트)/ },
  { value: 'blocks', re: /(상대가|상대는).{0,10}(막|블록|가드)|다\s*막혀|막혀/ },
];

export const RANGE_RULES: Rule<Range>[] = [
  { value: 'ground', re: /그라운드|바닥|누워|깔려|마운트|사이드컨트롤|가드\s*(안|에서)|ground|on the mat/ },
  { value: 'clinch', re: /클린치|붙어서|목을?\s*잡|빰|clinch/ },
  { value: 'close', re: /근거리|인파이팅|붙은\s*거리|가까운\s*거리|짧은\s*거리|close range|inside/ },
  { value: 'mid', re: /중거리|미들\s*레인지|mid range/ },
  { value: 'long', re: /원거리|장거리|먼\s*거리|아웃\s*파이팅|long range|outside/ },
];

/** Arts named in the input → MARTIALDEX art ids. 'mma' expands to the arts an MMA fight draws from. */
export const ART_RULES: Rule<string>[] = [
  { value: 'mixed-martial-arts', re: /\bmma\b|종합\s*격투|이종\s*격투|엠엠에이|\bufc\b/ },
  { value: 'kickboxing', re: /킥복싱|kick\s*boxing/ },
  { value: 'boxing', re: /(?<!킥)복싱|(?<!킥)복서|권투|(?<!kick\s?)boxing|boxer/ },
  { value: 'muay-thai', re: /무에타이|muay\s*thai/ },
  { value: 'wrestling', re: /레슬링|wrestling/ },
  { value: 'bjj', re: /주짓수|브라질리언|\bbjj\b|jiu.?jitsu/ },
  // "반응을 유도해서" (to draw out) is not the art 유도 (judo)
  // "후퇴 유도", "반응 유도 셋업" — 유도 right after the thing being drawn out is the verb too
  { value: 'judo', re: /(?<!(후퇴|반응|실수|전진|공격|움직임|태클|카운터)\s*(를|을)?\s*)유도(?!\s*(해|하|시키|된|되|를\s*위해|셋업|동작))|judo/ },
  { value: 'sambo', re: /삼보|sambo/ },
  { value: 'karate', re: /가라데|가라테|karate/ },
  { value: 'taekwondo', re: /태권도|taekwondo/ },
];
export const MMA_ARTS = ['mixed-martial-arts', 'boxing', 'kickboxing', 'muay-thai', 'wrestling', 'bjj'];

export const TYPE_RULES: Rule<Feature>[] = [
  { value: 'punch', re: /펀치|주먹|punch(es)?\b/ },
  { value: 'kick', re: /(?<!상대(가|의).{0,8})(?<![가-힣])(킥|발차기)(?!복싱)|(하단|몸통|머리|다리)을?\s*차(는|고|기|서)|\bkicks?\b/ },
  { value: 'knee', re: /니킥|무릎|(?<![가-힣])니\s*(공격|로|를)|knee/ },
  { value: 'elbow', re: /엘보|팔꿈치|elbow/ },
  { value: 'takedown', re: /테이크다운(?!.{0,12}(방어|막))|더블렉|싱글렉|메치기|takedown|double leg|single leg/ },
  { value: 'submission', re: /서브미션|조르기|관절기|암바|초크|기무라|트라이앵글|길로틴|submission|choke|armbar/ },
  { value: 'sweep', re: /스윕|sweep/ },
  { value: 'footwork', re: /풋워크|스텝|발놀림|피벗|footwork|step|pivot/ },
  { value: 'feint', re: /페인트|속임|속이|훼이크|페이크|레벨\s*체인지|시선을?\s*(끌|위로|돌리|빼앗)|fake|feint|level change/ },
  { value: 'pass', re: /가드\s*패스|패스\s*(하|를|기술)|pass(ing)?\b/ },
  { value: 'body', re: /바디|몸통|복부|리버|body shot|liver/ },
];

export const DIFFICULTY_RULES: Rule<DifficultyPref>[] = [
  { value: 'beginner', re: /초보|입문|처음|쉬운|기초|beginner|easy/ },
  { value: 'intermediate', re: /중급|intermediate/ },
  { value: 'advanced', re: /고급|상급|어려운|advanced/ },
];

export const KIND_RULES: Rule<'setup' | 'combo' | 'technique'>[] = [
  { value: 'setup', re: /셋업|세팅|유도|반응(을|하게)?\s*(이끌|만들|끌어)|미끼|setup|set up|bait/ },
  { value: 'combo', re: /콤보|조합|연타|연결기|콤비네이션|combination|combo/ },
  { value: 'technique', re: /단일\s*기술|기술\s*하나|한\s*가지\s*기술|single technique/ },
];

/** Requests to hurt someone outside sport (injury as the goal, street fights, banned targets). */
export const HARM_RE = /(일부러|고의로|진짜로|확실히)?\s*(다치게|부상(을|시키|입히)|부러뜨|부러트|망가뜨|불구|죽이|살인|기절\s*시키|실신\s*시키|못\s*일어나게|급소|눈\s*(을|을\s*)?(찌르|파)|길거리\s*싸움|싸움에서\s*(이기|제압)|복수|패\s*주|두들겨|break (his|her|their|someone'?s?) (arm|neck|leg)|hurt (him|her|them|someone)|street fight|kill)/i;

/** Analysed fields → the technique features they ask for (weights add up per feature). */
export const GOAL_WANTS: Record<Goal, Partial<Record<Feature, number>>> = {
  attack: { punch: 2, kick: 1.5, combination: 2, knee: 1.2, elbow: 0.8, pressure: 1, feint: 1 },
  defense: { defense: 3, footwork: 1, tdDefense: 1 },
  counter: { counter: 3, defense: 1.5, punch: 1 },
  distance: { footwork: 3, distance: 3, defense: 0.5 },
  takedown: { takedown: 3, clinch: 1 },
  tdDefense: { tdDefense: 3.5, defense: 1, clinch: 0.5 },
  position: { groundTop: 2.5, back: 2, pass: 1.5, clinch: 1 },
  escape: { escape: 3, guard: 1 },
  sweep: { sweep: 3, guard: 1.5 },
  submission: { submission: 3 },
  clinch: { clinch: 3, knee: 1.5, elbow: 1, takedown: 1 },
  transition: { transition: 2, combination: 1 },
};
export const BEHAVIOR_WANTS: Record<Behavior, Partial<Record<Feature, number>>> = {
  retreat: { pressure: 3, footwork: 2, combination: 1.5, feint: 1, punch: 1 },
  pressure: { counter: 2.5, footwork: 2, distance: 2, defense: 1, clinch: 0.5 },
  guardHigh: { body: 3, kick: 1, feint: 1, combination: 1 },
  jabReaction: { feint: 2.5, counter: 1.5, combination: 1.5 },
  takedownAttempt: { tdDefense: 3.5, defense: 1, counter: 1 },
  clinch: { clinch: 3, knee: 1.5, elbow: 1, takedown: 1, escape: 0.5 },
  kicks: { defense: 2, counter: 2, clinch: 0.5 },
  counterWaiting: { feint: 2.5, footwork: 1, combination: 1 },
  taller: { pressure: 2, clinch: 1.5, footwork: 1.5, takedown: 1 },
  bottom: { escape: 3, sweep: 2, guard: 1.5 },
  top: { groundTop: 2.5, pass: 2, submission: 1.5 },
  inGuard: { sweep: 2.5, submission: 2, guard: 2 },
  onBack: { back: 3, submission: 1.5 },
  punches: { defense: 2, counter: 2 },
  blocks: { feint: 2, body: 1.5, combination: 1.5 },
};
export const RANGE_WANTS: Record<Range, Partial<Record<Feature, number>>> = {
  long: { distance: 1.5, footwork: 1, kick: 1 },
  mid: { punch: 1, kick: 1 },
  close: { punch: 1, elbow: 1, knee: 0.5 },
  clinch: { clinch: 2, knee: 1, elbow: 1 },
  ground: { groundTop: 1, guard: 1, escape: 1, sweep: 1, submission: 1 },
};

/** Quick category chips → the features (and arts) they stand for. */
export const CATEGORY_WANTS: Record<QuickCategory, { label: string; wants: Partial<Record<Feature, number>>; arts?: string[] }> = {
  striking: { label: 'STRIKING', wants: { punch: 2, kick: 2, knee: 1, elbow: 1, combination: 1.5 }, arts: ['boxing', 'kickboxing', 'muay-thai'] },
  grappling: { label: 'GRAPPLING', wants: { groundTop: 2, guard: 2, sweep: 2, submission: 2, escape: 2, pass: 1.5 }, arts: ['bjj', 'judo', 'sambo'] },
  wrestling: { label: 'WRESTLING', wants: { takedown: 3, tdDefense: 2, clinch: 1.5 }, arts: ['wrestling'] },
  mma: { label: 'MMA', wants: { takedown: 1.5, tdDefense: 1.5, punch: 1.5, clinch: 1, groundTop: 1 }, arts: MMA_ARTS },
  defense: { label: 'DEFENSE', wants: { defense: 3, tdDefense: 1.5 } },
  counter: { label: 'COUNTER', wants: { counter: 3, defense: 1 } },
  distance: { label: 'DISTANCE CONTROL', wants: { footwork: 3, distance: 3 } },
  transitions: { label: 'TRANSITIONS', wants: { transition: 3, combination: 1, escape: 1, sweep: 1 } },
};

export const GOAL_LABEL: Record<Goal, string> = {
  attack: '공격 연결',
  defense: '방어',
  counter: '카운터',
  distance: '거리 조절',
  takedown: '테이크다운',
  tdDefense: '테이크다운 방어',
  position: '유리한 포지션',
  escape: '탈출',
  sweep: '스윕',
  submission: '서브미션',
  clinch: '클린치 공략',
  transition: '기술 연결·전환',
};
export const BEHAVIOR_LABEL: Record<Behavior, string> = {
  retreat: '상대가 뒤로 빠짐',
  pressure: '상대가 압박해 옴',
  guardHigh: '상대가 가드를 올림',
  jabReaction: '상대가 잽에 반응함',
  takedownAttempt: '상대가 테이크다운을 시도함',
  clinch: '클린치 상황',
  kicks: '상대가 킥을 씀',
  counterWaiting: '상대가 카운터를 노림',
  taller: '상대가 키·리치가 큼',
  bottom: '하위(깔린) 포지션',
  top: '상위 포지션',
  inGuard: '가드 포지션',
  onBack: '백 포지션',
  punches: '상대가 펀치를 씀',
  blocks: '상대가 공격을 막음',
};
export const RANGE_LABEL: Record<Range, string> = { long: '원거리', mid: '중거리', close: '근거리', clinch: '클린치', ground: '그라운드' };
export const FEATURE_LABEL: Record<Feature, string> = {
  punch: '펀치',
  kick: '킥',
  knee: '니',
  elbow: '엘보',
  body: '몸통 공격',
  footwork: '풋워크',
  feint: '페인트',
  defense: '방어',
  counter: '카운터',
  pressure: '압박',
  distance: '거리 조절',
  combination: '연결 공격',
  takedown: '테이크다운',
  tdDefense: '테이크다운 방어',
  clinch: '클린치',
  groundTop: '상위 포지션 컨트롤',
  guard: '가드',
  sweep: '스윕',
  submission: '서브미션',
  escape: '탈출',
  pass: '가드 패스',
  back: '백 컨트롤',
  transition: '연결·전환',
};
export const DIFFICULTY_LABEL: Record<DifficultyPref, string> = { beginner: '초급', intermediate: '중급', advanced: '고급' };

/**
 * Technique record text → features. Runs on the record's name, Korean name, aliases, category, positions, purpose,
 * description, principles and tags (lower-cased) — the DB's own words, so a feature is always traceable to a field.
 */
export const RECORD_FEATURE_RULES: Rule<Feature>[] = [
  { value: 'punch', re: /\bjab\b|\bcross\b(?![- ](arm|guard|face|grip|collar|wrist|body|ankle|side|step|over))|\bhook\b(?![- ]kick)|uppercut|overhand|straight(?! (knee|kick|armbar|ankle|foot))|punch|backfist|펀치|잽|훅|어퍼|스트레이트|주먹|zuki|tsuki/ },
  { value: 'kick', re: /kick|teep|chagi|geri|킥|티프|발차기/ },
  { value: 'knee', re: /knee|khao|니킥|무릎/ },
  { value: 'elbow', re: /elbow|\bsok\b|엘보|팔꿈치/ },
  { value: 'body', re: /\bbody\b|liver|바디|몸통|복부|명치|리버/ },
  { value: 'footwork', re: /\bstep\b(?![- ]?(up[- ])?(kick|knee))|pivot|footwork|shuffle|circl|angle|cut.?off|l-step|switch step|풋워크|스텝|피벗|발놀림|각도|서클/ },
  { value: 'feint', re: /feint|fake|페인트|속임|페이크/ },
  { value: 'defense', re: /block|parry|slip|roll|duck|bob|weave|cover|shell|guard\b|check|catch|lean|shoulder roll|방어|막기|블록|패리|슬립|위빙|uke|makki/ },
  { value: 'counter', re: /counter|카운터|kaeshi|되받|반격/ },
  { value: 'pressure', re: /pressure|cut.?off|forward|walk down|blitz|압박|전진|컷오프|블리츠|몰아/ },
  { value: 'distance', re: /range|distance|teep|long guard|거리|레인지|장거리/ },
  { value: 'combination', re: /→|->|--|combination|combo|연결|조합|콤비네이션|renzoku|연속/ },
  { value: 'takedown', re: /takedown|double leg|single leg|shot|throw|toss|trip|reap|osoto|ouchi|seoi|nage|gari|ashi|uchi.?mata|body lock lift|ankle pick|knee tap|테이크다운|메치|던지기|투사|싱글 레그|더블 레그|태클/ },
  { value: 'tdDefense', re: /sprawl|whizzer|down block|leg defense|takedown defen|단 디펜스|스프롤|위저|다운 블록|테이크다운 방어/ },
  { value: 'clinch', re: /clinch|plum|collar tie|underhook|overhook|body ?lock|two.on.one|wrist control|클린치|칼라 타이|언더훅|오버훅|바디락|빰|그립|kumi/ },
  { value: 'groundTop', re: /mount|side control|knee on belly|top position|ride|half guard top|north.south|마운트|사이드 컨트롤|니 온 벨리|탑 포지션|osaekomi|누르기/ },
  { value: 'guard', re: /\bguard\b(?! pass)|가드\s*\(|클로즈드 가드|오픈 가드|하프 가드|버터플라이|데 라 히바|스파이더|라쏘|x.guard/ },
  { value: 'sweep', re: /sweep|스윕|뒤집/ },
  { value: 'submission', re: /choke|armbar|kimura|americana|triangle|guillotine|lock|omoplata|strangle|조르기|관절기|암바|초크|기무라|트라이앵글|길로틴|shime|kansetsu/ },
  { value: 'escape', re: /escape|shrimp|hip escape|bridge|upa|granby|stand.?up|sit.?out|탈출|새우|브릿지|일어서|빠져나/ },
  { value: 'pass', re: /pass|패스/ },
  { value: 'back', re: /back take|back control|seatbelt|rear naked|백 컨트롤|백 테이크|시트벨트/ },
  { value: 'transition', re: /transition|→|->|전환|연결|chain|henka|renraku/ },
];
