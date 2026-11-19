# MARTIALDEX 이미지 생성 가이드

## 현재 상태 (2026-11-16)

- ChatGPT·Gemini 이미지 생성은 **실행하지 않았다.** 사용자 로그인 또는 유료 API 호출이 필요해 자율 실행 예외(인증·유료 서비스)에 해당한다.
- 대신 프로젝트에 이미 있는 **3D 파이터 모델 + 모션캡처 클립**을 시네마틱 조명으로 렌더해 17장의 브랜드 이미지를 직접 만들었다. 외부 서비스·비용 없음.
  - 생성 도구: `.devtools/render/brandRender.ts` + `.devtools/render-brand-images.mjs` (개발 서버 실행 중 `node .devtools/render-brand-images.mjs [id…]`)
  - 결과: `src/assets/brand/redesign/*.webp`, 연결: `src/components/brand/imagery.ts`
  - 한계: 얼굴·피부·도복·글러브가 없는 마네킹 조각상 톤이다. 발차기·던지기 모션캡처가 없어 킥 계열 무술은 타격 자세를 쓴다.
- 실사 캠페인 사진으로 바꾸고 싶다면 아래 프롬프트로 생성한 뒤, **같은 파일명**으로 `src/assets/brand/redesign/`에 덮어쓰면 코드 수정 없이 반영된다(가로세로 비율 유지).

## 공통 아트 디렉션 (모든 프롬프트 앞에 붙인다)

> Premium combat sports editorial photograph, luxury brand campaign. Pure near-black background (#0A0A0B), single hard key light from upper left, warm champagne-gold rim light (#C4AD7C) from behind, deep shadows, high contrast, matte skin, no visible logos, no text, no watermark. Cinematic 35mm look, fine film grain, subject isolated against darkness. Muted palette: black, graphite, ivory, a touch of gold. Professional athlete, realistic anatomy, sweat sheen, focused expression.

금지: 로고·상표·문자, 실존 인물 닮은 얼굴, 혈흔, 과장된 근육, 네온 컬러, 붉은 조명.

## 이미지 목록

| ID / 파일명 | 사용 위치 | 비율 · 권장 해상도 | 상세 프롬프트 (공통 디렉션 뒤에) | 적용 코드 |
|---|---|---|---|---|
| `hero-strike.webp` | 홈 커버 전면 배경 (`.mx-cover__img`) | 16:9 · 2400×1350 | A boxer throwing a straight right cross, full extension, captured from the side, subject on the left third, large empty dark space on the right for typography. | `IMAGERY.heroStrike` (Home.tsx) |
| `hero-guard.webp` | 마켓 타일, 프로필 배너, 레거시 히어로 | 16:9 · 2400×1350 | Fighter in a high guard stance, three-quarter view, subject on the right third, calm before the exchange. | `IMAGERY.heroGuard` |
| `coach-study.webp` | 홈 AI 코치 플레이트, 커리큘럼 커버 | 16:10 · 2000×1250 | Athlete shadowboxing a slow jab while a faint holographic skeleton overlay traces the joints (very subtle, gold lines). | `IMAGERY.coachStudy` |
| `gym-floor.webp` | 홈 체육관 타일, 체육관 배너 | 16:9 · 2000×1125 | Empty premium training gym at night, wrestling mats, one pool of light, a pair of fighters drilling a takedown in the distance. | `IMAGERY.gymFloor` |
| `community-clinch.webp` | 홈 커뮤니티 타일, 클랜 배너 | 16:9 · 2000×1125 | Two grapplers in a back control drill, shot from above at an angle, sculptural composition. | `IMAGERY.communityClinch` |
| `auth-portrait.webp` | 로그인·가입·재설정 왼쪽 패널 | 3:4 · 1200×1600 | Close portrait of a fighter wrapping hands with white hand wraps, eyes down, focus on the wraps. | `IMAGERY.authPortrait` (AuthFrame) |
| `art-boxing.webp` | 무술 플레이트: 복싱 | 4:5 · 1200×1500 | Boxer throwing a lead hook, gloves (plain black, no logo). | `artImage('boxing')` |
| `art-kickboxing.webp` | 무술 플레이트: 킥복싱 | 4:5 · 1200×1500 | Kickboxer throwing a roundhouse kick to the body, shin guards. | `artImage('kickboxing')` |
| `art-muaythai.webp` | 무술 플레이트: 무에타이 | 4:5 · 1200×1500 | Muay thai fighter in the clinch delivering a knee, traditional armband (plain). | `artImage('muay-thai')` |
| `art-taekwondo.webp` | 무술 플레이트: 태권도 | 4:5 · 1200×1500 | Taekwondo athlete in white dobok mid spinning hook kick, motion freeze. | `artImage('taekwondo')` |
| `art-karate.webp` | 무술 플레이트: 가라테 | 4:5 · 1200×1500 | Karateka in a deep stance throwing a reverse punch (gyaku-zuki), white gi, black belt. | `artImage('karate')` |
| `art-wrestling.webp` | 무술 플레이트: 레슬링 | 4:5 · 1200×1500 | Wrestler shooting a double-leg takedown, singlet, explosive penetration step. | `artImage('wrestling')` |
| `art-judo.webp` | 무술 플레이트: 유도 | 4:5 · 1200×1500 | Judoka executing a hip throw, white and navy judogi, uke airborne. | `artImage('judo')` |
| `art-sambo.webp` | 무술 플레이트: 삼보 | 4:5 · 1200×1500 | Sambo athletes in red and blue kurtka (desaturated), leg-entry throw. | `artImage('sambo')` |
| `art-grappling.webp` | 무술 플레이트: 주짓수 | 4:5 · 1200×1500 | Brazilian jiu-jitsu rear naked choke from back mount, black gi. | `artImage('bjj')` |
| `art-mma.webp` | 무술 플레이트: MMA | 4:5 · 1200×1500 | MMA fighter in a cage, open-finger gloves, ground-and-pound posture, cage mesh blurred. | `artImage('mixed-martial-arts')` |
| `art-striking.webp` | 예비 (현재 미사용) | 4:5 · 1200×1500 | Fighter's taped hands in guard, extreme close-up. | `IMAGERY.artStriking` |

## 저장 · 적용 절차

1. 생성 → WebP 로 저장(품질 85, 1장 400KB 이하 권장).
2. 위 표의 파일명 그대로 `src/assets/brand/redesign/`에 덮어쓰기.
3. `npm run build` 로 확인. 화면 배치(피사체 위치)는 표의 "subject on the left/right third" 지시를 지켜야 타이포그래피와 겹치지 않는다.
