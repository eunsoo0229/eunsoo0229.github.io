// 포지션 중심 카테고리 (BJJ · MMA) — Level 1 = the POSITION / situation a technique is used in, Level 2 = what it is
// FOR there. Built at run time from each technique's own data (technique.category, technique.positions — the
// encyclopedia sections the record appears in —, the curated hierarchy's sub-headings and the technique's own name)
// plus the existing purpose classifier (techniqueTaxonomy tags). Nothing in the technique data changes: ids, names,
// categories, the existing category list and the existing hierarchical taxonomy all stay as they are.
// A technique may sit in several positions. With no position evidence it goes to the 미분류 검토 area; with a
// position but no purpose evidence, to that position's "목적 확인 필요" bucket — never guessed, never hidden.

export interface PositionDef {
  id: string;
  ko: string;
  en: string;
  /** Section strings (category / positions / hierarchy sub-headings) that mean this position. */
  sources: RegExp;
  /** The technique's own name / aliases naming the position ("Mount Escape", "하프 가드 스윕"). */
  names?: RegExp;
  /** Purpose display order (only purposes that end up with techniques are shown). */
  purposes: string[];
}

export interface PurposeDef {
  id: string;
  ko: string;
  en: string;
  /** classifier dimensions (techniqueTaxonomy/dimensions.ts) that mean this purpose (HIGH/MEDIUM evidence) */
  dims: string[];
}

export interface PositionTaxonomyConfig {
  positions: PositionDef[];
  purposes: PurposeDef[];
  /** category / section string → purpose, when the classifier has no evidence ("암바 계열" → submission) */
  categoryPurpose: [RegExp, string][];
  /** purpose ids re-labelled per position kind (in standing, "submission" is a standing submission) */
  purposeIn?: (position: string, purpose: string) => string;
}

const P = (id: string, ko: string, en: string, sources: RegExp, purposes: string[], names?: RegExp): PositionDef => ({ id, ko, en, sources, purposes, names });
const U = (id: string, ko: string, en: string, dims: string[]): PurposeDef => ({ id, ko, en, dims });

// ------------------------------------------------------------------------------------------------ BJJ
const GUARD = ['submission', 'control', 'sweep', 'transition', 'retention', 'pass_defense', 'pass', 'escape'];
const TOP = ['submission', 'control', 'transition', 'escape', 'guard_recovery'];

const BJJ: PositionTaxonomyConfig = {
  positions: [
    P('standing', '스탠딩', 'Standing', /스탠딩|테이크다운|Takedown|그립|Grip|Kumi|잡기|던지기|투사|발기술|Ashi Waza|손기술|Te Waza|허리기술|Koshi Waza|Sutemi|싱글 레그|더블 레그|발목·무릎 공격|공격 진입|바디락|클린치|리샷|암 드래그|Arm Drag|테이크다운 진입|탑 포지션 \(레슬링\)/, ['takedown', 'clinch_control', 'standing_submission', 'standing_transition', 'td_defense'], /takedown|single leg(?! x)|double leg|snap ?down|duck ?under|ankle pick|테이크다운|싱글 ?레그(?! ?x)|더블 ?레그/i),
    P('closed-guard', '클로즈드 가드', 'Closed Guard', /클로즈드 가드|Closed Guard/, GUARD, /closed guard|loop choke|클로즈드 ?가드|루프 ?초크/i),
    P('open-guard', '오픈 가드', 'Open Guard', /오픈 가드|Open Guard/, GUARD, /open guard|worm guard|lapel guard|collar drag|sleeve drag|collar ?(&|and) ?sleeve|오픈 ?가드|웜 ?가드|칼라 ?드래그|슬리브 ?드래그|칼라[ ·-]?슬리브/i),
    P('half-guard', '하프 가드', 'Half Guard', /(?<!딥 )하프 가드|(?<!Deep )Half Guard/, [...GUARD, 'guard_recovery'], /(?<!deep )half guard|(?<!딥 )하프 ?가드/i),
    P('deep-half', '딥 하프 가드', 'Deep Half Guard', /딥 하프|Deep Half/, GUARD, /deep half|딥 ?하프/i),
    P('butterfly', '버터플라이 가드', 'Butterfly Guard', /버터플라이|Butterfly/, GUARD, /butterfly|버터플라이/i),
    P('de-la-riva', '데 라 히바 가드', 'De La Riva Guard', /데 라 히바|De La Riva/, GUARD, /de la riva|dlr|데 ?라 ?히바/i),
    P('spider', '스파이더 가드', 'Spider Guard', /스파이더|Spider/, GUARD, /spider|스파이더/i),
    P('lasso', '라쏘 가드', 'Lasso Guard', /라쏘|Lasso/, GUARD, /lasso|라쏘/i),
    P('x-guard', 'X 가드', 'X-Guard', /(?<!싱글 레그 )X 가드|(?<!-)X-Guard/, ['control', 'sweep', 'transition', 'submission'], /(?<!single leg )x[- ]guard|(?<!싱글 레그 )x ?가드/i),
    P('slx', '싱글 레그 X', 'Single Leg X', /싱글 레그 X|SLX|Single Leg X/, ['control', 'sweep', 'transition', 'submission'], /single leg x|slx|싱글 ?레그 ?x/i),
    P('fifty-fifty', '50/50 가드', '50/50 Guard', /50\/50/, ['submission', 'control', 'sweep', 'escape'], /50\/50|fifty/i),
    P('ashi-garami', '아시 가라미 · 레그 엔탱글먼트', 'Ashi Garami & Leg Entanglements', /아시 가라미|Ashi Garami|레그락 계열|하체 관절기/, ['submission', 'control', 'transition', 'escape'], /ashi|saddle|honey ?hole|inside sankaku|outside ashi|leg entanglement|leg ?locks?\b|아시 ?가라미/i),
    P('mount', '마운트', 'Mount', /마운트|Mount/, TOP, /mount|tate shiho|верхом|마운트/i),
    P('side-control', '사이드 컨트롤', 'Side Control', /사이드 컨트롤|Side Control|굳히기|Osaekomi/, TOP, /side control|kesa|scarf hold|yoko shiho|kata gatame|сбоку|поперек|사이드 ?컨트롤|케사/i),
    P('back-control', '백 컨트롤', 'Back Control', /백 컨트롤|Back Control|백 테이크|Back Take/, ['submission', 'control', 'transition', 'escape'], /back control|back take|rear naked|seat ?belt|body triangle|백 ?컨트롤|백 ?테이크|리어 ?네이키드/i),
    P('knee-on-belly', '니 온 벨리', 'Knee on Belly', /니 온 벨리|Knee on Belly/, TOP, /knee on belly|니 ?온 ?벨리/i),
    P('north-south', '노스 사우스', 'North-South', /노스 사우스|North-South|North South/, TOP, /north[- ]south|kami shiho|со стороны головы|노스 ?사우스/i),
    P('turtle', '터틀', 'Turtle', /터틀|Turtle/, ['submission', 'control', 'transition', 'escape', 'guard_recovery'], /turtle|터틀/i),
    P('front-headlock', '프론트 헤드락', 'Front Headlock', /프론트 헤드락|Front Headlock/, ['submission', 'control', 'transition', 'escape'], /front headlock|loop choke|프론트 ?헤드락|루프 ?초크/i),
    P('crucifix', '크루시픽스', 'Crucifix', /크루시픽스|Crucifix/, ['control', 'submission', 'escape'], /crucifix|크루시픽스/i),
    P('basics', '기본 움직임 · 연결', 'Fundamental Movements', /기본 움직임과 연결|기본 자세와 움직임/, ['movement', 'escape', 'transition', 'retention']),
    // existing BJJ categories with no single position of their own — kept as their own entries (not dissolved)
    P('guard-passing', '가드 패스 (탑 · 상대 가드 공통)', 'Guard Passing (vs any guard)', /패스 가드|가드 패스 기술 모음|Guard Passing/, ['pass', 'control', 'transition', 'submission']),
    P('submission-chains', '서브미션 연계 (포지션 공통)', 'Submission Chains (any position)', /암바 계열|트라이앵글 계열|김우라 계열/, ['submission', 'sweep', 'control', 'transition']),
  ],
  purposes: [
    U('takedown', '테이크다운', 'Takedowns', ['takedown', 'throw', 'single_leg', 'double_leg', 'body_lock_td', 'trip']),
    U('clinch_control', '클린치 컨트롤 · 그립', 'Clinch Control & Grips', ['grip']),
    U('standing_submission', '스탠딩 서브미션', 'Standing Submissions', []),
    U('standing_transition', '스탠딩 전환', 'Standing Transitions', []),
    U('td_defense', '테이크다운 방어', 'Takedown Defense', ['td_defense']),
    U('submission', '서브미션', 'Submissions', ['submission', 'choke', 'armbar', 'shoulder_lock', 'leglock']),
    U('control', '컨트롤', 'Control', ['control', 'grip', 'pin', 'ride']),
    U('sweep', '스윕', 'Sweeps', ['sweep', 'reversal']),
    U('transition', '전환 · 백 테이크', 'Transitions & Back Takes', ['transition', 'back_take', 'entry']),
    U('retention', '가드 유지', 'Guard Retention', ['retention']),
    U('pass_defense', '패스 대응', 'Pass Defense', ['defense', 'counter']),
    U('pass', '가드 패스 (상위)', 'Guard Passing (top)', ['pass', 'guard_break']),
    U('escape', '탈출 · 회복', 'Escapes & Recovery', ['escape']),
    U('guard_recovery', '가드 회복', 'Guard Recovery', []),
    U('movement', '기본 움직임', 'Movements', []),
  ],
  categoryPurpose: [
    [/암바 계열|트라이앵글 계열|김우라 계열|레그락 계열|상체 서브미션|조르기|Shime|관절기|Kansetsu/, 'submission'],
    [/탈출 기술 모음|탈출 \(Escape\)|^탈출$/, 'escape'],
    [/스윕 기술 모음/, 'sweep'],
    [/패스 가드|가드 패스 기술 모음/, 'pass'],
    [/백 테이크 기술 모음/, 'transition'],
    [/스탠딩 \/ 테이크다운|던지기|발기술|손기술|허리기술|싱글 레그|더블 레그|테이크다운 진입/, 'takedown'],
    [/스탠딩 포지션 \/ 그립|잡기 \/ 그립|그립 파이팅/, 'clinch_control'],
    [/암 드래그/, 'standing_transition'],
    [/기본 움직임과 연결|기본 자세와 움직임/, 'movement'],
    [/굳히기|Osaekomi/, 'control'],
  ],
  // the same classifier purpose means different things in different positions
  purposeIn: (position, purpose) => {
    if (position === 'standing') {
      const m: Record<string, string> = { submission: 'standing_submission', transition: 'standing_transition', control: 'clinch_control', sweep: 'takedown', pass_defense: 'td_defense', retention: 'td_defense', escape: 'td_defense', guard_recovery: 'td_defense', pass: 'standing_transition' };
      return m[purpose] ?? purpose;
    }
    const top = ['mount', 'side-control', 'back-control', 'knee-on-belly', 'north-south', 'crucifix', 'front-headlock', 'turtle', 'guard-passing'].includes(position);
    const m: Record<string, string> = { standing_submission: 'submission', standing_transition: 'transition', clinch_control: 'control', takedown: 'transition', td_defense: 'transition' };
    if (top) Object.assign(m, { retention: 'escape', pass_defense: 'escape', sweep: 'escape' });
    if (position === 'turtle') Object.assign(m, { retention: 'guard_recovery', pass_defense: 'escape' });
    if (position === 'basics') Object.assign(m, { pass_defense: 'retention' });
    return m[purpose] ?? purpose;
  },
};

// ------------------------------------------------------------------------------------------------ MMA
const STRIKE_DIMS = ['jab', 'straight', 'hook', 'uppercut', 'body_punch', 'special_punch', 'combination', 'feint', 'knee', 'elbow', 'teep', 'round_kick', 'low_kick', 'side_back_kick', 'axe_kick', 'spinning', 'jumping'];
const MMA_GROUND = ['gnp', 'submission', 'control', 'pass', 'sweep', 'transition', 'escape', 'submission_defense'];

const MMA: PositionTaxonomyConfig = {
  positions: [
    P('standing', '스탠딩', 'Standing', /스트라이킹|Striking|MMA 복싱|MMA 킥복싱|펀치|킥|Kick|풋워크|스탠스|거리|카운터|콤비네이션|조합|페인트|Feint|발차기|Geri|겨루기|스피닝|상대 펀치별|장거리|중거리|티프|Teep|로우킥|Low Kick|하이킥|공격 진입|싱글 레그|더블 레그|테이크다운|Takedown|스탠딩|방어 \(Defense\)|^방어$|막기|피하기|패링|블로킹/, ['strike', 'distance', 'strike_defense', 'takedown', 'td_defense', 'clinch_entry'], /takedown|single leg|double leg|jab|cross|hook|uppercut|kick|teep|feint|footwork|sprawl|테이크다운|싱글 ?레그|더블 ?레그|잽|훅|어퍼컷|킥|스프롤/i),
    P('clinch', '클린치', 'Clinch', /클린치|Clinch|근거리|인파이팅|니 \(|Khao|바디락|타이|Kumi|그립/, ['strike', 'control', 'takedown', 'cage', 'clinch_escape'], /clinch|collar tie|thai plum|underhook|overhook|body ?lock|whizzer|클린치|언더훅|오버훅|바디 ?락/i),
    P('cage', '케이지 · 펜스', 'Cage & Fence', /케이지|Cage|코너|로프|펜스/, ['control', 'takedown', 'strike', 'clinch_escape', 'scramble'], /cage|fence|wall|케이지|펜스/i),
    P('takedown-transition', '테이크다운 전환', 'Takedown Transitions', /전환 동작|Transitions|파르테르|리샷|Re-?shot|스탠딩 → /, ['takedown', 'td_defense', 'transition', 'scramble'], /finish|re-?shot|mat return|chain|single to|double to|to back|go-?behind|피니시|리샷/i),
    P('guard', '가드', 'Guard', /(?<!하프 |딥 하프 )가드 \(|클로즈드 가드|오픈 가드|버터플라이|스파이더|라쏘|데 라 히바|X 가드|싱글 레그 X|50\/50|패스 가드|가드 패스|스윕 기술/, MMA_GROUND, /closed guard|open guard|full guard|butterfly guard|guard pass|guard retention|guard recovery|butterfly recovery|클로즈드 ?가드|오픈 ?가드|가드 ?패스|가드 ?회복/i),
    P('half-guard', '하프 가드', 'Half Guard', /하프 가드|Half Guard|딥 하프/, MMA_GROUND, /half guard|하프 ?가드/i),
    P('side-control', '사이드 컨트롤', 'Side Control', /사이드 컨트롤|Side Control|굳히기|Osaekomi/, MMA_GROUND, /side control|kesa|yoko shiho|kata gatame|сбоку|поперек|사이드 ?컨트롤|케사/i),
    P('knee-on-belly', '니 온 벨리', 'Knee on Belly', /니 온 벨리|Knee on Belly/, MMA_GROUND, /knee on belly|니 ?온 ?벨리/i),
    P('north-south', '노스 사우스', 'North-South', /노스 사우스|North-South/, MMA_GROUND, /north[- ]south|kami shiho|со стороны головы|노스 ?사우스/i),
    P('mount', '마운트', 'Mount', /마운트|Mount/, MMA_GROUND, /mount|tate shiho|верхом|마운트/i),
    P('back-control', '백 컨트롤', 'Back Control', /백 컨트롤|Back Control|백 테이크/, MMA_GROUND, /back control|back take|rear naked|백 ?컨트롤|백 ?테이크|리어 ?네이키드/i),
    P('turtle', '터틀', 'Turtle', /터틀|Turtle/, MMA_GROUND, /turtle|knee-elbow|shoulder-to-mat|turn-in|터틀/i),
    P('front-headlock', '프론트 헤드락', 'Front Headlock', /프론트 헤드락|Front Headlock/, ['submission', 'control', 'transition', 'escape', 'gnp'], /front headlock|guillotine|프론트 ?헤드락|길로틴/i),
    P('leg-entanglement', '레그 엔탱글먼트', 'Leg Entanglements', /아시 가라미|Ashi Garami|레그락 계열|하체 관절기/, ['submission', 'escape', 'transition'], /ashi|heel hook|leg ?lock|leg entanglement|힐 ?훅|레그 ?락/i),
    P('scramble', '스크램블 · 일어서기', 'Scramble & Stand-Up', /스크램블|Scramble/, ['scramble', 'transition', 'escape'], /scramble|stand-?up|wall ?walk|hip heist|sit-?out|granby|스크램블|일어서|일어나기|스탠딩 복귀/i),
    // existing MMA ground categories whose records name no specific position — kept together, clearly labelled
    P('ground-other', '그라운드 (세부 포지션 미지정)', 'Ground (position not specified)', /그라운드 컨트롤|Ground Control|그라운드 앤 파운드|Ground & Pound|서브미션 \(Submission\)|네와자|바닥 포지션/, MMA_GROUND),
  ],
  purposes: [
    U('strike', '타격', 'Strikes', STRIKE_DIMS),
    U('distance', '거리 조절', 'Distance & Footwork', ['footwork', 'stance', 'evasion']),
    U('strike_defense', '타격 방어', 'Strike Defense', ['block', 'parry', 'slip_roll', 'kick_defense', 'defense', 'counter']),
    U('takedown', '테이크다운', 'Takedowns', ['takedown', 'throw', 'single_leg', 'double_leg', 'body_lock_td', 'trip', 'finish']),
    U('td_defense', '테이크다운 방어', 'Takedown Defense', ['td_defense']),
    U('clinch_entry', '클린치 진입', 'Clinch Entries', ['entry', 'setup']),
    U('control', '컨트롤', 'Control', ['control', 'grip', 'pin', 'ride']),
    U('cage', '케이지 압박', 'Cage Pressure', []),
    U('clinch_escape', '클린치 탈출', 'Clinch Escapes', []),
    U('gnp', '그라운드 타격', 'Ground Strikes', []),
    U('submission', '서브미션', 'Submissions', ['submission', 'choke', 'armbar', 'shoulder_lock', 'leglock']),
    U('submission_defense', '서브미션 방어', 'Submission Defense', []),
    U('pass', '가드 패스', 'Guard Passing', ['pass', 'guard_break']),
    U('sweep', '스윕', 'Sweeps', ['sweep', 'reversal']),
    U('transition', '포지션 전환', 'Position Transitions', ['transition', 'back_take', 'turn']),
    U('escape', '탈출 · 회복', 'Escapes & Recovery', ['escape', 'retention']),
    U('scramble', '스크램블 · 일어서기', 'Scrambles & Stand-Ups', []),
  ],
  categoryPurpose: [
    [/그라운드 앤 파운드|Ground & Pound/, 'gnp'],
    [/서브미션 \(Submission\)|암바 계열|트라이앵글 계열|김우라 계열|레그락 계열|상체 서브미션|조르기|관절기/, 'submission'],
    [/스크램블|Scramble/, 'scramble'],
    [/케이지 워크|Cage Work/, 'cage'],
    [/MMA 복싱|MMA 킥복싱|스트라이킹|펀치|킥|발차기|니 \(|엘보/, 'strike'],
    [/테이크다운 \(Takedown\)|싱글 레그|더블 레그|던지기|발기술|허리기술/, 'takedown'],
    [/탈출 기술 모음|탈출 \(Escape\)/, 'escape'],
    [/패스 가드|가드 패스 기술 모음/, 'pass'],
    [/스윕 기술 모음/, 'sweep'],
    [/풋워크|스탠스|거리/, 'distance'],
    [/방어 \(Defense\)|상대 펀치별 방어|킥 캐치/, 'strike_defense'],
  ],
  // the same classifier purpose means different things in different situations
  purposeIn: (position, purpose) => {
    const ground = !['standing', 'clinch', 'cage', 'takedown-transition', 'scramble'].includes(position);
    if (ground) {
      const m: Record<string, string> = { strike: 'gnp', strike_defense: 'escape', distance: 'escape', clinch_entry: 'transition', takedown: 'transition', td_defense: 'escape', cage: 'control', clinch_escape: 'escape', scramble: 'escape' };
      return m[purpose] ?? purpose;
    }
    if (position === 'standing') {
      const m: Record<string, string> = { control: 'clinch_entry', sweep: 'takedown', escape: 'clinch_escape', gnp: 'strike', pass: 'transition', submission_defense: 'td_defense' };
      return m[purpose] ?? purpose;
    }
    if (position === 'clinch') {
      const m: Record<string, string> = { escape: 'clinch_escape', clinch_entry: 'control', sweep: 'takedown', pass: 'transition', gnp: 'strike', distance: 'clinch_escape' };
      return m[purpose] ?? purpose;
    }
    if (position === 'cage') {
      const m: Record<string, string> = { control: 'cage', escape: 'clinch_escape', gnp: 'strike' };
      return m[purpose] ?? purpose;
    }
    return purpose === 'gnp' ? 'strike' : purpose;
  },
};

export const POSITION_TAXONOMY: Record<string, PositionTaxonomyConfig> = { bjj: BJJ, 'mixed-martial-arts': MMA };
