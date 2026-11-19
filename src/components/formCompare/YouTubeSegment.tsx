// The registered reference segment of a YouTube video (start → end), shared by 기준 영상 비교 and the camera measurement.

const IFRAME_ALLOW = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

export default function YouTubeSegment({ videoId, start, end, title }: { videoId: string; start: number; end: number; title: string }) {
  return (
    <div className="video-embed form-compare__embed" data-testid="form-ref-embed">
      <iframe
        src={`https://www.youtube.com/embed/${videoId}?start=${Math.floor(start)}&end=${Math.ceil(end)}&rel=0`}
        title={title}
        allow={IFRAME_ALLOW}
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}
