// Pieces of the composite coach turn that read search results (all code, no model):
//   - videoReport:     YouTube results ranked by relevance, told apart as 강의 / 경기 / 불명, content never claimed
//   - externalVsDb:    techniques / entries named in the pages, checked against MARTIALDEX (candidates, never DB writes)
//   - similarFighters: fighters whose published style descriptions share the learner's profile traits
//   - rarityReport:    how unusual the learner's trait combination is — numbers only when a read page states them
// Every claim is a sentence from a page the app actually fetched, with its site; when the
// pages don't support something, the answer says so instead of filling the gap.

import type { ResearchResult } from '../selfResearch/types';
import type { KnowledgeIndex } from '../martialdexKnowledge/types';
import { classifyCandidate, type SourceText } from '../martialdexKnowledge/candidates';
import { CANDIDATE_STATUS_LABEL } from '../martialdexKnowledge/types';
import { splitSentences } from './relevance';
import type { StyleProfile, StyleTrait } from '../fighterProfile/styleTraits';
import type { ChatSource } from './types';

const site = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, '');
  } catch {
    return url;
  }
};
// extracted page text often loses the space after a period ("action.Edwards, as seen…") — sentences would run together
const sentencesOf = (text: string) => splitSentences(text.replace(/([a-z0-9)\]])\.([A-Z])/g, '$1. $2'));
const clip = (s: string, n = 170) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- videos

export type VideoKind = 'instructional' | 'fight' | 'analysis' | 'unknown';
export const VIDEO_KIND_LABEL: Record<VideoKind, string> = { instructional: '교육·강의 영상', fight: '경기·하이라이트 영상', analysis: '선수·기술 분석 영상', unknown: '종류 불명' };

const INSTRUCTIONAL = /(how to|tutorial|technique|instructional|drill|lesson|class|breakdown of the|setup|setups|entries|basics|fundamentals|step by step|tips|강좌|강의|레슨|하는 법|방법|기초|드릴|튜토리얼)/i;
const FIGHT = /(highlight|full fight|ko\b|knockout|vs\.?|fight night|ufc \d+|하이라이트|경기 영상|풀 경기)/i;
const ANALYSIS = /(breakdown|analysis|study|film study|how .+ (uses|wins|beat)|분석)/i;

export function videoKind(title: string, extra = ''): VideoKind {
  const t = `${title} ${extra}`;
  if (ANALYSIS.test(t) && !/how to/i.test(t)) return 'analysis';
  if (INSTRUCTIONAL.test(t)) return 'instructional';
  if (FIGHT.test(t)) return 'fight';
  return 'unknown';
}

/** How well a video's title / channel / summary matches the topic terms (0..1). The video itself is not watched. */
export function videoRelevance(r: ChatSource | ResearchResult, terms: string[], snippet = ''): number {
  const text = `${r.title} ${'video' in r && r.video?.channel ? r.video.channel : ''} ${snippet}`.toLowerCase();
  const hits = terms.filter((x) => x && text.includes(x.toLowerCase())).length;
  return terms.length ? hits / terms.length : 0;
}

export interface RankedVideo {
  source: ChatSource;
  kind: VideoKind;
  relevance: number;
  matched: string[];
}

export function rankVideos(videos: ChatSource[], terms: string[], snippets: Map<string, string>, prefer: VideoKind = 'instructional'): RankedVideo[] {
  const seen = new Set<string>();
  const out: RankedVideo[] = [];
  for (const v of videos) {
    const id = v.video?.platform === 'youtube' ? `yt:${v.url.match(/[?&]v=([\w-]{6,})|youtu\.be\/([\w-]{6,})/)?.slice(1).find(Boolean) ?? v.url}` : v.url;
    if (seen.has(id)) continue;
    seen.add(id);
    const sn = snippets.get(v.url) ?? '';
    const matched = terms.filter((x) => x && `${v.title} ${sn}`.toLowerCase().includes(x.toLowerCase()));
    out.push({ source: v, kind: videoKind(v.title, sn), relevance: videoRelevance(v, terms, sn), matched });
  }
  return out
    .filter((v) => v.matched.length > 0)
    .sort((a, b) => b.relevance - a.relevance || (a.kind === prefer ? -1 : 0) - (b.kind === prefer ? -1 : 0));
}

export function videoReportText(ranked: RankedVideo[], dropped: number): string {
  if (!ranked.length) return `요청한 주제와 제목·설명이 맞는 영상을 찾지 못했습니다${dropped ? ` (검색된 영상 ${dropped}개는 주제가 맞지 않아 제외)` : ''}.`;
  const lines = [`관련성 높은 순 ${ranked.length}개 — 제목·채널·설명만 보고 고른 것이며 영상 내용은 확인하지 않았습니다(확인 불가).`];
  for (const [i, v] of ranked.entries()) {
    const s = v.source;
    lines.push(`${i + 1}. ${s.title}${s.video?.channel ? ` — ${s.video.channel}` : ''}${s.video?.duration ? ` (${s.video.duration})` : ''}\n   ${VIDEO_KIND_LABEL[v.kind]} · 제목·설명에서 확인된 주제어: ${v.matched.join(', ')} · 내용 확인: 안 함`);
  }
  if (dropped) lines.push(`(주제어가 제목·설명에 없는 영상 ${dropped}개는 뺐습니다)`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- external findings vs MARTIALDEX

/** Wrestling / MMA entry and setup vocabulary an article uses (English). Matched as whole phrases. */
const TERMS = [
  'level change', 'snap down', 'collar tie', 'underhook', 'overhook', 'two-on-one', 'arm drag', 'duck under', 'body lock', 'high crotch',
  'single leg', 'double leg', 'ankle pick', 'knee tap', 'blast double', 'penetration step', 'outside step', 'sprawl', 'whizzer', 'front headlock',
  'go-behind', 'go behind', 'running the pipe', 'cage wrestling', 'wall walk', 'chain wrestling', 're-shot', 'reshot', 'fake jab', 'jab', 'overhand',
  'uppercut', 'lead hook', 'leg kick', 'calf kick', 'teep', 'head fake', 'feint', 'double jab', 'cross', 'hand fighting', 'pummel', 'inside trip', 'outside trip',
  'lift', 'dump', 'mat return', 'cut the corner', 'drive through', 'head position',
];

export interface ExternalTerm {
  name: string;
  status: string;
  inDb: boolean;
  dbName?: string;
  dbId?: string;
  sites: string[];
  quote: string;
}

export function externalVsDb(results: ResearchResult[], art: string, index: KnowledgeIndex | null, opts: { exclude?: string[] } = {}): ExternalTerm[] {
  const pages = results.filter((r) => r.content);
  if (!pages.length || !index) return [];
  const sources: SourceText[] = pages.map((r) => ({ url: r.url, title: r.title, content: r.content, snippet: r.snippet, sourceType: r.sourceType, publishedAt: r.publishedAt }));
  const found = new Map<string, { url: string; quote: string }[]>();
  for (const r of pages) {
    for (const s of sentencesOf(r.content ?? '')) {
      const low = s.toLowerCase();
      for (const term of TERMS) {
        if (!new RegExp(`\\b${esc(term)}\\b`, 'i').test(low)) continue;
        const list = found.get(term) ?? [];
        if (!list.some((e) => e.url === r.url)) list.push({ url: r.url, quote: s.slice(0, 300) });
        found.set(term, list);
      }
    }
  }
  const exclude = new Set((opts.exclude ?? []).map((x) => x.toLowerCase()));
  const out: ExternalTerm[] = [];
  for (const [term, ev] of found) {
    if (exclude.has(term)) continue;
    const c = classifyCandidate({ kind: 'technique', name: term, martialArt: art, evidence: ev.map((e) => ({ url: e.url, quote: e.quote })) }, sources, index)[0];
    if (!c) continue;
    out.push({ name: term, status: CANDIDATE_STATUS_LABEL[c.status], inDb: c.status === 'duplicate', dbName: c.duplicateOf?.name, dbId: c.duplicateOf?.id, sites: [...new Set(ev.map((e) => site(e.url)))], quote: ev[0].quote });
  }
  // the most widely mentioned first
  return out.sort((a, b) => b.sites.length - a.sites.length).slice(0, 12);
}

export function externalVsDbText(items: ExternalTerm[]): string {
  if (!items.length) return '읽은 자료에서 기술·진입 용어를 찾지 못해 MARTIALDEX와 비교하지 못했습니다.';
  const inDb = items.filter((i) => i.inDb);
  const outDb = items.filter((i) => !i.inDb);
  const lines: string[] = [];
  if (inDb.length) lines.push(`MARTIALDEX에 이미 있는 것 (자료와 연결): ${inDb.map((i) => `${i.name} → ${i.dbName}`).join(', ')}`);
  if (!outDb.length) lines.push('자료에서 찾은 기술·진입 용어는 모두 MARTIALDEX에 이미 있습니다 — 신규 등록 후보 없음 (DB는 바꾸지 않았습니다).');
  if (outDb.length) {
    lines.push('MARTIALDEX에 없는 기술·개념 — 신규 등록 후보 (DB는 바꾸지 않았습니다):');
    for (const i of outDb.slice(0, 6)) lines.push(`- ${i.name} · ${i.status} · ${i.sites.length}곳 (${i.sites.slice(0, 2).join(', ')})\n  근거: "${clip(i.quote)}"`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- similar fighters

const NOT_NAME = /^(The|This|That|These|Those|When|While|If|In|On|At|For|With|And|But|His|Her|Their|He|She|They|It|UFC|MMA|ONE|PFL|Bellator|Fight|Night|Round|Rounds|Championship|Champion|Title|Division|Weight|Light|Heavy|Middle|Welter|Feather|Bantam|Fly|Straw|Best|Top|Most|Southpaw|Orthodox|Switch|Counter|Pressure|Kick|Kicks|Boxing|Wrestling|Jiu|Jitsu|Muay|Thai|Brazilian|American|Russian|Dagestan|Dagestani|Irish|Nigerian|Georgian|Mexican|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Read|More|Related|Sign|Share|Watch|Getty|Images|Photo|Credit|Getty Images|Las|Vegas|Abu|Dhabi|New|York|Fighter|Fighters|Style|Styles|Build|Your|Own|How|What|Why|Who|Guide|Pick|Game|Plan|Gym|Free|All|Round|Every|Many|Some|One|Two|Three|Here|There|Our|My|We|You|Click|Learn|Home|About|Contact|Privacy|Policy|Terms|Cookie|Video|Videos|News|Rankings|Results|Event|Events|Card|Main|Co|Fan|Fans|Stats|Record|Mixed|Martial|Arts|Kickboxer|Wrestler|Striker|Grappler|Boxer|Japanese|Chinese|Korean|Canadian|English|British|Australian|Dutch|French|Polish|Swedish|Cameroonian|Chechen|Kazakh|Cuban|Scottish|Welsh|Filipino|Shotokan|Kyokushin|Karate|Sambo|Judo|Taekwondo|Left|Right|Handed)$/;
const NAME_RE = /\b([A-Z][a-z'’-]{1,}(?:\s+(?:de|da|dos|van|der|von|el)\s+)?(?:\s+[A-Z][a-z'’-]{1,}){1,2})\b/g;

export interface FighterMatch {
  name: string;
  /** Traits found described in a sentence that names this fighter. */
  shared: { trait: StyleTrait; quote: string; site: string; url: string }[];
  /** The learner's traits the pages contradict for this fighter (e.g. orthodox vs southpaw). */
  differs: { trait: StyleTrait; quote: string; site: string }[];
  /** The learner's style traits no read sentence confirms for this fighter. */
  unconfirmed: StyleTrait[];
  sites: string[];
}

function namesIn(sentence: string): { name: string; at: number }[] {
  const out: { name: string; at: number }[] = [];
  for (const m of sentence.matchAll(NAME_RE)) {
    // "Lyoto Machida The Brazilian…" → "Lyoto Machida": drop non-name words at the edges, keep the person
    const parts = m[1].replace(/[’']s$/, '').split(/\s+/);
    let a = 0;
    let b = parts.length;
    while (a < b && NOT_NAME.test(parts[a])) a++;
    while (b > a && NOT_NAME.test(parts[b - 1])) b--;
    const kept = parts.slice(a, b);
    if (kept.length < 2 || kept.some((p) => NOT_NAME.test(p))) continue;
    const name = kept.join(' ');
    out.push({ name, at: (m.index ?? 0) + m[1].indexOf(kept[0]) });
  }
  return out;
}

const OPPOSITE: Record<string, RegExp> = { 'stance:southpaw': /\borthodox\b/i, 'stance:orthodox': /\bsouthpaw\b/i };

/** Fighters whose described style shares the learner's traits — from sentences that name both, never from height/reach alone. */
// pages about the UFC video games / fantasy leagues describe players, not fighters
const NOT_FIGHT_PAGE = /(ea sports ufc|ufc\s?[3-6]\b(?!\d)|video game|ranked matches|career mode|fantasy (mma|league)|ultimate team)/i;
// a sentence must be about fighting for its names to be fighters
const FIGHT_CONTEXT = /(ufc|mma|fighter|fought|bout|champion|title|knockout|ko\b|tko|decision|submission|octagon|cage|division|weight|opponent|kickboxer|wrestler|striker|grappler|southpaw|orthodox|puncher|punches|kicks?|takedowns?|clinch|stance)/i;

export function similarFighters(results: ResearchResult[], profile: StyleProfile, max = 3): FighterMatch[] {
  const traits = profile.traits.filter((t) => t.kind !== 'physical');
  const by = new Map<string, FighterMatch>();
  for (const r of results.filter((x) => x.content && !NOT_FIGHT_PAGE.test(`${x.title} ${x.content.slice(0, 4000)}`))) {
    for (const s of sentencesOf(r.content ?? '')) {
      const names = FIGHT_CONTEXT.test(s) ? namesIn(s) : [];
      if (!names.length) continue;
      // a trait belongs to a name only when it is said right after it — up to the next name or clause end ("Edwards … is a
      // southpaw counter fighter" is not about the Usman named later; "A came up as a kickboxer, B out of wrestling")
      for (const [k, { name: n, at }] of names.slice(0, 4).entries()) {
        const end = Math.min(names[k + 1]?.at ?? s.length, at + n.length + 150);
        const before = s.slice(Math.max(0, at - 40), at);
        // "akin to / like / than / against / beat X": X is compared with or fought, not the one being described
        if (/(akin to|similar to|like|unlike|than|against|vs\.?|versus|over|beat|beating|defeated|faced|facing|including|such as|selection|with|rematch|trilogy|series)\s+(the\s+)?([a-z][a-z'-]*\s+){0,3}$/i.test(before)) continue;
        // "X is …" after the name, or "the southpaw X" right before it
        const low = `${/[,;:]\s*$/.test(before) ? '' : before.split(/[,;:.]/).pop() ?? ''} ${s.slice(at, end).split(/[;:]|,\s+(?=[A-Z][a-z]+\s+[A-Z])/)[0]}`.toLowerCase();
        const e = by.get(n) ?? { name: n, shared: [], differs: [], unconfirmed: [], sites: [] };
        for (const t of traits) {
          if (t.en.some((w) => new RegExp(`\\b${esc(w)}\\b`, 'i').test(low)) && !e.shared.some((x) => x.trait.id === t.id)) e.shared.push({ trait: t, quote: s.slice(0, 260), site: site(r.url), url: r.url });
          const opp = OPPOSITE[t.id];
          if (opp && opp.test(low) && !e.differs.some((x) => x.trait.id === t.id)) e.differs.push({ trait: t, quote: s.slice(0, 260), site: site(r.url) });
        }
        if (!e.sites.includes(site(r.url))) e.sites.push(site(r.url));
        by.set(n, e);
      }
    }
  }
  const ranked = [...by.values()]
    .filter((e) => e.shared.length > 0)
    // a stance contradicted in the same pages weighs against; more independent sites weigh for
    .sort((a, b) => b.shared.length - b.differs.length + b.sites.length / 10 - (a.shared.length - a.differs.length + a.sites.length / 10))
    .slice(0, max * 3);
  for (const e of ranked) e.unconfirmed = traits.filter((t) => !e.shared.some((x) => x.trait.id === t.id) && !e.differs.some((x) => x.trait.id === t.id));
  return ranked;
}

export function similarFightersText(matches: FighterMatch[], profile: StyleProfile): string {
  const traits = profile.traits.filter((t) => t.kind !== 'physical');
  if (!traits.length) return '프로필에 스타일 정보(스탠스·거리·킥·레슬링 진입 등)가 없어 비교 기준이 없습니다. 개인 파이터 프로필을 채우면 그 기준으로 찾습니다.';
  if (!matches.length) return `프로필 특징(${traits.map((t) => t.label).join(', ')})과 같은 문장에서 설명된 선수를 읽은 자료에서 찾지 못했습니다. 키·리치·체급만으로는 비슷한 선수라고 하지 않습니다.`;
  const lines = [`비교 기준(내 프로필): ${traits.map((t) => `${t.label}${t.confirmed ? '' : '(미확인)'}`).join(' · ')}`];
  for (const [i, m] of matches.entries()) {
    lines.push(`\n${i + 1}. ${m.name} — 자료 ${m.sites.length}곳`);
    lines.push(`   비슷한 점: ${m.shared.map((s) => s.trait.label).join(', ')}`);
    for (const q of [...new Set(m.shared.map((s) => `${s.site}\u0000${s.quote}`))].slice(0, 2)) {
      const [st, qt] = q.split('\u0000');
      lines.push(`   근거(${st}): "${clip(qt)}"`);
    }
    if (m.differs.length) lines.push(`   다른 점: ${m.differs.map((d) => `${d.trait.label}와 반대로 설명됨 (${d.site}: "${clip(d.quote, 110)}")`).join(' / ')}`);
    if (m.unconfirmed.length) lines.push(`   확인 안 됨: ${m.unconfirmed.map((t) => t.label).join(', ')} — 자료에 이 선수와 함께 나오지 않음`);
    if (m.shared.length === 1 || m.sites.length === 1) lines.push('   불확실: 근거 문장이 1개(또는 자료 1곳)뿐이라 비슷하다고 단정하기 어렵습니다.');
  }
  lines.push('\n※ 선수 이름은 읽은 자료의 문장에서 찾은 것이며, 인물 정보와 전적은 따로 확인하지 않았습니다.');
  return lines.join('\n');
}

// ---------------------------------------------------------------- rarity

export interface RarityStat {
  trait: StyleTrait;
  quote: string;
  site: string;
}

/** Sentences that state how common a trait is (a percentage or a share), from read pages only. */
export function rarityStats(results: ResearchResult[], profile: StyleProfile): RarityStat[] {
  const out: RarityStat[] = [];
  for (const r of results.filter((x) => x.content)) {
    for (const s of sentencesOf(r.content ?? '')) {
      if (!/(\d{1,2}(\.\d)?\s?(%|percent)|one in \w+|\d+ (in|out of) \d+)/i.test(s)) continue;
      for (const t of profile.traits) {
        if (t.kind === 'physical') continue;
        if (t.en.some((w) => new RegExp(`\\b${esc(w)}\\b`, 'i').test(s)) && !out.some((x) => x.trait.id === t.id)) out.push({ trait: t, quote: s.slice(0, 260), site: site(r.url) });
      }
    }
  }
  return out;
}

const AREA: Record<string, string> = { stance: '스탠스', range: '거리', style: '운영 방식', striking: '타격', kicking: '킥', grappling: '그래플링', movement: '움직임', defense: '방어' };

export function rarityText(profile: StyleProfile, stats: RarityStat[], searched: boolean): string {
  const traits = profile.traits.filter((t) => t.kind !== 'physical');
  if (!traits.length) return '프로필에 스타일 정보가 없어 희귀성을 판단할 수 없습니다.';
  const lines: string[] = [];
  if (stats.length) {
    lines.push('자료에 나온 수치 (원문 그대로 — 앱이 계산한 값이 아님):');
    for (const s of stats.slice(0, 3)) lines.push(`- ${s.trait.label}: "${clip(s.quote)}" (${s.site})`);
  } else {
    lines.push(`${searched ? '읽은 자료에서' : '검색하지 않아'} 각 특징이 선수 중 얼마나 흔한지 알려 주는 통계를 찾지 못했습니다. 그래서 "상위 몇 %" 같은 수치는 말하지 않습니다.`);
  }
  const areas = [...new Set(traits.map((t) => t.kind))];
  lines.push(`\n정성 분석 (앱의 판단 — 통계 아님): 내 프로필 특징은 ${areas.map((a) => AREA[a] ?? a).join('·')} ${areas.length}개 영역에 걸쳐 있습니다 (${traits.map((t) => t.label).join(', ')}).`);
  if (areas.includes('grappling') && (areas.includes('kicking') || areas.includes('striking'))) lines.push('- 타격 선호와 테이크다운 진입 선호가 함께 있는 조합입니다. 한쪽만 뚜렷한 프로필보다 상대가 대비해야 할 영역이 넓습니다.');
  if (traits.some((t) => t.id === 'stance:southpaw' || t.kind === 'stance')) lines.push('- 스탠스 특징(사우스포·스위치)은 오소독스 상대가 익숙하지 않은 각도를 만든다는 점에서 자주 언급되는 차별점입니다 — 흔한 정도는 위 자료 수치가 있을 때만 말합니다.');
  if (traits.length <= 2) lines.push('- 프로필의 스타일 정보가 적어 조합의 특이성을 말하기에 근거가 부족합니다.');
  return lines.join('\n');
}

/** English search phrase for a set of traits (the two most specific style traits). */
export function traitQuery(traits: StyleTrait[], suffix: string): string {
  const pick = traits.filter((t) => t.kind !== 'physical').slice(0, 2).map((t) => t.en[0]);
  return `${pick.join(' ')} ${suffix}`.trim();
}
