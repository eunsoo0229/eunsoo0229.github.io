import type { Technique } from '../../types';
import { isTechniqueInArt } from '../techniqueCanonical';
import { findNormalizedDuplicate } from '../userTechniques/service';
import type { UserTechniqueRecord } from '../userTechniques/types';
import { createCategory, deleteCategory, findPickerNode } from './service';
import type { CustomCategory, NewCategoryInput } from './types';

// Saving a new technique with its chosen category, as one operation:
//   1. a category must be chosen (or a new one drafted)
//   2. last duplicate check — the same technique must not exist in this art (names re-checked after edits)
//   3. a drafted category is created (validated + duplicate-checked again)
//   4. the technique is filed: `category` = the chosen node's art category string, `taxonomyNodeId` = the node
//   5. registration fails → the category made in step 3 is removed again (rollback)

export interface RegistrationChoice {
  nodeId: string | null;
  draft: NewCategoryInput | null;
  tags: string[];
  edits?: { name?: string; koreanName?: string; description?: string; difficulty?: Technique['difficulty'] };
}

export type RegisterFn = (record: UserTechniqueRecord, userId: string | null) => Promise<{ id: string; techniqueName: string; technique: Technique }>;

export type RegistrationResult =
  | { ok: true; saved: { id: string; techniqueName: string; technique: Technique }; createdCategory: CustomCategory | null; warning?: string }
  | { ok: false; message: string; duplicateOf?: Technique; rolledBack?: boolean };

export async function registerWithCategory(record: UserTechniqueRecord, choice: RegistrationChoice, userId: string | null, register: RegisterFn): Promise<RegistrationResult> {
  const art = record.technique.martialArt;
  if (!choice.nodeId && !choice.draft) return { ok: false, message: '카테고리를 선택해 주세요.' };
  if (choice.draft && choice.draft.art !== art) return { ok: false, message: '다른 무술의 카테고리는 선택할 수 없습니다.' };
  const node = choice.nodeId ? findPickerNode(art, choice.nodeId) : undefined;
  if (choice.nodeId && !node) return { ok: false, message: '선택한 카테고리를 이 무술에서 찾을 수 없습니다.' };

  const edits = choice.edits ?? {};
  const name = (edits.name ?? record.technique.name).trim() || record.technique.name;
  const koreanName = (edits.koreanName ?? record.technique.koreanName ?? '').trim() || null;
  for (const n of [name, koreanName].filter((x): x is string => !!x)) {
    const dup = findNormalizedDuplicate(n);
    if (dup && isTechniqueInArt(dup, art)) return { ok: false, message: `"${dup.koreanName || dup.name}"이(가) 이미 이 무술에 있습니다. 같은 기술을 다시 등록하지 않습니다.`, duplicateOf: dup };
  }

  let created: CustomCategory | null = null;
  let warning: string | undefined;
  if (choice.draft) {
    const r = await createCategory(choice.draft, userId);
    if (!r.ok) return { ok: false, message: r.message };
    created = r.value;
    warning = r.warning;
  }
  const categoryString = created ? created.categoryString ?? node?.categoryString ?? record.technique.category : node!.categoryString || record.technique.category;
  const nodeId = created?.id ?? node!.id;
  const technique: Technique = {
    ...record.technique,
    name,
    koreanName,
    description: edits.description?.trim() || record.technique.description,
    difficulty: edits.difficulty !== undefined ? edits.difficulty : record.technique.difficulty,
    category: categoryString,
    taxonomyNodeId: nodeId,
    taxonomyTags: [...new Set(choice.tags)],
  };
  try {
    const saved = await register({ ...record, technique, updatedAt: new Date().toISOString() }, userId);
    return { ok: true, saved, createdCategory: created, warning };
  } catch (e) {
    let rolledBack = false;
    if (created) rolledBack = (await deleteCategory(created.id, userId, { rollback: true })).ok;
    return { ok: false, message: `기술을 저장하지 못했습니다: ${String((e as Error)?.message ?? e)}${created ? (rolledBack ? ' (새로 만든 카테고리도 되돌렸습니다)' : ' (새로 만든 카테고리는 되돌리지 못했습니다 — 관리 화면에서 확인해 주세요)') : ''}`, rolledBack };
  }
}
