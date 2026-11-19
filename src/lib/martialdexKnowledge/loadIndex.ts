// Loads the network-backed knowledge sources (사용자 콤보·셋업 + 연결, public read)
// with a time limit, then builds the index. If they can't be loaded the index
// still has the technique DB and the user's combo book, and says so in `sources`.

import { comboRepository } from '../combo/repository';
import { listSharedCombos } from '../sharedCombo/service';
import { listAllLinks } from '../sharedCombo/links';
import { buildKnowledgeIndex } from './index';
import type { KnowledgeIndex } from './types';

const LOAD_TIMEOUT_MS = 6000;
const CACHE_MS = 10 * 60 * 1000;
let cached: { at: number; index: KnowledgeIndex } | null = null;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export async function loadKnowledgeIndex(opts: { fresh?: boolean } = {}): Promise<KnowledgeIndex> {
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.index;
  const [shared, links] = await Promise.all([
    withTimeout(listSharedCombos(null), LOAD_TIMEOUT_MS).catch(() => null),
    withTimeout(listAllLinks(), LOAD_TIMEOUT_MS).catch(() => null),
  ]);
  const index = buildKnowledgeIndex({
    sharedCombos: shared && shared.ok ? shared.data : null,
    sharedComboError: shared ? (shared.ok ? undefined : shared.message) : '사용자 콤보·셋업 응답 시간 초과',
    comboLinks: links && links.ok ? links.data : null,
    myCombos: comboRepository.list(),
  });
  // Only cache a complete index, so a temporary network failure is retried next time.
  if (index.sources.every((s) => s.ok)) cached = { at: Date.now(), index };
  return index;
}
