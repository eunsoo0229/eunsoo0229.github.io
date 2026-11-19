# AI 코치 42개 문제 통합 개선 — 1차 보고서

작성 2026-11-08 · 작업 위치 `/Users/swcho/Documents/MARTIALDEX` (원본, 기획서 §1-1)

> **이 보고서는 1차 진행분이다.** 42개 문제 중 일부만 해결했고, 각 항목의 상태를
> §5에 해결 완료 / 부분 해결 / 미해결로 구분해 적었다. 테스트하지 않은 것을
> 해결 완료로 적지 않았다.

---

## 1. 기존 아키텍처 분석

조사 결과 AI 코치 대화 경로는 다음과 같다.

```
CoachChat.tsx
  └ coachAgent.runCoachTurn(input, deps)          src/lib/selfAi/coachAgent.ts (841줄)
      ├ buildConversationMemory(history)          conversationMemory.ts (181줄)
      │    └ 주제(TopicThread)는 저장된 메시지의 turn: TurnMeta 에서 파생.
      │      별도 저장소 없음 → 턴 메타데이터가 없으면 주제도 없다.
      ├ planTurn(text)                            router.ts — 단일 의도 1차 매칭
      ├ analyzeIntents(text)                      intents.ts — 다중 의도 + composite 플래그
      └ 분기
          ├ suggestionReply()      수업 제안에 대한 예/아니오
          ├ runComposite()         compositeTurn.ts (403줄) — 의도별 섹션 조립
          └ runCoachTurnInner()    기존 단일 의도 경로 (의도적으로 보존)
```

`deps`(`selfAi/deps.ts`)가 research·chat·knowledgeIndex·learnerContext를 주입한다.
테스트는 이 지점을 가짜로 바꿔 오프라인으로 돈다.

**이 구조는 2026-11-08 다른 세션이 12개 섹션 사양으로 개편해 원본에 병합한 것이다.**
본 작업 전 상태를 독립 검증했다: `tsc` 통과, `test-coach-conversation-pipeline` 44/44,
`test-self-coach-agent` 31/31, `test-search-relevance` 52/52.

---

## 2. 발견된 근본 원인 — 측정값

기획서 §20의 테스트 질문 24개를 실제 `analyzeIntents()`에 넣어 분류 결과를 측정했다.

**작업 전: 24개 중 17개가 기대 의도를 잡지 못했다.**

측정에서 드러난 구조적 원인은 하나다. **의도 분류가 "문장에 어떤 단어가 있는가"로만
이뤄지고, 특정 의도가 다른 의도를 배제하는 장치가 없다.** 그래서:

| 질문 | 작업 전 분류 | 실제 벌어지는 일 |
|---|---|---|
| "…쳤는데 암바 걸린 것처럼 팔이 아파" | `GENERAL_CONVERSATION` | 통증 호소가 일반 대화로 처리됨 |
| "이번 주 하트 가장 많은 콤보, 셋업, 게시물" | `SETUP_RESEARCH` | "셋업" 단어 때문에 **웹 검색** 실행 |
| "아까 내가 처음에 무슨 셋업 물어봤지?" | `SETUP_RESEARCH` | 대화 기록에 답이 있는데 **재검색** |
| "토푸리아가 자주 쓰는 콤보" | `SETUP_RESEARCH` | 선수 분석이 셋업 조사로 축소 |
| "내가 격투기에 재능이 없는 것 같아 힘들어" | `GENERAL_CONVERSATION` | 정서 호소에 전용 경로 없음 |
| "JAB의 3D 프리뷰 띄워줘" | `GENERAL_CONVERSATION` | 앱 액션 경로 자체가 없음 |
| "내 키와 리치를 체급 내에서 비교해줘" | `GENERAL_CONVERSATION` | 체격 비교 경로 없음 |

---

## 3. 수정한 파일

| 파일 | 변경 |
|---|---|
| `src/lib/selfAi/intents.ts` | EXCLUSIVE 의도 4종 추가 + 조기 반환 분기, 회상 게이트 |
| `src/lib/selfAi/exclusiveTurn.ts` | **신규** — 4종의 실제 실행 경로 |
| `src/lib/selfAi/coachAgent.ts` | EXCLUSIVE 분기를 composite/inner 앞에 배치, `socialTrending` dep, `hasHistory` 전달 |
| `src/lib/selfAi/deps.ts` | `socialTrending` 주입 |
| `src/lib/social/trendingService.ts` | **신규** — 내부 소셜 집계 (§16) |
| `.devtools/test-coach-exclusive-intents.mjs` | **신규** — 실행 경로 검증 테스트 |

---

## 4. 적용한 설계 원칙

기획서 §3-1의 **"분류 결과만 로그에 남기고 기존의 잘못된 경로로 계속 처리하는 방식은
허용하지 않는다"** 를 지키기 위해, 추가한 4종은 **EXCLUSIVE**로 설계했다 — 분류되면
다른 의도를 덮어쓰고, `runComposite`/`runCoachTurnInner`에 **도달하기 전에** 각자의
출처에서 답하고 반환한다.

- **통증(§13)** — 완전 결정론적. 모델을 호출하지 않는다. 생성 답변은 진단처럼 들릴
  위험이 있고, 이 경로는 절대 진단을 해서는 안 된다.
- **정서(§14)** — 모델을 쓰되 시스템 프롬프트로 공감 우선·추측 금지·기술 나열 금지를
  강제하고, **실제 학습 기록만** 맥락으로 넘긴다.
- **소셜(§16)** — 결정론적 집계. `community_post_likes`·`shared_combo_likes`의
  `created_at`으로 **기간 내 받은 하트**를 세므로, 누적 `like_count`와 구분된다(§16-2).
  **조회 실패와 데이터 없음을 다른 문구로 구분**하고, 어느 쪽이든 웹 검색으로 대체하지 않는다.
- **회상(§4-1)** — 대화 메모리에서 답한다. 검색도 모델 호출도 하지 않는다.

---

## 5. 각 문제의 해결 상태

| 번호 | 항목 | 상태 |
|---|---|---|
| D17 | 통증 질문 오분류 | **해결 완료** (테스트 7건) |
| D18 | 정서 고민 오분류 | **해결 완료** (테스트 6건) |
| H23 | 소셜 조회가 웹 검색으로 감 | **해결 완료** (테스트 6건) |
| B9·B10 | 대화 회상이 재검색으로 감 | **해결 완료** (테스트 3건) |
| A3 | 미학습 기술 검색 | **미해결** |
| A6 | 사용자가 만든 셋업 평가 | **미해결** |
| A7·A8·G22 | 상대 패턴·카운터 분석 | **미해결** |
| B11 | 수업에 추가 (LESSON_CONTINUATION) | **미해결** |
| C14·C15·C16 | 체격 비교 | **미해결** |
| E19 | 선수별 콤보 조사 | **미해결** |
| F21 | 장비 추천 | **미해결** |
| I24 | 앱 액션 (3D 프리뷰) | **미해결** |
| J25–30 | 3D 프리뷰 기반 자세 측정 | **미해결 — 조사도 안 함** |
| K31–35 | 수업 연동 | 기존 구현 존재, **미검증** |

**의도 분류 오분류: 17/24 → 12/24.**

---

## 6. 기존 기능과의 호환성

EXCLUSIVE 분기는 기존 경로 **앞에** 붙였고 기존 분기 로직은 건드리지 않았다.
작업 중 `test-self-coach-agent` [A15b]가 한 번 깨졌다 — 학습자 기록을 user 메시지에
넣었는데 테스트가 system 프롬프트에서 찾았기 때문이다. 기록은 맥락이므로 system으로
옮겨 해결했다(테스트를 고치지 않았다).

---

## 7. 비용 및 외부 API

**증가 없음.** 추가한 경로 중 셋(통증·소셜·회상)은 모델도 검색도 호출하지 않으므로
기존보다 호출이 **줄어든다**. 정서 경로만 기존과 같은 로컬 모델을 1회 호출한다.
새 유료 의존성·Gemini fallback 없음.

---

## 8. 데이터베이스 마이그레이션

**불필요.** `trendingService`는 이미 적용된 `community_post_likes`(0026)와
`shared_combo_likes`(0037)를 읽기만 한다.

---

## 9. 남아 있는 문제

1. 위 표의 **미해결 11개 항목**.
2. **3D 자세 측정(§18)은 조사조차 하지 않았다.** 기획서가 "반드시 별도 검증"이라고
   명시한 영역이므로 다음 작업의 최우선으로 둔다.
3. Android·Electron·Web 플랫폼별 차이 미확인.
4. 다른 세션이 보고한 기존 성능 문제: `coachKnowledge/lookup.exactTechniquesInText`에
   인덱스가 없어 호출당 ~300ms + 단어당 ~60ms. 본 작업에서 건드리지 않았다.
