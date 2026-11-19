-- DM · 클랜 채팅에서 게시물 / 콤보·셋업 / 기술 / 커리큘럼을 공유한다.
--
-- 첨부는 "참조 + 표시용 스냅샷"이지 콘텐츠 복사본이 아니다. 받는 쪽이 눌렀을 때
-- 실제 열람 가능 여부는 원본 테이블의 RLS가 다시 판정한다 — 스냅샷에 제목이
-- 담겨 있다고 해서 원본을 볼 수 있는 것은 아니다. 0026의 curriculum_snapshot이
-- 쓰는 방식과 같다.
--
-- kind 별로 담기는 것:
--   post        {kind,id,title}                     → community_posts.id. 가시성은 0045 정책이 판정.
--   combo       {kind,id,name,comboKind,martialArt} → shared_combos.id (공개 읽기).
--   technique   {kind,id,name,martialArt}           → data/processed/*.json 의 정적 기술. DB 아님.
--   curriculum  {kind,title,martialArt,totalDays,techniqueCount,shareCode}
--               curricula 는 본인 행만 읽을 수 있어(0002) id를 줘도 상대는 못 연다.
--               그래서 앱이 이미 쓰는 공유코드(lib/curriculum/shareCode.ts)를 싣고,
--               받는 쪽은 "내 커리큘럼으로 가져오기"로 복사한다.

alter table public.messages
  add column if not exists attachment jsonb;
alter table public.clan_messages
  add column if not exists attachment jsonb;

-- 모양과 크기만 DB에서 강제한다. 공유코드가 들어가는 커리큘럼이 가장 크므로
-- 그 쪽에 맞춰 넉넉히 잡되, 채팅 행이 무한정 커지지 않게 상한을 둔다.
do $$ begin
  alter table public.messages add constraint messages_attachment_shape check (
    attachment is null or (
      jsonb_typeof(attachment) = 'object'
      and attachment ->> 'kind' in ('post', 'combo', 'technique', 'curriculum')
      and pg_column_size(attachment) < 262144
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.clan_messages add constraint clan_messages_attachment_shape check (
    attachment is null or (
      jsonb_typeof(attachment) = 'object'
      and attachment ->> 'kind' in ('post', 'combo', 'technique', 'curriculum')
      and pg_column_size(attachment) < 262144
    )
  );
exception when duplicate_object then null; end $$;

-- 본문이 비어도 첨부만 보내는 것은 허용해야 하므로 미리보기 문구를 보정한다.
-- (0046의 on_message_insert 를 대체한다 — 첨부 종류를 미리보기에 반영)
create or replace function public.on_message_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  other uuid;
  preview text;
begin
  preview := nullif(new.body, '');
  if preview is null and new.attachment is not null then
    preview := case new.attachment ->> 'kind'
                 when 'post' then '게시물을 공유했습니다'
                 when 'combo' then '콤보·셋업을 공유했습니다'
                 when 'technique' then '기술을 공유했습니다'
                 when 'curriculum' then '커리큘럼을 공유했습니다'
                 else '첨부를 보냈습니다'
               end;
  end if;
  if preview is null and new.image_url is not null then
    preview := '사진';
  end if;

  update public.conversations
     set last_message_at = new.created_at,
         last_message_preview = left(coalesce(preview, ''), 120)
   where id = new.conversation_id;

  other := public.conversation_other_member(new.conversation_id, new.sender_id);
  if other is not null and not exists (
    select 1 from public.conversation_members
    where conversation_id = new.conversation_id and user_id = other and muted
  ) then
    perform public.notify(other, 'message', new.sender_id, 'conversation', new.conversation_id::text, left(coalesce(preview, ''), 120));
  end if;
  return new;
end;
$$;
