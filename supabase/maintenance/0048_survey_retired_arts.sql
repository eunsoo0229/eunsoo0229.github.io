-- READ-ONLY survey to run (SQL editor, as admin) BEFORE applying
-- 0048_retire_custom_martial_arts.sql. Nothing here writes.
-- 우슈(wushu)·택견(taekkyon) were added through the removed "무술 추가"
-- feature. This lists every place that refers to them so the migration's
-- result can be checked against it.

-- 1) Shared registry rows (deleted by 0048 after archiving).
select id, name_ko, name_en, added_by, created_at from public.custom_martial_arts order by created_at;

-- 2) Shared technique rows filed under the two arts (deleted by 0048 after archiving).
select martial_art, count(*) from public.add_teq where martial_art in ('wushu', 'taekkyon') group by martial_art;

-- 3) Shared rows of OTHER arts that point at those techniques (link records / relations).
--    0048 keeps any wushu/taekkyon technique that appears here. Expected: 0 rows
--    (audit snapshot data/audit/add-teq-snapshot.json, 2026-10-03, had none).
select a.id, a.martial_art
from public.add_teq a
where a.martial_art not in ('wushu', 'taekkyon')
  and (a.data::text ~ '"(wushu|taekkyon)__');

-- 4) Shared content that mentions those techniques (kept; listed for review).
select id, martial_art, technique_ids from public.shared_combos
where martial_art in ('wushu', 'taekkyon') or exists (select 1 from unnest(technique_ids) t where t ~ '^(wushu|taekkyon)__');
select id, tags from public.community_posts where tags::text ~ '"(wushu|taekkyon)';
select technique_id, count(*) from public.technique_reports where technique_id ~ '^(wushu|taekkyon)__' group by technique_id;

-- 5) PERSONAL data (never deleted by 0048 — counts only, per user).
select 'user_techniques' as tbl, count(*) as rows, count(distinct user_id) as users from public.user_techniques where martial_art in ('wushu', 'taekkyon')
union all
select 'technique_video_picks', count(*), count(distinct user_id) from public.technique_video_picks where technique_id ~ '^(wushu|taekkyon)__'
union all
select 'curricula', count(*), count(distinct user_id) from public.curricula where martial_art in ('wushu', 'taekkyon') or data::text ~ '"(wushu|taekkyon)__'
union all
select 'training_history', count(*), count(distinct user_id) from public.training_history where data::text ~ '"(wushu|taekkyon)__'
union all
select 'combos', count(*), count(distinct user_id) from public.combos where data::text ~ '"(wushu|taekkyon)__';
