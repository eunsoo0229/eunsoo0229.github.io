// Video and paper details for self-hosted search results (Electron main process).
//
// - YouTube: the video id, and whether the owner allows embedding, asked from
//   YouTube's public oEmbed endpoint (200 = embeddable, 401/403 = embedding
//   disabled by the owner, 404/400 = removed / private / invalid). The app plays
//   only embeddable videos in its own player and never works around the policy.
// - Papers: the DOI as given by the index, checked against doi.org (a registered
//   DOI redirects to the publisher; an unknown one answers 404). Nothing is
//   filled in when an index did not provide it.

const TIMEOUT_MS = 5000;

function youtubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www\.|m\.)/, '');
    if (host === 'youtu.be') return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/);
      return m ? m[1] : null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

/** → 'embeddable' | 'not_embeddable' | 'unavailable' | 'unknown' (+ channel name when YouTube gave it) */
async function youtubeEmbedStatus(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.status === 200) {
      const j = await r.json().catch(() => null);
      return { embed: 'embeddable', channel: j && typeof j.author_name === 'string' ? j.author_name : undefined };
    }
    if (r.status === 401 || r.status === 403) return { embed: 'not_embeddable' };
    if (r.status === 404 || r.status === 400) return { embed: 'unavailable' };
    return { embed: 'unknown' };
  } catch {
    return { embed: 'unknown' };
  }
}

const DOI_RE = /^10\.\d{4,9}\/\S+$/;

function cleanDoi(raw) {
  if (typeof raw !== 'string') return null;
  const d = raw.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  return DOI_RE.test(d) ? d : null;
}

/** DOI from the index, or from a doi.org / oadoi.org link in the result URL. */
function doiOf(result) {
  return cleanDoi(result.doi) || cleanDoi((String(result.url || '').match(/(?:doi\.org|oadoi\.org)\/(10\.\d{4,9}\/[^?#\s]+)/i) || [])[1]);
}

/** → 'registered' | 'not_found' | 'unchecked' */
async function doiStatus(doi) {
  try {
    const r = await fetch(`https://doi.org/${encodeURI(doi)}`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.status >= 300 && r.status < 400) return 'registered';
    if (r.status === 404) return 'not_found';
    return 'unchecked';
  } catch {
    return 'unchecked';
  }
}

module.exports = { youtubeId, youtubeEmbedStatus, doiOf, cleanDoi, doiStatus };
