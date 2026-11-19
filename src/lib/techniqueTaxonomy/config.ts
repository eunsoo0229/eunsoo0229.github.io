// Curated taxonomy per martial art — Level 2 groups built from the art's EXISTING category strings (each existing
// category belongs to exactly one group; nothing is renamed or removed, `technique.category` stays the source of
// truth). A group may:
//   children  'all'       every member category becomes a Level-3 child (e.g. 나게와자 → 발기술 / 손기술 / 허리기술 …)
//             'secondary' every member category except the first (the group's own) becomes a child
//                         (하프 가드 → 딥 하프 가드)
//   split     Level-3 children by purpose / family / position (dimensions.ts), created only where the art's real
//             data supports them (classify.ts / index.ts thresholds)
//   subSplit  Level-4 children of one split child (e.g. 서브미션 → 초크 / 암바 / 숄더락 / 레그락)
// `section` only groups Level-2 entries visually on the art page; it is not a level.
// Categories not listed here (user-added techniques, categories a technique carries from another art) become their
// own Level-2 group automatically, so every technique always has a place.

export interface GroupDef {
  id: string;
  ko: string;
  en: string;
  section: string;
  legacy: string[];
  children?: 'all' | 'secondary';
  split?: string[];
  /** Level-4 children of a Level-3 child — keyed by a split dimension id or a member category string. */
  subSplit?: Record<string, string[]>;
}

export interface ArtTaxonomyConfig {
  sections: { id: string; ko: string; en: string }[];
  groups: GroupDef[];
  /** Dimensions used to tag every technique of the art for cross-cutting search (purpose filter), even outside split groups. */
  tags: string[];
}

const SUBMISSION_FAMILIES = { submission: ['choke', 'armbar', 'shoulder_lock', 'leglock'] };
const GRAPPLING_TAGS = ['sweep', 'submission', 'back_take', 'pass', 'escape', 'retention', 'control', 'transition', 'entry', 'takedown', 'throw', 'grip', 'td_defense', 'defense', 'counter', 'setup'];
const STRIKING_TAGS = ['jab', 'straight', 'hook', 'uppercut', 'body_punch', 'special_punch', 'combination', 'feint', 'knee', 'elbow', 'teep', 'round_kick', 'low_kick', 'side_back_kick', 'axe_kick', 'spinning', 'jumping', 'block', 'parry', 'slip_roll', 'evasion', 'kick_defense', 'counter', 'defense', 'footwork', 'stance'];

export const TAXONOMY_CONFIG: Record<string, ArtTaxonomyConfig> = {
  bjj: {
    sections: [
      { id: 'standing', ko: '스탠딩', en: 'Standing' },
      { id: 'guard', ko: '가드 (하위)', en: 'Guards (Bottom)' },
      { id: 'top', ko: '패스 · 상위 포지션', en: 'Passing & Top Positions' },
      { id: 'escape', ko: '탈출 · 회복', en: 'Escapes & Recovery' },
      { id: 'submission', ko: '서브미션', en: 'Submissions' },
      { id: 'other', ko: '기타', en: 'Other' },
    ],
    tags: GRAPPLING_TAGS,
    groups: [
      { id: 'standing', ko: '스탠딩 · 테이크다운', en: 'Standing & Takedowns', section: 'standing', legacy: ['스탠딩 / 테이크다운'], split: ['grip', 'takedown', 'throw'] },
      { id: 'arm-drag', ko: '암 드래그', en: 'Arm Drag', section: 'standing', legacy: ['암 드래그 (Arm Drag)'] },
      { id: 'closed-guard', ko: '클로즈드 가드', en: 'Closed Guard', section: 'guard', legacy: ['클로즈드 가드 (Closed Guard)'], split: ['grip', 'control', 'guard_break', 'sweep', 'submission', 'back_take'] },
      { id: 'open-guard', ko: '오픈 가드', en: 'Open Guard', section: 'guard', legacy: ['오픈 가드 (Open Guard)'], split: ['guard_variant', 'sweep', 'entry', 'back_take', 'retention'] },
      { id: 'half-guard', ko: '하프 가드', en: 'Half Guard', section: 'guard', legacy: ['하프 가드 (Half Guard)', '딥 하프 가드 (Deep Half Guard)'], children: 'secondary', split: ['guard_variant', 'sweep', 'retention', 'escape', 'control'] },
      { id: 'butterfly', ko: '버터플라이 가드', en: 'Butterfly Guard', section: 'guard', legacy: ['버터플라이 가드 (Butterfly Guard)'], split: ['sweep'] },
      { id: 'de-la-riva', ko: '데 라 히바 가드', en: 'De La Riva Guard', section: 'guard', legacy: ['데 라 히바 (De La Riva Guard)', '스윕 기술 모음'], split: ['sweep', 'entry', 'back_take', 'grip'] },
      { id: 'spider', ko: '스파이더 가드', en: 'Spider Guard', section: 'guard', legacy: ['스파이더 가드 (Spider Guard)'], split: ['transition', 'entry'] },
      { id: 'lasso', ko: '라쏘 가드', en: 'Lasso Guard', section: 'guard', legacy: ['라쏘 가드 (Lasso Guard)'], split: ['transition'] },
      { id: 'x-guard', ko: 'X 가드', en: 'X-Guard', section: 'guard', legacy: ['X 가드 (X-Guard)'] },
      { id: 'slx', ko: '싱글 레그 X', en: 'Single Leg X', section: 'guard', legacy: ['싱글 레그 X (SLX / Single Leg X)'], split: ['sweep', 'transition'] },
      { id: 'fifty-fifty', ko: '50/50 가드', en: '50/50 Guard', section: 'guard', legacy: ['50/50 가드'] },
      { id: 'ashi-garami', ko: '아시 가라미 · 레그 엔탱글먼트', en: 'Ashi Garami & Leg Entanglements', section: 'guard', legacy: ['아시 가라미 (Ashi Garami)'] },
      { id: 'guard-passing', ko: '가드 패스', en: 'Guard Passing', section: 'top', legacy: ['패스 가드 (Guard Passing)', '가드 패스 기술 모음'], split: ['pass', 'control'] },
      { id: 'side-control', ko: '사이드 컨트롤', en: 'Side Control', section: 'top', legacy: ['사이드 컨트롤 (Side Control)'], split: ['control', 'submission'], subSplit: SUBMISSION_FAMILIES },
      { id: 'knee-on-belly', ko: '니 온 벨리', en: 'Knee on Belly', section: 'top', legacy: ['니 온 벨리 (Knee on Belly)'] },
      { id: 'north-south', ko: '노스 사우스', en: 'North-South', section: 'top', legacy: ['노스 사우스 (North-South)'] },
      { id: 'mount', ko: '마운트', en: 'Mount', section: 'top', legacy: ['마운트 (Mount)'], split: ['control', 'escape', 'submission'] },
      { id: 'back-control', ko: '백 컨트롤', en: 'Back Control', section: 'top', legacy: ['백 컨트롤 (Back Control)', '백 테이크 기술 모음'], split: ['control', 'back_take', 'submission'] },
      { id: 'turtle', ko: '터틀', en: 'Turtle', section: 'top', legacy: ['터틀 (Turtle)'], split: ['control', 'submission', 'escape'] },
      { id: 'front-headlock', ko: '프론트 헤드락', en: 'Front Headlock', section: 'top', legacy: ['프론트 헤드락 (Front Headlock)'], split: ['submission', 'back_take'] },
      { id: 'crucifix', ko: '크루시픽스', en: 'Crucifix', section: 'top', legacy: ['크루시픽스 (Crucifix)'] },
      { id: 'escapes', ko: '탈출 · 가드 회복', en: 'Escapes & Guard Recovery', section: 'escape', legacy: ['탈출 기술 모음', '기본 움직임과 연결 기술'], children: 'secondary', split: ['escape', 'retention'] },
      { id: 'submissions', ko: '서브미션 계열', en: 'Submission Families', section: 'submission', legacy: ['암바 계열', '트라이앵글 계열', '김우라 계열', '레그락 계열'], children: 'all' },
      { id: 'gi-nogi', ko: 'Gi / No-Gi 특화', en: 'Gi / No-Gi Specific', section: 'other', legacy: ['기(Gi)에서 특히 중요한 기술', '노기(No-Gi)에서 자주 등장하는 포지션'], children: 'all' },
    ],
  },

  'mixed-martial-arts': {
    sections: [
      { id: 'striking', ko: '타격', en: 'Striking' },
      { id: 'grappling', ko: '레슬링 · 클린치', en: 'Wrestling & Clinch' },
      { id: 'ground', ko: '그라운드', en: 'Ground' },
      { id: 'mma', ko: 'MMA 전환 · 상황', en: 'MMA Transitions & Situations' },
    ],
    tags: [...GRAPPLING_TAGS, ...STRIKING_TAGS],
    groups: [
      { id: 'striking', ko: '스트라이킹', en: 'Striking', section: 'striking', legacy: ['스트라이킹 (Striking)'], split: ['footwork', 'elbow', 'feint', 'stance'] },
      { id: 'boxing', ko: 'MMA 복싱', en: 'MMA Boxing', section: 'striking', legacy: ['MMA 복싱'], split: ['jab', 'straight', 'hook', 'uppercut', 'body_punch', 'combination', 'counter'] },
      { id: 'kickboxing', ko: 'MMA 킥복싱', en: 'MMA Kickboxing', section: 'striking', legacy: ['MMA 킥복싱'], split: ['teep', 'round_kick', 'low_kick', 'knee', 'combination', 'counter'] },
      { id: 'defense', ko: '방어', en: 'Defense', section: 'striking', legacy: ['방어 (Defense)'], split: ['td_defense', 'block', 'parry', 'slip_roll', 'evasion', 'kick_defense', 'escape'] },
      { id: 'clinch', ko: '클린치', en: 'Clinch', section: 'grappling', legacy: ['클린치 (Clinch)'], split: ['grip', 'body_lock_td', 'knee', 'elbow', 'trip', 'escape'] },
      { id: 'takedown', ko: '테이크다운', en: 'Takedowns', section: 'grappling', legacy: ['테이크다운 (Takedown)'], split: ['single_leg', 'double_leg', 'body_lock_td', 'trip', 'throw', 'setup', 'counter'] },
      { id: 'cage', ko: '케이지 워크', en: 'Cage Work', section: 'grappling', legacy: ['케이지 워크 (Cage Work)'] },
      { id: 'ground-control', ko: '그라운드 컨트롤', en: 'Ground Control', section: 'ground', legacy: ['그라운드 컨트롤 (Ground Control)'], split: ['mount_pos', 'side_pos', 'back_pos', 'turtle_pos', 'pass', 'sweep', 'escape', 'standup_pos'] },
      { id: 'ground-and-pound', ko: '그라운드 앤 파운드', en: 'Ground & Pound', section: 'ground', legacy: ['그라운드 앤 파운드 (Ground & Pound)'] },
      { id: 'submission', ko: '서브미션', en: 'Submissions', section: 'ground', legacy: ['서브미션 (Submission)'], split: ['choke', 'armbar', 'shoulder_lock', 'leglock'] },
      { id: 'transitions', ko: 'MMA 전환 동작', en: 'MMA Transitions', section: 'mma', legacy: ['MMA 전환 동작 (Transitions)'] },
      { id: 'scramble', ko: '스크램블', en: 'Scramble', section: 'mma', legacy: ['스크램블 (Scramble)'] },
    ],
  },

  wrestling: {
    sections: [
      { id: 'neutral', ko: '스탠딩 (뉴트럴)', en: 'Neutral' },
      { id: 'attack', ko: '테이크다운 공격', en: 'Takedown Attacks' },
      { id: 'defense', ko: '방어 · 카운터', en: 'Defense & Counters' },
      { id: 'mat', ko: '매트 (탑 · 바텀)', en: 'Mat Wrestling' },
    ],
    tags: [...GRAPPLING_TAGS, 'finish', 'turn', 'pin', 'ride', 'reversal'],
    groups: [
      { id: 'basics', ko: '기본 자세와 움직임', en: 'Stance & Motion', section: 'neutral', legacy: ['기본 자세와 움직임'], split: ['footwork', 'escape', 'defense'] },
      { id: 'ties', ko: '스탠딩 그립 · 타이', en: 'Standing Ties & Grips', section: 'neutral', legacy: ['스탠딩 포지션 / 그립'], split: ['grip', 'stance'] },
      { id: 'setups', ko: '공격 진입 (셋업 · 페이크)', en: 'Setups & Entries', section: 'attack', legacy: ['공격 진입 (셋업 / 페이크 / 피더링)'], split: ['setup', 'back_take'] },
      { id: 'leg-attacks', ko: '레그 어택', en: 'Leg Attacks', section: 'attack', legacy: ['싱글 레그', '더블 레그', '발목·무릎 공격'], children: 'all', subSplit: { '싱글 레그': ['finish'], '더블 레그': ['finish'] } },
      { id: 'body-lock', ko: '바디락 · 클린치', en: 'Body Lock & Clinch', section: 'attack', legacy: ['바디락 / 클린치'], split: ['grip', 'takedown'] },
      { id: 'throws', ko: '던지기 · 투사', en: 'Throws & Lifts', section: 'attack', legacy: ['던지기 / 투사 (상체 던지기 포함)'] },
      { id: 'front-headlock', ko: '프론트 헤드락', en: 'Front Headlock', section: 'attack', legacy: ['프론트 헤드락'] },
      { id: 'defense', ko: '테이크다운 방어 · 리샷', en: 'Takedown Defense & Re-Shots', section: 'defense', legacy: ['방어', '리샷 / 카운터'], children: 'all' },
      { id: 'top', ko: '탑 포지션 (라이드 · 턴 · 핀)', en: 'Top: Rides, Turns & Pins', section: 'mat', legacy: ['탑 포지션'], split: ['ride', 'turn', 'pin'] },
      { id: 'bottom', ko: '바텀 · 탈출 · 리버설', en: 'Bottom, Escapes & Reversals', section: 'mat', legacy: ['바텀 포지션', '탈출 (Escape)', '리버설 (Reversal)'], children: 'all' },
    ],
  },

  boxing: {
    sections: [
      { id: 'base', ko: '기본기', en: 'Fundamentals' },
      { id: 'offense', ko: '공격', en: 'Offense' },
      { id: 'defense', ko: '방어 · 카운터', en: 'Defense & Counters' },
      { id: 'tactics', ko: '근거리 · 전술', en: 'Inside Fighting & Tactics' },
    ],
    tags: STRIKING_TAGS,
    groups: [
      { id: 'stance', ko: '기본 자세 · 가드', en: 'Stances & Guards', section: 'base', legacy: ['기본 자세'] },
      { id: 'footwork', ko: '풋워크', en: 'Footwork', section: 'base', legacy: ['풋워크'] },
      { id: 'range', ko: '거리별 기술', en: 'Techniques by Range', section: 'base', legacy: ['거리별 포지션'] },
      { id: 'punches', ko: '펀치', en: 'Punches', section: 'offense', legacy: ['기본 펀치', '특수 펀치'], children: 'secondary', split: ['straight', 'hook', 'uppercut', 'body_punch', 'special_punch'] },
      { id: 'combos', ko: '콤비네이션 · 페인트', en: 'Combinations & Feints', section: 'offense', legacy: ['조합', '페인트 (Feint)'], children: 'all' },
      { id: 'defense', ko: '방어', en: 'Defense', section: 'defense', legacy: ['방어', '상대 펀치별 방어'], split: ['block', 'parry', 'slip_roll', 'evasion'] },
      { id: 'counters', ko: '카운터', en: 'Counter Punching', section: 'defense', legacy: ['카운터'], split: ['slip_roll', 'parry', 'evasion', 'block'] },
      { id: 'inside', ko: '근거리 · 클린치', en: 'Inside Fighting & Clinch', section: 'tactics', legacy: ['근거리 / 인파이팅', '클린치', '코너 / 로프 포지션'], children: 'all' },
      { id: 'tactics', ko: '링 전술', en: 'Ring Tactics', section: 'tactics', legacy: ['링 제너럴십 (Ring Generalship)', '사우스포 vs 오소독스 매치업 전술', '아마추어(포인트) vs 프로 스코어링과 전술', '스타일별 분류와 전형적 기술 조합'], children: 'all' },
    ],
  },

  'muay-thai': {
    sections: [
      { id: 'base', ko: '기본기', en: 'Fundamentals' },
      { id: 'weapons', ko: '공격 (8개의 무기)', en: 'The Eight Limbs' },
      { id: 'clinch', ko: '클린치', en: 'Clinch' },
      { id: 'defense', ko: '방어 · 카운터', en: 'Defense & Counters' },
    ],
    tags: STRIKING_TAGS,
    groups: [
      { id: 'basics', ko: '거리와 자세', en: 'Range & Stance', section: 'base', legacy: ['기본 개념 --- 거리(Range)와 자세'] },
      { id: 'kicks', ko: '킥 · 티프', en: 'Kicks & Teeps', section: 'weapons', legacy: ['장거리 킥 (Round Kick / Low Kick 계열)', '장거리 --- 티프 (Teep, ถีบ)', '로우킥 (Low Kick)'], children: 'all' },
      { id: 'punches', ko: '펀치', en: 'Punches', section: 'weapons', legacy: ['중거리 펀치'], split: ['combination'] },
      { id: 'elbows-knees', ko: '엘보 · 니', en: 'Elbows & Knees', section: 'weapons', legacy: ['엘보 (Sok, ศอก)', '니 (Khao, เข่า)'], children: 'all' },
      { id: 'spinning', ko: '스피닝 기술', en: 'Spinning Techniques', section: 'weapons', legacy: ['스피닝 기술 모음'] },
      { id: 'clinch', ko: '클린치', en: 'Clinch', section: 'clinch', legacy: ['클린치 (Clinch)'], split: ['grip', 'knee', 'trip'] },
      { id: 'defense', ko: '방어', en: 'Defense', section: 'defense', legacy: ['킥 캐치 / 방어', '펀치 방어', '킥 방어'], children: 'all' },
      { id: 'counters', ko: '카운터', en: 'Counters', section: 'defense', legacy: ['카운터 종합'] },
    ],
  },

  kickboxing: {
    sections: [
      { id: 'base', ko: '기본기 · 규칙', en: 'Fundamentals & Rules' },
      { id: 'offense', ko: '공격', en: 'Offense' },
      { id: 'defense', ko: '방어 · 카운터', en: 'Defense & Counters' },
    ],
    tags: STRIKING_TAGS,
    groups: [
      { id: 'concepts', ko: '기본 개념 · 규칙', en: 'Concepts & Rules', section: 'base', legacy: ['기본 개념', '규칙 체계 (가장 먼저 알아야 할 것)', '포인트 스파링 특유 전술', '테이크다운 방지 및 그래플링 브레이크 규정'], children: 'all' },
      { id: 'stance-footwork', ko: '스탠스 · 풋워크', en: 'Stance & Footwork', section: 'base', legacy: ['스탠스', '풋워크'], children: 'all' },
      { id: 'punches', ko: '펀치', en: 'Punches', section: 'offense', legacy: ['펀치'], split: ['straight', 'hook', 'uppercut', 'special_punch'] },
      { id: 'kicks', ko: '킥', en: 'Kicks', section: 'offense', legacy: ['킥'], split: ['teep', 'round_kick', 'low_kick', 'side_back_kick', 'axe_kick', 'spinning', 'jumping'] },
      { id: 'knees-elbows', ko: '니 · 엘보', en: 'Knees & Elbows', section: 'offense', legacy: ['니 (무릎)', '엘보'], children: 'all' },
      { id: 'combos', ko: '콤비네이션 · 페인트', en: 'Combinations & Feints', section: 'offense', legacy: ['대표적인 콤비네이션 (연결)', '페인트 (Feint)'], children: 'all' },
      { id: 'clinch', ko: '클린치 · 근거리', en: 'Clinch & Close Range', section: 'offense', legacy: ['클린치 / 근거리 제어'] },
      { id: 'defense', ko: '방어', en: 'Defense', section: 'defense', legacy: ['방어'], split: ['parry', 'slip_roll', 'evasion', 'kick_defense'] },
      { id: 'counters', ko: '카운터', en: 'Counters', section: 'defense', legacy: ['카운터'] },
    ],
  },

  taekwondo: {
    sections: [
      { id: 'base', ko: '기본', en: 'Basics' },
      { id: 'kicks', ko: '발차기', en: 'Kicks' },
      { id: 'sparring', ko: '겨루기', en: 'Sparring (Kyorugi)' },
      { id: 'forms', ko: '품새 · 격파 · 호신', en: 'Forms, Breaking & Self-Defense' },
    ],
    tags: STRIKING_TAGS,
    groups: [
      { id: 'stances', ko: '서기 · 이동', en: 'Stances & Movement', section: 'base', legacy: ['기본 서기 / 자세', '이동 / 풋워크'], children: 'all' },
      { id: 'hands-blocks', ko: '손기술 · 막기', en: 'Hand Techniques & Blocks', section: 'base', legacy: ['손기술', '막기'], children: 'all' },
      { id: 'kicks', ko: '발차기', en: 'Kicks', section: 'kicks', legacy: ['기본 발차기 (세부 명칭)', '회전 발차기', '점프 / 공중 발차기', '발차기 표적 부위 분류'], children: 'secondary' },
      { id: 'sparring', ko: '겨루기', en: 'Sparring', section: 'sparring', legacy: ['겨루기 발차기 [WT 중심]', '연결 기술 (콤비네이션)', '거리별 전술'], children: 'all' },
      { id: 'forms', ko: '품새', en: 'Poomsae', section: 'forms', legacy: ['품새 (Poomsae / Tul)'] },
      { id: 'breaking-selfdefense', ko: '격파 · 낙법 · 호신술', en: 'Breaking, Falls & Self-Defense', section: 'forms', legacy: ['격파 (Kyokpa)', '낙법과 호신술 [ITF 중심]'], children: 'all' },
    ],
  },

  karate: {
    sections: [
      { id: 'kihon', ko: '기본 (Kihon)', en: 'Kihon' },
      { id: 'kumite', ko: '쿠미테', en: 'Kumite' },
      { id: 'tradition', ko: '전통 · 응용', en: 'Tradition & Application' },
    ],
    tags: STRIKING_TAGS,
    groups: [
      { id: 'stances', ko: '서기 (Dachi)', en: 'Stances (Dachi)', section: 'kihon', legacy: ['기본 자세 (Kihon Dachi)'] },
      { id: 'movement', ko: '이동 · 회피', en: 'Movement & Evasion', section: 'kihon', legacy: ['이동 (Shintai / 풋워크)', '타이사바키 / 회피 (Tai Sabaki)'], children: 'all' },
      { id: 'hand', ko: '손기술 · 팔꿈치', en: 'Hand Strikes & Elbows', section: 'kihon', legacy: ['손기술 (Te-waza)', '팔꿈치 (Empi / Hiji)'], children: 'secondary' },
      { id: 'kicks', ko: '발차기 (Geri)', en: 'Kicks (Geri)', section: 'kihon', legacy: ['발차기 (Geri)'] },
      { id: 'blocks', ko: '막기 (Uke)', en: 'Blocks (Uke)', section: 'kihon', legacy: ['막기 (Uke)'] },
      { id: 'ranges', ko: '거리별 기술 (Maai)', en: 'Techniques by Range (Maai)', section: 'kumite', legacy: ['장거리 (To-ma)', '중거리 (Ma)', '근거리 (Chika-ma)'], children: 'all' },
      { id: 'counters-combos', ko: '카운터 · 연속기', en: 'Counters & Combinations', section: 'kumite', legacy: ['카운터 (Go no Sen 응용)', '조합 (Renzoku-waza)'], children: 'all' },
      { id: 'kumite', ko: '쿠미테 전술', en: 'Kumite Tactics', section: 'kumite', legacy: ['쿠미테 --- 판정 규칙과 타이밍'] },
      { id: 'tradition', ko: '응용 · 호흡 · 유파', en: 'Bunkai, Breathing & Styles', section: 'tradition', legacy: ['전통 가라테의 응용 (자기방어 / Bunkai)', '호흡법 (Kokyu-ho): Ibuki와 Nogare', '유파별 대표 기술과 가타'], children: 'all' },
    ],
  },

  judo: {
    sections: [
      { id: 'base', ko: '기본 · 그립', en: 'Basics & Gripping' },
      { id: 'nage', ko: '메치기 (Nage-waza)', en: 'Throws (Nage-waza)' },
      { id: 'katame', ko: '굳히기 (Katame-waza)', en: 'Grappling (Katame-waza)' },
    ],
    tags: GRAPPLING_TAGS,
    groups: [
      { id: 'basics', ko: '자세 · 이동 · 원리', en: 'Posture, Movement & Principles', section: 'base', legacy: ['기본 자세와 이동', '유도의 핵심 원리 --- Kuzushi · Tsukuri · Kake'], children: 'all' },
      { id: 'kumi-kata', ko: '그립 (Kumi Kata)', en: 'Gripping (Kumi Kata)', section: 'base', legacy: ['잡기 / 그립 --- Kumi Kata'] },
      { id: 'nage-waza', ko: '메치기 (Nage-waza)', en: 'Throws (Nage-waza)', section: 'nage', legacy: ['손기술 --- Te Waza', '허리기술 --- Koshi Waza', '발기술 --- Ashi Waza', '바로 누우며 던지기 --- Ma Sutemi Waza', '옆으로 누우며 던지기 --- Yoko Sutemi Waza'], children: 'all' },
      { id: 'combinations', ko: '연결 · 되치기', en: 'Combinations & Counters', section: 'nage', legacy: ['연속·연결·변화 기술 --- Renraku Waza / Henka Waza', '카운터 --- Kaeshi Waza'], children: 'all' },
      { id: 'osaekomi', ko: '누르기 · 바닥 포지션', en: 'Pins & Ground Positions (Osaekomi)', section: 'katame', legacy: ['네와자 / 바닥 포지션', '굳히기 --- Osaekomi Waza'] },
      { id: 'shime-kansetsu', ko: '조르기 · 관절기', en: 'Chokes & Joint Locks', section: 'katame', legacy: ['조르기 --- Shime Waza', '관절기 --- Kansetsu Waza'], children: 'all' },
      { id: 'escapes', ko: '탈출', en: 'Escapes', section: 'katame', legacy: ['탈출'], split: ['escape', 'retention'] },
    ],
  },

  sambo: {
    sections: [
      { id: 'standing', ko: '스탠딩', en: 'Standing' },
      { id: 'parter', ko: '파르테르 (그라운드)', en: 'Parter (Ground)' },
      { id: 'combat', ko: '컴뱃 삼보', en: 'Combat Sambo' },
    ],
    tags: GRAPPLING_TAGS,
    groups: [
      { id: 'basics-grips', ko: '자세 · 그립 · 균형 무너뜨리기', en: 'Stance, Grips & Off-Balancing', section: 'standing', legacy: ['기본 자세와 거리(Дистанция)', '그립 파이팅(Захват) --- 재킷·벨트 중심', '균형 무너뜨리기(Выведение из равновесия)'], children: 'all' },
      { id: 'throws', ko: '테이크다운 · 던지기', en: 'Takedowns & Throws', section: 'standing', legacy: ['테이크다운 진입 (레슬링 계열)', '다리 기술 --- 포드쎗카(Подсечка) 계열: 발쓸기(Sweep)', '다리 기술 --- 자쳅(Зацеп)·오트하바트(Отхват)·포드핫(Подхват)· 포드사드(Подсад)', '허리/몸통 던지기 --- 브로속 체레즈 베드로(Бросок через бедро)', '등으로 던지기 --- 브로속 체레즈 스피누(Бросок через спину)', '어깨·팔로 던지기 --- 멜니차(Мельница)와 베르투쉬카(Вертушка)', '희생 기술 --- 브로속 체레즈 골로부(Бросок через голову)· 체레즈 그루지(Бросок через грудь)'], children: 'all' },
      { id: 'counters', ko: '카운터', en: 'Counters', section: 'standing', legacy: ['카운터(Контрприем)'] },
      { id: 'parter', ko: '파르테르 포지션', en: 'Parter Positions', section: 'parter', legacy: ['스탠딩 → 파르테르(Партер) 전환', '탑 포지션과 홀드다운 --- 우제르자니예(Удержание)', '바텀 포지션과 탈출', '스윕 / 전환'], children: 'all' },
      { id: 'submissions', ko: '관절기 · 조르기', en: 'Locks & Chokes', section: 'parter', legacy: ['하체 관절기 --- 삼보의 전통적 강점', '상체 관절기 --- 뤄착(Рычаг)과 우젤(Узел)', '목/조르기 계열 --- 컴뱃 삼보 한정'], children: 'all' },
      { id: 'combat-striking', ko: '컴뱃 삼보 타격', en: 'Combat Sambo Striking', section: 'combat', legacy: ['컴뱃 삼보 타격 범주'] },
    ],
  },
};
