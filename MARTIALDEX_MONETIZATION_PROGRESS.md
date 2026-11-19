# MARTIALDEX 수익화 작업 진행 기록

시작: 2026-11-16 · 작업 위치: 원본 `/Users/swcho/Documents/MARTIALDEX` (clone 없음)

## 0. 보호 조치
- 백업: `MARTIALDEX_backups/MARTIALDEX_20261116_pre_monetization` (APFS clone, 수정 금지)
- 운영 DB(prod `dxazzyzsgmfqhagbpeux`): 시작 시점 마이그레이션 0001–0060 적용 상태. 이번 작업의 마이그레이션은 **작성·로컬 검증만** 하고 운영 적용은 별도 승인 후.
- 실결제·현금 출금: 비활성. 결제는 Toss **테스트** 키 경로만.
- 관리자/개발자 계정 (사용자 지시, 정정 반영): `martialdex@martialdex.local`(아이디 로그인 `martialdex`, 이미 platform_admins)과 `joeunsu232@gmail.com` — 모든 기능 + 무제한 크레딧. 둘 다 prod에 존재·이메일 인증 완료 → 마이그레이션에서 **user_id로 고정**해 지정(이메일 문자열만으로 특권을 주지 않음: 가입 경로가 도메인을 막지 않으므로).

## 1. 기존 기능 조사 (완료)
- 멤버십/구독/코인/지갑/엔타이틀먼트 코드: **없음** (신규).
- 결제: `supabase/functions/payment-verify` — Toss confirm/cancel, `PAYMENT_SECRET_KEY` 미설정 시 샌드박스(`TEST_RECEIPT`). 'paid'/'refunded' 전이는 service_role만(`FORBIDDEN_DIRECT_PAID_TRANSITION`), payment_key 유니크 인덱스로 중복 방지. 클라이언트 `src/lib/payments/*` (callPaymentVerify, Toss 위젯, PaymentModal 테스트 결제). → **재사용, 새 action만 추가**.
- 커리큘럼 마켓(0009/0010/0018): 원화 판매, 주문에 수수료/판매자 몫 기록(기본 10%), 정산 테이블 없음. 통계 트리거가 'paid' 주문을 세지 않는 기존 버그 있음.
- 장비 마켓(0057/0059): 택배 주문·Toss 결제, **수수료 컬럼 없음**, 분쟁 테이블 없음, 환불은 발송 전만.
- 관리자: `platform_admins` + `is_platform_admin()`(0055), 화면은 `/admin/platform` 탭 구조 → 탭 추가.
- 체육관: gyms/gym_members(owner/instructor/student), 공지·과제·진도(0055), 디렉터리·제휴(0058, `gym_partnerships.plan/monthly_fee` 존재). 관리 화면 `/gym/admin/*`, `/gyms/manage/*` → **재사용, 요금제만 연결**.
- 계정: 아이디 로그인 = `<id>@martialdex.local`. 프로필 `handle` 등(0045).
- 테스트 하네스: `.devtools/lib/pglite-supabase.mjs`(실제 RLS, payment-verify는 gear_* 만 스텁) + `qa-ecosystem-e2e.mjs`.

## 2. 구현 진행
- [x] 0061 공통 설정·특권 계정·요금제·구독·권한 / 0062 지갑·원장·코인 주문·보상·무결성 / 0063 창작자·콘텐츠·구매·수수료·환불·후기·신고·정산 시뮬 / 0064 장비 수수료·분쟁·체육관 사업자 리포트·제휴·수익 분석
- [x] `.devtools/test-monetization-sql.mjs` (+`-market.mjs`): **148/148 통과** (PGlite, 실제 RLS)
  - 테스트로 잡은 버그: ① 취소 예약 구독에도 결제 유예 3일이 적용됨 → 수정 ② 상품 공개 정책이 구매 테이블을 직접 읽어 **비로그인 마켓 목록이 권한 오류** → definer 도우미로 수정 ③ 장비 주문 결제 확정 시 수수료가 바뀐 설정으로 재계산됨 → 주문 생성 시 고정
- [x] 회귀: 기존 SQL 테스트 9종 통과 (ecosystem 133/133 — 테스트 픽스처 auth.users에 email 컬럼 추가, 운영 Supabase와 동일하게)
- [x] payment-verify 새 action (sub_*, coin_*) — live 키+잠금 시 거부, 샌드박스는 관리자만 / payment-webhook 신규 (서명 검증 + Toss 재조회) — test-payment-webhook 11/11 / 하네스 스텁 추가
- [x] 클라이언트 `src/lib/monetization/*` + 화면 11종(멤버십·지갑·거래내역·코인스토어·결제결과·콘텐츠 마켓·상세·라이브러리·스튜디오·편집기·수익·사업자) + 관리자 탭 + 장비 주문 수수료/분쟁 + 체육관 링크 + 제휴 슬롯
- [x] E2E `qa-monetization-e2e.mjs` 53/53, 회귀 ecosystem E2E 74/74, 화면 점검 96/96, tsc 0
- [x] 빌드: web·Mac·Android 성공 (보고서 §14)

## 3. 변경 파일
신규: supabase/migrations/0061–0064, supabase/functions/payment-webhook/*, src/lib/monetization/{service,useMembership}.ts, src/pages/monetization/*, src/components/monetization/{shared,GearOrderExtras}.tsx, src/components/admin/MonetizationAdmin.tsx, src/styles/brand/monetization.css, .devtools/{test-monetization-sql,test-monetization-sql-market,test-payment-webhook,qa-monetization-e2e}.mjs
수정: supabase/functions/payment-verify/index.ts(액션 추가), src/App.tsx(라우트), src/components/brand/navConfig.ts(메뉴), src/main.tsx(css), src/pages/PlatformAdmin.tsx(탭), src/pages/gear/{GearOrders,GearMarket}.tsx, src/pages/GymAdminDetail.tsx(링크), .devtools/lib/pglite-supabase.mjs(스텁), .devtools/test-ecosystem-sql.mjs(픽스처 email 컬럼)

## 4. 추가 DB 구조

## 5. 결제 테스트 결과

## 6. 보안 테스트 결과

## 7. 미완료 항목
최종 보고서 `MARTIALDEX_MONETIZATION_REPORT.md` §12–15 참고.
