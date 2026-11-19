// The conversation coach's answer to a fighter-style question — written by code from
// the evidence report (fighterStyle/evidenceStyle.ts). Grouped by what the learner
// wants to know (주요 타격·그래플링 기술, 셋업, 콤비네이션, 카운터, 거리 운영, 경기 운영,
// 반복 패턴), each item with its support level and the source sentence — and, apart,
// what the pages say that is NOT the fighter's (the opponent's techniques, general
// explanations, advice, captions). A category the sources do not show is "확인할 수 없음".
// Nothing is added; the fights themselves (videos) are not analysed.

import type { EvidenceStyleReport, StyleItem } from '../fighterStyle/evidenceStyle';
import { FIGHTER_FAILURE_LABEL, STYLE_SUPPORT_LABEL, type FighterFailure } from '../fighterStyle/evidenceStyle';
import { EVIDENCE_LABEL, type EvidenceKind } from '../fighterStyle/actor';
import type { PersonName } from '../selfResearch/types';
import { resolveTechnique } from '../userTechniques/service';

const GRAPPLING_ARTS = new Set(['wrestling', 'bjj', 'judo', 'sambo']);
const ASKED: [RegExp, string, StyleItem['kind'][]][] = [
  [/셋업|setup/i, '셋업', ['setup']],
  [/콤보|콤비네이션|combination|combo/i, '콤비네이션', ['combo']],
  [/카운터|counter/i, '카운터', ['situation']],
  [/거리|풋워크|스탠스|footwork|stance/i, '거리·풋워크', ['distance']],
];

/**
 * 질문한 주제를 자료가 확인했는가 — 분석 본문보다 먼저 답한다.
 *
 * 사양 §2·§5: 자료가 얇으면 "확인 불가"라고 말해야 하고, 습관은 자료 한 곳으로 단정할 수 없다. 이 블록이
 * 없을 때 코치는 가드를 물어도 셋업·콤비네이션 목록을 늘어놓고 가드는 한마디도 하지 않은 채 끝냈다.
 */
function topicVerdict(te: NonNullable<EvidenceStyleReport['topicEvidence']>): string[] {
  if (!te.labels.length) return [];
  const label = te.labels.join('·');
  const lines = [`\n■ 질문하신 내용: ${label}`];
  const skipped = [te.offTopic ? `선수 이름만 나오고 ${label}는 다루지 않은 자료 ${te.offTopic}건` : '', te.sameNameOther ? `같은 이름의 다른 기술을 다룬 자료 ${te.sameNameOther}건` : ''].filter(Boolean);
  if (!te.sentences.length) {
    lines.push(`- 확인 불가 — 읽은 자료 본문에서 이 선수와 ${label}를 함께 말한 문장을 찾지 못했습니다. 추측으로 답하지 않습니다.`);
    if (skipped.length) lines.push(`- 근거에서 제외: ${skipped.join(', ')} (아래 출처 목록에 참고로만 남겨 두었습니다)`);
    return lines;
  }
  // 습관을 물었으면 서로 다른 자료 2곳이 필요하다 — 한 곳의 한 문장은 그 경기의 서술일 수 있다
  if (te.habitAsked && te.directSites < 2) {
    lines.push(`- 습관·반복 여부는 확인 불가 — ${label}를 말한 자료가 ${te.directSites}곳뿐입니다. 한 자료의 서술만으로 "습관적으로 그렇게 한다"고 말하지 않습니다.`);
    lines.push(`- 그 자료가 말한 내용 (사실 확인된 문장, 반복 여부는 별개):`);
  } else if (te.habitAsked) {
    const freq = te.sentences.filter((s) => s.frequency).length;
    lines.push(`- 서로 다른 자료 ${te.directSites}곳이 ${label}를 말합니다${freq ? ` (그 중 ${freq}곳은 원문이 "자주·주로" 같은 빈도 표현을 씀)` : ' (다만 원문에 빈도 표현은 없어 "습관"까지는 자료가 말하지 않습니다)'}.`);
  } else {
    lines.push(`- 자료 ${te.directSites}곳의 본문에서 이 선수와 ${label}가 같은 문장으로 확인됐습니다.`);
  }
  for (const s of te.sentences) lines.push(`  · ${s.site}: "${s.sentence.length > 220 ? `${s.sentence.slice(0, 219)}…` : s.sentence}"`);
  if (skipped.length) lines.push(`- 근거에서 제외: ${skipped.join(', ')}`);
  return lines;
}

type Category = { label: string; pick: (i: StyleItem) => boolean };
const isGrappling = (i: StyleItem) => i.techniqueIds.some((id) => GRAPPLING_ARTS.has(resolveTechnique(id)?.martialArt ?? ''));
const CATEGORIES: Category[] = [
  { label: '주요 타격 기술', pick: (i) => i.kind === 'technique' && !isGrappling(i) },
  { label: '주요 그래플링 기술', pick: (i) => i.kind === 'technique' && isGrappling(i) },
  { label: '셋업', pick: (i) => i.kind === 'setup' },
  { label: '콤비네이션', pick: (i) => i.kind === 'combo' },
  { label: '카운터', pick: (i) => i.kind === 'situation' },
  { label: '거리 운영', pick: (i) => i.kind === 'distance' },
  { label: '경기 운영 특징', pick: (i) => i.kind === 'gameplan' },
];

function quoteLine(i: StyleItem): string {
  // one quote per site first: "여러 자료에서 공통 확인" must show the different sites
  const verified = i.quotes.filter((q) => q.verified);
  const quotes = [...verified.filter((q, n) => verified.findIndex((x) => x.site === q.site) === n), ...verified].filter((q, n, a) => a.indexOf(q) === n).slice(0, 2);
  return quotes.map((q) => `${q.site}${q.evidence ? `(${EVIDENCE_LABEL[q.evidence]})` : ''} "${q.quote.length > 150 ? `${q.quote.slice(0, 149)}…` : q.quote}"`).join(' / ');
}

function itemLine(i: StyleItem): string {
  // only a combination / setup is an ORDER of moves; a counter item lists the punches it names
  const name = i.steps?.length ? i.steps.join(i.kind === 'combo' || i.kind === 'setup' || i.kind === 'connection' ? ' → ' : ', ') : i.text.replace(/^[^:]+: /, '');
  const freq = i.frequencyStated ? ' · 원문에 빈도 표현' : '';
  const ev = quoteLine(i);
  return `- ${name} · ${STYLE_SUPPORT_LABEL[i.support]}${freq}${ev ? `\n  근거: ${ev}` : ''}`;
}

export function fighterReportText(question: string, report: EvidenceStyleReport, name: PersonName | null): string {
  const lines: string[] = [];
  if (name?.ok && name.source) lines.push(`선수: ${name.query} → ${name.en} (위키백과 한국어 문서 「${name.ko}」의 영어 문서 연결로 확인)`);
  else if (name?.ok) lines.push(`선수: ${name.en}`);
  else if (name) lines.push(`선수: ${name.query} — 영문 이름을 확인하지 못해(${name.reason}) 입력한 이름으로 검색했습니다.`);
  if (name?.ok && name.via) lines.push(`이름 확인 경로: ${name.via}`);
  const log = report.searchLog;
  if (log?.rounds.length) {
    const total = log.rounds.reduce((n, r) => n + r.results, 0);
    const relevant = log.rounds.reduce((n, r) => n + r.relevant, 0);
    const fails = (Object.keys(log.failures) as FighterFailure[]).filter((k) => log.failures[k] > 0).map((k) => `${FIGHTER_FAILURE_LABEL[k]} ${log.failures[k]}건`);
    lines.push(`검색 과정: ${log.rounds.length}회 검색(${log.rounds.map((r, i) => `${i + 1}차 ${r.results}건·관련 ${r.relevant}건·본문 ${r.read}곳`).join(' → ')}), 결과 ${total}건 중 이 선수에 관한 자료 ${relevant}건${fails.length ? ` · 사용하지 못한 이유: ${fails.join(', ')}` : ''}`);
  }
  const used = report.sources.filter((s) => s.used).length;
  const onlyRef = report.sources.length - used;
  lines.push(
    `분석 근거: 본문을 읽은 분석 자료 ${report.pagesRead ?? 0}곳${report.sources.length ? ` (아래 출처 ${report.sources.length}건 중 실제로 문장을 인용해 쓴 자료 ${used}건${onlyRef ? `, 참고로만 남긴 자료 ${onlyRef}건` : ''})` : ''}. 각 항목은 그 원문 문장에서 MARTIALDEX 기술 이름을 찾고, 그 동작을 이 선수가 했다고 쓴 문장만 골랐습니다. 경기 영상은 보지 않았습니다(영상 자체를 분석하지 않음).`
  );
  // 질문한 주제에 대한 판정을 먼저 — 분석 목록을 읽기 전에 "확인됐는지 아닌지"를 알 수 있어야 한다
  if (report.topicEvidence) lines.push(...topicVerdict(report.topicEvidence));
  // 검색이 이 선수의 것을 확인하지 못했어도 앱이 가진 기록은 그대로 있다 (사양 §5)
  if (report.topicRecords?.length) {
    lines.push(`- 참고로 MARTIALDEX에 있는 ${report.topicEvidence?.labels.join('·') ?? '해당'} 기록: ${report.topicRecords.map((r) => r.name).join(', ')} — 앱의 기술 기록일 뿐, 이 선수가 무엇을 쓰는지에 대한 근거가 아닙니다.`);
  }

  const confirmed = report.items.filter((i) => i.support === 'multi_source' || i.support === 'source_analysis');
  const empty: string[] = [];
  for (const c of CATEGORIES) {
    const group = confirmed.filter(c.pick).sort((a, b) => (a.support === b.support ? 0 : a.support === 'multi_source' ? -1 : 1));
    if (!group.length) {
      empty.push(c.label);
      continue;
    }
    lines.push(`\n■ ${c.label}`);
    lines.push(...group.slice(0, 6).map(itemLine));
    if (group.length > 6) lines.push(`- … 외 ${group.length - 6}건`);
  }
  // 반복(습관)과 "자료 한 곳이 빈도를 말했다"는 다른 사실이다 — 사양 §4: 단일 자료로 습관을 단정하지 않는다
  const repeated = confirmed.filter((i) => i.support === 'multi_source');
  const singleFreq = confirmed.filter((i) => i.support !== 'multi_source' && i.frequencyStated);
  lines.push('\n■ 반복적으로 확인되는 패턴 (서로 다른 자료 2곳 이상)');
  lines.push(repeated.length ? repeated.slice(0, 6).map((i) => `- ${i.steps?.join(' → ') ?? i.text}`).join('\n') : '- 서로 다른 자료 두 곳 이상에서 공통으로 확인된 패턴은 없습니다.');
  if (singleFreq.length) {
    lines.push('\n■ 자료 1곳만 빈도를 말한 패턴 (반복 여부는 확인 못함)');
    lines.push(...singleFreq.slice(0, 4).map((i) => `- ${i.steps?.join(' → ') ?? i.text} — 자료 한 곳의 서술이라 습관으로 단정하지 않습니다.`));
  }
  const inferred = report.items.filter((i) => i.support === 'ai_inference');
  if (inferred.length) {
    lines.push(`\n■ ${STYLE_SUPPORT_LABEL.ai_inference}`);
    lines.push(...inferred.slice(0, 4).map((i) => `- ${i.text}${i.steps?.length ? ` (${i.steps.join(' → ')})` : ''}`));
  }
  if (empty.length) lines.push(`\n■ 확인할 수 없는 항목: ${empty.join(', ')} — 읽은 자료에 이 선수가 했다고 쓴 문장이 없습니다.`);

  // what the pages name that is NOT this fighter's — kept out of the analysis above
  const ex = report.excluded ?? [];
  if (ex.length) {
    const by = (k: EvidenceKind) => ex.filter((e) => e.evidence === k);
    const opp = by('opponent');
    const parts: string[] = [];
    if (opp.length) parts.push(`- 상대가 사용한 기술 ${opp.length}건: ${[...new Set(opp.map((e) => e.name))].slice(0, 5).join(', ')}\n  예: "${opp[0].quote.length > 140 ? `${opp[0].quote.slice(0, 139)}…` : opp[0].quote}" (${opp[0].reason})`);
    for (const k of ['general', 'hypothetical', 'caption', 'unclear'] as EvidenceKind[]) {
      const list = by(k);
      if (list.length) parts.push(`- ${EVIDENCE_LABEL[k]} ${list.length}건${k === 'unclear' ? ` (${[...new Set(list.map((e) => e.name))].slice(0, 4).join(', ')})` : ''}`);
    }
    if (parts.length) lines.push(`\n■ 선수 기술에서 제외한 언급 (자료에 나오지만 이 선수의 기술로 보지 않음)\n${parts.join('\n')}`);
  }

  const asked = ASKED.filter(([re]) => re.test(question));
  if (asked.length) {
    const summary = asked.map(([, label, kinds]) => {
      const found = confirmed.filter((i) => kinds.includes(i.kind));
      return found.length ? `${label} ${found.length}건` : `${label}: 자료에서 확인 못함`;
    });
    lines.push(`\n■ 요청하신 항목: ${summary.join(' / ')}`);
  }
  if (!confirmed.length && !inferred.length) lines.push('\n분석 자료에서 이 선수의 셋업·콤비네이션·카운터를 MARTIALDEX 기술과 연결해 확인한 내용이 없습니다. 근거 없는 분석은 만들지 않았습니다.');
  if (report.videos.length) lines.push(`\n■ 경기 영상 ${report.videos.length}개 (제목·설명만 확인, 영상 내용 미확인) — 아래 카드에서 재생`);
  if (report.limits.length) lines.push(`\n■ 한계\n${report.limits.map((l) => `- ${l}`).join('\n')}`);
  return lines.join('\n');
}
