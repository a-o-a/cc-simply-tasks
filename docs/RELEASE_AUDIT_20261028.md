# 출시 전 검수 및 수정 기록 — 2026-10-28

로컬 브랜치 **audit/release-20261028**에서 확인된 주요 기능·상태·접근성 문제를 수정하고, 최종 프로덕션 빌드와 전체 테스트 **89/89**, 독립 검토자의 재실행 **31/31**을 통과했다. 기존 다크/라이트 테마, 상태 색상, 월간 캘린더, 작업 보기 구조를 유지했다. 이 결과는 아래 로컬 검증 범위에 한정하며 운영 배포나 모든 브라우저에 대한 출시 인증을 뜻하지 않는다.

## 시작 상태와 검증 환경

- 시작 커밋: 3faa8fb, 시작 브랜치 master. 작업 트리는 깨끗했다. 기존 개발·운영 DB, 환경 파일, 의존성 버전, lockfile, 인증·보안 설정은 변경하지 않았다.
- Node 24.21.0, macOS arm64, Next 16.4.1 프로덕션 빌드. 프로젝트 최소 엔진 요구를 만족한다. 문서 권장 런타임인 Node 22에서의 이번 변경 재실행은 하지 않았다.
- 기존 README, DEVELOPMENT, 이전 검수 기록, 최근 커밋 및 API/UI 테스트를 먼저 확인했다. 기능·코드, DB/렌더링 성능, 독립 검토를 병렬로 나누고 파일 소유권을 지정했다. 같은 파일의 GET/POST 변경도 순차로 조율했다.
- scripts/test-server.mjs가 새 SQLite DB에 커밋된 migration을 적용하고 127.0.0.1의 별도 프로덕션 서버를 실행했다. 수동 브라우저 조작도 같은 방식의 임시 DB를 사용했다.
- Ego 브라우저로 화면을 직접 조작하고 캡처 이미지를 열어 확인했다. 자동화는 프로젝트의 Playwright Chromium 1248을 임시 경로에 설치해 실행했다.
- 검수 단계에서는 배포, push, 외부 메시지 발송, 유료 서비스 사용을 하지 않았다. 이 문서는 커밋·병합 전 검수 결과이며, 후속 승인에 따른 Git 반영 상태는 저장소 이력을 기준으로 한다.

| 기준선 | 결과 및 근거 |
|---|---|
| lint / typecheck | 성공: [lint](release-audit-20261028/baseline-lint.txt), [typecheck](release-audit-20261028/baseline-typecheck.txt) |
| 기본 build | 최초 실행은 샌드박스 포트 생성 오류. 오류가 남은 캐시를 임시 위치에 보존하고 새 캐시로 기본 Turbopack 빌드 성공: [실패](release-audit-20261028/baseline-build.txt), [성공](release-audit-20261028/baseline-build-clean.txt) |
| 기존 API·날짜·TODO·캘린더 회귀 | 성공. 최초 전체 실행의 UI 3개 상위 그룹은 요구 Chromium 부재로 시작하지 못했다: [원본](release-audit-20261028/baseline-tests.txt) |
| 기존 브라우저 회귀 | Chromium 설치 후 24/24 성공: [기준선 UI](release-audit-20261028/baseline-ui.txt) |
| 새 상호작용 검사 | 하위 8개 모두 수정 전 실패: [재현](release-audit-20261028/before-interactions.txt) |
| 새 경계 검사 | 날짜 마지막 999ms, 205건 대시보드, 장기 간트 DOM 상한·휴일 경계에서 실패 재현: [커서/날짜](release-audit-20261028/before-cursor-pagination.txt), [홈](release-audit-20261028/before-dashboard.txt), [간트](release-audit-20261028/before-gantt.txt), [휴일 경계](release-audit-20261028/before-gantt-holiday.txt) |

## 확인한 문제와 수정

심각도는 P1=핵심 흐름 접근 불가, P2=잘못된 결과·상태·사용성 또는 측정된 성능 문제로 분류했다. 수정 위험은 해당 코드의 변경 범위를 기준으로 평가했다. 취향에 따른 리디자인은 포함하지 않았다.

### 휴일을 만든 뒤 수정·삭제할 수 없음 — P1 / 위험 낮음

- 근거: [month-view.tsx](../components/calendar/month-view.tsx)는 HOLIDAY를 일반 일정 칩에서 제외하고 제목을 span에 합쳐 표시했다. 실제 생성한 휴일 제목을 클릭해도 편집창이 열리지 않았고 키보드 포커스 대상도 아니었다.
- 영향: 잘못 입력한 휴일을 캘린더에서 고칠 수 없다.
- 수정: 기존 날짜 옆 표시와 색상은 유지하면서 각각의 휴일 제목을 이름 있는 버튼으로 만들었다.
- 완료 확인: 같은 날 휴일 두 개를 개별 선택하고 Enter로 편집, 저장 실패 후 초안 유지·재시도, 삭제 및 GET 404까지 확인했다.

### 저장·삭제 진행 상태가 폼 조작을 막지 않음 — P2 / 위험 중간

- 근거: [작업 폼](../components/work-items/work-item-form-dialog.tsx), [일정 폼](../components/calendar/event-form-dialog.tsx), [작업 드로어](../components/work-items/work-item-drawer.tsx). 요청을 지연시키면 입력·취소가 계속 활성화됐다. 응답 완료 콜백은 현재 폼을 닫는 구조였다.
- 영향: 저장 요청 이후 바꾼 입력은 이미 전송된 값과 달라지며, 닫기와 다음 편집을 섞으면 초안 소실 위험이 있다. 이 위험은 확인된 상태 전환에서 도출한 영향이며 운영 데이터 손실 사례를 관찰한 것은 아니다.
- 수정: 동기 ref로 쓰기 재진입을 막고 진행 중 입력·닫기를 잠시 제한한다. 실패하면 폼 안의 지속적인 오류 안내, 초안, 재시도 경로를 유지한다. 목록·상세 모두 tickets를 포함하므로 도달하지 않는 별도 티켓 조회·빈 배열 fallback도 제거했다.
- 완료 확인: 저장·삭제 지연, Escape, 입력/취소 비활성, 503 오류 후 재시도, 한 번의 쓰기를 브라우저 회귀와 직접 조작으로 검증했다.

### 모바일 티켓 입력과 작은 화면의 일정 폼 — P2 / 위험 낮음

- 근거: 390×844에서 시스템 선택 고정 폭 때문에 티켓 입력칸이 **36px**가 됐다. 390×667에서는 일정 폼이 화면보다 높았다.
- 영향: 티켓번호를 읽고 편집하기 어렵고 일정 폼 상하단 접근이 불편하다.
- 수정: 모바일 티켓 행을 시스템 선택/번호 두 줄로 배치하고, 각 입력에 접근 가능한 이름을 붙였다. 일정 폼 높이를 동적 화면 높이 안에 제한하고 내용만 스크롤한다.
- 완료 확인: 같은 390px 조건에서 티켓 입력 폭 **284px**, 폼 가로 넘침 0. 작은 화면에서 제목 입력·저장 및 삭제 흐름을 확인했다.

### 이관 화면의 키보드 진입점과 잘못된 요일 — P2 / 위험 낮음

- 근거: [transfer-client.tsx](../components/transfer/transfer-client.tsx)의 작업명은 클릭 가능한 td였고, KST 날짜에 브라우저 현지 getDay()를 적용했다. UTC 브라우저에서 2026-10-28이 화요일로 표시됐다.
- 영향: 키보드로 상세를 열 수 없고 한국 밖 시간대에서 요일을 잘못 읽게 된다.
- 수정: 제목 버튼을 추가하고 날짜 문자열의 요일은 UTC 날짜축으로 계산한다.
- 완료 확인: UTC 브라우저에서 수요일 표시, Enter 상세 열기, Escape 닫기와 제목 포커스 복원을 확인했다.

### 관계 정보가 감사 이력에서 빠짐 — P2 / 위험 낮음

- 근거: [작업 POST](../app/api/work-items/route.ts), [작업 PATCH](../app/api/work-items/[id]/route.ts), [일정 PATCH](../app/api/calendar-events/[id]/route.ts). 티켓 생성/교체/제거와 일정의 이전 담당자 ID가 감사 스냅샷에 없었다.
- 영향: 누가 어떤 연동 정보·담당자를 바꿨는지 이전 값과 비교할 수 없다.
- 수정: 기존 트랜잭션 안에서 관계의 이전/이후 값을 기록한다. 일정 담당자는 순서를 정규화하고, 관계 필드 생략 시 기존 관계 유지 의미를 보존했다.
- 완료 확인: [관계 회귀](../scripts/relation-audit-regression.test.mjs) 하위 6개 통과. 감사 기록 실패를 주입했을 때 부모·티켓·로그가 함께 롤백됨도 검사했다. 최초 하위 4개 실패는 도구 stdout으로 재현했으며 별도 원본 로그 파일은 보관하지 않았다.

### 오래된 활동과 등록자 누락 — P2 / 위험 낮음

- 근거: [작업 드로어](../components/work-items/work-item-drawer.tsx)가 활동 첫 50개만 보여주고 등록자는 최근 100개 안에서만 찾았다. 101회 수정 fixture에서 등록자가 “—”로 표시됐다.
- 영향: 오래 사용한 작업의 생성·과거 변경 이력에 접근할 수 없다.
- 수정: 활동에 50개씩 더보기와 재시도를 추가했다. 등록자/최종 수정자는 각각 action 필터·pageSize 1로 조회한다. 이전 요청을 취소하고 실패한 후속 페이지에서 기존 목록을 보존한다.
- 완료 확인: 102개 이력 끝까지 키보드·모바일 접근, 최초/후속 조회 실패 복구, 등록자 표시를 [활동 회귀](../scripts/activity-ui-regression.test.mjs)에서 검증했다.

### 대시보드 200건 제한과 장애를 0건으로 표시 — P2 / 위험 중간

- 근거: [dashboard-client.tsx](../components/dashboard/dashboard-client.tsx)는 두 작업 요약을 pageSize 200으로 한 번만 읽었다. 조회 실패에는 0과 빈 배열을 넣었다. 205건 fixture와 503 응답으로 실제 재현했다.
- 영향: 실제 업무가 요약에서 누락되고, 장애를 업무 없음으로 오인한다.
- 수정: 마지막 페이지까지 조회하고 최신 요청만 반영한다. 작업·오늘 일정·최근 활동의 실패를 빈 상태와 구분하고 재시도를 제공한다. 갱신 실패 때는 기존 데이터와 “이전 조회 결과” 안내를 함께 보여준다. 최근 활동은 화면에서 필요한 10개만 요청한다.
- 완료 확인: 205건 전체 표시, 초기 실패/복구, 모바일 독립 오류, 늦은 응답과 갱신 실패 후 206건 보존을 [대시보드 회귀](../scripts/dashboard-regression.test.mjs)에서 검증했다.

### 날짜 필터의 마지막 999ms 누락 — P2 / 위험 낮음

- 근거: 작업 이관일, TODO 기한 목록·건수의 종료 필터가 23:59:59 이하를 사용했다.
- 영향: 당일 23:59:59.001~.999의 정상 데이터가 월/일 범위 집계에서 빠진다.
- 수정: KST 다음 날 자정 미만으로 비교했다.
- 완료 확인: 마지막 밀리초 포함, 다음 날 제외, 목록과 TODO 건수 일치를 [커서/날짜 회귀](../scripts/cursor-pagination.test.mjs)로 확인했다.

### 후속 페이지 전체 행 조회 — P2 / 위험 중간

- 근거: 작업/TODO/감사 로그가 커서가 있으면 전체 정렬 결과를 JS로 가져와 절단했다.
- 수정: [공통 커서 조건](../lib/pagination.ts)과 동일 SQL의 커서 CTE를 사용해 커서 자신부터 최대 pageSize+2행만 읽는다. 기존 ID 커서 계약, 정렬 동률, 이관일 NULL 순서, 삭제/필터 이탈 커서의 400 응답을 유지했다.
- 완료 확인: 첫/중간/깊은 페이지의 결과 동일성, nullable 정렬, 잘못된 커서와 마지막 커서 구분을 검증했다. 측정은 다음 절에 있다.

### 장기 간트의 과도한 DOM과 휴일 시간대 경계 — P2 / 위험 중간

- 근거: [gantt-view.tsx](../components/work-items/gantt-view.tsx)는 10년 작업 하나에 3,668개 날짜 열을 만들었다. 표시용 UTC 날짜축을 실제 조회 범위로 쓰면서 첫날 종일 휴일도 누락했다.
- 수정: 전체 기간/작업바/가로 폭을 유지하고 날짜 헤더·배경만 현재 화면과 앞뒤 4열로 렌더링한다. 휴일 조회·날짜 전개에는 실제 KST 자정 범위를 전달한다.
- 완료 확인: 10년 마지막 날짜, 중간 날짜 정렬, 모바일 리사이즈/스크롤, 키보드 상세, 첫날·마지막날 휴일 및 종일 종료일 제외를 [간트 회귀](../scripts/gantt-regression.test.mjs)로 검증했다.

## 같은 조건의 성능 비교

DB: Node 24.21.0, 같은 in-memory libsql/Drizzle DB, 각 테이블 10,000행·약 4KB 텍스트/행, pageSize 50. 준비 3회 후 전후 실행 순서를 교대로 바꿔 15회 측정했다. 아래는 두 번째 페이지의 중앙값이다. 5,000·9,500번째 커서에서도 결과 동일성을 확인했다.

| DB 쿼리·Drizzle 행 변환·페이지 절단 | 수정 전 | 수정 후 |
|---|---:|---:|
| 진행 작업 후속 페이지 | 117.473ms | 9.776ms |
| 이관 정렬 후속 페이지 | 101.034ms | 7.488ms |
| TODO 후속 페이지 | 61.422ms | 7.044ms |
| 감사 로그 후속 페이지 | 63.864ms | 19.765ms |
| 드라이버에서 JS로 가져온 행 | 10,000 | 52 |

[원본 JSONL](release-audit-20261028/cursor-performance.jsonl), [재현 스크립트](../scripts/benchmark-cursor-pagination.mjs), 실행: npm run benchmark:cursor. HTTP 전송량·관계 하이드레이션·브라우저 렌더링을 포함하지 않는다. 응답은 원래도 한 페이지였으므로 네트워크 응답 크기가 같은 비율로 줄었다고 해석하면 안 된다.

간트: 독립 검토자가 Ego 1323×972, 같은 2020-01-01~2030-01-01 작업 1개, 준비 1회 후 5회 측정했다. 보기 버튼 클릭부터 **첫 React DOM 반영과 강제 레이아웃 계산**까지의 중앙값은 **60.2→2.6ms**였다. 첫 반영 때 차트 영역 요소는 **14,688→174개**, 날짜 열은 **3,668→40개**, viewport 계산이 끝난 후 날짜 열은 **31개**였다. 전체 가로 스크롤 폭 **117,536px**와 마지막 날짜 접근은 유지했다. 페인트·전체 페이지 로딩·실제 사용자 환경의 체감 시간 측정은 아니다. 병렬 탭의 requestAnimationFrame 지연이 섞인 초기 측정은 제외했다.

[간트 전 원본](release-audit-20261028/gantt-commit-baseline.json), [후 원본](release-audit-20261028/gantt-commit-after.json). DOM 상한·스크롤 유지 검증은 npm run test:ui에 포함된다.

## 실제 화면 확인

정상 화면뿐 아니라 로딩, 빈 상태, 조회/저장 실패와 복구, 긴 제목·시스템 이름·티켓번호, 키보드, 390px 모바일을 확인했다. 이미지는 실제 실행 앱에서 캡처하고 직접 열어 확인했으며, 에뮬레이션 직후 전환 애니메이션이 섞인 캡처는 다시 촬영했다.

| 화면 | 수정 전 | 수정 후 |
|---|---|---|
| 모바일 티켓, 390×844 | [36px 입력](release-audit-20261028/before-mobile-tickets.png) | [284px 입력](release-audit-20261028/after-mobile-tickets.png) |
| 모바일 일정, 390×667 | [높이 초과](release-audit-20261028/before-mobile-event.png) | [스크롤 폼](release-audit-20261028/after-mobile-event.png) |
| 휴일 | [선택 불가](release-audit-20261028/before-holiday.png) | [키보드 편집](release-audit-20261028/after-holiday-keyboard-mobile.png) |
| 장기 간트 | [전](release-audit-20261028/before-gantt-long.png) | [후](release-audit-20261028/after-gantt-long.png), [끝 날짜](release-audit-20261028/after-gantt-end.png), [모바일](release-audit-20261028/after-gantt-mobile.png) |
| 홈 | [기준선](release-audit-20261028/before-desktop-home.png) | [205건 검증](release-audit-20261028/after-dashboard-205.png), [조회 실패](release-audit-20261028/after-dashboard-work-error.png) |

추가 확인: [모바일 빈 상태](release-audit-20261028/after-mobile-empty.png), [로딩](release-audit-20261028/after-mobile-loading.png), [오류·재시도](release-audit-20261028/after-mobile-error.png), [저장 중](release-audit-20261028/after-calendar-pending-mobile.png), [과거 활동](release-audit-20261028/after-activity-mobile.png), [활동 오류](release-audit-20261028/after-activity-retry.png), [대시보드 모바일 오류](release-audit-20261028/after-dashboard-mobile-errors.png).

각 기능 재현에 필요한 합성 데이터를 썼으므로 모든 전후 화면의 레코드 내용이 같은 것은 아니다. 모바일 폭과 간트 성능 비교는 위에 명시한 동일 조건을 사용했다.

## 최종 검증과 재현

| 실행 | 결과 | 근거 |
|---|---|---|
| npm run lint | exit 0 | [로그](release-audit-20261028/final-lint.txt) |
| npm run typecheck | exit 0 | [로그](release-audit-20261028/final-typecheck.txt) |
| npm run build | 기본 Turbopack 성공 | [로그](release-audit-20261028/final-build.txt) |
| node --test scripts/*.test.mjs | 89/89, 실패·취소·skip 0 | [전체 로그](release-audit-20261028/final-tests.txt) |
| 독립 검토자 5개 회귀 재실행 | 31/31, 실패·취소·skip 0 | [독립 로그](release-audit-20261028/independent-final.txt) |
| 대시보드 캡처 fixture 정리 후 재실행 | 5/5 | [로그](release-audit-20261028/final-dashboard.txt) |
| 변경 공백 검사 | git diff --check 성공 | 최종 도구 실행 기록 |

텍스트 실행 로그는 줄 끝 공백과 불필요한 마지막 빈 줄만 정리했다. JSON 측정값과 테스트 결과는 변경하지 않았다.

89에는 하위 검사 77개와 상위 그룹 12개가 포함된다. 기존 smoke의 HTTP 확인 155회는 이 테스트 수에 추가로 더하지 않는다. 중간 통합 실행에서 간트 모바일 검사 하나는 차트가 세로 화면 아래에 있어 실패했다. 실제 box 좌표로 가로 배치는 정상임을 확인한 뒤 먼저 차트까지 세로 스크롤하는 테스트 단계로 바로잡았다. [진단 근거](release-audit-20261028/gantt-mobile-diagnosis.txt).

핵심 흐름은 이름 등록, 설정·팀원·코드 관리, 작업 생성/편집/상태 전환·테이블/칸반/간트, 이관, TODO·체크리스트, 일정 생성/편집/드래그/삭제, SSE, 감사 이력, 백업 생성/다운로드/SQLite 무결성을 포함한다. 회귀에는 날짜 경계, 동시 TODO 편집, 원자 롤백, 늦은 응답, 저장·조회 오류 복구, 긴 목록, 모바일·키보드를 포함했다.

일반 재현:

    npm run check
    npx playwright install chromium
    npm run test:ui
    npm run benchmark:cursor

이번 실행은 설치/실행 모두 PLAYWRIGHT_BROWSERS_PATH=/private/tmp/cc-release-playwright를 사용했다. 개별 테스트를 실행할 때도 먼저 빌드가 필요하다. UI 캡처를 남기려면 RELEASE_UI_ARTIFACT_DIR에 절대 경로를 지정한다.

README와 DEVELOPMENT의 실행 스크립트, 후속 커서 계약, 감사 스냅샷, 폼 상태, 대시보드, 간트 렌더링 설명을 실제 코드에 맞췄다. README의 현재 존재하지 않는 주 보기 설명도 현재 월 보기 기준으로 바로잡았다.

## 남은 제약과 미검증 범위

- 이번 실행은 Node 24.21.0, Chromium/Ego와 모바일 에뮬레이션 기준이다. Node 22 재실행, Safari/WebKit·Firefox, 실제 모바일 기기·가상 키보드, 스크린리더·전체 WCAG/색 대비 검수는 하지 않았다.
- 실제 운영 DB, 장시간 부하·대량 동시 사용자, 다중 프로세스 SSE/cron, 운영 복원 훈련, 현시점 의존성 취약점 전수 검사는 하지 않았다.
- 현재 제품은 인증 없는 내부망 도구다. 외부 공개 접근 제어는 기존 제품 경계이며 사용자 승인 없이 변경하지 않았다.
- 작업·일정의 동시 편집 충돌 방지는 아직 없다. TODO 드로어만 선택적 expectedUpdatedAt 계약을 사용한다. 이번 폼 가드는 한 폼의 진행 중 조작을 보호하며 서버의 idempotency나 모든 동시 편집을 보장하지 않는다.
- 홈의 전체 목록 수집·렌더링, 팀원 목록 전체 조회, 많은 간트 작업바는 데이터 규모에 따라 추가 비용이 생긴다. 이번 수치는 특정 합성 fixture의 후속 조회·날짜 열 개선에 한정한다. 대시보드 전용 집계 API나 행 가상화는 도입하지 않았다.
- 삭제된 팀원의 과거 관계 보존과 새 배정 허용 정책은 변경하지 않았다. 참조 데이터 무결성 정책의 전면 변경은 별도 설계 범위로 남겼다.

확인된 이번 우선 수정과 관련 검증은 완료했다. 승인이나 외부 접근 때문에 미완료로 남은 필수 수정은 없다. 위 미검증 범위를 검증 성공으로 표시하지 않는다.
