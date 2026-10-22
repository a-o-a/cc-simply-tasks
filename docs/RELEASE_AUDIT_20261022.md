# 출시 전 검수 기록 — 2026-10-22

확인된 주요 데이터 손실·목록 누락·모바일 사용성 문제를 수정하고 로컬 프로덕션 빌드에서 재검증했다. Node 22.13.0과 24.21.0에서 lint, typecheck, 기본 Turbopack build 및 전체 회귀 검증이 통과했다. 수정에 참여하지 않은 검토자의 재검수에서도 잔여 P1/P2 문제를 발견하지 못했다. 이 결과의 범위는 아래 환경과 검증 항목이며, 외부 공개 배포나 전체 접근성 인증을 뜻하지 않는다.

## 작업 범위와 기존 변경 보존

- 로컬 브랜치: `codex/release-audit-20261022`. 시작 커밋은 `cffac9f`였으며, 시작 당시 작업 트리에 이미 Node/Next 업그레이드 등 사용자 변경이 있었다. 이 검수는 그 상태를 기준선으로 삼았다.
- 시작 파일 127개의 내용과 해시, 기존 Git diff/status를 `/private/tmp/cc-release-audit-20261022/`에 보관했다. 완료 시 기존 파일 누락은 0개다. 기존 파일 중 이번 검수에서 추가 변경한 37개는 [목록](release-audit/changed-existing-files.json)으로 분리했다. `git diff` 전체를 이번 검수의 변경으로 간주하면 안 된다.
- 의존성·lockfile·환경 설정·스키마 migration은 변경하지 않았다. 테스트와 화면 조작은 임시 SQLite DB와 `127.0.0.1`의 별도 프로덕션 서버에서 수행했다.
- 배포, push, 유료 서비스 사용, 인증·보안 설정 변경은 수행하지 않았다.
- 기능 QA, 성능, UI/코드 관점으로 병렬 검토했다. 수정 파일의 소유자를 나누고, 공유 파일은 순차로 수정했다. 기능 QA 검토자는 구현에 참여하지 않고 최종 재검수를 맡았다.

## 기준선

| 항목 | 수정 전 결과 | 증거 |
|---|---|---|
| 실행 환경 | macOS arm64, Node 24.21.0, Next 16.4.1, React 19.3.1, libsql/SQLite | 프로젝트 `package.json` 및 실행 결과 |
| lint / typecheck | 통과 | [lint](release-audit/baseline-lint.txt), [typecheck](release-audit/baseline-typecheck.txt) |
| 기본 build | 제한된 실행 환경의 프로세스·포트 권한 문제로 실패 | [실패 로그](release-audit/baseline-build.txt) |
| 기준선 실행용 build | webpack 빌드 통과, 해당 결과로 앱 실행 | [빌드 로그](release-audit/baseline-build-webpack.txt) |
| 기존 API smoke | 11/11, 임시 DB에 대한 HTTP 확인 155회 | [로그](release-audit/baseline-smoke.txt) |
| 기존 브라우저 테스트 | 4/4 | [로그](release-audit/baseline-ui.txt) |
| 새 날짜 회귀 | 하위 검증 3개 모두 실패 | [로그](release-audit/before-date-regression.txt) |
| 새 출시 UI 회귀 초기 6개 | 모바일, 키보드, 늦은 응답, 오류 복구, 팀원 경계 모두 실패 | [로그](release-audit/before-release-ui.txt) |

기존 정상 흐름 테스트만으로는 아래 문제를 찾지 못했다. 실패 재현을 추가하고 작은 묶음으로 수정했다. 최초 build의 실행 환경 문제는 생성된 캐시를 별도 보관한 후 재빌드해 해소했으며, 최종 검증은 webpack 우회 없이 기본 Turbopack을 사용했다. 번들러와 캐시 조건이 달라 빌드 시간을 성능 개선 수치로 비교하지 않는다.

## 확인된 문제와 처리

심각도는 P1=데이터 손실 또는 주요 데이터 접근 불가, P2=잘못된 입력·상태·사용성·성능 문제로 구분했다. 아래는 재현 또는 측정된 항목이며 취향에 따른 리디자인 제안은 포함하지 않았다.

### 1. TODO 초안 소실과 부분 저장 — P1, 수정 위험 중간

- **근거/재현:** TODO 최초 목록 응답을 지연시킨 뒤 새 TODO를 입력하면 응답 도착 시 드로어의 초기화 effect가 다시 실행되어 초안이 지워졌다. 기존 편집은 부모 저장과 체크리스트 삭제·추가·수정을 여러 HTTP 요청으로 처리했다. [드로어](../components/todos/todo-drawer.tsx), [TODO API](../app/api/todos/[id]/route.ts).
- **사용자 영향:** 입력 내용이 유실된다. 중간 실패 시 일부만 저장되고, 재시도할 때 이미 추가된 항목이 중복될 수 있었다.
- **해결:** 닫기 콜백을 안정화하고 상세 요청을 취소 가능하게 했다. 부모 필드·체크리스트·감사 로그를 한 PATCH와 한 트랜잭션으로 저장한다. 기존 ID는 유지하고 생략된 항목만 soft delete하며 외부/중복 ID를 거부한다. 실패 시 초안과 재시도 경로를 유지한다.
- **완료 확인:** 저장 중 DB 오류를 주입해 부모·자식·감사 로그가 모두 롤백되고, 재시도 한 번으로 정상 저장되는지 확인했다. Enter/IME 입력, 늦은 목록 응답, 저장 실패 후 재시도도 브라우저에서 통과했다. [수정 전 실패](release-audit/before-todo-regression.txt), [회귀 테스트](../scripts/todo-regression.test.mjs).

### 2. TODO 동시 편집으로 다른 사용자 변경을 덮어쓰기 — P1, 수정 위험 중간

- **근거/재현:** 원자 저장의 1차 구현을 독립 검토할 때 발견했다. A가 드로어를 연 뒤 B가 체크리스트를 추가·완료하고 A가 저장하면 B의 변경이 오래된 전체 목록으로 대체됐다. [수정 전 실패 3개](release-audit/before-todo-concurrency-regression.txt).
- **사용자 영향:** 다른 사용자의 추가 항목 또는 완료 상태가 사라진다.
- **해결:** 공식 드로어는 `expectedUpdatedAt`을 전송한다. 서버는 트랜잭션 안에서 버전을 비교해 충돌 시 409를 반환한다. 모든 부모·체크리스트 변경은 부모 버전을 최소 1ms 증가시킨다. 충돌 시 초안을 유지하고 최신 내용을 다시 확인하도록 지속적인 오류 안내를 표시한다.
- **완료 확인:** 동시 추가, 동시 완료, 같은 시각의 연속 쓰기, 드로어 충돌 안내를 API와 실제 브라우저 테스트로 검증했다. 기존 클라이언트와 호환되도록 버전 필드는 선택적이며, 생략 호출은 충돌 보호 대상이 아니다.

### 3. 51번째 작업·팀원 및 월별 집계 누락 — P1, 수정 위험 중간

- **근거/재현:** 51개 이상 등록하면 진행 작업의 뒤쪽 항목에 접근할 수 없었고, 팀원 관리·선택 및 캘린더 집계는 첫 페이지만 사용했다. 홀딩 작업은 기본 칸반의 상태 목록에서 빠졌다. [작업 목록](../components/work-items/work-items-client.tsx), [회원 관리](../app/members/members-client.tsx), [캘린더](../components/calendar/calendar-client.tsx).
- **사용자 영향:** 실제 존재하는 작업·담당자가 사라진 것처럼 보이고 이관 건수가 과소 집계된다.
- **해결:** 진행 작업에 `더보기`를 추가했고 이관 완료는 기존 `이전`·`다음` 페이지 이동을 유지한다. 팀원 및 기간 집계는 공통 `api.getAll()`로 마지막 페이지까지 조회하며 중복 커서를 방지한다. 기본 진행 상태에 HOLDING을 포함했다. 삭제된 커서는 첫 페이지를 반복하는 대신 400으로 알리고, 목록을 보존한 채 처음부터 재조회할 수 있게 했다.
- **완료 확인:** 51번째 항목에 테이블·칸반·간트에서 접근, 51번째 팀원 관리·배정, 205건 캘린더 집계, 정렬 동률/필터/페이지 연결, 삭제된 커서 복구 및 홀딩 노출을 검증했다. [페이지 회귀](../scripts/pagination-regression.test.mjs), [수정 전](release-audit/pagination-before.txt), [홀딩 재현](release-audit/holding-before.txt).

### 4. 부분 PATCH의 잘못된 날짜 범위 허용 — P2, 수정 위험 낮음

- **근거/재현:** 저장된 시작일보다 앞선 종료일만 PATCH하거나, 저장된 종료 시각보다 늦은 시작 시각만 PATCH하면 잘못된 최종 범위를 만들 수 있었다. 존재하지 않는 날짜와 역순 필터도 허용됐다. [작업 API](../app/api/work-items/[id]/route.ts), [일정 API](../app/api/calendar-events/[id]/route.ts), [검증 스키마](../lib/validation/).
- **사용자 영향:** 간트·캘린더에서 의미 없는 범위나 누락된 결과가 나타날 수 있다.
- **해결:** DB 기존 값과 PATCH 입력을 합친 최종 범위를 트랜잭션 안에서 검증한다. 실제 달력 날짜 및 필터 범위를 검증한다. 작업 날짜는 같은 날을 허용하고, 일정은 종료 시각이 시작보다 뒤여야 한다.
- **완료 확인:** 잘못된 단일 필드 변경은 400, 원래 시작·종료 값은 유지, 정상 경계값은 저장됨을 확인했다. [테스트](../scripts/date-regression.test.mjs).

### 5. 늦은 응답·조회 실패의 잘못된 표시 — P2, 수정 위험 중간

- **근거/재현:** 이전 검색/상세 응답을 지연시키면 최신 선택을 덮을 수 있었다. TODO와 캘린더 실패는 빈 데이터처럼 보이거나 직접 복구할 경로가 부족했다. [TODO 목록](../components/todos/todos-client.tsx), [작업 상세](../components/work-items/work-item-drawer.tsx), [캘린더](../components/calendar/calendar-client.tsx).
- **사용자 영향:** 다른 작업의 상세가 보이거나 오래된 검색 결과를 믿게 되고, 장애를 데이터 없음으로 오인한다.
- **해결:** 요청 취소 및 순서 검사를 적용하고 상세 전환 시 이전 데이터를 비운다. 작업/TODO 제목 검색은 250ms 대기를 사용하며, 작업 검색에는 IME·Enter 처리도 적용했다. 로딩·빈 결과·오류를 구분하고 오류에는 재시도를 제공한다.
- **완료 확인:** A 검색/상세를 늦게 반환한 뒤 B 결과가 유지되는지, 500 응답 후 같은 조건으로 복구되는지 확인했다. 지연 응답의 전달 완료까지 기다리는 회귀 테스트를 사용했다. [브라우저 회귀](../scripts/release-ui.test.mjs).

### 6. 모바일 본문 잘림과 긴 입력의 조작 어려움 — P2, 수정 위험 중간

- **근거/재현:** 390px 화면에서 고정 240px 사이드바가 본문을 150px로 줄였고 본문은 768px 최소 폭을 유지했다. [셸](../components/app-shell.tsx), [메뉴](../components/sidebar.tsx), [드로어](../components/ui/sheet.tsx).
- **사용자 영향:** 필터·저장 버튼이 화면 밖으로 밀려 주요 기능을 쓰기 어렵다.
- **해결:** 기존 색상·타이포그래피·데스크톱 사이드바를 유지하면서 모바일 상단 메뉴, 한 열 필터, 전체 폭 드로어와 줄바꿈을 적용했다. 테이블·간트·월간 캘린더는 해당 영역 내부에서 가로 스크롤한다.
- **완료 확인:** 390px에서 홈·작업·이관·TODO·캘린더·설정의 본문과 주요 컨트롤, 긴 제목·체크리스트, 실제 생성·Enter 저장, 캘린더 가로 스크롤을 확인했다. 본문 `clientWidth/scrollWidth`는 `150/768px → 390/390px`이다.

### 7. 키보드로 작업 상세를 열 수 없음 — P2, 수정 위험 낮음

- **근거/재현:** 작업 테이블의 클릭 가능한 행이 키보드 동작을 제공하지 않았다. [테이블](../components/work-items/table-view.tsx), [날짜 선택기](../components/ui/date-picker.tsx), [팀원 선택](../components/member-filter.tsx).
- **사용자 영향:** 마우스 없이 작업 상세에 접근하기 어렵고 일부 컨트롤의 의미를 파악하기 어렵다.
- **해결:** 제목을 네이티브 버튼으로 만들고 닫을 때 원래 버튼으로 포커스를 복원한다. 날짜 트리거는 네이티브 버튼과 연결된 label을 사용한다. 날짜 초기화·이전/다음·체크리스트·팀원 버튼에 이름과 상태를 제공한다.
- **완료 확인:** Tab/Enter로 상세 열기, Escape로 닫기 및 포커스 복귀, 날짜 선택기 키보드 사용을 브라우저에서 검증했다. 전체 WCAG 적합성이나 스크린리더 검증은 수행하지 않았다.

### 8. 목록 첫 페이지의 전체 행 로딩 및 긴 일정의 전체 날짜 계산 — P2, 수정 위험 낮음~중간

- **근거:** 작업·TODO·감사 로그는 전체 정렬 결과를 JS로 가져온 다음 50건으로 잘랐다. 장기 일정은 화면 밖 날짜까지 모두 전개했다. [목록 API](../app/api/work-items/route.ts), [날짜 헬퍼](../lib/client/calendar.ts).
- **사용자 영향:** 데이터 누적과 장기 일정에 따라 조회·계산 비용이 커진다.
- **해결:** 첫 페이지에 SQL `LIMIT take + 1`을 적용하고, 캘린더·간트의 날짜 전개를 현재 보이는 기간으로 제한했다. 기존 정렬과 종일 일정의 종료일 제외 규칙을 유지한다.
- **완료 확인:** 전후 첫 51행 및 보이는 날짜 키가 동일함을 assert한 뒤 같은 fixture에서 반복 측정했다. 결과는 다음 절에 있다. 후속 커서 페이지의 전체 조회는 아직 남아 있다.

## 성능 측정

[재현 스크립트](../scripts/benchmark-pagination.mjs): `npm run benchmark`. [원본 JSONL](release-audit/performance.jsonl).

Node 24.21.0에서 같은 libsql 메모리 DB·migration·합성 데이터(각 테이블 10,000행, 행당 약 4KB 텍스트)를 사용했다. 준비 실행 3회 후 전후 순서를 교대로 바꾸어 각각 15회 측정했다. 아래는 중앙값이다.

| 측정 구간 | 수정 전 | 수정 후 | 동등성 확인 |
|---|---:|---:|---|
| 작업 첫 페이지 쿼리·JS 행 생성 | 84.342ms | 8.759ms | 첫 51행 동일 |
| TODO 첫 페이지 쿼리·JS 행 생성 | 45.696ms | 6.501ms | 첫 51행 동일 |
| 감사 로그 첫 페이지 쿼리·JS 행 생성 | 48.829ms | 0.330ms | 첫 51행 동일 |
| 10년 종일 일정 1건의 표시 날짜 계산 | 78.127ms | 0.924ms | 42일 그리드의 날짜 키 동일 |

목록에서 DB 드라이버가 JS로 만드는 행은 10,000개에서 51개로, 장기 일정 계산은 3,653일에서 42일로 감소했다. HTTP 전송량, 실제 사용자 DB, 페이지 전체 로딩 시간, 브라우저 렌더링 시간 또는 메모리 사용량을 측정한 결과는 아니다. 실제 효과는 데이터 크기·필터·서버 환경에 따라 달라진다.

## 전후 화면

스크린샷은 Ego 브라우저에서 실제 실행 앱을 조작해 저장하고 이미지를 직접 열어 검사했다. 빈 DB, 인위적 조회 실패/지연, 긴 콘텐츠를 각각 확인했다. 지연·실패 주입은 검수용 탭에 한정했으며 정상 조회 복구도 확인했다.

| 화면/조건 | 수정 전 | 수정 후 |
|---|---|---|
| 데스크톱 홈, 1440×1000, 다크 | [전](release-audit/before-desktop.png) | [후](release-audit/after-desktop.png) |
| 모바일 TODO, 390×844, 빈 결과 | [전](release-audit/before-mobile.png) | [후](release-audit/after-mobile.png) |
| TODO 조회 실패, 1440×1000 | [전](release-audit/before-error.png) | [오류·재시도](release-audit/after-error.png) |
| TODO 로딩, 960×1325 | [전](release-audit/before-loading.png) | [상태 표시](release-audit/after-loading.png) |

추가 최종 화면: [모바일 입력](release-audit/after-mobile-draft.png), [저장된 긴 제목·체크리스트](release-audit/after-mobile-long.png), [모바일 캘린더](release-audit/after-mobile-calendar.png), [오른쪽 날짜로 가로 스크롤](release-audit/after-mobile-calendar-scrolled.png).

## 최종 검증

모든 API/UI 테스트는 `scripts/test-server.mjs`가 만든 별도 프로덕션 서버·임시 DB를 사용했다. 다음의 테스트 수는 Node 러너 집계이며 전체 49에는 하위 검증 43개와 상위 그룹 6개가 포함된다. 저장소의 텍스트 로그 복사본은 커밋을 위해 줄 끝 공백과 파일 끝의 불필요한 빈 줄만 정리했다.

| 실행 | 결과 | 증거 |
|---|---|---|
| Node 24.21.0 lint / typecheck | 통과, exit 0 | [lint](release-audit/final-lint.txt), typecheck 도구 실행 기록 |
| Node 24.21.0 기본 Turbopack build | 통과 | [로그](release-audit/final-build.txt) |
| Node 24.21.0 smoke + date + TODO + calendar | 25/25 | [로그](release-audit/final-api.txt) |
| Node 24.21.0 기존 UI + 출시 UI + pagination | 24/24 | [로그](release-audit/final-ui.txt) |
| Node 22.13.0 lint / typecheck | 통과, exit 0 | [lint](release-audit/node22-lint.txt), typecheck 도구 실행 기록 |
| Node 22.13.0 기본 Turbopack build | 통과 | [로그](release-audit/node22-build.txt) |
| Node 22.13.0 전체 7개 테스트 파일 | 49/49, 실패·skip 0 | [TAP 로그](release-audit/node22-tests.txt) |
| 독립 검토자의 Node 22.13.0 TODO + 출시 UI 재실행 | 20/20, exit 0 | 독립 도구 stdout 기록, 별도 파일 미보관 |
| 독립 화면 재검수 | 데스크톱·모바일·긴 내용·초안·오류·로딩 6개 이미지 확인, 잔여 P1/P2 미발견 | 독립 검토 결과 |
| 변경 공백 검사 | `git diff --check` 통과 | 도구 실행 기록 |

핵심 흐름에는 액터 등록, 설정/팀원/코드 CRUD, 작업 생성·편집·상태 전환·테이블/칸반/간트, TODO 생성·편집·완료·체크리스트, 일정 생성·드래그, SSE, 감사 로그, 수동 백업·다운로드 및 SQLite 무결성 검증이 포함된다. 기존 정상 테스트를 유지하면서 잘못된 날짜, 오류 후 복구, 늦은 응답, 동시 편집, 페이지 경계를 추가했다.

재현 명령:

```bash
nvm use
npm run check
npx playwright install chromium
npm run test:ui
npm run benchmark
```

이번 환경에서는 Playwright 브라우저를 임시 경로에 설치하고 설치/실행에 같은 `PLAYWRIGHT_BROWSERS_PATH`를 사용했다. Node 22.13.0은 공식 배포 바이너리의 SHA256을 검증한 뒤 임시 경로에서 실행했다. 설치 정책이나 프로젝트 의존성을 변경하지 않았다.

README와 DEVELOPMENT 문서의 실행 스크립트, 반응형 구조, 페이지네이션, 원자 TODO 저장, 날짜 검증, `If-Match` 미지원 및 선택적 버전 계약을 실제 구현에 맞춰 갱신했다.

## 남은 제약과 미검증 범위

- **대규모 후속 페이지:** 첫 페이지 이외의 기존 ID 커서 조회는 전체 정렬 결과를 읽는다. 기간 전체를 모으는 `getAll()`도 페이지 수만큼 요청하므로 매우 큰 데이터에서는 별도 집계 API/키셋 페이지네이션 검토가 남는다. 이번 수치는 첫 페이지 최적화에 한정한다.
- **동시 편집:** TODO 드로어만 버전 검사를 사용한다. 다른 API 및 `expectedUpdatedAt`을 생략한 TODO 호출은 동시 편집 충돌을 막지 않는다. 전 API 계약 변경은 수행하지 않았다.
- **브라우저·접근성:** Chromium 자동화 및 Ego 화면, 에뮬레이션 390px를 검증했다. Safari/WebKit, Firefox, 실제 iOS/Android 기기, 스크린리더, 전체 색 대비·WCAG 검수는 미수행이다.
- **운영 환경:** 실제 운영 데이터, 장시간 부하, 다중 서버/SSE/cron, 배포·복원 실전 절차는 검증하지 않았다. 테스트 백업의 최신 데이터 포함 여부와 무결성은 검증했다.
- **제품의 기존 경계:** 현재는 인증 없는 내부망 도구다. 외부 공개를 위한 접근 제어는 이번 범위에 포함되지 않으며 보안 설정도 변경하지 않았다.

요청한 로컬 검수와 확인된 우선 문제 수정은 완료했으며, 승인이나 외부 접근 때문에 중단된 필수 수정은 없다. 위 운영·브라우저 확장 범위는 검증 완료로 표시하지 않는다.
