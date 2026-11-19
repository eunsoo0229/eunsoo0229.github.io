// Curated MMA combos / setups for 사용자 콤보 (operator account MARTIALDEX), v2 (2026-10-25).
// Researched from the web sources in SOURCES; every entry names the source it follows.
// Every step is a technique NAME that must resolve to a real MARTIALDEX technique
// (official DB or shared library) — the publisher refuses an entry whose step does not
// resolve. "Name@art" pins the record when the same name exists in several arts.
// Sequences already shared (v1 or by anyone) are skipped by the publisher.
//
// Entry: { kind, art, steps, purpose, desc, src: [source keys], label? }
//   kind 'combo' : steps are names
//   kind 'setup' : steps are { t, note?, react? } — react = the opponent reaction it draws
// TECHNIQUES: new shared-library records (add_teq) published before the combos that use them.

export const SOURCES = {
  evolve20: { label: 'Evolve MMA — 20 Advanced MMA Striking Set-Ups And Combinations', url: 'https://evolve-mma.com/blog/20-advanced-mma-striking-set-ups-and-combinations-you-should-add-to-your-arsenal/' },
  evolveTdStrikes: { label: 'Evolve — Setting Up Takedowns With Strikes (GSP · Rashad Evans · Frankie Edgar · Josh Koscheck)', url: 'https://evolve-vacation.com/blog/setting-up-takedowns-with-strikes/' },
  evolveCounters: { label: 'Evolve University — 5 Of The Most Useful Counter Techniques And Combinations For MMA', url: 'https://evolve-university.com/blog/5-of-the-most-useful-counter-techniques-and-combinations-for-mma/' },
  evolveSuperman: { label: 'Evolve MMA — Explosive Superman Punch Combinations (Denner Sitbandon breakdown)', url: 'https://evolve-mma.com/blog/watch-knock-your-opponent-out-with-these-explosive-superman-punch-combinations-videos/' },
  cejudoCatch: { label: 'Dynamic Striking — Catching Kicks To Set Up A Takedown With Henry Cejudo', url: 'https://dynamicstriking.com/blogs/news/catching-kicks-to-set-up-a-takedown-with-henry-cejudo' },
  cejudoLeg: { label: "Dynamic Striking — How To Catch Your Opponent's Leg And Take Them Down (Henry Cejudo)", url: 'https://dynamicstriking.com/blogs/news/how-to-catch-your-opponents-leg-and-take-them-down-by-henry-cejudo' },
  devoe: { label: 'Coaches Insider — Down Block Go Behind vs a Single (Austin DeVoe, Colorado School of Mines)', url: 'https://coachesinsider.com/wrestling/down-block-go-behind-vs-a-single-with-austin-devoe-colorado-school-of-mines' },
  usawSnap: { label: 'USA Wrestling — Snapdowns to Takedowns', url: 'https://content.usawmembership.com/articles/3711' },
  evolveSingleDef: { label: 'Evolve University — How To Defend The Single Leg Takedown In MMA', url: 'https://evolve-university.com/blog/how-to-defend-the-single-leg-takedown-in-mma/' },
  evolveSprawl: { label: 'Evolve MMA — What Is Sprawling In MMA?', url: 'https://evolve-mma.com/blog/what-is-sprawling-in-mma/' },
  sprawlshot: { label: 'Digitsu — Sprawlshot Drill (Mason Fowler)', url: 'https://digitsu.com/v/sprawlshot-drill-mason-fowler' },
  freeletics: { label: 'Freeletics — Sprawls (스프롤 후 일어나며 점프하는 동작)', url: 'https://freeletics.com/en/blog/posts/freeletics-exercises-sprawls' },
};

const MMA = 'mixed-martial-arts';
const C = (art, steps, purpose, desc, src, label) => ({ kind: 'combo', art, steps, purpose, desc, src, label });
const S = (art, steps, purpose, desc, src, label) => ({ kind: 'setup', art, steps, purpose, desc, src, label });

export const TECHNIQUES = [
  {
    name: 'Jump Sprawl',
    koreanName: '점프 스프롤',
    art: 'wrestling',
    category: '리샷 / 카운터',
    tags: ['테이크다운 방어', '드릴'],
    youtubeQuery: 'sprawl drill jump wrestling',
    difficulty: '초급',
    description: '스프롤로 다리를 뒤로 빼 골반을 매트 쪽에 붙여 슛을 끊은 뒤, 곧바로 손으로 밀며 다리를 당겨 점프하듯 일어나 다시 자세를 잡는 반응·체력 드릴 변형이다. 정식 경기 기술이라기보다 스프롤과 빠른 복귀를 반복해 익히는 훈련 동작이다.',
    purpose: '태클을 끊는 스프롤과, 스프롤 뒤 바로 일어나 다음 공격·슛으로 이어 가는 복귀 속도를 함께 훈련한다.',
    keyPoints: ['다리는 뒤로 차듯 빼고 골반을 매트 쪽으로 떨어뜨린다', '가슴이 아니라 골반으로 체중을 싣는다', '일어날 때 손으로 밀며 두 발을 동시에 당겨 점프', '착지하자마자 원래 스탠스와 가드로 복귀'],
    commonMistakes: ['가슴부터 앞으로 쓰러져 다리가 상대 손에 남음', '일어난 뒤 자세가 높게 서 버림', '점프에 집중해 스프롤 깊이가 얕아짐'],
    src: ['freeletics', 'sprawlshot', 'evolveSprawl'],
  },
];

const mma = [
  // ---- Evolve MMA: 20 advanced set-ups
  C(MMA, ['Jab', 'Cross', 'Lead Uppercut', 'Low Kick'], '잽으로 거리, 크로스로 가드를 끌고 어퍼 뒤 로우킥', '잽으로 거리를 재고 크로스로 상대 가드를 끌어낸 뒤 어퍼컷, 마지막 로우킥은 앞선 펀치에 가려 보이지 않게 들어갑니다. 다리와 움직임을 무너뜨리는 클래식 연결.', ['evolve20']),
  C(MMA, ['Slip', 'Rear Uppercut', 'Body Hook'], '슬립 후 일어나며 어퍼, 이어 바디 훅으로 단단한 가드 열기', '상대 펀치를 슬립하고 올라오며 뒷손 어퍼, 이어 리드 바디 훅으로 낮은 쪽을 공략해 굳은 가드를 엽니다.', ['evolve20']),
  S(MMA, [{ t: 'Inside Low Kick', react: '안쪽 로우킥에 반격하려고 들어옴' }, { t: 'Switch Stance', note: '킥을 내리며 스탠스 전환' }, { t: 'Lead Hook', note: '스위치로 앞손이 된 오른손 훅' }], '인사이드 로우킥으로 반격을 유도하고 스위치 후 오른손 훅', '안쪽 로우킥이 상대 반격을 끌어내고, 스탠스를 바꾸며 오른손 훅을 넣습니다. 키 큰 상대에게 유용하다고 소개됩니다.', ['evolve20']),
  C(MMA, ['Shoulder Roll', 'Spinning Back Fist'], '숄더 롤로 크로스를 흘리고 그 회전으로 스피닝 백피스트', '크로스를 숄더 롤로 흘린 회전을 그대로 이어 스피닝 백피스트 — 예상하지 못한 각도에서 들어갑니다.', ['evolve20']),
  S(MMA, [{ t: 'Kick Feint', note: '뒷발 로우킥 페인트', react: '로우킥을 막으려 가드·다리를 내림' }, { t: 'Kick Feint', note: '몸통 킥을 반쯤 보여 줌', react: '몸통을 막으려 손을 내림' }, { t: 'High Kick', note: '비어 있는 머리로' }], '로우킥·바디킥 페인트로 손을 내리게 해 하이킥', '로우킥 페인트로 가드를 끌어내리고, 몸통 킥을 반쯤 보여 손을 더 내리게 한 뒤 열린 머리로 하이킥.', ['evolve20']),
  C(MMA, ['Body Cross', 'Straight Knee', 'Horizontal Elbow'], '근거리 몸통 크로스-니-엘보 연결', '오른손 몸통 크로스에서 오른 무릎, 오른 팔꿈치로 이어지는 근거리 연결 — 상대를 짧은 거리에 묶어 둡니다.', ['evolve20']),
  C(MMA, ['Superman Punch', 'Lead Low Kick'], '슈퍼맨 펀치로 가드를 올린 뒤 앞발 킥', '킥처럼 보이다 펀치가 되는 슈퍼맨 펀치에 상대가 가드를 올리면 몸통·다리가 비어 빠른 앞발 킥이 들어갑니다.', ['evolve20']),
  C(MMA, ['Body Jab', 'Overhand'], '바디 잽으로 시선을 아래로, 오버핸드를 머리에', '몸통 잽으로 상대가 아래를 의식하게 만든 뒤 오버핸드를 머리로. 레벨 체인지도 오버핸드 셋업에 도움이 됩니다.', ['evolve20']),
  S(MMA, [{ t: 'Jab', note: '거리 재기' }, { t: 'Lead Teep', react: '밀려나며 뒤로 물러남' }, { t: 'Flying Knee', note: '니 페인트 후, 물러나는 상대에게 — 공중에서도 가드 유지' }], '잽-앞발 팁으로 밀어낸 뒤 플라잉 니', '잽과 앞발 팁으로 거리를 재고 흔든 뒤, 무릎 페인트로 반응을 끌어내고 물러나는 상대에게 플라잉 니로 거리를 좁힙니다.', ['evolve20']),
  C(MMA, ['Clinch Knee', 'Elbow from Clinch'], '클린치 니 뒤 떨어지며 엘보', '클린치에서 몸통·머리로 무릎을 넣고, 서로 떨어지는 순간 엘보를 넣습니다.', ['evolve20']),
  C(MMA, ['Jab', 'Overhand', 'High Kick'], '스텝인 잽-오버핸드로 머리를 옆으로 빼게 해 하이킥', '스텝인 잽으로 거리를 좁히고 오버핸드로 상대 머리를 옆으로 움직이게 한 뒤, 그 머리로 하이킥.', ['evolve20']),
  S(MMA, [{ t: 'Jab', react: '머리 쪽 공격에 반응' }, { t: 'Feint@boxing', note: '크로스 페인트', react: '얼굴 가드를 올림' }, { t: 'Body Hook', note: '비어 있는 몸통 공격' }], '잽 뒤 크로스 페인트로 가드를 올리고 몸통 공격', '잽-크로스를 예상하게 만든 뒤 크로스를 페인트로 바꾸고 몸통 공격으로 가드를 무너뜨립니다 (출처는 "몸통 공격"으로만 소개 — 여기서는 바디 훅).', ['evolve20']),
  C(MMA, ['Low Kick', 'High Kick'], '로우킥 반응을 이용한 하이킥', '로우킥에 대한 자연스러운 방어 반응(다리 들기·손 내리기)으로 머리가 비는 순간 하이킥.', ['evolve20']),
  S(MMA, [{ t: 'Overhand', react: '두 손을 올려 막음' }, { t: 'Level Change Double Leg', note: '비어 있는 다리로' }], '오버핸드로 손을 올리게 해 테이크다운', '오버핸드를 막으려 상대가 손을 올리면 다리가 비어 테이크다운 기회가 생깁니다.', ['evolve20']),
  C(MMA, ['Cross', 'Rear Knee', 'Horizontal Elbow'], '크로스-뒷무릎으로 거리를 좁히고 엘보', '크로스와 뒷무릎으로 거리를 좁히고 근거리 엘보로 마무리.', ['evolve20']),
  S(MMA, [{ t: 'Body Lock', react: '바디락에 붙잡혀 버팀' }, { t: 'High Kick', note: '떨어지는 순간' }], '바디락으로 묶은 뒤 떨어지며 하이킥', '바디락으로 상대를 통제하다 하이킥으로 연결 — 경기를 끝내거나 후반 라운드를 대비해 체력을 빼앗습니다.', ['evolve20']),
  C(MMA, ['Body Kick', 'Teep'], '뒷발 라운드킥 뒤 팁으로 높이·각도 바꾸기', '뒷발 라운드킥과 팁(푸시 킥)으로 서로 다른 높이와 각도를 빠르게 연속 공격.', ['evolve20']),
  S(MMA, [{ t: 'Jab' }, { t: 'Cross', note: '원투 뒤 잠깐 멈춤' }, { t: 'Jab Feint', react: '잽을 막으려 반응' }, { t: 'Spinning Elbow', note: '균형을 잃은 순간' }], '원투 뒤 쉬었다 잽 페인트로 스피닝 엘보', '원투 뒤 잠깐 멈추고 잽 페인트로 반응을 끌어낸 뒤 스피닝 엘보로 균형이 흐트러진 상대를 노립니다.', ['evolve20']),
  // ---- Evolve: setting up takedowns with strikes
  S(MMA, [{ t: 'Lead Hook', react: '훅을 맞받으려 앞으로 달려듦' }, { t: 'Basic Double Leg', note: '낮춘 어깨로 받아 더블레그' }], '리드 훅으로 달려들게 해 더블레그 (GSP vs 세라)', '조르주 생피에르가 맷 세라를 상대로 쓴 연결: 리드 훅에 상대가 앞으로 달려들면 낮춘 어깨에 걸려 더블레그가 들어갑니다.', ['evolveTdStrikes']),
  S(MMA, [{ t: 'Cross' }, { t: 'Lead Hook', react: '빠른 연타에 두 팔로 머리를 감싸 커버' }, { t: 'Level Change Double Leg', note: '시야가 가려진 순간' }], '빠른 연타로 커버하게 만들고 태클 (라샤드 에반스)', '빠르고 강한 펀치에 상대가 두 팔로 머리를 감싸면 시야가 가리고 몸이 굳어, 그 순간 태클을 들어갑니다.', ['evolveTdStrikes']),
  S(MMA, [{ t: 'Duck', react: '크게 휘두르는 펀치로 돌진' }, { t: 'Basic Double Leg', note: '덕킹한 그대로 골반·다리를 잡음' }], '돌진하는 펀치 아래로 덕킹해 더블레그 (프랭키 에드가)', '상대의 큰 펀치 아래로 덕킹해 그대로 골반이나 다리를 잡는 카운터 레슬링 — 프랭키 에드가가 그레이 메이나드 상대로 성공.', ['evolveTdStrikes']),
  S(MMA, [{ t: 'Level Change Double Leg', react: '태클을 막으려 고개를 숙이고 버팀' }, { t: 'Rear Uppercut', note: '막힌 태클 직후, 숙인 머리로' }], '막힌 태클 직후 어퍼컷 (에드가 vs 메이나드)', '에드가는 실패한 더블레그 직후 어퍼컷으로 메이나드를 KO 시켰습니다. 태클이 막혀도 바로 타격으로 전환.', ['evolveTdStrikes']),
  // ---- kick catch → takedown (Cejudo / Evolve)
  S(MMA, [{ t: 'Catch@kickboxing', note: '킥 방향으로 옆으로 움직이며 다리를 받아 잡음', react: '한 발로 서서 균형이 흔들림' }, { t: 'High Single', note: '잡은 다리를 당기며 붙어 싱글' }], '킥을 잡아 싱글 레그 (헨리 세후도)', '킥을 차는 순간 상대는 균형이 무너집니다. 킥 방향으로 비켜 힘을 죽이며 다리를 받아 잡고, 당기며 붙어 싱글 레그로 넘깁니다.', ['cejudoCatch', 'cejudoLeg', 'evolveTdStrikes']),
  S(MMA, [{ t: 'Catch@kickboxing', react: '잡힌 다리로 한 발 서기' }, { t: 'Outside Trip', note: '디딤발을 바깥에서 걸어 넘김' }], '킥을 잡아 트립으로 넘기기', '세후도는 다리를 잡은 뒤 싱글·더블뿐 아니라 다리 걸기(트립)로도 넘길 수 있다고 설명합니다.', ['cejudoLeg']),
  // ---- Evolve University: counters / superman
  C(MMA, ['Jab', 'Gazelle Punch'], '자리 잡은 잽 뒤 가젤 펀치', '잽이 자리 잡으면 앞손 가젤 펀치(무릎을 굽혔다 튀어 오르며 치는 훅)로 연결할 수 있다고 소개됩니다.', ['evolveCounters']),
  C(MMA, ['Jab', 'High Kick'], '잽으로 시선을 묶고 하이킥', '자리 잡은 잽은 하이킥(어느 쪽이든)을 위한 셋업이 됩니다.', ['evolveCounters']),
  C(MMA, ['Jab', 'Cross', 'Lead Hook', 'Low Kick', 'Superman Punch'], '원투훅-로우킥 뒤 다리를 뒤로 뻗으며 슈퍼맨', '원투훅 뒤 뒷발 로우킥, 그 다리를 회수해 뒤로 쭉 뻗으며 크로스를 던지는 반 박자 공격 — 뻗은 다리가 균형을 잡아 줘 빗나가도 버틸 수 있습니다.', ['evolveCounters']),
  S(MMA, [{ t: 'Cross', note: '맞히지 않아도 되는 크로스(페인트 가능)', react: '크로스를 패리함' }, { t: 'High Kick', note: '패리로 생긴 빈틈으로' }], '크로스를 패리하게 만들어 하이킥', '상대가 크로스를 계속 패리하면 그 동작이 킥이 들어갈 틈을 만듭니다. 오픈 스탠스(오소독스 vs 사우스포)에서 특히 잘 통합니다.', ['evolveCounters']),
  C(MMA, ['Check@kickboxing', 'Superman Punch'], '정강이 체크에서 발을 내리지 않고 슈퍼맨 펀치 (데너 싯반돈)', '킥을 정강이로 막은 다리를 땅에 내리지 않고 그대로 뒤로 차며 슈퍼맨 펀치로 이어 KO를 만든 장면에서 가져온 연결.', ['evolveSuperman']),
  S(MMA, [{ t: 'Kick Feint', react: '킥을 막으려 다리를 들거나 손을 내림' }, { t: 'Superman Punch', note: '페인트한 다리를 뒤로 차며' }], '킥 페인트로 슈퍼맨 펀치 셋업', '슈퍼맨 펀치는 잘못 쓰면 훅 카운터를 맞기 쉬워 셋업이 필요합니다. 킥 페인트를 먼저 보여 준 뒤 던집니다.', ['evolveSuperman']),
  // ---- takedown defense → counter (MMA)
  C(MMA, ['Sprawl', 'Whizzer'], '스프롤로 슛을 끊고, 다리를 잡히면 위저', '슛이 오면 스탠스를 넓히고 골반을 낮춰 체중을 상대 몸통에 싣는 스프롤, 그래도 다리를 잡히면 상대 팔을 위에서 감아 눌러 어깨에 압박을 주는 위저로 거리를 관리합니다.', ['evolveSingleDef', 'evolveSprawl']),
  C(MMA, ['Down Block', 'Go-Behind'], '싱글을 다운 블락으로 막고 고 비하인드', '들어오는 싱글을 다운 블락으로 막고, 무릎을 미끄러뜨려 골반 옆을 축으로 돌아 상대 뒤로 갑니다.', ['devoe']),
  C(MMA, ['Sprawl', 'Snap Down', 'Go-Behind'], '스프롤로 머리를 끌어내린 뒤 스냅 다운에서 고 비하인드', '상대의 전진을 풀 스프롤로 받아 머리를 매트로 끌어내리고, 스냅 다운에서 돌아 뒤를 잡습니다.', ['usawSnap']),
];

// ---- wrestling drills the mitt can call (reaction: the holder shoots → you answer)
const wrestling = [
  C('wrestling', ['Sprawl', 'High Single'], '스프롤 후 일어나 상대 앞다리로 싱글 (스프롤샷 드릴)', '파트너 신호에 스프롤, 바로 일어나 상대 스탠스를 읽고 앞다리 쪽으로 싱글 레그를 들어가는 드릴. 30초~1분 라운드로 반복합니다.', ['sprawlshot']),
  C('wrestling', ['Jump Sprawl', 'Basic Double Leg'], '점프 스프롤로 끊고 일어나며 바로 더블레그', '스프롤로 슛을 끊고 점프하듯 일어나 자세를 되찾자마자 더블레그로 반격하는 반응·체력 드릴.', ['sprawlshot', 'freeletics']),
];

export const ENTRIES = [...mma, ...wrestling];
