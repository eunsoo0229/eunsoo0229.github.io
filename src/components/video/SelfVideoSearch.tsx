import Icon from '../Icon';
import { useState } from 'react';
import type { Technique } from '../../types';
import { videoQueries } from '../../lib/selfAi/router';
import { toSources } from '../../lib/selfAi/coachAgent';
import { selfResearchProvider } from '../../lib/selfResearch/provider';
import type { ChatSource } from '../../lib/selfAi/types';
import VideoResultCards from './VideoResultCards';

// "자체 검색으로 영상 찾기" for one technique — the same search, embed check and cards
// as the 자체 AI 코치 (대화·수업 중 질문), so every screen shows found videos the same
// way. Runs only when pressed (a Day page lists several techniques: one search each
// would fire at once otherwise). Where self-hosted search is not available it says so.

type State = { status: 'idle' } | { status: 'loading' } | { status: 'done'; videos: ChatSource[]; note: string } | { status: 'error'; message: string };

export default function SelfVideoSearch({ technique, artNameKo }: { technique: Technique; artNameKo?: string }) {
  const [state, setState] = useState<State>({ status: 'idle' });
  async function run() {
    setState({ status: 'loading' });
    const name = technique.koreanName ?? technique.name;
    const queries = videoQueries(`${artNameKo ?? ''} ${name} 강좌 영상`.trim(), [technique]);
    const outcome = await selfResearchProvider.search({ query: queries[0], queries: queries.slice(1), kind: 'video', maxResults: 6 });
    if (!outcome.ok) {
      setState({ status: 'error', message: outcome.message });
      return;
    }
    const videos = toSources(outcome.results);
    const playable = videos.filter((v) => v.video?.embed === 'embeddable').length;
    setState({ status: 'done', videos, note: videos.length ? `찾은 영상 ${videos.length}개 · 앱에서 바로 재생 가능 ${playable}개 (영상 내용은 확인하지 않았습니다)` : '이 기술의 영상을 찾지 못했습니다.' });
  }
  return (
    <div className="self-video-search" data-testid="self-video-search">
      {state.status === 'idle' && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run()} data-testid="self-video-search-run">
          <Icon name="search" /> {technique.koreanName ?? technique.name} 영상 더 찾기 (자체 검색)
        </button>
      )}
      {state.status === 'loading' && <p className="muted">영상 검색 중…</p>}
      {state.status === 'error' && <p className="muted" data-testid="self-video-search-error">{state.message}</p>}
      {state.status === 'done' && (
        <>
          <p className="muted" data-testid="self-video-search-note">{state.note}</p>
          <VideoResultCards videos={state.videos} testId="self-video-search-results" />
        </>
      )}
    </div>
  );
}
