import { dataKoreanNames, hangulSkeleton } from '../coachKnowledge/koreanNames';
import type { Technique } from '../../types';

// 기술명 표기 — the small local model writes technique names inconsistently (measured 2026-11-07: "Jab" in English
// mid-sentence, "쨉", once "잉크" for 잽). The official Korean names come ONLY from MARTIALDEX's own data
// (coachKnowledge/koreanNames.ts dataKoreanNames / koreanName); never guessed. Three things are done:
//   glossaryBlock  : the official names of the techniques in play go into the prompt ("기술명은 아래 표기만")
//   fixTerminology : an English technique name in the answer gets its official Korean name the first time
//                    ("Jab" → "잽(Jab)", later "잽"); a Hangul word that is a sound-alike misspelling of an official
//                    name (same consonant skeleton, different spelling: 쨉 → 잽, 키무라 → 기무라) is normalized
//   a word no rule can map (e.g. "잉크") is NOT rewritten — guessing would be worse; the limit is reported.

export function officialKoreanName(t: Technique): string | null {
  return t.koreanName?.trim() || dataKoreanNames(t)[0] || null;
}

/** "[기술명 표기]" lines for the prompt ('' when no technique has a Korean name in the data). */
export function glossaryBlock(techniques: Technique[]): string {
  const rows = [...new Map(techniques.map((t) => [t.id, t])).values()]
    .map((t) => ({ t, ko: officialKoreanName(t) }))
    .filter((x) => x.ko)
    .slice(0, 12);
  if (!rows.length) return '';
  return `[기술명 표기 — 기술 이름은 아래 MARTIALDEX 표기만 쓴다. 영어 이름만 쓰거나 다른 철자로 쓰지 않는다]\n${rows.map((x) => `- ${x.ko} (${x.t.name})`).join('\n')}`;
}

const PARTICLE = /(이|가|을|를|은|는|도|의|에|에서|으로|로|와|과|만)$/;
// one-syllable words too common to be read as a misspelt technique name
const COMMON_SYLLABLE = new Set(['잘', '잠', '잔', '잡', '재', '장', '정', '좀', '참', '한', '할', '함', '합', '항', '해', '후', '훈', '훨', '흔', '힘', '킥', '팔', '발', '몸', '앞', '뒤', '안', '밖', '손', '다', '더', '덜', '또', '꼭', '각', '간', '갈', '감', '같', '거', '것', '곧', '공', '그', '글', '기', '길', '나', '날', '남', '내', '너', '네', '늘', '대', '때', '딱', '마', '막', '만', '말', '매', '먼', '면', '모', '못', '무', '물', '뭐', '바', '반', '방', '번', '법', '별', '보', '본', '분', '빨', '뼈', '사', '살', '상', '새', '생', '서', '선', '세', '셋', '수', '쉽', '스', '시', '실', '심', '아', '알', '약', '양', '어', '언', '얼', '없', '여', '연', '열', '영', '오', '온', '왜', '외', '요', '우', '운', '원', '위', '은', '을', '의', '이', '인', '일', '임', '있', '자', '작', '저', '전', '절', '점', '제', '조', '주', '중', '즉', '지', '진', '짧', '쪽', '차', '처', '첫', '초', '총', '최', '추', '충', '치', '칠', '큰', '탓', '통', '틈', '판', '편', '폼', '표', '품', '하', '학', '핵', '향', '허', '혹', '화', '확', '환', '활', '회']);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Consonant classes with tense / aspirated variants unified (koreanNames.ts: ㅉ·ㅊ ~ ㅈ, ㄲ·ㅋ ~ ㄱ …). */
function looseSkeleton(s: string): string {
  return hangulSkeleton(s, true);
}

export function fixTerminology(answer: string, techniques: Technique[]): { text: string; notes: string[] } {
  let text = answer;
  const notes: string[] = [];
  const named = [...new Map(techniques.map((t) => [t.id, t])).values()].map((t) => ({ t, ko: officialKoreanName(t) })).filter((x): x is { t: Technique; ko: string } => !!x.ko);
  for (const { t, ko } of named) {
    // English name → "한국어(English)" once, then the Korean name (only for a Latin-script name different from the Korean one)
    const latinName = /[A-Za-z]/.test(t.name) && t.name !== ko;
    const en = new RegExp(`(?<![A-Za-z(])${escape(t.name)}(?![A-Za-z)])`, 'g');
    let first = !text.includes(ko);
    let replaced = 0;
    if (latinName) text = text.replace(en, () => {
      replaced++;
      if (first) {
        first = false;
        return `${ko}(${t.name})`;
      }
      return ko;
    });
    if (replaced) notes.push(`영어 기술명 "${t.name}"을 MARTIALDEX 표기 "${ko}"로 바꿨습니다.`);
    // sound-alike misspelling of the official Korean name
    const target = looseSkeleton(ko);
    const fixed = new Set<string>();
    text = text.replace(/[가-힣]{1,8}/g, (word) => {
      const stem = word.replace(PARTICLE, '');
      const tail = word.slice(stem.length);
      if (stem === ko || stem.length !== ko.length || stem.length < 1) return word;
      if (looseSkeleton(stem) !== target) return word;
      // same consonant skeleton AND the same vowels — only consonant tenseness differs (쨉 ~ 잽, 키무라 ~ 기무라)
      const vowel = (ch: string) => Math.floor(((ch.charCodeAt(0) - 0xac00) % 588) / 28);
      const vowelsSame = [...stem].every((ch, i) => vowel(ch) === vowel(ko[i]));
      if (!vowelsSame) return word;
      fixed.add(stem);
      return ko + tail;
    });
    if (fixed.size) notes.push(`기술명 철자 ${[...fixed].map((f) => `"${f}"`).join(', ')}을(를) MARTIALDEX 표기 "${ko}"로 바로잡았습니다.`);
    // near miss (measured live: "잭" · "잣" for 잽): same initial consonants and vowels, only a final consonant differs,
    // for names of 1–3 syllables that are IN PLAY (named in the question / data). Corrected and said so.
    if (ko.length <= 3) {
      const parts = (ch: string) => {
        const c = ch.charCodeAt(0) - 0xac00;
        return { ini: Math.floor(c / 588), vow: Math.floor((c % 588) / 28), fin: c % 28 };
      };
      const near = new Set<string>();
      text = text.replace(/[가-힣]{1,8}/g, (word) => {
        if (word.startsWith(ko)) return word;
        const stem = word.slice(0, ko.length);
        if (stem.length !== ko.length) return word;
        const rest = word.slice(ko.length);
        const diffs = [...stem].map((ch, i) => ({ a: parts(ch), b: parts(ko[i]) }));
        const onlyFinal = diffs.every(({ a, b }) => a.ini === b.ini && a.vow === b.vow) && diffs.filter(({ a, b }) => a.fin !== b.fin).length === 1;
        // the rest must be a particle or a compound continuation written right after the name ("잭카운터" → 잽카운터)
        if (!onlyFinal || (rest && !PARTICLE.test(rest) && !/^(카운터|연습|거리|공격|타이밍)/.test(rest))) return word;
        // one-syllable names: only with something attached ("잭을", "잭카운터") and never a common word ("잘 하세요")
        if (ko.length === 1 && (!rest || COMMON_SYLLABLE.has(stem))) return word;
        near.add(stem);
        return ko + rest;
      });
      if (near.size) notes.push(`기술명 오기 ${[...near].map((f) => `"${f}"`).join(', ')}을(를) MARTIALDEX 표기 "${ko}"로 바로잡았습니다 (받침만 다른 오기).`);
    }
  }
  return { text, notes };
}
