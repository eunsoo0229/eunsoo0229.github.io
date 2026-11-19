# MARTIALDEX 프리미엄 리디자인 — 진행 기록

이 파일은 작업이 중단돼도 이어서 진행할 수 있도록 유지한다. (최종 보고서: `MARTIALDEX_PREMIUM_REDESIGN_REPORT.md`)

## 백업
- `/Users/swcho/Documents/MARTIALDEX_backups/redesign-20261116-011709` (+ `.sha256`, 1,471 파일 대조 통과)

## 작업 목록
| # | 항목 | 상태 |
|---|---|---|
| 1 | 프로젝트 분석 (라우트·셸·스타일 구조) | 완료 |
| 2 | KO STYLE 레퍼런스 분석 (peigneux.studio/KOStyle, kostyle.ae — 텍스트 기반, CSS 미확인) | 완료 |
| 3 | 이미지: 3D 모델+모션캡처 시네마틱 렌더 17장 (`src/assets/brand/redesign`) | 완료 |
| 4 | 폰트 번들 (Bebas Neue / Cinzel / Barlow / Pretendard, 오프라인) | 완료 |
| 5 | 디자인 토큰·베이스·컴포넌트 레이어 (`src/styles/brand/*`) | 완료 |
| 6 | 새 앱 셸 (헤더 대체: 인덱스 내비 + 전체 화면 메뉴 + 모바일 탭바) | 완료 |
| 7 | 페이지 프레임 (챕터 스트립 + 첫 제목 마스트헤드화) | 완료 |
| 8 | 핵심 페이지 재설계 (홈, 무술, 로그인/가입/재설정, 404, 로딩, 코치 워크스페이스, 기술 상세 헤더) | 완료 |
| 9 | 인터랙션 (등장·호버·메뉴 전환·숫자 카운트, reduced-motion 존중) | 완료 |
| 10 | 검증 (tsc·빌드·화면 QA 168/168·회귀 75/79(기존 동일)·E2E 74/74·Electron 19/19·Android 빌드+에뮬레이터) | 완료 |
| 11 | 보고서 `MARTIALDEX_PREMIUM_REDESIGN_REPORT.md` | 완료 |

## 보류 (자율 실행 예외)
- ChatGPT/Gemini 이미지 생성: 로그인 또는 유료 API 필요 → 보류, 대신 로컬 3D 렌더 + 생성 가이드 문서.

## 다음 작업
- 남은 일: 보고서 §16 미완료 항목 (기능별 고유 레이아웃 확대, 3D 스튜디오, 네이티브 스플래시, 실사 이미지).
