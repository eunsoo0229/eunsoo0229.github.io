// Post-checks on the local model's answer. The model may cite sources only as
// [n] for sources that were really retrieved this turn; anything else is removed
// and the learner is told. When no search ran, wording that claims one is flagged.

export interface GuardResult {
  text: string;
  /** Citation numbers that point at real sources. */
  cited: number[];
  removedCitations: number[];
  /** True when the answer claims a search/video/paper lookup that did not happen. */
  falseSearchClaim: boolean;
  /** Raw URLs the model wrote that are not among the retrieved sources (removed). */
  removedUrls: string[];
  /** Chinese characters / Japanese kana leaked into a Korean answer (small models do this). */
  foreignScript: boolean;
  /** Sentences promising an action the coach never takes after answering ("다시 시도해 보겠습니다") — removed. */
  removedPromises: string[];
}

const SEARCH_CLAIM = /(검색(해 ?보니|한 결과|결과에 따르면|해서 찾)|찾아 ?보니|조사해 ?보니|자료에 따르면|영상을 (찾았|확인했)|논문에 따르면|according to (my|the) search)/i;
const URL_RE = /https?:\/\/[^\s)\]>"']+/g;
// The answer is final: nothing is retried, searched or checked after it (measured: "다시 시도해 보겠습니다" after a
// failed search that was never retried).
const PROMISE = /(다시 (시도|검색|찾아|확인)해? ?보겠|(찾아|검색해|알아|확인해|조사해) ?보겠습니다|(찾아|검색해|알아봐) ?드리겠|잠시만 기다려|나중에 (다시 )?알려 ?드리)/;

export function guardAnswer(raw: string, opts: { sourceCount: number; sourceUrls: string[]; searched: boolean }): GuardResult {
  const removedCitations: number[] = [];
  const cited = new Set<number>();
  let text = raw.replace(/\[(\d{1,2})\]/g, (m, n) => {
    const i = Number(n);
    if (i >= 1 && i <= opts.sourceCount) {
      cited.add(i);
      return m;
    }
    removedCitations.push(i);
    return '';
  });
  const allowed = new Set(opts.sourceUrls.map((u) => u.replace(/\/+$/, '')));
  const removedUrls: string[] = [];
  text = text.replace(URL_RE, (u) => {
    if (allowed.has(u.replace(/[.,]+$/, '').replace(/\/+$/, ''))) return u;
    removedUrls.push(u);
    return '(확인되지 않은 링크 삭제)';
  });
  const removedPromises: string[] = [];
  text = text
    .split('\n')
    .map((line) =>
      line
        .split(/(?<=[.!?。])[ \t]+/)
        .filter((s) => {
          if (!PROMISE.test(s)) return true;
          removedPromises.push(s.trim());
          return false;
        })
        .join(' ')
    )
    .join('\n');
  const falseSearchClaim = !opts.searched && SEARCH_CLAIM.test(text);
  const foreignScript = /[\u4e00-\u9fff\u3040-\u30ff]/.test(text);
  return { text: text.replace(/[ \t]{2,}/g, ' ').trim(), cited: [...cited].sort((a, b) => a - b), removedCitations, falseSearchClaim, removedUrls, foreignScript, removedPromises };
}
