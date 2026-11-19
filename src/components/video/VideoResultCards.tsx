import Icon from '../Icon';
import { useState } from 'react';
import type { EmbedStatus, VideoInfo } from '../../lib/selfResearch/types';

// Video search results as cards with an in-app player. Reusable anywhere a list of
// found videos is shown (자체 AI 대화, 수업 중 질문, 커리큘럼·기술 상세 영상 찾기).
//  - YouTube videos whose owner allows embedding (checked with YouTube's oEmbed in
//    the main process) play in the app's own player, one at a time, above the list.
//  - Embedding disabled / removed / other platforms: shown as such, with the
//    original link — the embed policy is never worked around.
//  - The same video is listed once (by video id, else URL).

export interface VideoCard {
  title: string;
  url: string;
  source?: string;
  publishedAt?: string;
  video?: VideoInfo;
}

const IFRAME_ALLOW = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

const STATUS: Record<EmbedStatus, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  embeddable: { label: '앱에서 재생', tone: 'ok' },
  not_embeddable: { label: '외부 재생 불가 (소유자 설정)', tone: 'warn' },
  unavailable: { label: '재생 불가 (삭제·비공개)', tone: 'bad' },
  unknown: { label: '재생 가능 여부 미확인', tone: 'warn' },
  not_supported: { label: '원본 사이트에서 시청', tone: 'warn' },
};

function openOriginal(url: string, e?: React.MouseEvent) {
  if (window.martialdex?.openExternal) {
    e?.preventDefault();
    void window.martialdex.openExternal(url);
  }
}

export function dedupeVideos<T extends VideoCard>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((v) => {
    const key = v.video?.videoId ? `yt:${v.video.videoId}` : v.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function VideoResultCards({ videos, testId = 'video-results' }: { videos: VideoCard[]; testId?: string }) {
  const list = dedupeVideos(videos);
  const [playing, setPlaying] = useState<string | null>(null);
  const current = list.find((v) => v.video?.videoId === playing) ?? null;
  if (!list.length) return null;
  return (
    <div className="video-results" data-testid={testId}>
      {current?.video?.videoId && (
        <div className="video-results__player" data-testid="video-results-player">
          <div className="video-results__frame">
            <iframe
              key={current.video.videoId}
              src={`https://www.youtube.com/embed/${current.video.videoId}?autoplay=1&rel=0`}
              title={current.title}
              allow={IFRAME_ALLOW}
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              data-video-id={current.video.videoId}
            />
          </div>
          <div className="video-results__now">
            <strong>{current.title}</strong>
            <span>
              {current.video.channel ? `${current.video.channel} · ` : ''}출처: YouTube ·{' '}
              <a href={current.url} target="_blank" rel="noreferrer" onClick={(e) => openOriginal(current.url, e)}>
                원본에서 보기
              </a>{' '}
              · <button type="button" className="link-button" onClick={() => setPlaying(null)}>닫기</button>
            </span>
            <span className="video-results__hint">재생이 되지 않으면 원본에서 보기를 눌러 주세요.</span>
          </div>
        </div>
      )}
      <ul className="video-results__grid">
        {list.map((v) => {
          const status = STATUS[v.video?.embed ?? 'not_supported'];
          const canPlay = v.video?.embed === 'embeddable' && !!v.video.videoId;
          const active = canPlay && playing === v.video!.videoId;
          return (
            <li key={v.video?.videoId ?? v.url} className={`video-card${active ? ' video-card--active' : ''}`} data-embed={v.video?.embed ?? 'not_supported'}>
              <button
                type="button"
                className="video-card__thumb"
                onClick={(e) => (canPlay ? setPlaying(v.video!.videoId!) : openOriginal(v.url, e as unknown as React.MouseEvent))}
                aria-label={canPlay ? `${v.title} 앱에서 재생` : `${v.title} 원본에서 보기`}
                data-testid="video-card-play"
              >
                {v.video?.thumbnail ? <img src={v.video.thumbnail} alt="" loading="lazy" decoding="async" /> : <span className="video-card__noimg"><Icon name="video" /></span>}
                {v.video?.duration && <span className="video-card__duration">{v.video.duration}</span>}
                {canPlay && <span className="video-card__play" aria-hidden="true"><Icon name="play" /></span>}
              </button>
              <div className="video-card__body">
                <div className="video-card__title" title={v.title}>
                  {v.title}
                </div>
                <div className="video-card__meta">
                  {[v.video?.channel, v.source, v.publishedAt?.slice(0, 10)].filter(Boolean).join(' · ') || '채널 정보 없음'}
                </div>
                <div className="video-card__foot">
                  <span className={`video-card__status video-card__status--${status.tone}`}>{status.label}</span>
                  <a href={v.url} target="_blank" rel="noreferrer" onClick={(e) => openOriginal(v.url, e)}>
                    원본
                  </a>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
