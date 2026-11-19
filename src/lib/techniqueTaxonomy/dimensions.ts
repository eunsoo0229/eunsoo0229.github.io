// Classification dimensions for the technique taxonomy — what a technique IS FOR (purpose), what KIND of technique it
// is (family), or WHERE it happens (position). Each art's config (config.ts) picks the dimensions that make sense for
// it; a group is only split along the dimensions it lists. Terms are matched against a technique's own data
// (classify.ts) — Korean as substrings, English on word boundaries. `mask` phrases are blanked out first so a
// compound word never counts as the dimension ("언더훅" is not a hook punch, "body triangle" is not a triangle choke).

export type DimensionKind = 'purpose' | 'family' | 'position';

export interface Dimension {
  id: string;
  kind: DimensionKind;
  ko: string;
  en: string;
  termsKo: string[];
  termsEn: string[];
  mask?: string[];
}

const D = (id: string, kind: DimensionKind, ko: string, en: string, termsKo: string[], termsEn: string[], mask?: string[]): Dimension => ({ id, kind, ko, en, termsKo, termsEn, mask });

const HOOK_MASK = ['언더훅', '오버훅', '후크', 'underhook', 'underhooks', 'overhook', 'hooks', 'hook sweep', 'dlr hook', 'butterfly hook', 'hooks in', 'hook control', 'lasso hook', 'de la riva hook'];
const CROSS_MASK = ['crossface', 'cross face', 'cross-face', 'cross collar', 'cross grip', 'cross side', 'cross guard', 'cross step', 'cross-arm', 'cross wrist', 'cross ankle', 'cross body', '크로스 그립', '크로스 칼라', '크로스페이스', '크로스 페이스', '크로스 스텝', '크로스 가드', '크로스 사이드'];
const TRIANGLE_MASK = ['body triangle', '바디 트라이앵글', '바디트라이앵글', 'tripod'];
const GRAPPLING_ROLL_MASK = ['granby', '그랜비', 'peterson', '피터슨', 'bridge and roll', 'roll-through', 'roll through', 'trap and roll', 'wrist roll', 'roll towards', '브릿지 앤 롤', '굴러'];

export const DIMENSIONS: Dimension[] = [
  // ── grappling purposes ──
  D('sweep', 'purpose', '스윕', 'Sweeps', ['스윕', '뒤집', '상대를 넘기'], ['sweep', 'sweeps'], ['sweep single', 'foot sweep', 'kick catch to sweep', 'catch and sweep']),
  D('submission', 'purpose', '서브미션', 'Submissions', ['서브미션', '초크', '조르기', '조르는', '조릅', '관절기', '암바', '기무라', '김우라', '아메리카나', '오모플라타', '레그락', '힐훅', '니바', '토홀드', '앵클락', '길로틴', '트라이앵글', '넥타이', '십자', '꺾', '가타메 (관절', 'рычаг', 'узел', 'ущемление', 'удушающ'],
    ['submission', 'submissions', 'choke', 'strangle', 'armbar', 'arm bar', 'kimura', 'americana', 'omoplata', 'heel hook', 'kneebar', 'toe hold', 'ankle lock', 'calf slicer', 'guillotine', 'triangle', 'necktie', 'arm triangle', "d'arce", 'darce', 'anaconda', 'ezekiel', 'jime', 'juji', 'ude garami', 'leg lock', 'leg locks', 'armlock', 'wristlock'], TRIANGLE_MASK),
  D('back_take', 'purpose', '백 테이크', 'Back Takes', ['백 테이크', '백테이크', '등 뒤로', '등 뒤를 잡', '백을 잡', '백을 확보', '백을 완성', '백 포지션으로', '백으로 전환', '백으로 이동', '백 컨트롤을 확보', '백 컨트롤로', 'забегание за спину'], ['back take', 'back takes', 'take the back', 'to back', '→ back', 'go-behind', 'go behind', 'spin behind', 'berimbolo']),
  D('pass', 'purpose', '가드 패스', 'Guard Passing', ['패스', '가드를 통과', '가드를 넘'], ['pass', 'passing', 'leg drag', 'torreando', 'knee cut', 'long step', 'smash'], ['pass the ball']),
  D('guard_variant', 'position', '가드 종류', 'Guard Variations', ['가드$', '가드 형태$', '가드 포지션$', '가드 변형$', '하프 가드$'], ['guard', 'lockdown', 'knee shield', 'z guard', 'dogfight'], ['guard break', 'guard recovery', 'recover full guard', 'recover butterfly guard', 'guard pass']),
  D('guard_break', 'purpose', '가드 오프닝', 'Guard Opening', ['가드 브레이크', '가드를 열', '다리를 풀어', '오프닝'], ['guard break', 'guard opening', 'open the guard', 'knee-in-the-middle']),
  D('escape', 'purpose', '탈출', 'Escapes', ['탈출', '이스케이프', '빠져나', '벗어나', '피터슨', '그랜비', '시트아웃', '싯아웃', '스탠드업으로'], ['escape', 'escapes', 'sit-out', 'sit out', 'granby', 'peterson', 'stand-up to escape', 'wrist peel', 'hip heist']),
  D('retention', 'purpose', '가드 회복·리텐션', 'Guard Retention & Recovery', ['리텐션', '가드 회복', '가드를 회복', '가드로 회복', '가드 유지', '리커버리', '회복'], ['retention', 'recovery', 'recover', 'guard recovery', 'wrestle-up', 'wrestle up', 'technical stand-up', 'stand-up']),
  D('control', 'purpose', '컨트롤·유지', 'Control & Pins', ['컨트롤', '누르기', '굳히기', '홀드', '포지션$', 'удержание'], ['control', 'pressure', 'ride', 'pin', 'hold', 'gatame', 'seatbelt', 'chair sit', 'mount', 'crossface']),
  D('transition', 'purpose', '전환', 'Transitions', ['전환', '트랜지션', '이동하는', '넘어가는', '연결 동작', 'перевод'], ['transition', 'to x guard', 'to slx', 'to spider', '→', 'backstep', 'to single leg', 'to side control', 'to mount']),
  D('entry', 'purpose', '진입·엔트리', 'Entries', ['엔트리', '진입', '들어가는'], ['entry', 'entries', 'entering']),
  D('takedown', 'purpose', '테이크다운', 'Takedowns', ['테이크다운', '넘어뜨리', '쓰러뜨리'], ['takedown', 'takedowns', 'single leg', 'single-leg', 'double leg', 'double-leg', 'high crotch', 'ankle pick', 'knee tap', 'trip', 'fireman', 'mat return', 'lateral drop', 'suplex', 'lift']),
  D('throw', 'purpose', '던지기', 'Throws', ['던지기', '던지는', '메치', '업어', '허리기술', '바로 누우며', '옆으로 누우며', 'бросок'], ['throw', 'throws', 'nage', 'goshi', 'otoshi', 'guruma', 'makikomi', 'gaeshi', 'hip toss', 'suplex', 'fireman', 'seoi']),
  D('grip', 'purpose', '그립·타이', 'Grips & Ties', ['그립', '잡기', '타이', '언더훅', '오버훅', 'захват'], ['grip', 'grips', 'tie', 'collar', 'sleeve', 'underhook', 'overhook', 'whizzer', '2-on-1', 'two-on-one', 'russian tie', 'wrist control', 'kumi kata', 'hand fighting', 'hand control']),
  D('defense', 'purpose', '방어', 'Defense', ['방어', '막는', '막기', '디펜스', '블로킹'], ['defense', 'defence', 'defend', 'block', 'down block', 'sprawl', 'whizzer', 'square hips', 'hip pressure', 'head hands']),
  D('counter', 'purpose', '카운터·되치기', 'Counters', ['카운터', '반격', '되치기', '역공', '되받', 'контрприем'], ['counter', 'counters', 'kaeshi', 'gaeshi', 're-single', 're-double', 'reshot', 'catch and return', 'check and return']),
  D('td_defense', 'purpose', '테이크다운 방어', 'Takedown Defense', ['테이크다운 방어', '테이크다운을 막', '스프롤', '태클을 막', '다리를 빼'], ['sprawl', 'whizzer', 'down block', 'crossface', 'hip pressure', 'square hips', 'chest-to-chest', 'down defense', 'front headlock defense', 'takedown defense', 'head hands', 'fence takedown defense']),
  D('setup', 'purpose', '셋업·페인트', 'Setups & Feints', ['셋업', '페인트', '유인', '속임'], ['setup', 'set-up', 'feint', 'fake', 'fake shot', 'pump', 'arm drag', 'snap down', 'duck under', 'slide by', 'shuck', 'throw-by', 'drop step']),
  D('finish', 'purpose', '마무리 (피니시)', 'Finishes', ['마무리', '피니시'], ['finish', 'finishes', 'running the pipe', 'cutback', 'back trip', 'lift and return', 'corner', 'switch-off']),
  D('turn', 'purpose', '턴·틸트', 'Turns & Tilts', ['틸트', '뒤집어', '넬슨', '바 암', '치킨 윙'], ['tilt', 'nelson', 'bar arm', 'chicken wing', 'turk', 'gut wrench', 'cross wrist']),
  D('pin', 'purpose', '핀·크레이들', 'Pins & Cradles', ['크레이들', '핀 ', '폴'], ['cradle', 'pin combination', 'pin']),
  D('ride', 'purpose', '라이드', 'Rides', ['라이드'], ['ride', 'tight waist', 'chop', 'claw']),
  D('reversal', 'purpose', '리버설', 'Reversals', ['리버설'], ['reversal', 'roll-through', 'switch to attack']),
  // ── submission families (L4 under submissions) ──
  D('choke', 'family', '초크·조르기', 'Chokes', ['초크', '조르기', '조르는', '넥타이', '길로틴', '트라이앵글 초크', '지메', 'удушающ'], ['choke', 'strangle', 'guillotine', 'necktie', 'triangle', 'arm triangle', "d'arce", 'darce', 'anaconda', 'ezekiel', 'jime', 'loop choke', 'bow and arrow', 'clock choke'], TRIANGLE_MASK),
  D('armbar', 'family', '암바 계열', 'Armbars', ['암바', '십자꺾기', '주지가타메', 'рычаг локтя'], ['armbar', 'arm bar', 'juji', 'ude hishigi juji']),
  D('shoulder_lock', 'family', '숄더락·암락 (기무라·아메리카나)', 'Shoulder Locks & Armlocks', ['기무라', '김우라', '아메리카나', '오모플라타', '우데가라미', '숄더락', 'узел плеча', 'рычаг плеча'], ['kimura', 'americana', 'omoplata', 'ude garami', 'shoulder lock', 'armlock', 'wristlock', 'wrist lock']),
  D('leglock', 'family', '레그락', 'Leg Locks', ['레그락', '힐훅', '니바', '토홀드', '앵클락', '앵클 락', '카프 슬라이서', 'рычаг колена', 'рычаг стопы', 'рычаг бедра', 'ущемление ахиллова', 'ущемление икроножной', 'узел стопы'], ['leg lock', 'leglock', 'heel hook', 'kneebar', 'knee bar', 'toe hold', 'ankle lock', 'calf slicer', 'achilles', 'foot lock']),
  // ── striking families ──
  D('jab', 'family', '잽', 'Jabs', ['잽'], ['jab', 'kizami'], []),
  D('straight', 'family', '스트레이트·크로스', 'Straights & Crosses', ['스트레이트', '크로스', '바로지르기', '반대지르기', '지르기'], ['cross', 'straight', 'oi-zuki', 'gyaku-zuki', 'choku-zuki', '1--2'], CROSS_MASK),
  D('hook', 'family', '훅', 'Hooks', ['훅'], ['hook', 'hooks', 'mawashi-zuki', 'kagi-zuki', 'check hook', 'shovel'], HOOK_MASK),
  D('uppercut', 'family', '어퍼컷', 'Uppercuts', ['어퍼컷', '어퍼'], ['uppercut', 'age-zuki', 'tate-zuki']),
  D('body_punch', 'family', '바디 공격', 'Body Shots', ['바디 ', '몸통'], ['body jab', 'body cross', 'body hook', 'body uppercut', 'body attack', 'to body', 'shovel hook', 'body--head', 'head--body']),
  D('special_punch', 'family', '특수 펀치', 'Special Punches', ['오버핸드', '슈퍼맨', '볼로', '백피스트', '등주먹'], ['overhand', 'superman', 'bolo', 'backfist', 'gazelle', 'corkscrew', 'uraken']),
  D('combination', 'family', '콤비네이션', 'Combinations', ['콤비네이션', '연속', '조합'], ['combination', 'combo', '→', '--']),
  D('feint', 'family', '페인트', 'Feints', ['페인트'], ['feint', 'fake']),
  D('knee', 'family', '니 (무릎)', 'Knees', ['니킥', '니 킥', '무릎 차기', '무릎 공격', '무릎으로 찍', '무릎으로 올려', '무릎을 올려 차', '무릎 타격', '카오'], ['knee', 'khao'], ['knee shield', 'knee cut', 'knee slide', 'knee on belly', 'knee tap', 'knee mount', 'kneebar', 'knee bar']),
  D('elbow', 'family', '엘보 (팔꿈치)', 'Elbows', ['엘보', '팔꿈치 공격', '팔꿈치 치기', '팔꿈치 타격', '팔꿈치로 치', '팔꿈치로 찍', '팔꿈치로 베', '팔굽치기', '팔굽'], ['elbow', 'empi', 'hiji', 'sok'], ['elbow guard', 'elbow block', 'elbow shield', 'elbow-knee', 'knee elbow', 'elbow control', 'elbow escape']),
  D('teep', 'family', '앞차기·티프', 'Front Kicks & Teeps', ['앞차기', '밀어차기', '티프'], ['teep', 'front kick', 'push kick', 'mae geri']),
  D('round_kick', 'family', '돌려차기·라운드킥', 'Round Kicks', ['돌려차기', '라운드킥', '라운드 킥'], ['round kick', 'roundhouse', 'mawashi geri', 'switch kick', 'body kick', 'high kick', 'question mark']),
  D('low_kick', 'family', '로우킥', 'Low Kicks', ['로우킥', '로우 킥', '카프킥'], ['low kick', 'calf kick', 'thigh kick', 'leg kick', 'oblique kick']),
  D('side_back_kick', 'family', '옆차기·뒤차기', 'Side & Back Kicks', ['옆차기', '뒤차기', '뒤후려', '후려차기'], ['side kick', 'back kick', 'yoko geri', 'ushiro geri', 'wheel kick']),
  D('axe_kick', 'family', '내려차기·반달차기', 'Axe & Crescent Kicks', ['내려차기', '찍어차기', '반달차기'], ['axe kick', 'crescent', 'kakato', 'mikazuki']),
  D('spinning', 'family', '회전 기술', 'Spinning Techniques', ['회전 발차기', '회전하며 뒤', '뒤로 돌며', '몸을 완전히 회전', '스피닝', '뒤돌아', '돌개'], ['spinning', 'spin', 'tae chiang'], ['spin behind']),
  D('jumping', 'family', '점프 기술', 'Jumping Techniques', ['뛰어', '점프', '이단', '공중', '플라잉'], ['jumping', 'flying', 'jump', 'tobi', 'nidan']),
  D('block', 'family', '블로킹·가드', 'Blocks & Covers', ['막기', '블록', '블로킹', '커버', '가드'], ['block', 'cover', 'shell', 'guard', 'elbow block', 'forearm', 'uke', 'frame'], ['guard recovery']),
  D('parry', 'family', '패링·캐치', 'Parries & Catches', ['패링', '쳐내', '흘려'], ['parry', 'catch', 'nagashi']),
  D('slip_roll', 'family', '슬립·롤링·더킹', 'Slips, Rolls & Ducks', ['슬립', '위빙', '롤링', '더킹', '덕킹'], ['slip', 'roll', 'bob', 'weave', 'duck', 'shoulder roll'], GRAPPLING_ROLL_MASK),
  D('evasion', 'family', '거리 회피', 'Evasion by Distance', ['회피', '빠지', '스텝 백', '물러'], ['pull', 'lean back', 'step back', 'step out', 'step away', 'angle out', 'evade', 'side step', 'circle out', 'tai sabaki']),
  D('kick_defense', 'family', '킥 방어 (체크·캐치)', 'Kick Defense', ['체크', '캐치', '정강이 블록'], ['check', 'kick catch', 'teep catch', 'shin block', 'catch and', 'teep stop']),
  D('stance', 'family', '스탠스·자세', 'Stances', ['서기', '자세', '스탠스'], ['stance', 'dachi', 'orthodox', 'southpaw', 'guard', 'peek-a-boo', 'philly']),
  D('footwork', 'family', '풋워크·이동', 'Footwork', ['스텝', '이동', '풋워크', '피벗', '전진', '후진'], ['step', 'pivot', 'shuffle', 'footwork', 'circle', 'cut off', 'cut-off', 'ashi', 'in-and-out', 'angle']),
  // ── takedown families (MMA / wrestling) ──
  D('single_leg', 'family', '싱글 레그', 'Single Legs', ['싱글 레그', '싱글렉', '싱글 렉'], ['single leg', 'single-leg', 'high crotch', 'low single', 'high single', 'snatch single', 'sweep single', 'outside single', 'inside single', 'ankle pick', 'knee tap', 'running the pipe']),
  D('double_leg', 'family', '더블 레그', 'Double Legs', ['더블 레그', '더블레그'], ['double leg', 'double-leg', 'blast double', 'high double', 'low double', 'snatch double', 'morote gari']),
  D('body_lock_td', 'family', '바디락', 'Body Locks', ['바디락', '바디 락', '베어 허그'], ['body lock', 'bear hug', 'bear-hug', 'waist lock', 'double underhooks', 'over-under']),
  D('trip', 'family', '트립·발 걸기', 'Trips & Foot Sweeps', ['트립', '발걸기', '다리 걸기', '발쓸기', '후리기', 'подсечка', 'зацеп', 'подсад', 'отхват'], ['trip', 'foot sweep', 'ashi barai', 'ouchi gari', 'kouchi gari', 'osoto gari', 'kosoto gari', 'kosoto gake', 'sasae', 'okuri ashi', 'de ashi', 'tani otoshi', 'hiza guruma']),
  // ── positions (MMA ground control / clinch) ──
  D('mount_pos', 'position', '마운트', 'Mount', ['마운트', '올라탄', 'верхом'], ['mount']),
  D('side_pos', 'position', '사이드 컨트롤', 'Side Control', ['사이드', '곁누르기', '케사', 'сбоку', 'поперек'], ['side control', 'kesa', 'yoko shiho', 'north-south', 'kami shiho', 'knee on belly']),
  D('back_pos', 'position', '백 컨트롤', 'Back Control', ['백 컨트롤', '백 마운트', '등 뒤', 'спиной'], ['back control', 'back mount', 'back take', 'seatbelt', 'hooks', 'rear']),
  D('turtle_pos', 'position', '터틀', 'Turtle', ['터틀', '거북'], ['turtle']),
  D('guard_pos', 'position', '가드 (하위)', 'Guard (Bottom)', ['가드에서', '하위 포지션', '바텀', '깔린'], ['guard', 'bottom', 'half guard', 'butterfly']),
  D('standup_pos', 'position', '일어서기·스탠드업', 'Getting Up', ['일어서', '스탠드업', '스탠딩 복귀'], ['stand-up', 'stand up', 'wrestle-up', 'technical stand', 'get up']),
  D('cage_pos', 'position', '케이지', 'Against the Cage', ['케이지', '펜스', '철창'], ['cage', 'fence']),
];

export const DIMENSION_BY_ID = new Map(DIMENSIONS.map((d) => [d.id, d]));
