// 자체 AI 코치의 수업 자료 영상 찾기 — MARTIALDEX에 등록된 영상이 없을 때.
//
// 왜 필요한가. 자체 코치는 "MARTIALDEX에 등록된 영상이 없습니다"로 끝내고 아무것도 찾지 않았다. 영상 내용을
// Gemini로 확인하지 못한다는 이유였는데, 그건 "내용을 확인했다고 말할 수 없다"는 뜻이지 "찾을 수 없다"는 뜻이
// 아니다. 기술 하나짜리 수업이면 기술 이름으로 검색했을 때 대개 튜토리얼이 나온다.
//
// 어디서 찾는가 (2026-11-22 수정). 처음에는 자체 검색(selfResearchProvider)만 썼는데, 그 경로는
// **기본 설정에서 아무 데서도 동작하지 않았다**:
//   · 데스크톱 — 자체 검색은 기본값이 OFF라 `DISABLED` 를 돌려준다
//   · 웹(GitHub Pages) — Electron도 Android도 아니라 provider 자체가 available=false
//   · Android — 기기 직접 검색이 되므로 여기서만 동작했다
// 그래서 수업 화면에 영상이 한 번도 뜨지 않았다. 지금은 앱이 이미 가진 **키 없는 YouTube 검색**
// (videoSearch/provider.ts — Electron은 IPC, 웹·Android는 Supabase Edge Function)을 기본 경로로 쓴다.
// 이것은 Gemini가 아니므로 "Gemini 자동 폴백 금지" 규칙에 어긋나지 않는다. 자체 검색이 켜져 있으면
// 그쪽을 먼저 쓴다 — 재생 가능 여부·길이까지 알 수 있어 더 정확하게 거를 수 있기 때문이다.
//
// 찾기는 하되 확인했다고는 하지 않는다: 제목이 기술 이름을 담고 여러 기술 모음이 아닌 것만 고른 뒤
// "내용 미확인"으로 표시한다.

import type { Technique } from '../../types';
import type { ResearchResult } from '../selfResearch/types';
import { toSources } from '../selfAi/coachAgent';
import { NOT_SINGLE, pickReferenceVideos, TUTORIAL } from '../poseCoach/poseCoach';
import { selfResearchProvider } from '../selfResearch/provider';
import { videoSearchProvider } from '../videoSearch/provider';
import { dataKoreanNames } from '../coachKnowledge/koreanNames';
import { youtubeSearchUrl } from '../externalLink';
import type { TutorVideo } from './tutorVideoFinder';

export interface SelfVideoResult {
  videos: TutorVideo[];
  /** 검색어 (사용자에게 "무엇으로 찾았는지" 보여 주기 위해) */
  queries: string[];
  /** 영상이 없을 때 그 이유 — 못 찾았다는 말만 하지 않고 무엇이 걸러졌는지 적는다. */
  note: string | null;
  /**
   * 앱이 영상을 찾지 못했을 때 사용자가 직접 볼 수 있는 YouTube 검색 링크.
   * 웹에서는 영상 검색 함수가 로그인을 요구하므로(공개 중계 방지), 비로그인 사용자에게는
   * 이 링크가 유일한 길이다 — 아무것도 못 주는 것보다 낫다.
   */
  searchUrl: string;
}

/** 기술 이름으로 만든 검색어 — 영어 이름이 기본, 한글 이름이 있으면 함께. */
export function selfVideoQueries(t: Technique): string[] {
  const sport = t.martialArt.replace(/-/g, ' ');
  return [`${t.name} ${sport} technique tutorial`, `how to ${t.name} ${sport}`, ...(t.koreanName ? [`${t.koreanName} 기술 설명`] : [])];
}

/** 자료 제목이 이 기술을 가리키는 이름들 (영문명·한글명·별칭·데이터의 한글 표기). */
function nameForms(t: Technique): string[] {
  return [t.name, t.koreanName ?? '', ...(t.aliases ?? []), ...dataKoreanNames(t)]
    .filter((n) => n && (n.length >= 2 || /^[가-힣]+$/.test(n)))
    .map((n) => n.toLowerCase());
}

const unverified = (what: string) => `${what} 영상 내용은 확인하지 않았습니다.`;

/**
 * 키 없는 YouTube 검색 결과에서 단일 기술 영상을 고른다.
 * 자체 검색과 달리 길이·재생 가능 여부를 알 수 없으므로 **제목으로만** 거른다 —
 * 기술 이름이 들어 있고, 여러 기술을 모은 영상이 아닌 것.
 */
function pickFromTitles(results: { videoId: string; title: string; channel: string }[], t: Technique, max: number): { videos: TutorVideo[]; rejected: string[] } {
  const names = nameForms(t);
  const videos: TutorVideo[] = [];
  const rejected: string[] = [];
  for (const r of results) {
    const title = r.title.toLowerCase();
    const why = !names.some((n) => title.includes(n)) ? '제목에 기술 이름 없음' : NOT_SINGLE.test(r.title) ? '여러 기술·하이라이트 영상' : null;
    if (why) {
      rejected.push(why);
      continue;
    }
    videos.push({
      video: { videoId: r.videoId, title: r.title, channel: r.channel },
      source: 'self_search',
      reason: unverified('기술 이름으로 검색해 찾은 단일 기술 영상입니다. 길이와 재생 가능 여부는 확인하지 못했고,'),
    });
  }
  // 같은 조건이면 설명·강좌형 제목을 먼저
  videos.sort((a, b) => Number(TUTORIAL.test(b.video.title)) - Number(TUTORIAL.test(a.video.title)));
  return { videos: videos.slice(0, max), rejected };
}

/** 자체 검색(SearXNG·기기 검색)이 켜져 있을 때의 경로 — 길이·재생 가능 여부까지 보고 거른다. */
async function viaSelfSearch(t: Technique, queries: string[], max: number): Promise<{ videos: TutorVideo[]; note: string | null } | null> {
  if (!selfResearchProvider.available()) return null;
  const outcome = await selfResearchProvider.search({ query: queries[0], queries: queries.slice(1), kind: 'video', maxResults: 8 });
  if (!outcome.ok) return null; // 꺼져 있거나(DISABLED) 실패 — 아래의 YouTube 검색이 받는다
  const { picked, rejected } = pickReferenceVideos(toSources(outcome.results), t);
  const videos: TutorVideo[] = picked
    .filter((v) => v.video?.videoId)
    .slice(0, max)
    .map((v) => ({
      video: { videoId: v.video!.videoId!, title: v.title, channel: v.video?.channel ?? v.source ?? '' },
      source: 'self_search',
      reason: unverified('기술 이름으로 검색해 찾은 단일 기술 영상입니다.'),
    }));
  if (videos.length) return { videos, note: null };
  const why = [...new Set(rejected.map((r) => r.why))].join(', ');
  return outcome.results.length ? { videos: [], note: `자체 검색 결과 ${outcome.results.length}건 중 단일 기술 영상이 없었습니다(${why || '사유 미상'}).` } : null;
}

/**
 * 이 기술의 단일 기술 튜토리얼을 찾는다. 내용은 확인하지 않는다 —
 * 호출한 쪽은 반드시 "영상 내용 미확인"을 함께 보여 줘야 한다.
 */
export async function findSelfTechniqueVideos(t: Technique, opts: { max?: number } = {}): Promise<SelfVideoResult> {
  const queries = selfVideoQueries(t);
  const max = opts.max ?? 3;
  const searchUrl = youtubeSearchUrl(queries[0]);

  const self = await viaSelfSearch(t, queries, max);
  if (self?.videos.length) return { videos: self.videos, queries, note: null, searchUrl };

  // 기본 경로: 앱의 키 없는 YouTube 검색 (Electron IPC / Supabase Edge Function)
  const rejected: string[] = [];
  for (const query of queries) {
    const outcome = await videoSearchProvider.search(query);
    if (!outcome.ok) {
      // 로그인 문제는 "영상이 없다"가 아니라 "지금은 찾을 수 없다"다 — 그대로 전한다
      return { videos: [], queries, searchUrl, note: outcome.code === 'UNAUTHORIZED' ? '앱에서 영상을 찾으려면 로그인이 필요합니다. 아래 버튼으로 YouTube에서 직접 찾아보실 수 있습니다.' : `영상 검색에 실패했습니다: ${outcome.message}` };
    }
    const picked = pickFromTitles(outcome.results, t, max);
    rejected.push(...picked.rejected);
    if (picked.videos.length) return { videos: picked.videos, queries, note: null, searchUrl };
  }
  const why = [...new Set(rejected)].join(', ');
  return { videos: [], queries, searchUrl, note: rejected.length ? `검색 결과 중 단일 기술 영상이 없었습니다(${why}).` : self?.note ?? '검색 결과가 없었습니다.' };
}

// ────────────────────────────────────────────────── 셋업·콤보 (기술 여러 개를 잇는 수업)

export interface ComboVideoResult {
  /** 각 단계 기술의 영상 (기술당 1개). 영상을 못 찾은 단계도 note 와 함께 그대로 들어 있다. */
  steps: { technique: Technique; videos: TutorVideo[]; note: string | null }[];
  /** 두 기술을 "연결"한 영상 — 콤보 자체를 다룬 자료. 단계 영상과 섞지 않는다. */
  connection: SelfVideoResult;
}

/**
 * 콤보·셋업 수업의 검색어 — 연결 자체를 찾는다.
 * "잽 → 더블렉"이면 잽 영상도 더블렉 영상도 아닌, 둘을 잇는 영상을 찾는 검색어.
 */
export function comboVideoQueries(steps: Technique[], martialArt?: string | null): string[] {
  const names = steps.map((t) => t.name);
  const sport = (martialArt ?? steps[0]?.martialArt ?? '').replace(/-/g, ' ');
  const ko = steps.map((t) => t.koreanName).filter((x): x is string => !!x);
  return [
    `${names.join(' to ')} ${sport} combination`.trim(),
    `how to set up ${names[names.length - 1]} with ${names[0]} ${sport}`.trim(),
    ...(ko.length === steps.length ? [`${ko.join(' ')} 콤비네이션`] : []),
  ];
}

/**
 * 콤보·셋업 수업의 자료 영상: 단계 기술마다 1개 + 연결 영상 1개.
 *
 * 왜 나누는가. "잽 → 더블렉"을 배울 때 필요한 것은 세 가지다 — 잽이 어떤 동작인지, 더블렉이 어떤 동작인지,
 * 그리고 그 둘을 어떻게 잇는지. 연결 영상 하나만 보여 주면 각 기술을 모르는 학습자가 따라갈 수 없고,
 * 단계 영상만 보여 주면 정작 배우려는 연결을 못 본다. 그래서 따로 찾고 따로 표시한다.
 * 내용 확인은 여기서도 하지 않는다 — 전부 self_search 로 표시된다.
 */
export async function findSelfComboVideos(steps: Technique[], opts: { martialArt?: string | null; perStep?: number } = {}): Promise<ComboVideoResult> {
  // 같은 기술이 두 번 나오는 콤보("잽 → 잽 → 크로스")는 한 번만 찾는다 (중복 검색 방지)
  const unique: Technique[] = [];
  for (const t of steps) if (!unique.some((u) => u.id === t.id)) unique.push(t);
  const perStep = await Promise.all(unique.map((t) => findSelfTechniqueVideos(t, { max: opts.perStep ?? 1 })));
  const queries = comboVideoQueries(steps, opts.martialArt);
  let connection: SelfVideoResult = { videos: [], queries, searchUrl: youtubeSearchUrl(queries[0]), note: '연결 영상을 찾으려면 기술이 둘 이상이어야 합니다.' };
  if (unique.length >= 2) connection = await findConnectionVideo(steps, queries);
  return { steps: unique.map((technique, i) => ({ technique, videos: perStep[i].videos, note: perStep[i].note })), connection };
}

/**
 * 연결 영상 고르기 — 단일 기술 거르개를 쓸 수 없다. 콤보 영상은 기술을 둘 이상 다루므로
 * "여러 기술 영상 제외" 규칙에 전부 걸린다. 대신 제목이 단계 기술 중 **둘 이상**을 담은 것만 고른다.
 */
async function findConnectionVideo(steps: Technique[], queries: string[]): Promise<SelfVideoResult> {
  const searchUrl = youtubeSearchUrl(queries[0]);
  const hitsIn = (title: string) =>
    new Set(steps.filter((t) => nameForms(t).some((n) => n.length >= 2 && title.toLowerCase().includes(n))).map((t) => t.id)).size;

  if (selfResearchProvider.available()) {
    const outcome = await selfResearchProvider.search({ query: queries[0], queries: queries.slice(1), kind: 'video', maxResults: 8 });
    if (outcome.ok) {
      const picked = pickComboFromResearch(outcome.results, hitsIn, queries);
      if (picked.videos.length) return picked;
    }
  }
  let notTwo = 0;
  for (const query of queries) {
    const outcome = await videoSearchProvider.search(query);
    if (!outcome.ok) return { videos: [], queries, searchUrl, note: outcome.code === 'UNAUTHORIZED' ? '앱에서 연결 영상을 찾으려면 로그인이 필요합니다. 아래 버튼으로 직접 찾아보실 수 있습니다.' : `연결 영상 검색에 실패했습니다: ${outcome.message}` };
    for (const r of outcome.results) {
      if (hitsIn(r.title) < 2) {
        notTwo++;
        continue;
      }
      return {
        videos: [{ video: { videoId: r.videoId, title: r.title, channel: r.channel }, source: 'self_search', reason: unverified('제목에 이 콤보의 기술이 둘 이상 들어 있어 연결 영상으로 골랐습니다.') }],
        queries,
        searchUrl,
        note: null,
      };
    }
  }
  const names = steps.map((t) => t.koreanName ?? t.name).join(' → ');
  return {
    videos: [],
    queries,
    searchUrl,
    note: notTwo
      ? `${names} 연결을 함께 다룬 영상을 찾지 못했습니다(제목에 기술이 하나만 나온 영상 ${notTwo}건). 단계별 영상으로 각각 익힌 뒤 연결은 설명을 따라 주세요.`
      : '연결 영상 검색 결과가 없었습니다.',
  };
}

/** 자체 검색 결과에서 연결 영상 고르기 (재생 가능 여부까지 확인할 수 있는 경로). */
function pickComboFromResearch(results: ResearchResult[], hitsIn: (title: string) => number, queries: string[]): SelfVideoResult {
  const searchUrl = youtubeSearchUrl(queries[0]);
  for (const r of results) {
    if (hitsIn(r.title) < 2) continue;
    if (r.video?.embed !== 'embeddable' || !r.video.videoId) continue;
    return {
      videos: [{ video: { videoId: r.video.videoId, title: r.title, channel: r.video.channel ?? r.source ?? '' }, source: 'self_search', reason: unverified('제목에 이 콤보의 기술이 둘 이상 들어 있어 연결 영상으로 골랐습니다.') }],
      queries,
      searchUrl,
      note: null,
    };
  }
  return { videos: [], queries, searchUrl, note: null };
}
