// test-monetization-sql.mjs 의 2부 (0063·0064): 창작자·콘텐츠 마켓·수수료·환불·정산 시뮬레이션·
// 장비 마켓 수수료·분쟁·체육관 사업자 리포트·제휴·수익 분석. 단독 실행하지 않는다(1부가 import).
export async function run({ db, as, fails, one, bal, check, section, U }) {
  const ent = async (uid, f) => (await as(uid, `select public.has_entitlement($1, $2) x`, [uid, f]))[0].x;

  section('5. 창작자 등록·검수');
  check('창작자 프로필 없이 상품 등록 불가', (await fails(U.creator, `select * from public.save_creator_product('{"product_type":"course","title":"잽 마스터"}'::jsonb)`, [], /CREATOR_PROFILE_REQUIRED/)) === true);
  await as(U.creator, `select * from public.upsert_my_creator_profile($1::jsonb)`, [JSON.stringify({ display_name: '코치K', bio: '복싱 10년', specialties: ['boxing'], years_training: 10, credentials: [{ title: '생활체육지도자 2급', issuer: '문체부' }] })]);
  const cp0 = await one(`select * from public.creator_profiles where user_id = $1`, [U.creator]);
  check('신청 직후 status=pending, 검증 자격은 비어 있음(본인 입력과 분리)', cp0.status === 'pending' && cp0.verified_credentials.length === 0 && cp0.credentials.length === 1);
  check('본인이 status/검증 자격을 직접 못 바꿈', (await fails(U.creator, `update public.creator_profiles set status = 'approved', verified_credentials = '[{"title":"x"}]' where user_id = $1`, [U.creator])) === true
    && (await one(`select status from public.creator_profiles where user_id=$1`, [U.creator])).status === 'pending');
  check('승인 전 창작자 프로필은 다른 사용자에게 안 보임', (await as(U.buyer, `select count(*)::int n from public.creator_profiles where user_id = $1`, [U.creator]))[0].n === 0);
  check('창작자 검수: 관리자만', (await fails(U.buyer, `select * from public.admin_review_creator($1, 'approved')`, [U.creator], /FORBIDDEN/)) === true);
  await as(U.op, `select * from public.admin_review_creator($1, 'approved', '경력 확인', null, '[{"title":"생활체육지도자 2급","verified":true}]'::jsonb)`, [U.creator]);
  check('승인 후 공개 + 관리자 검증 자격 표시', (await as(null, `select status, jsonb_array_length(verified_credentials) v from public.creator_profiles where user_id = $1`, [U.creator]))[0]?.v === 1);

  section('6. 콘텐츠 등록·검수·노출');
  const content = { sections: [{ title: '1강 · 잽 기본', text: '전체 본문 — 구매자만', technique_ids: ['boxing__jab'] }] };
  const [p1] = await as(U.creator, `select * from public.save_creator_product($1::jsonb)`, [JSON.stringify({ product_type: 'course', title: '잽 마스터 코스', summary: '잽 4주', price_coins: 1000, martial_art: 'boxing', difficulty: 'beginner', est_minutes: 120, outline: ['잽 기본', '잽 응용'], preview: { text: '맛보기' }, technique_ids: ['boxing__jab'], content })]);
  check('상품 초안 생성 (draft)', p1.status === 'draft' && p1.price_coins === 1000);
  check('저작권 확인 없이 검수 요청 불가', (await fails(U.creator, `select * from public.submit_product_for_review($1)`, [p1.id], /RIGHTS_NOT_CONFIRMED/)) === true);
  await as(U.creator, `select * from public.save_creator_product($1::jsonb)`, [JSON.stringify({ id: p1.id, rights_confirmed: true })]);
  await as(U.creator, `select * from public.submit_product_for_review($1)`, [p1.id]);
  check('검수 대기 상품은 마켓에 안 보임', (await as(U.buyer, `select count(*)::int n from public.creator_products where id = $1`, [p1.id]))[0].n === 0);
  check('검수 대기 상품 구매 불가', (await fails(U.buyer, `select * from public.purchase_product($1)`, [p1.id], /PRODUCT_UNAVAILABLE/)) === true);
  check('남의 상품 수정 불가', (await fails(U.other, `select * from public.save_creator_product($1::jsonb)`, [JSON.stringify({ id: p1.id, price_coins: 1 })], /NOT_YOUR_PRODUCT|CREATOR_PROFILE_REQUIRED/)) === true);
  await as(U.op, `select * from public.admin_review_product($1, 'approved', 'ok')`, [p1.id]);
  check('승인 후 마켓 노출 (비로그인 포함)', (await as(null, `select count(*)::int n from public.creator_products where id = $1`, [p1.id]))[0].n === 1);
  check('구매 전: 본문 열람 불가 / 미리보기는 상품 행에서 가능', (await as(U.buyer, `select count(*)::int n from public.creator_product_content where product_id = $1`, [p1.id]))[0].n === 0
    && (await as(U.buyer, `select preview->>'text' t from public.creator_products where id = $1`, [p1.id]))[0].t === '맛보기');

  section('7. 코인 구매 → 수수료·창작자 몫');
  await as('service', `select public.post_ledger($1, 'event_reward', 3000, 'test', 'seed', 'seed-buyer-3000')`, [U.buyer]);
  const b0 = await bal(U.buyer);
  const [pu] = await as(U.buyer, `select * from public.purchase_product($1)`, [p1.id]);
  check('구매: 1,000코인 차감, 수수료 15% = 150, 창작자 850', (await bal(U.buyer)) === b0 - 1000 && pu.platform_fee_coins === 150 && pu.creator_earning_coins === 850 && pu.commission_bp === 1500, pu);
  check('구매 후 본문 열람 가능', (await as(U.buyer, `select body->'sections'->0->>'text' t from public.creator_product_content where product_id = $1`, [p1.id]))[0]?.t === '전체 본문 — 구매자만');
  const [pu2] = await as(U.buyer, `select * from public.purchase_product($1)`, [p1.id]);
  check('중복 구매 요청 → 같은 구매 반환, 추가 차감 없음', pu2.id === pu.id && (await bal(U.buyer)) === b0 - 1000);
  check('창작자 수익: 보류(hold 7일) 850', (await one(`select status, amount_coins from public.creator_earnings where purchase_id = $1`, [pu.id])).amount_coins === 850);
  check('본인 상품 구매 불가', (await fails(U.creator, `select * from public.purchase_product($1)`, [p1.id], /OWN_PRODUCT/)) === true);
  check('잔액 부족 구매 거부 + 구매 기록 안 남음', (await fails(U.other, `select * from public.purchase_product($1)`, [p1.id], /INSUFFICIENT_COINS/)) === true
    && (await one(`select count(*)::int n from public.content_purchases where buyer_id = $1`, [U.other])).n === 0);
  check('다른 사용자는 남의 구매 내역 못 봄', (await as(U.other, `select count(*)::int n from public.content_purchases where buyer_id = $1`, [U.buyer]))[0].n === 0);
  check('창작자는 판매 내역을 봄', (await as(U.creator, `select count(*)::int n from public.content_purchases where creator_id = $1`, [U.creator]))[0].n === 1);
  // 수수료 변경은 소급되지 않음
  await as(U.op, `select * from public.admin_update_monetization_config('{"default_commission_bp":2000}'::jsonb)`);
  check('기본 수수료 20%로 변경해도 기존 구매 기록은 15% 그대로', (await one(`select commission_bp from public.content_purchases where id = $1`, [pu.id])).commission_bp === 1500);
  // 상품 유형별·이벤트·창작자 특별 수수료
  await as(U.op, `select * from public.admin_save_commission_rule('{"scope":"product_type","scope_key":"document","commission_bp":1000}'::jsonb)`);
  check('수수료 우선순위: 유형별 10% (document)', (await as(U.buyer, `select public.resolve_commission_bp($1, 'document') b`, [U.creator]))[0].b === 1000);
  await as(U.op, `select * from public.admin_save_commission_rule('{"scope":"event","scope_key":"*","commission_bp":500,"note":"런칭 이벤트"}'::jsonb)`);
  check('수수료 우선순위: 진행 중 이벤트 5% 가 유형별보다 우선', (await as(U.buyer, `select public.resolve_commission_bp($1, 'document') b`, [U.creator]))[0].b === 500);
  await as(U.op, `select * from public.admin_review_creator($1, 'approved', null, 1200)`, [U.creator]);
  check('수수료 우선순위: 창작자 특별 수수료 12% 가 최우선', (await as(U.buyer, `select public.resolve_commission_bp($1, 'document') b`, [U.creator]))[0].b === 1200);
  check('수수료 규칙 조회: 관리자만', (await as(U.buyer, `select count(*)::int n from public.commission_rules`))[0].n === 0);

  section('8. 운영자·개발자 계정 = 무제한');
  const dev0 = await bal(U.dev);
  const [pd] = await as(U.dev, `select * from public.purchase_product($1)`, [p1.id]);
  check('개발자 계정: 잔액 0이어도 구매 가능, 코인 차감 0, 창작자 수익 미발생', pd.privileged_comp === true && (await bal(U.dev)) === dev0 && pd.creator_earning_coins === 0
    && (await one(`select count(*)::int n from public.creator_earnings where purchase_id = $1`, [pd.id])).n === 0);
  check('개발자 계정 구매도 원장에 0코인 기록 (정가 메모)', /정가 1000/.test((await one(`select note from public.wallet_ledger where idempotency_key = $1`, [`purchase:${pd.id}`]))?.note ?? ''));
  check('운영자 계정은 구매 없이도 모든 본문 열람', (await as(U.op, `select count(*)::int n from public.creator_product_content where product_id = $1`, [p1.id]))[0].n === 1);

  section('9. PRO 포함 콘텐츠 (서버 권한)');
  const [p2] = await as(U.creator, `select * from public.save_creator_product($1::jsonb)`, [JSON.stringify({ product_type: 'document', title: 'PRO 전용 가드 가이드', price_coins: 500, pro_included: true, rights_confirmed: true, content: { sections: [{ title: 'x', text: 'PRO 본문' }] } })]);
  await as(U.creator, `select * from public.submit_product_for_review($1)`, [p2.id]);
  await as(U.op, `select * from public.admin_review_product($1, 'approved')`, [p2.id]);
  check('무료 사용자: PRO 포함 콘텐츠 본문 불가', (await as(U.other, `select count(*)::int n from public.creator_product_content where product_id = $1`, [p2.id]))[0].n === 0);
  const [po] = await as(U.other, `select * from public.create_subscription_order('pro', 'monthly')`);
  await as('service', `select public.finalize_subscription_payment($1, 'paid', 'pk_pro_other')`, [po.id]);
  check('PRO 구독자: 구매 없이 본문 열람', (await as(U.other, `select count(*)::int n from public.creator_product_content where product_id = $1`, [p2.id]))[0].n === 1);

  section('10. 수정·판매 중지·삭제');
  await as(U.creator, `select * from public.save_creator_product($1::jsonb)`, [JSON.stringify({ id: p1.id, summary: '잽 4주 (개정)', content: { sections: [{ title: '1강', text: '개정 본문' }] } })]);
  check('판매 중 상품 수정 → 재검수 대기 + 버전 증가', (await one(`select status, version from public.creator_products where id = $1`, [p1.id])).status === 'pending_review');
  check('수정 후에도 기존 구매자는 계속 열람 (개정 본문)', (await as(U.buyer, `select body->'sections'->0->>'text' t from public.creator_product_content where product_id = $1`, [p1.id]))[0]?.t === '개정 본문');
  check('수정 중에는 새 구매 불가', (await fails(U.other, `select * from public.purchase_product($1)`, [p1.id], /PRODUCT_UNAVAILABLE/)) === true);
  await as(U.op, `select * from public.admin_review_product($1, 'approved')`, [p1.id]);
  await as(U.creator, `select * from public.set_product_on_sale($1, false)`, [p1.id]);
  check('판매 중지(unlisted): 마켓에서 사라짐, 기존 구매자는 내 라이브러리에서 계속 열람', (await as(U.other, `select count(*)::int n from public.creator_products where id=$1`, [p1.id]))[0].n === 0
    && (await as(U.buyer, `select count(*)::int n from public.creator_product_content where product_id = $1`, [p1.id]))[0].n === 1
    && (await as(U.buyer, `select count(*)::int n from public.creator_products where id=$1`, [p1.id]))[0].n === 1);
  await as(U.creator, `select * from public.set_product_on_sale($1, true)`, [p1.id]);
  check('같은 버전이면 검수 없이 판매 재개', (await one(`select status from public.creator_products where id = $1`, [p1.id])).status === 'approved');
  check('구매자 있는 상품은 삭제 불가(판매 중지만)', (await fails(U.creator, `select public.delete_creator_product($1)`, [p1.id], /HAS_PURCHASES_UNLIST_INSTEAD/)) === true);

  section('11. 후기·신고');
  check('구매하지 않은 사용자는 후기 불가', (await fails(U.seller, `insert into public.product_reviews (product_id, user_id, rating, body) values ($1, $2, 5, '좋음')`, [p1.id, U.seller])) === true);
  await as(U.buyer, `insert into public.product_reviews (product_id, user_id, rating, body) values ($1, $2, 4, '좋아요')`, [p1.id, U.buyer]);
  check('구매자 후기 → 평점 갱신', Number((await one(`select rating_avg from public.creator_products where id=$1`, [p1.id])).rating_avg) === 4);
  await as(U.seller, `insert into public.content_reports (product_id, reporter_id, reason, detail) values ($1, $2, 'copyright', '제 영상 무단 사용')`, [p1.id, U.seller]);
  await as(U.seller, `insert into public.content_reports (creator_id, reporter_id, reason) values ($1, $2, 'false_credentials')`, [U.creator, U.seller]);
  check('신고: 저작권·허위 자격 접수, 신고자 본인·관리자만 조회', (await as(U.seller, `select count(*)::int n from public.content_reports`))[0].n === 2 && (await as(U.buyer, `select count(*)::int n from public.content_reports`))[0].n === 0 && (await as(U.op, `select count(*)::int n from public.content_reports`))[0].n === 2);

  section('12. 환불');
  const [rq] = await as(U.buyer, `select * from public.request_content_refund($1, '내용이 설명과 다름')`, [pu.id]);
  check('구매자 환불 요청', rq.refund_status === 'requested');
  check('남의 구매 환불 요청 불가', (await fails(U.other, `select * from public.request_content_refund($1, 'x')`, [pu.id], /NOT_YOUR_PURCHASE/)) === true);
  await db.query(`update public.creator_earnings set available_at = now() - interval '1 day' where purchase_id = $1`, [pu.id]);
  await as(U.creator, `select public.my_creator_summary()`);
  check('환불 요청 중인 수익은 보류 기간이 지나도 정산 가능으로 안 풀림', (await one(`select status from public.creator_earnings where purchase_id=$1`, [pu.id])).status === 'held');
  const bb = await bal(U.buyer);
  await as(U.op, `select * from public.admin_resolve_content_refund($1, true, '승인')`, [pu.id]);
  check('환불 승인: 구매자 +1000, 창작자 수익 reversed, 열람 권한 해제', (await bal(U.buyer)) === bb + 1000
    && (await one(`select status from public.creator_earnings where purchase_id=$1`, [pu.id])).status === 'reversed'
    && (await as(U.buyer, `select count(*)::int n from public.creator_product_content where product_id = $1`, [p1.id]))[0].n === 0);
  check('환불 이중 처리 불가', (await fails(U.op, `select * from public.admin_resolve_content_refund($1, true)`, [pu.id], /NOT_REFUNDABLE/)) === true);

  section('13. 정산 (시뮬레이션)');
  // 창작자 수익 쌓기: 다른 구매자 3명 분량 — config 최소 정산액을 낮춰 테스트
  await as(U.op, `select * from public.admin_update_monetization_config('{"settlement_min_coins":1000,"default_commission_bp":1500}'::jsonb)`);
  await as(U.op, `select * from public.admin_review_creator($1, 'approved', null, null)`, [U.creator]);
  await db.query(`update public.commission_rules set active = false`);
  for (const b of [U.seller, U.owner, U.instr]) {
    await as('service', `select public.post_ledger($1, 'event_reward', 2000, 'test', 'seed', $2)`, [b, `seed-${b}`]);
    await as(b, `select * from public.purchase_product($1)`, [p1.id]);
  }
  check('보류 중 수익은 정산 요청 불가', (await fails(U.creator, `select * from public.request_settlement()`, [], /BELOW_SETTLEMENT_MINIMUM/)) === true);
  await db.query(`update public.creator_earnings set available_at = now() - interval '1 second' where status = 'held'`);
  const [st] = await as(U.creator, `select * from public.request_settlement()`);
  check('정산 요청: 850×3 = 2,550코인, 예상액 2,550원(환산율 1), 모드=simulation', Number(st.amount_coins) === 2550 && Number(st.amount_krw_estimate) === 2550 && st.mode === 'simulation' && st.status === 'requested', st);
  check('정산 중복 요청 불가', (await fails(U.creator, `select * from public.request_settlement()`, [], /SETTLEMENT_IN_PROGRESS|BELOW_SETTLEMENT_MINIMUM/)) === true);
  check('실제 지급 모드로 바꿀 수 없음 (CHECK)', (await fails('service', `update public.settlement_requests set mode = 'live' where id = $1`, [st.id])) === true);
  check('승인 전 지급 완료 처리 불가', (await fails(U.op, `select * from public.admin_decide_settlement($1, 'paid_simulated')`, [st.id], /NOT_APPROVED/)) === true);
  check('정산 결정: 관리자만', (await fails(U.creator, `select * from public.admin_decide_settlement($1, 'approved')`, [st.id], /FORBIDDEN/)) === true);
  await as(U.op, `select * from public.admin_decide_settlement($1, 'approved')`, [st.id]);
  await as(U.op, `select * from public.admin_decide_settlement($1, 'paid_simulated')`, [st.id]);
  const sum = (await as(U.creator, `select public.my_creator_summary() s`))[0].s;
  check('지급 완료(시뮬레이션) → 수익 settled, 대시보드 반영, 현금 지급 비활성 표시', Number(sum.settled_coins) === 2550 && sum.cash_payout_enabled === false && Number(sum.platform_fee_coins) === 450, sum);
  // 미성년 창작자 → 보류
  await as(U.other, `select * from public.upsert_my_creator_profile('{"display_name":"주니어","is_minor":true}'::jsonb)`);
  await as(U.op, `select * from public.admin_review_creator($1, 'approved')`, [U.other]);
  const [p3] = await as(U.other, `select * from public.save_creator_product('{"product_type":"tactics","title":"주니어 전술","price_coins":2000,"rights_confirmed":true}'::jsonb)`);
  await as(U.other, `select * from public.submit_product_for_review($1)`, [p3.id]);
  await as(U.op, `select * from public.admin_review_product($1, 'approved')`, [p3.id]);
  await as('service', `select public.post_ledger($1, 'event_reward', 2000, 'test', 'seed', 'seed-seller-2')`, [U.seller]);
  await as(U.seller, `select * from public.purchase_product($1)`, [p3.id]);
  await db.query(`update public.creator_earnings set available_at = now() - interval '1 second' where creator_id = $1`, [U.other]);
  const [stm] = await as(U.other, `select * from public.request_settlement()`);
  check('미성년 창작자(보호자 동의 없음) 정산 → on_hold', stm.status === 'on_hold' && /미성년/.test(stm.hold_reason), stm);
  check('미성년 보류 건 승인 불가', (await fails(U.op, `select * from public.admin_decide_settlement($1, 'approved')`, [stm.id], /MINOR_GUARDIAN_REQUIRED/)) === true);
  await as(U.op, `select * from public.admin_decide_settlement($1, 'rejected', '보호자 동의 필요')`, [stm.id]);
  check('정산 거절 → 수익이 다시 정산 가능 상태로', (await one(`select count(*)::int n from public.creator_earnings where creator_id=$1 and status='available'`, [U.other])).n === 1);
  // 수익 → 코인 전환
  const ob = await bal(U.other);
  const conv = (await as(U.other, `select public.convert_earnings_to_coins() n`))[0].n;
  check('정산 가능 수익 → MARTIAL COIN 전환 (원장 creator_earning)', Number(conv) === 1700 && (await bal(U.other)) === ob + 1700);
  check('전환 재실행해도 중복 지급 없음', Number((await as(U.other, `select public.convert_earnings_to_coins() n`))[0].n) === 0 && (await bal(U.other)) === ob + 1700);

  section('14. 저작권 판매 중지 + 일괄 환불');
  const sb = await bal(U.seller);
  await as(U.op, `select * from public.admin_review_product($1, 'suspended', '저작권 침해 확인', true)`, [p3.id]);
  check('판매 중지(suspended) + 환불 → 구매자 2,000코인 반환, 열람 불가', (await bal(U.seller)) === sb + 2000 && (await as(U.seller, `select count(*)::int n from public.creator_product_content where product_id = $1`, [p3.id]))[0].n === 0);
  check('이미 코인으로 전환된 수익은 창작자 지갑에서 회수', (await one(`select count(*)::int n from public.wallet_ledger where user_id = $1 and entry_type = 'clawback'`, [U.other])).n === 1);
  const integ = await as(U.op, `select * from public.wallet_integrity_report() where check_name in ('balance_mismatch','chain_break','duplicate_reference')`);
  check('전체 흐름 후 원장 무결성 이상 0건', integ.length === 0, integ);

  section('15. 장비 마켓 수수료·분쟁 (기존 마켓 확장)');
  const lid = (await one(`insert into public.gear_listings (seller_id, seller_nickname, title, category, condition, price, shipping_available, shipping_fee) values ($1, 'seller', '복싱 글러브 12oz', 'boxing_gloves', 'good', 50000, true, 3000) returning id`, [U.seller])).id;
  const [go] = await as(U.buyer, `select * from public.create_gear_order($1, '홍길동', '01012345678', '서울시 어딘가 1')`, [lid]);
  check('장비 주문 생성 시 수수료 자동 계산 (3% of 50,000 = 1,500, 배송비 제외)', go.fee_bp === 300 && go.platform_fee_krw === 1500 && go.seller_net_krw === 51500, go);
  await as(U.op, `select * from public.admin_update_monetization_config('{"gear_fee_bp":500}'::jsonb)`);
  await as('service', `select * from public.finalize_gear_order($1, 'paid', null, 'pk_gear_1')`, [go.id]);
  check('결제 후 수수료 고정 (설정 변경 무관)', (await one(`select platform_fee_krw from public.gear_orders where id=$1`, [go.id])).platform_fee_krw === 1500);
  const [dp] = await as(U.buyer, `select * from public.open_gear_dispute($1, 'not_received', '배송 안 옴')`, [go.id]);
  check('구매자 분쟁 신고', dp.status === 'open');
  check('분쟁 중복 신고 불가', (await fails(U.buyer, `select * from public.open_gear_dispute($1, 'other', 'x')`, [go.id])) === true);
  check('거래 당사자 아닌 사용자는 분쟁 신고·조회 불가', (await fails(U.other, `select * from public.open_gear_dispute($1, 'other', 'x')`, [go.id], /NOT_YOUR_ORDER/)) === true && (await as(U.other, `select count(*)::int n from public.gear_order_disputes`))[0].n === 0);
  await as(U.op, `select * from public.admin_resolve_gear_dispute($1, 'resolved_no_refund', '배송 조회 확인')`, [dp.id]);
  await as(U.seller, `select public.mark_gear_order_shipped($1, 'CJ', '1234')`, [go.id]);
  await as(U.buyer, `select public.confirm_gear_order_received($1)`, [go.id]);
  const ov = (await as(U.op, `select public.admin_revenue_overview() o`))[0].o;
  check('수익 분석: 배송 완료 거래만 장비 수수료 실현 (1,500원)', Number(ov.gear.fee_realized_krw) === 1500 && Number(ov.gear.gmv_delivered_krw) === 53000, ov.gear);

  section('16. 체육관 사업자 요금제');
  await db.query(`insert into public.gyms (id, name, owner_user_id, join_code) values ('gym-a', 'A 체육관', $1, 'JOINA')`, [U.owner]);
  await db.query(`insert into public.gym_members (gym_id, user_id, role, nickname) values ('gym-a', $1, 'instructor', 'instr'), ('gym-a', $2, 'student', 'buyer')`, [U.instr, U.buyer]);
  check('요금제 없는 체육관: 사업자 리포트 거부', (await fails(U.owner, `select public.gym_business_report('gym-a')`, [], /BUSINESS_PLAN_REQUIRED/)) === true);
  check('관장이 아닌 사람은 사업자 요금제 주문 불가', (await fails(U.instr, `select * from public.create_subscription_order('gym', 'monthly', 'gym-a')`, [], /NOT_GYM_OWNER/)) === true);
  check('개인 요금제에 체육관 지정 불가', (await fails(U.owner, `select * from public.create_subscription_order('pro', 'monthly', 'gym-a')`, [], /PERSONAL_PLAN_NO_GYM/)) === true);
  const [gs] = await as(U.owner, `select * from public.create_subscription_order('gym', 'yearly', 'gym-a')`);
  check('사업자 연간 주문 490,000원', gs.amount_krw === 490000);
  await as('service', `select public.finalize_subscription_payment($1, 'paid', 'pk_gym_1')`, [gs.id]);
  const rep = (await as(U.owner, `select public.gym_business_report('gym-a') r`))[0].r;
  check('사업자 요금제 후: 관장 리포트 (회원 2, 지도자 1)', Number(rep.members) === 2 && Number(rep.instructors) === 1, rep);
  check('같은 체육관 지도자도 사업자 기능 사용', (await ent(U.instr, 'gym_business_reports')) === true && !!(await as(U.instr, `select public.gym_business_report('gym-a') r`))[0].r);
  check('학생은 사업자 리포트 불가', (await fails(U.buyer, `select public.gym_business_report('gym-a')`, [], /NOT_GYM_STAFF|BUSINESS_PLAN_REQUIRED/)) === true);
  check('관장은 체육관 구독을 조회', (await as(U.owner, `select count(*)::int n from public.user_subscriptions where gym_id = 'gym-a'`))[0].n === 1);

  section('17. 제휴·광고');
  check('캠페인 등록: 관리자만', (await fails(U.buyer, `select * from public.admin_save_partner_campaign('{"partner_name":"x","kind":"brand","title":"광고","placement":"gear"}'::jsonb)`, [], /FORBIDDEN/)) === true);
  const [cmp] = await as(U.op, `select * from public.admin_save_partner_campaign($1::jsonb)`, [JSON.stringify({ partner_name: '글러브 브랜드', kind: 'brand', label: '광고', title: '신제품 글러브', placement: 'gear', link_url: 'https://example.com', fee_krw: 300000 })]);
  check('초안(draft) 캠페인은 사용자에게 안 보임', (await as(U.buyer, `select count(*)::int n from public.partner_campaigns`))[0].n === 0);
  await as(U.op, `select * from public.admin_save_partner_campaign($1::jsonb)`, [JSON.stringify({ id: cmp.id, status: 'approved' })]);
  check('승인된 캠페인만 노출, 광고 표시(label) 포함', (await as(null, `select label from public.partner_campaigns`))[0]?.label === '광고');
  check('계약 금액은 관리자만', (await as(U.buyer, `select count(*)::int n from public.partner_contracts`))[0].n === 0);
  await as(null, `select public.record_campaign_event($1, 'impression')`, [cmp.id]);
  await as(U.buyer, `select public.record_campaign_event($1, 'click')`, [cmp.id]);
  check('노출·클릭은 합계만 (사용자 식별 정보 저장 없음)', (await one(`select impressions, clicks from public.partner_campaigns where id=$1`, [cmp.id])).clicks == 1);
  check('https 가 아닌 링크 거부', (await fails(U.op, `select * from public.admin_save_partner_campaign('{"partner_name":"x","kind":"brand","title":"광고2","placement":"gear","link_url":"http://bad"}'::jsonb)`)) === true);

  section('18. 관리자 수익 분석');
  const o2 = (await as(U.op, `select public.admin_revenue_overview(now() - interval '1 day', now() + interval '1 day') o`))[0].o;
  check('구독 매출: 개인/사업자 구분 (사업자 490,000원)', Number(o2.subscriptions.business_paid_krw) === 490000 && Number(o2.subscriptions.personal_paid_krw) > 0, o2.subscriptions);
  check('코인 충전액과 코인 사용액·미사용 코인 구분', Number(o2.coins.sales_krw) > 0 && 'outstanding_coins' in o2.coins && 'spent_coins' in o2.coins, o2.coins);
  check('콘텐츠: 거래액·플랫폼 수수료·창작자 몫 분리', 'gross_coins' in o2.content && 'platform_fee_coins' in o2.content && 'creator_share_coins' in o2.content, o2.content);
  check('정산: 지급 완료(시뮬레이션) 금액 별도', Number(o2.settlements.paid_simulated_krw_estimate) === 2550, o2.settlements);
  check('제휴 계약 금액 집계', Number(o2.partners.contract_fee_krw) === 300000);
  check('모든 결제가 테스트 결제로 표시', o2.all_test_payments === true);
  check('수익 분석: 일반 사용자 거부', (await fails(U.buyer, `select public.admin_revenue_overview()`, [], /FORBIDDEN/)) === true);

  section('19. 특권 계정 거래는 일반 매출·판매 통계에서 제외 (0065)');
  const ov0 = (await as(U.op, `select public.admin_revenue_overview(now() - interval '1 day', now() + interval '1 day') o`))[0].o;
  // 개발자 계정: 출석 보상 + PRO 테스트 결제 + 코인 테스트 구매
  await as(U.dev, `select public.claim_daily_checkin()`);
  const [dso] = await as(U.dev, `select * from public.create_subscription_order('pro', 'monthly')`);
  await as('service', `select public.finalize_subscription_payment($1, 'paid', 'pk_dev_sub')`, [dso.id]);
  const [dco] = await as(U.dev, `select * from public.create_coin_order('starter')`);
  await as('service', `select public.finalize_coin_order($1, 'paid', 'pk_dev_coin')`, [dco.id]);
  const ov1 = (await as(U.op, `select public.admin_revenue_overview(now() - interval '1 day', now() + interval '1 day') o`))[0].o;
  check('특권 계정 구독 결제는 개인 구독 매출에 미포함', Number(ov1.subscriptions.personal_paid_krw) === Number(ov0.subscriptions.personal_paid_krw), [ov0.subscriptions.personal_paid_krw, ov1.subscriptions.personal_paid_krw]);
  check('특권 계정 코인 구매는 코인 매출·유료 발행에 미포함', Number(ov1.coins.sales_krw) === Number(ov0.coins.sales_krw) && Number(ov1.coins.issued_paid_coins) === Number(ov0.coins.issued_paid_coins));
  check('특권 계정 출석 보상은 무료 발행에 미포함', Number(ov1.coins.issued_free_coins) === Number(ov0.coins.issued_free_coins));
  check('특권 계정 지갑은 미사용 코인 잔액에 미포함', Number(ov1.coins.outstanding_coins) === Number(ov0.coins.outstanding_coins));
  check('제외된 내부 거래는 privileged_excluded 에 따로 표시', Number(ov1.privileged_excluded.subscription_paid_krw) === 9900 && Number(ov1.privileged_excluded.coin_sales_krw) === 1000 && Number(ov1.privileged_excluded.issued_free_coins) === 10 && Number(ov1.privileged_excluded.content_comps) >= 1, ov1.privileged_excluded);
  check('특권 계정 무상 이용은 콘텐츠 판매 건수에 미포함', Number(ov1.content.sales_count) === (await one(`select count(*)::int n from public.content_purchases where status = 'completed' and not privileged_comp and created_at > now() - interval '1 day'`)).n);
  const sc = await one(`select sales_count from public.creator_products where id = $1`, [p1.id]);
  const real = await one(`select count(*)::int n from public.content_purchases where product_id = $1 and status = 'completed' and not privileged_comp`, [p1.id]);
  check('상품 판매 수 = 실제 판매(무상 이용 제외)', sc.sales_count === real.n, [sc.sales_count, real.n]);
  const cs = (await as(U.creator, `select public.my_creator_summary() s`))[0].s;
  check('창작자 대시보드 판매 건수에서 무상 이용 제외', Number(cs.sales_count) === real.n, [cs.sales_count, real.n]);

  section('20. Gemini 코치 사용 한도 (0066)');
  const F = U.seller; // 무료 사용자
  const use = async (uid, id) => (await as(uid, `select public.consume_gemini_use($1) r`, [id]))[0].r;
  const q0 = (await as(F, `select public.my_gemini_quota() q`))[0].q;
  check('무료 사용자: 하루 5회, 남은 5회', q0.unlimited === false && q0.limit === 5 && q0.remaining === 5, q0);
  const res = [];
  for (let i = 1; i <= 6; i++) res.push(await use(F, `free-use-${i}`));
  check('1~5번째 작업 허용, 6번째 거부(QUOTA_EXCEEDED)', res.slice(0, 5).every((r) => r.allowed === true && r.new_use === true) && res[5].allowed === false && res[5].reason === 'QUOTA_EXCEEDED', res.map((r) => r.allowed));
  check('거부 후 남은 횟수 0', (await as(F, `select public.my_gemini_quota() q`))[0].q.remaining === 0);
  const G = U.instr; // 다른 무료 사용자
  for (let i = 0; i < 15; i++) await use(G, 'grouped-action-1');
  check('같은 작업(use_id)의 호출 15번 = 1회만 차감', (await as(G, `select public.my_gemini_quota() q`))[0].q.used === 1);
  const over = await use(G, 'grouped-action-1');
  check('묶음 최대 호출(15) 초과 → USE_EXPIRED (같은 id 로 무한 재사용 불가)', over.allowed === false && over.reason === 'USE_EXPIRED');
  await use(G, 'grouped-action-2');
  await db.query(`update public.gemini_usage set started_at = now() - interval '11 minutes' where use_id = 'grouped-action-2'`);
  const late = await use(G, 'grouped-action-2');
  check('묶음 시간(10분) 지나면 → USE_EXPIRED', late.allowed === false && late.reason === 'USE_EXPIRED');
  await db.query(`update public.gemini_usage set day = day - 1 where user_id = $1`, [F]);
  check('날짜가 바뀌면 다시 5회', (await as(F, `select public.my_gemini_quota() q`))[0].q.remaining === 5 && (await use(F, 'next-day-1')).allowed === true);
  // PRO·특권은 무제한
  const P = U.other; // 위에서 PRO 구독 활성화된 사용자
  const pq = (await as(P, `select public.my_gemini_quota() q`))[0].q;
  let proOk = true;
  for (let i = 0; i < 8; i++) proOk = proOk && (await use(P, `pro-use-${i}`)).allowed === true;
  check('PRO 구독자: 무제한 (8회 모두 허용)', pq.unlimited === true && proOk, pq);
  let devOk = true;
  for (let i = 0; i < 8; i++) devOk = devOk && (await use(U.dev, `dev-use-${i}`)).allowed === true;
  check('운영자·개발자 계정: 무제한', devOk && (await as(U.dev, `select public.my_gemini_quota() q`))[0].q.unlimited === true);
  check('PRO 요금제 기능에 gemini_unlimited 포함', (await one(`select 'gemini_unlimited' = any(features) x from public.membership_plans where id = 'pro'`)).x === true);
  // 권한
  check('비로그인 호출 거부', (await fails(null, `select public.consume_gemini_use('anon-use-1')`, [], /AUTH_REQUIRED|permission denied/)) === true);
  check('사용 기록 직접 쓰기·삭제 불가 (한도 초기화 우회 방지)', (await fails(F, `delete from public.gemini_usage where user_id = $1`, [F])) === true || (await one(`select count(*)::int n from public.gemini_usage where user_id = $1`, [F])).n > 0);
  check('남의 사용 기록 조회 불가', (await as(G, `select count(*)::int n from public.gemini_usage where user_id = $1`, [F]))[0].n === 0);
  check('잘못된 use_id 거부', (await fails(F, `select public.consume_gemini_use('x')`, [], /INVALID_USE_ID/)) === true);
  // 관리자 설정
  await as(U.op, `select * from public.admin_update_monetization_config('{"free_gemini_daily_uses":2}'::jsonb)`);
  const H = U.owner;
  const h = [await use(H, 'hlimit-01'), await use(H, 'hlimit-02'), await use(H, 'hlimit-03')];
  check('관리자가 무료 횟수를 2로 바꾸면 3번째 거부', h[0].allowed && h[1].allowed && h[2].allowed === false, h.map((x) => x.allowed));
  await as(U.op, `select * from public.admin_update_monetization_config('{"free_gemini_daily_uses":5}'::jsonb)`);
  check('일반 사용자는 무료 횟수 설정 변경 불가', (await fails(F, `select public.admin_update_monetization_config('{"free_gemini_daily_uses":999}'::jsonb)`, [], /FORBIDDEN/)) === true);
}
