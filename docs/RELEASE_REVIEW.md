# 출시 전 검수 결과 — 2026-10-21

검수 범위의 중요한 결함을 수정하고 Node 22에서 회귀·프로덕션 HTTP·실제 화면·독립 재검수를 완료했습니다. 기존 업무 상태와 정보 구성을 유지했습니다. 주요 버튼의 색상은 후속 요청에 따라 아래와 같이 회색 계열로 조정했습니다. 스키마 변경과 데이터 이관은 없습니다. 로그인·권한 도입, 대량 데이터 가상화, 실운영 부하 검증은 아래 남은 범위입니다.

기준 커밋은 `e4a35de`, 초기 작업 트리는 깨끗했습니다. 로컬 `codex/release-readiness` 브랜치에서 작업했습니다. 개발·운영 DB와 기존 `.next`를 사용하지 않고 빈 DB 템플릿을 복제한 별도 디렉터리에서 앱을 빌드·실행했습니다. 배포·푸시·유료 서비스·인증/보안 설정 변경은 수행하지 않았습니다.

## 기준선과 검수 방법

Node **22.23.3**, npm **10.9.9**, macOS ARM64에서 확인했습니다. 호스트 기본 Node 26 대신 공식 Node 22 바이너리와 SHA256을 확인해 별도 임시 경로에서 실행했습니다. 프로젝트의 `.nvmrc`와 Node 22 엔진 조건을 유지합니다.

수정 전 `typecheck`, `lint`, `test:lint`, 단위 5개 모듈과 격리된 프로덕션 빌드가 통과했습니다. 기존 검사만으로 모바일·날짜 입력·저장과 검색 경합을 검출하지 못했습니다. [기준 검사 기록](release-assets/baseline-checks.txt)을 보존했습니다.

실제 Chrome에서 홈·작업·할 일·이관·캘린더·설정을 열고 조작했습니다. 기본 화면은 1440×1000과 390×844, 긴 콘텐츠는 추가로 320×568에서 확인했습니다. 로딩·빈 검색·500 오류·재시도, 긴 본문/제목/체크리스트, 키보드 메뉴·날짜 입력·지우기도 검사했습니다. API, 프론트 코드/성능, 의존성을 서브에이전트가 독립 조사했고, 수정에 참여하지 않은 별도 검토자가 최종 diff와 화면을 다시 검사했습니다.

## 확인한 문제와 수정

아래는 재현한 결함입니다. 취향에 따른 전면 디자인 변경은 포함하지 않았습니다. P1은 해당 화면의 주요 조작을 막는 문제, P2는 잘못된 입력/상태나 복구에 영향을 주는 문제입니다.

| 우선순위·수정 위험 | 근거·재현 | 사용자 영향 | 수정과 완료 확인 |
|---|---|---|---|
| P1 · 중간 | `components/app-shell.tsx`, `sidebar.tsx`: 390px 화면에서도 240px 사이드바와 768px 본문 강제 | 본문 150px만 보여 핵심 조작이 화면 밖으로 밀림 | 모바일 상단 메뉴, 화면별 반응형 배치, 큰 보기의 내부 가로 스크롤. 6개 화면 모두 본문/스크롤 폭 390px 확인 |
| P1 · 낮음 | `work-item-form-dialog.tsx`, `todo-drawer.tsx`: 모바일 긴 폼의 `fieldset`에 휠 스크롤 | 하단 입력을 볼 수 없고 저장 영역과 본문이 겹침 | 일반 div가 스크롤을 담당하고 fieldset은 비활성화만 담당. 실제 휠로 마지막 입력까지 도달, footer 고정 확인 |
| P1 · 낮음 | `lib/client/calendar.ts`, Calendar/Gantt: 40년 일정 10개를 한 달에 표시 | 불필요한 146,100개 날짜 계산으로 UI를 수초 점유 | 표시 범위의 교집합만 확장. 같은 입력 측정과 날짜 경계 회귀 검사, 독립 150개 조합 비교 통과 |
| P2 · 낮음 | `todos-client.tsx`: PATCH 응답을 지연시키고 다른 제목을 검색한 뒤 응답 완료 | 입력한 새 검색과 다른 목록을 표시 | 저장/드로어 완료 후 항상 최신 조회 콜백 사용. 지연 PATCH 브라우저 회귀 통과 |
| P2 · 중간 | 작업·할 일·체크리스트·일정 API: 없는 팀원 ID 또는 삭제된 팀원으로 새 배정 | 일반 500 오류 또는 삭제된 팀원 재배정 | `lib/db/member-validation.ts`에서 트랜잭션 안의 신규 관계 검증. 필드와 복구 안내가 포함된 400, 기존 삭제 관계 유지·해제, 부모/자식 rollback 검증 |
| P2 · 낮음 | `components/ui/date-picker.tsx`: `2026-10-21junk`를 입력 후 Enter | 잘못된 입력을 조용히 잘라서 수락. 날짜 제어의 이름·비활성화·키보드 지우기도 부족 | 정확한 날짜 형식 검사, native 버튼과 분리된 지우기, 달력/입력 이름과 오류 alert. 잘못된/존재하지 않는 날짜 거부와 키보드 지우기 통과 |
| P2 · 낮음 | 긴 TODO 제목과 담당자/마감일을 320px 화면에서 표시 | 목록 제목 폭이 수십 px로 줄고 드로어 제목이 저장/취소를 화면 밖으로 밀어냄 | 모바일 메타 정보를 두 번째 행으로 배치, 패널 제목 2줄 제한과 footer 축소 방지. 제목 폭 약 120px, 제목 높이 56px, 버튼 하단 556px 확인 |

초기 브라우저에서 확인한 favicon 404도 `app/icon.svg` 추가로 정리했습니다. 마지막 새 페이지 로드의 독립 검수에서는 console 오류/경고가 없었습니다. 강제로 발생시킨 500 네트워크 오류는 이 결과와 구분합니다.

## 측정 전후

| 측정 항목 | 수정 전 | 수정 후 |
|---|---:|---:|
| 40년 일정 10개의 월력 날짜 매핑 중앙값 | 4,223.384ms | 15.859ms |
| 같은 조건에서 생성한 날짜 key | 146,100개 | 420개 |
| 390px 화면의 본문 가용 폭 | 150px | 390px |
| 390px 화면의 본문 스크롤 폭 | 768px | 390px |
| production `npm audit` 영향 패키지 | High 1 | 0 |
| 전체 `npm audit` 영향 패키지 | High 5 + Moderate 4 | High 4 + Moderate 4 |

성능 측정은 같은 Node·장비에서 2006~2046년 종일 일정 10개를 2026년 10월의 42일 월력에 매핑했습니다. 워밍업 1회 후 5회 중앙값입니다. 해당 계산이 약 266배 빨라졌으며 **앱 전체 응답시간이나 DB 성능의 측정값은 아닙니다.** [수정 전 원본](release-assets/calendar-performance-before.json), [수정 후 원본](release-assets/calendar-performance-after.json)을 제공합니다. 빌드 속도 개선은 주장하지 않습니다.

`node scripts/benchmark-calendar.cjs current`로 현재 연산을 재측정할 수 있습니다. 기존 전체 기간 확장과 교집합 결과가 일치하도록 종일 일정의 끝날 제외, 시간 일정의 양끝 날짜, KST 자정과 월 경계를 검사했습니다.

## 화면 기록

동일한 viewport에서 비교한 최초 출시 검수 당시의 실제 화면입니다. 이 절의 블루 버튼 스냅샷은 아래 후속 색상 조정 이전의 기록입니다. 검수 과정에서 임시 데이터가 추가·변경되었으므로 표시 건수는 성능/정합성의 전후 비교값으로 사용하지 않습니다.

| 화면 | 수정 전 | 수정 후 |
|---|---|---|
| 홈 390×844 | [본문 잘림](release-assets/home-mobile-before.png) | [전체 본문](release-assets/home-mobile-after.png) |
| 작업 390×844 | [최소 폭 강제](release-assets/work-mobile-before.png) | [반응형 필터·제어](release-assets/work-mobile-after.png) |
| 긴 작업 폼 390×844 | [본문/버튼 겹침](release-assets/work-form-before.png) | [마지막 입력까지 스크롤](release-assets/work-form-after.png) |
| 긴 TODO 제목 320×568 | [버튼이 화면 밖으로 밀림](release-assets/todo-title-before.png) | [2줄 제목과 저장 영역](release-assets/todo-title-after.png) |

최종 주요 화면: [홈 데스크톱](release-assets/home-desktop-after.png), [할 일 모바일](release-assets/todos-mobile-after.png), [이관 모바일](release-assets/transfer-mobile-after.png), [캘린더 모바일](release-assets/calendar-mobile-after.png), [설정 모바일](release-assets/settings-mobile-after.png), [다크 모드](release-assets/settings-dark-after.png). 월력·테이블·칸반·간트는 각 보기 안에서 가로로 스크롤합니다.

상태 확인: [지연 로딩](release-assets/loading-mobile.png), [500 오류](release-assets/error-mobile.png). 강제 오류를 해제한 뒤 다시 시도로 복구하고, 없는 제목을 검색한 빈 결과에서 초기화로 돌아오는 것까지 확인했습니다. [화면 폭 수정 전](release-assets/screens-before.json), [수정 후](release-assets/screens-after.json)도 남겼습니다.

### 후속 색상 조정 — 차콜 버튼

사용자 요청에 따라 기본 버튼·선택 필터·날짜 선택·포커스의 공통 강조 토큰을 회색으로 바꿨습니다. 라이트 모드는 차콜 `#27272a`와 흰 글자, 다크 모드는 밝은 회색 `#d4d4d8`과 어두운 글자입니다. 진행·이관·휴일 등 업무 의미를 가진 색상은 유지했습니다. 앱 아이콘도 차콜로 맞췄습니다.

Node 22.23.3의 분리된 프로덕션 빌드와 Chrome 실제 화면에서 라이트/다크, 1440px/390px, 기본·호버·키보드 포커스·선택·비활성/활성 버튼을 확인했습니다. 기본 버튼의 글자/배경 대비는 각각 14.89:1, 13.46:1이며 모바일 본문/스크롤 폭은 390px입니다. [측정 기록](release-assets/neutral-buttons-check.json)을 보존합니다.

최신 색상: [기본 버튼 미리보기](release-assets/neutral-buttons-preview.png), [라이트·키보드 포커스](release-assets/neutral-buttons-light.png), [다크·키보드 포커스](release-assets/neutral-buttons-dark.png), [모바일 라이트](release-assets/neutral-buttons-mobile-light.png), [모바일 다크](release-assets/neutral-buttons-mobile-dark.png).

### 후속 폼 간격 통일 — 5px

사용자 지정에 따라 수직 라벨–입력칸 간격을 **5px**로 통일했습니다. `app/globals.css`의 `form-field` utility가 grid·단일 열·5px gap·최소 폭을 함께 정의합니다. 이름 입력/변경, 작업, TODO, 일정, 서비스명, 팀원, 분류/시스템 코드 폼과 작업/TODO 검색 필터에 적용했습니다. 인라인 Label과 `space-y-*` 혼용으로 일반 입력·날짜·담당자 사이의 실제 간격이 달랐던 문제를 제거했습니다.

다열 폼은 가로 12px·모바일 세로 16px로 형제 필드와 맞췄고 TODO 푸터의 패딩은 본문과 같은 16px입니다. 라벨 연결, 저장 동작, 긴 폼의 스크롤 영역은 보존했습니다.

실제 Chrome 1440px/390px에서 16개 화면·79개 라벨/입력 외곽 간격이 모두 **5px**였으며 가로 넘침과 pageerror는 없었습니다. 날짜 입력은 버튼 내부가 아닌 테두리 외곽을 측정합니다. TODO 검색 필터 3곳도 별도 실측에서 5px입니다. Node 22의 lint·typecheck·프로덕션 빌드와 독립 diff/스크린샷 재검수가 통과했습니다. [측정 기록](release-assets/form-spacing-after.json), [수정 전 혼용 값](release-assets/form-spacing-before.json), [빌드 로그](release-assets/form-spacing-build.log)를 보존합니다.

최종 화면: [표시 이름](release-assets/form-spacing-after-name-desktop.png), [표시 이름 모바일](release-assets/form-spacing-after-name-mobile.png), [작업 폼](release-assets/form-spacing-after-work-desktop.png), [작업 모바일](release-assets/form-spacing-after-work-mobile.png), [TODO 모바일](release-assets/form-spacing-after-todo-mobile.png), [일정 모바일](release-assets/form-spacing-after-event-mobile.png).

### 후속 대량 데이터 — 작업 2,000건

별도 localhost 프로덕션 검수 DB에 정상 API로 샘플을 넣었습니다. 기존 개발·운영 DB는 사용하지 않았습니다. 작업 **2,000건**은 활성 1,320·이관 완료 680건이며 8개 상태로 분산됩니다. 팀원 12명·분류 6개·시스템 8개·티켓 2,000개, 별도로 TODO 60건(체크리스트 330개)·일정 36건이 있습니다. 장문 설명 100건·미배정 작업 160건·티켓 없는 작업 300건을 포함합니다. 업무 날짜는 2026년 4~11월, 생성/수정 시각은 실제 API 실행 시각입니다.

`scripts/seed-demo.cjs`는 임시 QA 경로·localhost·명시적 실행 옵션을 확인하고 샘플 표식으로 중복 생성을 피합니다. API 전 10페이지의 고유 ID 2,000개, 상태별 상세·관계·날짜·CREATE 감사 로그 2,000개, SQLite integrity/외래키 검사가 통과했습니다. 재실행 시 추가 **0건**, 기존 모든 행 보존과 총 2,000건 유지를 확인했습니다. [데이터 검증](release-assets/seed-data-summary.json), [실행 방법](DEVELOPMENT.md#대량-샘플-데이터)을 참고하세요.

실제 화면에서 홈 2,000건 집계, 테이블 50건씩 다음 페이지, 요청번호 검색/상세 열기, 칸반 1,320개, 간트 1,311개 일정 바, TODO 더보기 30→48건, 캘린더·이관 화면을 확인했습니다. [화면/조작 기록](release-assets/seed-ui-check.json)에 브라우저/API 오류는 없습니다. 이 기록의 모바일 홈 가로 넘침은 아래 후속 수정으로 해결했습니다. [칸반](release-assets/demo-kanban-desktop.png), [간트](release-assets/demo-gantt-desktop.png), [TODO 모바일](release-assets/demo-todos-mobile.png), [월력 모바일](release-assets/demo-calendar-mobile.png)을 보존합니다.

대량 데이터에서 홈의 암시적 grid 열이 긴 제목의 최소 폭을 따라 늘어나는 문제도 재현했습니다. 모바일 단일 열을 `grid-cols-1`로 명시해 390px 본문의 스크롤 폭이 **465→390px**가 됐습니다. 최종 프로덕션에서 320px·390px·1440px를 다시 열어 본문 폭 320·390·1,200px와 스크롤 폭이 각각 일치하고 제목/담당자가 가려지지 않는 것을 확인했습니다. [수정 전](release-assets/demo-home-mobile.png), [수정 후 390px](release-assets/demo-home-after-390.png), [320px](release-assets/demo-home-after-320.png), [1440px](release-assets/demo-home-after-1440.png), [폭 측정](release-assets/home-overflow-after.json)을 제공합니다.

이는 샘플 2,000건의 단일 로컬 기능·화면 검증입니다. 실제 동시 사용자, 응답시간 분포·메모리·DB 부하의 전후 성능 비교를 의미하지 않습니다. 홈의 진행 중 320건, 칸반·간트 전체 조회/렌더링은 남아 있어 개인/기간 필터와 집계·표시 범위 축소가 제품 개선 후보입니다.

## 의존성과 문서

Next/Next ESLint **16.4.2**, React/DOM **19.3.1**, PostCSS **8.5.31**, source-map-js **1.2.2**로 갱신했습니다. 공식 릴리스와 엔진·peer를 확인했습니다. TypeScript는 typescript-eslint 호환 범위 때문에 **6.0.3**을 유지하고, SQLite 앱에 해당하지 않는 Drizzle 변경이나 무관한 UI 패키지 일괄 업그레이드는 제외했습니다.

Node 22의 새 임시 설치에서 `npm ci --strict-peer-deps`가 통과했고 invalid/missing peer는 없었습니다. 같은 Node/npm·캐시·lockfile 검사 조건으로 audit을 비교했습니다. 위 개수는 독립 CVE 수가 아닌 전이 의존성의 영향 패키지 수입니다. [감사 결과 요약](release-assets/dependency-audit-summary.json), [버전·공식 근거·남은 취약점](DEPENDENCIES.md)을 참고하세요.

README, 개발 가이드, 의존성 가이드, 후속 계획을 실제 구현에 맞췄습니다. 10월 2일 정비 기록은 과거 결과임을 명시했습니다. 공통 관계 검증, 날짜 매핑, 재현 benchmark와 브라우저 회귀 외에 범용 CRUD 계층이나 새로운 테스트 프레임워크는 도입하지 않았습니다.

## 실행한 검증

| 검사 | 결과·범위 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과, 경고/오류 없음 |
| `npm test` | backend·backup·calendar-range·file-download·frontend·security 6개 모듈 통과 |
| `npm run test:lint` | 잘못된 코드 22개 검출, 정상 7개 허용, TypeScript 오류 3개 검출 |
| `npm run test:integration` | 별도 프로덕션 빌드, 실제 HTTP 페이지/아이콘·통계·cursor·날짜·audit·TODO 원자성·요청 보호·백업 무결성·신규 관계 검증/rollback 통과 |
| 브라우저 회귀 | 모바일 메뉴·본문 폭, 날짜 검증/지우기, 폼 휠 스크롤, 저장/검색 경합, 320px 긴 제목 5개 시나리오 통과 |
| 실제 조작 | 작업 생성/날짜/상세 Enter, TODO+체크리스트 생성, 시간 일정 생성, 이관 일괄 완료, 서비스명 저장/탭 제목 동기화, 라이트/다크, 수동 백업 목록 갱신 통과 |
| 독립 재검수 | 최종 diff, 150개 날짜 조합, 모바일·데스크톱·키보드·긴 콘텐츠 통과 |

회귀는 [수정 전 실패](release-assets/browser-before.log)와 [수정 후 통과](release-assets/browser-after.log), 관계 입력은 [기존 500 재현](release-assets/backend-before.log)과 새 통합 검사로 구분합니다. [최종 검사 로그](release-assets/final-checks.log), [통합 검사 로그](release-assets/final-integration.log), [독립 검수 기록](release-assets/independent-review.md)을 보존했습니다.

### 브라우저 회귀 재현

기존 개발·운영 DB 대신 **복제한 임시 DB**를 지정합니다. 아래 빌드는 실행 중인 개발 서버를 중지한 로컬 체크아웃에서 실행합니다. 테스트가 생성한 레코드는 삭제 상태로 정리되며 감사 로그는 남습니다. 앱의 production 의존성에 Playwright를 추가하지 않았습니다.

```bash
nvm install
nvm use
npm ci
TASK_QA_DIR="$(mktemp -d)"
cp db/dev.db.clean "$TASK_QA_DIR/qa.db"
DATABASE_URL="file:$TASK_QA_DIR/qa.db" BACKUP_CRON="0 0 0 1 1 *" npm run build
DATABASE_URL="file:$TASK_QA_DIR/qa.db" BACKUP_CRON="0 0 0 1 1 *" npm start -- --hostname 127.0.0.1 --port 3036
```

다른 터미널에서 동일 프로젝트 경로를 사용합니다. Chrome이 필요합니다.

```bash
npx --yes @playwright/cli@0.1.22 -s=release open http://127.0.0.1:3036
npx --yes @playwright/cli@0.1.22 -s=release run-code --filename scripts/browser-regressions.js
npx --yes @playwright/cli@0.1.22 -s=release close
```

검사가 실패하면 CLI의 `Error`와 개별 `passed` 값을 확인합니다. 새 임시 DB의 비어 있는 기본 화면을 전제로 하며, 다른 검수 데이터를 넣었다면 별도 임시 DB로 다시 실행합니다. 추가 원본 스냅샷과 조작 로그는 로컬 `output/playwright/`에 생성하며 Git에서는 제외합니다.

## 남은 문제·미검증 범위

- 개발 도구의 **High 4 / Moderate 4** 영향 패키지가 남습니다. Next ESLint의 braces, Drizzle CLI의 오래된 esbuild 경로이며 현재 호환 패치가 없습니다. 강제 다운그레이드나 개발 서버 외부 노출을 하지 않았습니다. 배포 시점에 audit을 다시 확인해야 합니다.
- 로그인·사용자별 권한과 동시 편집 충돌 보호는 기존대로 미구현입니다. 내부망/접근 제어 정책과 충돌 정책은 별도 제품·운영 결정이 필요합니다. 이번 작업에서는 인증/보안 설정을 변경하지 않았습니다.
- 칸반·간트·월 집계의 전페이지 조회와 간트의 전체 기간 DOM은 남아 있습니다. 샘플 2,000건의 화면·조회는 위 후속 검수에서 확인했지만 DB 쿼리 계획, 동시 접속/쓰기, 수십 년 작업 범위의 간트 렌더링 부하, 메모리 한계는 측정하지 않았습니다. 집계 API·가상화·인덱스는 실제 규모 측정 후 결정해야 합니다.
- 정적 검토에서 API의 작업 시스템 `code` 변경이 문자열로 저장한 기존 티켓 연결을 자동으로 옮기지 않는 계약 위험을 확인했습니다. UI는 코드 변경을 막지만 API 계약은 추후 불변 정책 또는 별도 이관 기능으로 정리해야 합니다. 실제 HTTP 이관 시나리오는 검증하지 않았으며 현재 일반 화면 경로의 영향이 낮아 변경하지 않았습니다.
- 실제 운영 DB/데이터, 외부 프록시·TLS·인증, 여러 프로세스의 자동 백업, 서버 장애/디스크 부족·실운영 복구, Safari/Firefox/실기기 터치·스크린리더 전체 조합은 검증하지 않았습니다. Chromium의 viewport 검수와 단일 로컬 프로세스 결과입니다.
- 막힌 승인 요청이나 외부 접근 항목은 없습니다. 배포·푸시는 수행하지 않았습니다.
