-- Restores what 0048_retire_custom_martial_arts.sql removed, from
-- public.retired_records_archive. Run as admin. The app build that removed
-- the feature will still not LIST the arts; restoring brings the data back
-- for an older build or for a later decision to re-add them as official arts.

begin;

insert into public.custom_martial_arts
select (jsonb_populate_record(null::public.custom_martial_arts, r.row_data)).*
from public.retired_records_archive r
where r.source_table = 'custom_martial_arts'
on conflict (id) do nothing;

insert into public.add_teq
select (jsonb_populate_record(null::public.add_teq, r.row_data)).*
from public.retired_records_archive r
where r.source_table = 'add_teq'
on conflict (id) do nothing;

-- Re-open adding arts only if the 무술 추가 feature itself is brought back:
-- create policy "custom_martial_arts_insert_authenticated" on public.custom_martial_arts
--   for insert to authenticated with check (auth.uid() is not null);
-- grant insert on public.custom_martial_arts to authenticated;

commit;
