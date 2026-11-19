import type { Technique } from '../../types';
import { POSITIONS, fieldOf, formatValue, valueOf } from './catalog';
import { getProfile, liveItem } from './store';
import type { FighterProfile } from './types';

// Lesson notes from the profile by fixed rules — the MARTIALDEX 자체 코치
// (no language model) personalizes with these, and both coaches show them at
// the start of a lesson. Every note quotes the answer it came from; nothing
// is inferred about skill.

export interface LessonNote {
  text: string;
  /** Profile items the note is based on. */
  basis: string[];
}

const KICK = /(킥|kick|차기|티프|teep)/i;
const PUNCH = /(펀치|punch|잽|jab|스트레이트|straight|cross|크로스|훅|hook|어퍼|uppercut|오버핸드|overhand)/i;
const SINGLE = /(싱글|single)/i;
const DOUBLE = /(더블|double)/i;

const PUNCH_OF: [RegExp, string][] = [
  [/잽|jab/i, 'jab'],
  [/스트레이트|straight|크로스|cross/i, 'straight'],
  [/어퍼|uppercut/i, 'uppercut'],
  [/오버핸드|overhand/i, 'overhand'],
];
const KICK_OF: [RegExp, string][] = [
  [/티프|teep|프론트|front kick|앞차기|밀어차기/i, 'teep'],
  [/사이드|side kick|옆차기/i, 'side'],
  [/로우?킥|low kick|카프/i, 'low'],
  [/미들|middle|바디킥|body kick/i, 'middle'],
  [/하이킥|high kick|헤드킥/i, 'high'],
];
const POSITION_OF: [RegExp, string[]][] = [
  [/마운트|mount/i, ['mountTop', 'mountBottom']],
  [/하프|half/i, ['halfTop', 'halfBottom']],
  [/클로즈드|closed guard/i, ['closedTop', 'closedBottom']],
  [/사이드 ?컨트롤|side control/i, ['sideTop', 'sideBottom']],
  [/백 ?컨트롤|back control|백 테이크|back take|리어 네이키드|rear naked/i, ['backTop', 'backBottom']],
  [/터틀|turtle/i, ['turtleTop', 'turtleBottom']],
  [/클린치|clinch/i, ['clinch']],
];
const posLabel = (id: string) => POSITIONS.find((x) => x.value === id)?.label ?? id;
const list = (p: FighterProfile, k: string) => {
  const v = valueOf(p, k);
  return Array.isArray(v) ? v : [];
};

export function lessonProfileNotes(input: { martialArt?: string | null; technique?: Technique | null; topic?: string | null; profile?: FighterProfile }): LessonNote[] {
  const p = input.profile ?? getProfile();
  const t = input.technique ?? null;
  const subject = [t?.name, t?.koreanName, t?.category, ...(t?.positions ?? []), input.topic].filter(Boolean).join(' ');
  const art = input.martialArt ?? t?.martialArt ?? null;
  const striking = !!art && ['boxing', 'kickboxing', 'muay-thai', 'taekwondo', 'karate', 'mixed-martial-arts'].includes(art);
  const out: LessonNote[] = [];
  const stance = valueOf(p, 'body.stance');
  const switching = valueOf(p, 'body.stanceSwitch');

  if (striking || /레슬링|wrestling/.test(art ?? '')) {
    if (stance === 'southpaw') out.push({ text: '사우스포라고 하셨으니, 설명의 "앞손·앞발"은 오른쪽, "뒷손·뒷발"은 왼쪽입니다.', basis: ['body.stance'] });
    if (stance === 'switch' || switching === 'often') out.push({ text: '스탠스를 자주 바꾼다고 하셨어요 — 이 기술을 양쪽 스탠스에서 한 번씩 연습하고, 바꾼 직후의 거리를 확인해 보세요.', basis: ['body.stance', 'body.stanceSwitch'] });
  }

  if (striking && PUNCH.test(subject) && !KICK.test(subject)) {
    const fav = list(p, 'box.favoritePunches');
    const hit = PUNCH_OF.find(([re, id]) => re.test(subject) && fav.includes(id));
    if (hit) out.push({ text: `${formatValue(fieldOf('box.favoritePunches'), [hit[1]])}은(는) 자주 쓴다고 하셨으니, 기본 동작은 짧게 확인하고 타이밍·연결 같은 응용에 시간을 더 쓰세요.`, basis: ['box.favoritePunches'] });
    if (/훅|hook/i.test(subject) && fav.length && !fav.some((x) => x === 'leadHook' || x === 'rearHook')) out.push({ text: '자주 쓰는 펀치에 훅은 없다고 하셨어요 — 오늘은 천천히 기본 궤도부터 잡아 보세요.', basis: ['box.favoritePunches'] });
  }

  if (striking && KICK.test(subject)) {
    const fav = list(p, 'kick.favorite');
    if (fav.some((x) => ['leadRound', 'teep', 'side'].includes(x)) || valueOf(p, 'kick.switchKick') === 'often') out.push({ text: '앞발 킥을 자주 쓴다고 하셨어요 — 이 기술도 앞발 킥 이후로 이어지는 연결을 함께 연습해 보세요. 다만 한쪽 발에만 의존하지 않도록 반대 발도 섞어 주세요.', basis: ['kick.favorite', 'kick.switchKick'] });
    const kick = KICK_OF.find(([re]) => re.test(subject));
    if (kick && fav.includes(kick[1])) out.push({ text: `${formatValue(fieldOf('kick.favorite'), [kick[1]])}은(는) 주로 쓰는 킥이라고 하셨으니 기본 반복보다 셋업과 연결에 집중하세요.`, basis: ['kick.favorite'] });
    if (valueOf(p, 'kick.recovery') === 'unbalanced') out.push({ text: '킥 후 균형이 자주 무너진다고 하셨어요 — 차고 나서 원래 스탠스로 돌아오는 것까지를 한 동작으로 연습하세요.', basis: ['kick.recovery'] });
  }

  if (SINGLE.test(subject) || DOUBLE.test(subject)) {
    const dir = valueOf(p, 'wr.direction');
    if (SINGLE.test(subject) && (dir === 'oppRight' || dir === 'oppLeft')) {
      out.push({ text: `싱글렉은 주로 ${dir === 'oppRight' ? '상대 오른다리' : '상대 왼다리'}를 잡는다고 하셨어요 — 익숙한 쪽으로 감을 잡은 뒤, 반대쪽 다리도 한 세트 연습해 한쪽에만 의존하지 않게 하세요.`, basis: ['wr.direction'] });
    }
    const finish = valueOf(p, 'wr.finish');
    if (finish) out.push({ text: `선호하는 마무리가 "${formatValue(fieldOf('wr.finish'), finish)}"라고 하셨으니, 그 마무리로 이어지는 그립을 확인해 보세요.`, basis: ['wr.finish'] });
  }

  const pos = POSITION_OF.find(([re]) => re.test(subject));
  if (pos) {
    const comfy = list(p, 'pos.comfortable').filter((x) => pos[1].includes(x));
    const hard = list(p, 'pos.uncomfortable').filter((x) => pos[1].includes(x));
    for (const id of hard) {
      const exit = valueOf(p, `pos.${id}.exit`);
      out.push({
        text: `${posLabel(id)}이(가) 불편하다고 하셨어요 — 오늘은 천천히 기본 프레임부터 잡고${exit ? `, 평소 선호한다는 "${formatValue(fieldOf(`pos.${id}.exit`), exit)}" 방향으로 이어 보세요` : ''}.`,
        basis: ['pos.uncomfortable', ...(exit ? [`pos.${id}.exit`] : [])],
      });
    }
    for (const id of comfy) out.push({ text: `${posLabel(id)}은(는) 편하다고 하셨으니, 기본보다 다음 단계(연결·변형)를 시도해 보세요.`, basis: ['pos.comfortable'] });
  }

  const improve = liveItem(p, 'train.improve');
  if (improve?.state === 'answered' && typeof improve.value === 'string' && t) {
    const words = [t.name, t.koreanName].filter(Boolean).map((x) => x!.toLowerCase());
    if (words.some((w) => w.length >= 2 && (improve.value as string).toLowerCase().includes(w))) out.push({ text: `"${improve.value}"을(를) 고치고 싶다고 하셨는데, 오늘 기술과 직접 관련이 있어요.`, basis: ['train.improve'] });
  }
  return out.slice(0, 4);
}
