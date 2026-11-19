-- 무술 추가 기능 제거 + 우슈(wushu)·택견(taekkyon) 정리.
-- The app now uses only the managed official arts (data/processed/*.json);
-- the user-added art registry (0031 custom_martial_arts) is closed.
--
-- Run supabase/maintenance/0048_survey_retired_arts.sql first and keep its
-- output. Restore: supabase/maintenance/0048_restore_retired_arts.sql.
--
-- What this does:
--   1. archives every affected shared row, whole, into retired_records_archive;
--   2. closes inserts into custom_martial_arts (old app builds can no longer add an art);
--   3. deletes the two arts' shared registry rows and their shared add_teq techniques,
--      EXCEPT a technique some other art's add_teq row still refers to.
-- What this never touches: personal data (user_techniques, training_history,
-- curricula, combos, technique_video_picks, …), shared combos, posts, reports.
-- Those keep their ids; the app simply no longer lists the two arts.

begin;

create table if not exists public.retired_records_archive (
  id bigserial primary key,
  source_table text not null,
  record_id text not null,
  row_data jsonb not null,
  reason text not null,
  archived_at timestamptz not null default now()
);
-- Admin-only: RLS on with no policy, nothing granted to clients.
alter table public.retired_records_archive enable row level security;
revoke all on public.retired_records_archive from anon, authenticated;

-- techniques of the two arts that another art's shared row still points at — kept
create temporary table retire_keep on commit drop as
select t.id
from public.add_teq t
where t.martial_art in ('wushu', 'taekkyon')
  and exists (
    select 1 from public.add_teq o
    where o.martial_art not in ('wushu', 'taekkyon')
      and o.data::text like '%"' || t.id || '"%'
  );

insert into public.retired_records_archive (source_table, record_id, row_data, reason)
select 'custom_martial_arts', c.id, to_jsonb(c), '0048 무술 추가 기능 제거'
from public.custom_martial_arts c
where not exists (select 1 from public.retired_records_archive r where r.source_table = 'custom_martial_arts' and r.record_id = c.id);

insert into public.retired_records_archive (source_table, record_id, row_data, reason)
select 'add_teq', t.id, to_jsonb(t), '0048 우슈·택견 삭제'
from public.add_teq t
where t.martial_art in ('wushu', 'taekkyon')
  and t.id not in (select id from retire_keep)
  and not exists (select 1 from public.retired_records_archive r where r.source_table = 'add_teq' and r.record_id = t.id);

drop policy if exists "custom_martial_arts_insert_authenticated" on public.custom_martial_arts;
revoke insert on public.custom_martial_arts from authenticated;

delete from public.add_teq
where martial_art in ('wushu', 'taekkyon')
  and id not in (select id from retire_keep);

-- every registry row (today: wushu, taekkyon) — the feature that created them is gone
delete from public.custom_martial_arts c
where exists (select 1 from public.retired_records_archive r where r.source_table = 'custom_martial_arts' and r.record_id = c.id);

commit;
