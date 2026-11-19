import { supabase } from '../supabase/client';
import type { SocialPeriod, SocialTrendingItem, SocialTrendingResult } from '../selfAi/exclusiveTurn';

/**
 * "이번 주 하트 가장 많은 콤보·셋업·게시물" — MARTIALDEX's own tables (§16).
 *
 * The count is hearts RECEIVED IN THE PERIOD, not the lifetime `like_count`
 * column: §16-2 asks for those to be distinguished, and "이번 주 하트 많은" means
 * the former. Both like tables carry created_at, so the period filter is applied
 * to the like rows and the totals are grouped here — PostgREST has no GROUP BY.
 *
 * A failed lookup and an empty period are different results (§16-2); the caller
 * must never replace either with a web search.
 */

const LIKE_SCAN_LIMIT = 2000;

function periodStart(period: SocialPeriod, now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'today') return d;
  if (period === 'week') {
    // 월요일 시작 (한국 주 단위)
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return d;
  }
  if (period === 'month') {
    d.setDate(1);
    return d;
  }
  d.setDate(d.getDate() - 30);
  return d;
}

function topBy<T>(rows: T[], key: (r: T) => string, limit: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return new Map([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit));
}

export async function socialTrending(period: SocialPeriod, limitPerKind = 5): Promise<SocialTrendingResult> {
  if (!supabase) return { ok: false, reason: 'Supabase 설정 없음', items: [] };
  const since = periodStart(period).toISOString();

  try {
    const [postLikes, comboLikes] = await Promise.all([
      supabase.from('community_post_likes').select('post_id, created_at').gte('created_at', since).limit(LIKE_SCAN_LIMIT),
      supabase.from('shared_combo_likes').select('combo_id, created_at').gte('created_at', since).limit(LIKE_SCAN_LIMIT),
    ]);
    if (postLikes.error) return { ok: false, reason: postLikes.error.message, items: [] };
    if (comboLikes.error) return { ok: false, reason: comboLikes.error.message, items: [] };

    const postTop = topBy(postLikes.data ?? [], (r) => r.post_id as string, limitPerKind);
    const comboTop = topBy(comboLikes.data ?? [], (r) => r.combo_id as string, limitPerKind * 2);

    const items: SocialTrendingItem[] = [];

    if (postTop.size > 0) {
      // RLS still applies: a post this viewer may not read simply does not come back.
      const { data } = await supabase
        .from('community_posts')
        .select('id, content, author_nickname, created_at')
        .in('id', [...postTop.keys()]);
      for (const p of data ?? []) {
        items.push({
          kind: 'post',
          id: p.id as string,
          title: ((p.content as string) || '').trim().slice(0, 60) || '(사진·영상 게시물)',
          author: (p.author_nickname as string) ?? '알 수 없음',
          hearts: postTop.get(p.id as string) ?? 0,
          createdAt: p.created_at as string,
        });
      }
    }

    if (comboTop.size > 0) {
      const { data } = await supabase
        .from('shared_combos')
        .select('id, name, kind, author_nickname, created_at')
        .in('id', [...comboTop.keys()]);
      for (const c of data ?? []) {
        items.push({
          kind: c.kind === 'setup' ? 'setup' : 'combo',
          id: c.id as string,
          title: (c.name as string) ?? '(이름 없음)',
          author: (c.author_nickname as string) ?? '알 수 없음',
          hearts: comboTop.get(c.id as string) ?? 0,
          createdAt: c.created_at as string,
        });
      }
    }

    items.sort((a, b) => b.hearts - a.hearts);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : '알 수 없는 오류', items: [] };
  }
}
