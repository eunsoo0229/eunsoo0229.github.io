-- 공유(종이비행기) — DM·클랜 채팅 첨부 종류 확장.
--   gym    : gym_listings.id (0058) — 받는 사람이 열면 RLS 가 다시 판단(승인된 체육관만 공개)
--   market : marketplace 커리큘럼 판매 글 id — 받는 사람이 열면 마켓 상세 화면이 다시 읽는다
--   gear   : 0057 에서 DM 에만 추가됐던 것을 클랜 채팅에도 허용
-- 첨부는 "참조 + 표시용 스냅샷"일 뿐 권한을 주지 않는다(0050 과 같은 원칙). 모양·크기 제한은 그대로.

alter table public.messages drop constraint if exists messages_attachment_shape;
alter table public.messages add constraint messages_attachment_shape check (
  attachment is null or (
    jsonb_typeof(attachment) = 'object'
    and attachment ->> 'kind' in ('post', 'combo', 'technique', 'curriculum', 'gear', 'gym', 'market')
    and pg_column_size(attachment) < 262144
  )
);

alter table public.clan_messages drop constraint if exists clan_messages_attachment_shape;
alter table public.clan_messages add constraint clan_messages_attachment_shape check (
  attachment is null or (
    jsonb_typeof(attachment) = 'object'
    and attachment ->> 'kind' in ('post', 'combo', 'technique', 'curriculum', 'gear', 'gym', 'market')
    and pg_column_size(attachment) < 262144
  )
);

-- 0050 의 on_message_insert 와 동일하고, 새 첨부 종류의 미리보기 문구만 추가한다.
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
                 when 'gear' then '장비 상품을 공유했습니다'
                 when 'gym' then '체육관을 공유했습니다'
                 when 'market' then '마켓 커리큘럼을 공유했습니다'
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
