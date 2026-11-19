// 소셜 RLS 실동작 검증 (0045/0046/0047). 계정 2개로 "공격"을 시도해서
// 서버가 막는지 본다 — 버튼을 숨기는 것이 아니라 DB가 거부하는지가 핵심.
//
// 운영 프로젝트에 계정을 만드는 스크립트이므로 prodGuard를 통과해야 한다:
//   MARTIALDEX_QA_ALLOW_PROD=<ref>:qa-social-rls node .devtools/qa-social-rls.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { requireAccountQaTarget, supabaseTarget } from './lib/prodGuard.mjs';

requireAccountQaTarget('qa-social-rls');

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const env = fs.readFileSync(path.join(APP, '.env'), 'utf8');
const pick = (k) => (env.match(new RegExp(`^\\s*${k}\\s*=\\s*["']?([^"'\\s#]+)`, 'm')) || [])[1];
const URL_ = supabaseTarget().url || pick('VITE_SUPABASE_URL');
const KEY = pick('VITE_SUPABASE_PUBLISHABLE_KEY');

const mk = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now();
const acct = (n) => ({ email: `qa-social-${n}-${stamp}@martialdex-test.local`, password: `Qa!social-${stamp}-${n}` });

let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}
// "막혀야 정상"인 호출: 에러이거나 0행이면 통과
const blocked = (res) => !!res.error || (Array.isArray(res.data) && res.data.length === 0) || res.data === null;

async function signUp(c, a) {
  const { data, error } = await c.auth.signUp(a);
  if (error) throw new Error('signUp: ' + error.message);
  if (!data.session) throw new Error('세션 없음 — 이 프로젝트는 이메일 확인이 켜져 있어 자동 테스트 불가');
  return data.user.id;
}

const A = mk(), B = mk();
const aAcct = acct('a'), bAcct = acct('b');
let aId, bId, clanId, convId;

try {
  console.log(`\n대상 프로젝트: ${supabaseTarget().ref}\n`);
  aId = await signUp(A, aAcct);
  bId = await signUp(B, bAcct);
  console.log(`계정 생성: A=${aId.slice(0, 8)}  B=${bId.slice(0, 8)}\n`);
  await A.from('profiles').update({ nickname: 'QA소셜A' }).eq('user_id', aId);
  await B.from('profiles').update({ nickname: 'QA소셜B' }).eq('user_id', bId);

  console.log('[1] 공개 프로필 / 팔로우');
  check('B가 A의 공개 프로필을 읽는다', !!(await B.from('profiles').select('nickname').eq('user_id', aId).maybeSingle()).data);
  check('B가 A를 팔로우한다', !(await B.from('follows').insert({ follower_id: bId, following_id: aId })).error);
  const fc = await B.from('profiles').select('follower_count').eq('user_id', aId).maybeSingle();
  check('A의 follower_count가 트리거로 1이 된다', fc.data?.follower_count === 1, `값=${fc.data?.follower_count}`);
  check('B가 남의 이름으로 팔로우할 수 없다(위조)', blocked(await B.from('follows').insert({ follower_id: aId, following_id: bId })));
  await B.from('follows').delete().eq('follower_id', bId).eq('following_id', aId);

  console.log('\n[2] 비공개 계정');
  await A.from('profiles').update({ is_private: true }).eq('user_id', aId);
  check('비공개 계정은 직접 팔로우가 거부된다', blocked(await B.from('follows').insert({ follower_id: bId, following_id: aId })));
  check('대신 팔로우 요청은 만들어진다', !(await B.from('follow_requests').insert({ requester_id: bId, target_id: aId })).error);
  check('B가 스스로 요청을 승인할 수 없다', !!(await B.rpc('approve_follow_request', { p_requester: bId })).error);
  check('A가 요청을 승인한다(RPC)', !(await A.rpc('approve_follow_request', { p_requester: bId })).error);
  const after = await B.from('follows').select('follower_id').eq('follower_id', bId).eq('following_id', aId).maybeSingle();
  check('승인 후 팔로우 관계가 생긴다', !!after.data);

  console.log('\n[3] 게시물 공개범위');
  const pid = `qa-post-${stamp}`;
  await A.from('community_posts').insert({ id: pid, author_id: aId, author_nickname: 'QA소셜A', content: 'followers only', post_type: 'text', visibility: 'followers' });
  check('팔로워는 followers 게시물을 본다', !!(await B.from('community_posts').select('id').eq('id', pid).maybeSingle()).data);
  await B.from('follows').delete().eq('follower_id', bId).eq('following_id', aId);
  check('언팔로우하면 안 보인다', blocked(await B.from('community_posts').select('id').eq('id', pid).maybeSingle()));
  const anon = mk();
  check('비로그인도 못 본다', blocked(await anon.from('community_posts').select('id').eq('id', pid).maybeSingle()));
  await A.from('community_posts').delete().eq('id', pid);
  await A.from('profiles').update({ is_private: false }).eq('user_id', aId);

  console.log('\n[4] DM');
  const conv = await B.rpc('start_conversation', { p_other: aId });
  convId = conv.data;
  check('B가 A와 대화를 시작한다(RPC)', !!convId, conv.error?.message ?? '');
  check('B가 메시지를 보낸다', !(await B.from('messages').insert({ conversation_id: convId, sender_id: bId, body: 'hello' })).error);
  check('A가 그 메시지를 읽는다', ((await A.from('messages').select('body').eq('conversation_id', convId)).data ?? []).length === 1);
  check('발신자 id 위조가 거부된다', blocked(await B.from('messages').insert({ conversation_id: convId, sender_id: aId, body: 'forged' })));
  check('비참여자(비로그인)는 메시지를 못 읽는다', blocked(await anon.from('messages').select('id').eq('conversation_id', convId)));

  console.log('\n[5] 차단 · DM 수신 설정');
  await A.from('user_blocks').insert({ blocker_id: aId, blocked_id: bId });
  check('차단된 상대는 메시지를 못 보낸다', blocked(await B.from('messages').insert({ conversation_id: convId, sender_id: bId, body: 'blocked?' })));
  check('차단된 상대는 팔로우도 못 한다', blocked(await B.from('follows').insert({ follower_id: bId, following_id: aId })));
  await A.from('user_blocks').delete().eq('blocker_id', aId).eq('blocked_id', bId);
  await A.from('profiles').update({ dm_policy: 'nobody' }).eq('user_id', aId);
  check("dm_policy='nobody'면 새 대화가 거부된다", !!(await B.rpc('start_conversation', { p_other: aId })).error);
  await A.from('profiles').update({ dm_policy: 'everyone' }).eq('user_id', aId);

  console.log('\n[6] 클랜 · 권한 상승 시도');
  const made = await A.rpc('create_clan', { p_name: 'QA클랜', p_slug: `qa-clan-${stamp}`, p_description: '', p_primary_art: null, p_join_policy: 'open', p_is_public: true, p_rules: '' });
  clanId = made.data;
  check('A가 클랜을 만든다(RPC)', !!clanId, made.error?.message ?? '');
  check('비회원 B는 클랜 채팅을 못 읽는다', blocked(await B.from('clan_messages').select('id').eq('clan_id', clanId)));
  check('B가 owner로 가입하려는 시도가 거부된다', blocked(await B.from('clan_members').insert({ clan_id: clanId, user_id: bId, role: 'owner' })));
  check('B가 member로 가입한다', !(await B.from('clan_members').insert({ clan_id: clanId, user_id: bId, role: 'member' })).error);
  check('가입 후 채팅을 보낸다', !(await B.from('clan_messages').insert({ clan_id: clanId, sender_id: bId, body: 'hi clan' })).error);
  check('B가 스스로 직책을 올릴 수 없다(UPDATE 정책 없음)', blocked(await B.from('clan_members').update({ role: 'owner' }).eq('clan_id', clanId).eq('user_id', bId)));
  check('B가 set_clan_role RPC로도 못 올린다', !!(await B.rpc('set_clan_role', { p_clan: clanId, p_user: bId, p_role: 'officer' })).error);
  check('B가 방장 이전을 자기에게 못 건다', !!(await B.rpc('transfer_clan_ownership', { p_clan: clanId, p_to: bId })).error);
  await A.from('clan_members').delete().eq('clan_id', clanId).eq('user_id', bId);
  check('강퇴된 B는 채팅을 못 읽는다', blocked(await B.from('clan_messages').select('id').eq('clan_id', clanId)));
  check('강퇴된 B는 채팅을 못 쓴다', blocked(await B.from('clan_messages').insert({ clan_id: clanId, sender_id: bId, body: 'still here?' })));

  console.log('\n[6-2] 클랜 초대 (0051)');
  const inv = await A.rpc('create_clan', { p_name: 'QA초대클랜', p_slug: `qa-invite-${stamp}`, p_description: '', p_primary_art: null, p_join_policy: 'invite', p_is_public: true, p_rules: '' });
  const invClan = inv.data;
  check('초대 전용 클랜 생성', !!invClan, inv.error?.message ?? '');
  check('초대 전용 클랜은 직접 가입이 거부된다', blocked(await B.from('clan_members').insert({ clan_id: invClan, user_id: bId, role: 'member' })));
  check('초대 없이 수락 RPC를 쓸 수 없다', !!(await B.rpc('accept_clan_invitation', { p_clan: invClan })).error);
  check('비관리자 B는 초대를 보낼 수 없다', blocked(await B.from('clan_invitations').insert({ clan_id: invClan, invitee_id: aId, inviter_id: bId })));
  check('A(방장)가 B를 초대한다', !(await A.from('clan_invitations').insert({ clan_id: invClan, invitee_id: bId, inviter_id: aId })).error);
  check('초대자 id 위조가 거부된다', blocked(await B.from('clan_invitations').insert({ clan_id: invClan, invitee_id: aId, inviter_id: aId })));
  check('B가 자기 초대를 읽는다', ((await B.from('clan_invitations').select('clan_id').eq('clan_id', invClan)).data ?? []).length === 1);
  check('B가 초대를 수락한다', !(await B.rpc('accept_clan_invitation', { p_clan: invClan })).error);
  check('수락 후 클랜원이 된다', ((await B.from('clan_members').select('user_id').eq('clan_id', invClan).eq('user_id', bId)).data ?? []).length === 1);
  check('수락 후 초대 행은 사라진다', ((await B.from('clan_invitations').select('clan_id').eq('clan_id', invClan)).data ?? []).length === 0);
  check('이미 클랜원인 사람은 다시 초대할 수 없다', blocked(await A.from('clan_invitations').insert({ clan_id: invClan, invitee_id: bId, inviter_id: aId })));
  await A.from('clan_members').delete().eq('clan_id', invClan).eq('user_id', bId);
  await A.from('clans').delete().eq('id', invClan);

  console.log('\n[7] 채팅 첨부 (0050)');
  const conv2 = (await B.rpc('start_conversation', { p_other: aId })).data;
  const att = { kind: 'technique', id: 'boxing__jab', name: 'Jab', martialArt: 'boxing' };
  const sent = await B.from('messages').insert({ conversation_id: conv2, sender_id: bId, body: '', attachment: att });
  check('본문 없이 첨부만 보낼 수 있다', !sent.error, sent.error?.message ?? '');
  const got = (await A.from('messages').select('attachment').eq('conversation_id', conv2)).data ?? [];
  check('상대가 첨부를 읽는다', got.some((m) => m.attachment?.kind === 'technique'));
  const preview = (await A.from('conversations').select('last_message_preview').eq('id', conv2).maybeSingle()).data;
  check('첨부만 보내도 미리보기가 생긴다', !!preview?.last_message_preview, `"${preview?.last_message_preview}"`);
  check('알 수 없는 kind는 거부된다', blocked(await B.from('messages').insert({ conversation_id: conv2, sender_id: bId, body: '', attachment: { kind: 'evil', id: 'x' } })));
  check('첨부가 객체가 아니면 거부된다', blocked(await B.from('messages').insert({ conversation_id: conv2, sender_id: bId, body: '', attachment: 'not-an-object' })));
  await B.from('messages').delete().eq('conversation_id', conv2);
  await B.from('conversation_members').delete().eq('conversation_id', conv2).eq('user_id', bId);
  await A.from('conversation_members').delete().eq('conversation_id', conv2).eq('user_id', aId);

  console.log('\n[7-2] 상호작용 알림 (0052)');
  const npid = `qa-npost-${stamp}`;
  await A.from('community_posts').insert({ id: npid, author_id: aId, author_nickname: 'QA소셜A', content: 'notify me', post_type: 'text', visibility: 'public' });
  const notifsOf = async (type, entity) =>
    ((await A.from('notifications').select('type, entity_type, entity_id').eq('user_id', aId).eq('type', type)).data ?? [])
      .filter((n) => !entity || n.entity_type === entity);

  await B.from('community_post_likes').insert({ post_id: npid, user_id: bId });
  check('게시물 좋아요 → 작성자에게 알림', (await notifsOf('like', 'post')).some((n) => n.entity_id === npid));

  await B.from('community_post_comments').insert({ id: `qa-c-${stamp}`, post_id: npid, author_id: bId, author_nickname: 'QA소셜B', content: 'nice' });
  check('댓글 → 작성자에게 알림', (await notifsOf('comment', 'post')).some((n) => n.entity_id === npid));

  await B.from('community_post_reposts').insert({ id: `qa-r-${stamp}`, user_id: bId, reposter_nickname: 'QA소셜B', original_post_id: npid, original_author_nickname: 'QA소셜A', original_content_snippet: 'notify me' });
  check('리포스트 → 원작자에게 알림', (await notifsOf('repost', 'post')).some((n) => n.entity_id === npid));

  // 자기 글에 자기가 누른 좋아요는 알림이 생기지 않아야 한다
  const beforeSelf = (await notifsOf('like', 'post')).length;
  const spid = `qa-self-${stamp}`;
  await A.from('community_posts').insert({ id: spid, author_id: aId, author_nickname: 'QA소셜A', content: 'self', post_type: 'text', visibility: 'public' });
  await A.from('community_post_likes').insert({ post_id: spid, user_id: aId });
  check('자기 게시물 좋아요는 알림이 안 생긴다', (await notifsOf('like', 'post')).length === beforeSelf);

  // 차단한 상대의 행동은 알림으로 오지 않는다
  await A.from('user_blocks').insert({ blocker_id: aId, blocked_id: bId });
  const beforeBlocked = (await notifsOf('like', 'post')).length;
  await B.from('community_post_likes').insert({ post_id: spid, user_id: bId });
  check('차단한 상대의 좋아요는 알림이 안 온다', (await notifsOf('like', 'post')).length === beforeBlocked);
  await A.from('user_blocks').delete().eq('blocker_id', aId).eq('blocked_id', bId);

  // 콤보 좋아요
  const cid = `qa-combo-${stamp}`;
  const madeCombo = await A.from('shared_combos').insert({ id: cid, author_id: aId, author_nickname: 'QA소셜A', kind: 'combo', name: 'QA콤보', purpose: '테스트', steps: [{ techniqueId: 'boxing__jab', name: 'Jab' }] });
  if (!madeCombo.error) {
    await B.from('shared_combo_likes').insert({ combo_id: cid, user_id: bId });
    check('콤보·셋업 좋아요 → 작성자에게 알림', (await notifsOf('like', 'combo')).some((n) => n.entity_id === cid));
    await B.from('shared_combo_likes').delete().eq('combo_id', cid);
    await A.from('shared_combos').delete().eq('id', cid);
  } else {
    check('콤보·셋업 좋아요 → 작성자에게 알림', false, '콤보 생성 실패: ' + madeCombo.error.message);
  }

  await B.from('community_post_reposts').delete().eq('user_id', bId);
  await B.from('community_post_comments').delete().eq('author_id', bId);
  await B.from('community_post_likes').delete().eq('user_id', bId);
  await A.from('community_post_likes').delete().eq('user_id', aId);
  await A.from('community_posts').delete().eq('id', npid);
  await A.from('community_posts').delete().eq('id', spid);

  console.log('\n[8] 알림');
  const notif = await A.from('notifications').select('type').eq('user_id', aId);
  check('A에게 팔로우/메시지 알림이 쌓였다', (notif.data ?? []).length > 0, `${(notif.data ?? []).length}건`);
  check('B는 A의 알림을 못 본다', ((await B.from('notifications').select('id').eq('user_id', aId)).data ?? []).length === 0);
} catch (e) {
  console.log('\n!! 중단:', e.message);
  fail++;
} finally {
  console.log('\n[정리]');
  try {
    if (clanId) { await A.from('clan_messages').delete().eq('clan_id', clanId); await A.from('clans').delete().eq('id', clanId); }
    await A.from('clan_invitations').delete().eq('inviter_id', aId);
    if (convId) { await B.from('messages').delete().eq('conversation_id', convId); await B.from('conversation_members').delete().eq('conversation_id', convId).eq('user_id', bId); await A.from('conversation_members').delete().eq('conversation_id', convId).eq('user_id', aId); }
    await B.from('follows').delete().eq('follower_id', bId);
    await A.from('follows').delete().eq('follower_id', aId);
    await B.from('follow_requests').delete().eq('requester_id', bId);
    await A.from('notifications').delete().eq('user_id', aId);
    await B.from('notifications').delete().eq('user_id', bId);
    await A.from('community_posts').delete().eq('author_id', aId);
    console.log('  데이터 행 정리 완료 (auth 계정 2개는 service_role 없이는 삭제 불가 — 보고서 참조)');
  } catch (e) { console.log('  정리 중 오류:', e.message); }
  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
  console.log(`생성된 계정: ${aAcct.email} , ${bAcct.email}`);
  process.exit(fail > 0 ? 1 : 0);
}
