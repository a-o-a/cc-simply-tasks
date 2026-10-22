# cc-simply-tasks

내부용 작업(업무) 관리 시스템. Next.js 16 (App Router) + Drizzle ORM + `@libsql/client` + SQLite(file) 기반이며, 이후 Postgres 이관을 염두에 둔 구조로 설계됨.

## 목적

- 담당자별/이관일별로 작업(WorkItem)을 관리
- 작업별 요청 정보와 외부 시스템 연동 정보(WorkTicket, 티켓번호 선택 입력) 추적
- 팀원(TeamMember) 관리 및 캘린더 이벤트(CalendarEvent) 표시
- 모든 쓰기(write)에 대한 감사 로그(AuditLog) 남기기 (익명 액터 기반)
- 1차 범위: 내부망, 인증 없음 (추후 확장)

## 기술 스택

| 항목 | 버전 / 선택 | 비고 |
|---|---|---|
| Node.js | **22.13.0 이상**, 개발·운영 권장 22.x | `.nvmrc`는 22, 설치·빌드·마이그레이션에 같은 Node 사용 |
| Next.js / React | 16.4.1 / 19.3.1 | App Router, 동적 API `params`는 Promise |
| TypeScript | 6.0.3 strict | typescript-eslint 호환 범위에 맞춘 버전 |
| ESLint | 9.39.5 | Next 플러그인 호환 버전, `eslint.config.mjs` flat config |
| Drizzle ORM / Kit | 0.45.4 / 0.31.11 | 커밋된 SQL migration 적용 |
| SQLite Driver | `@libsql/client` 0.18.0 | Node용 드라이버, 네이티브 패키지는 서버 번들 외부화 |
| DB | SQLite (file) | `DATABASE_URL=file:...`; Postgres 전환은 별도 dialect·스키마 작업 필요 |
| 검증 | Zod 4.6.7 | `flattenError`, `z.iso.datetime` 사용 |
| UI | Tailwind CSS 4.3.3 + Radix | CSS-first 설정, `@tailwindcss/postcss`, `tw-animate-css` |
| 테마 / 아이콘 | next-themes 0.4.6 / lucide-react 1.57.0 | system / light / dark |
| 자동 백업 | node-cron 4.6.0 | 서버 프로세스 내 스케줄 |

정확한 설치 버전은 [`package.json`](./package.json)과 [`package-lock.json`](./package-lock.json)을 기준으로 합니다. TypeScript 7 및 ESLint 10은 현재 사용 중인 린트 도구·플러그인 호환 범위 때문에 채택하지 않습니다.

Tailwind 4 기준 지원 브라우저는 Safari 16.4+, Chrome 111+, Firefox 128+입니다. 디자인 토큰은 `app/globals.css`의 `@theme inline`에 있으며 `tailwind.config.ts`는 사용하지 않습니다. [Tailwind 업그레이드 가이드](https://tailwindcss.com/docs/upgrade-guide)

## 디렉터리 구조 (현재)

```
.
├── app/
│   ├── layout.tsx
│   ├── page.tsx                 # 홈 대시보드
│   ├── globals.css
│   ├── work-items/page.tsx      # 작업 목록 (테이블/칸반/간트 토글)
│   ├── todos/page.tsx           # TODO 목록/드로어
│   ├── calendar/page.tsx        # 캘린더 (월 보기, 드래그 이동)
│   ├── settings/page.tsx        # 설정 (서비스명/멤버/코드관리/백업)
│   ├── members/page.tsx         # → /settings 리다이렉트
│   └── api/
│       ├── work-items/          # 레퍼런스 구현
│       │   ├── route.ts         # GET(list+필터+범위), POST(+tickets)
│       │   └── [id]/route.ts    # GET, PATCH(tickets 전체대체), DELETE(soft)
│       ├── team-members/
│       │   ├── route.ts         # GET(list), POST
│       │   └── [id]/route.ts    # GET, PATCH, DELETE
│       ├── calendar-events/
│       │   ├── route.ts         # GET(range ?from&to), POST
│       │   ├── [id]/route.ts    # GET, PATCH, DELETE
│       │   └── stream/route.ts  # GET — SSE (캘린더 변경 실시간 푸시)
│       ├── work-systems/        # 티켓 시스템 코드 CRUD
│       │   ├── route.ts
│       │   └── [id]/route.ts
│       ├── work-categories/     # 작업 분류 코드 CRUD (동적 관리)
│       │   ├── route.ts
│       │   └── [id]/route.ts
│       ├── settings/route.ts    # GET / PATCH (service_name)
│       ├── todos/
│       │   ├── route.ts         # GET(list+필터+cursor), POST
│       │   ├── count/route.ts   # GET — TODO 카운트
│       │   ├── [id]/route.ts    # GET, PATCH, DELETE
│       │   └── [id]/checklist/  # POST(add), PATCH(reorder), [itemId]/PATCH/DELETE
│       ├── backup/route.ts      # GET — SQLite 스냅샷 다운로드
│       ├── db-stats/route.ts    # GET — 테이블별 레코드 수
│       └── audit-logs/
│           └── route.ts         # GET(read-only, ?entityType&entityId 등)
├── components/
│   ├── app-shell.tsx            # 사이드바 + 게이트 + 토스터 셸 (h-screen 레이아웃)
│   ├── sidebar.tsx              # 좌측 네비게이션 (240/64 collapsible, 서비스명 동적 표시)
│   ├── member-filter.tsx        # 재사용 팀원 필터 드롭다운 (Radix Popover, 캘린더·작업 공용)
│   ├── actor-name-gate.tsx      # 액터 이름 강제 모달 (ESC/바깥 차단)
│   ├── toaster.tsx
│   ├── theme-provider.tsx / theme-toggle.tsx
│   ├── ui/
│   │   ├── button/input/label/select/textarea/badge/dialog/sheet/tabs/toast
│   │   └── date-picker.tsx      # Radix Popover 기반 DatePicker / DateTimePicker
│   ├── work-items/
│   │   ├── work-items-client.tsx  # 진행/이관완료 scope + 뷰토글 + 필터 + 이관완료 페이지네이션
│   │   ├── table-view.tsx
│   │   ├── kanban-view.tsx
│   │   ├── gantt-view.tsx
│   │   ├── work-item-drawer.tsx   # 우측 sheet (상세/활동 탭, 요청정보/시스템연동 표시)
│   │   ├── work-item-form-dialog.tsx # 요청정보 + 시스템연동 포함 생성/수정 폼
│   │   └── status-badge.tsx
│   ├── calendar/
│   │   ├── calendar-client.tsx    # 오케스트레이터 (DnD, SSE 구독, 이관 건수 fetch)
│   │   ├── month-view.tsx         # 월 보기 그리드 (draggable 칩 + 이관 칩)
│   │   ├── event-form-dialog.tsx  # 생성/수정/삭제 통합
│   │   └── use-calendar-drag.ts   # @dnd-kit 드래그 훅 (낙관적 업데이트)
│   ├── dashboard/
│   │   └── dashboard-client.tsx   # 이번주 이관 예정 | 진행중인 작업 | 오늘 일정 + 최근 활동
│   ├── settings/
│   │   └── settings-client.tsx    # 설정 탭 (서비스 / 멤버 / 코드관리 / 백업+DB현황)
│   ├── todos/
│   │   ├── todos-client.tsx       # TODO 목록, 필터, 더보기, 완료 토글
│   │   └── todo-drawer.tsx        # 생성/수정 드로어, 체크리스트, 저장/삭제 확인 팝업
│   └── (members-client.tsx → app/members/ 아래)
├── lib/
│   ├── client/
│   │   ├── api.ts               # fetch wrapper (x-actor-name, SERVICE_NAME_STORAGE_KEY)
│   │   ├── use-toast.ts
│   │   ├── types.ts             # 클라이언트용 도메인 타입 (WorkCategory, WorkSystem, AppSettings 포함)
│   │   ├── format.ts            # KST 날짜/시간 포맷 — formatDate(yyyy-mm-dd) / formatDateTime(yyyy-mm-dd hh:mm:ss)
│   │   └── calendar.ts          # KST 월 그리드, eventDayKeys, kstWeekContaining
│   ├── db.ts                    # Drizzle DB 초기화 + libsql client 연결
│   ├── db/
│   │   ├── schema.ts           # Drizzle SQLite 스키마
│   │   ├── queries.ts          # 관계 하이드레이션/상세 조회 헬퍼
│   │   └── helpers.ts          # DB 공통 헬퍼
│   ├── calendar-bus.ts          # SSE용 서버 싱글톤 EventEmitter (globalThis 보관)
│   ├── enums.ts                 # enum 소스 오브 트루스 (Status 8종, Priority, MemberRole 등)
│   ├── enum-labels.ts           # enum → 한글 라벨 (표시 전용, CATEGORY_LABELS 제거됨)
│   ├── time.ts / actor.ts / diff.ts / audit.ts / http.ts
│   ├── pagination.ts            # cursor 기반 (기본 50, 최대 200)
│   ├── utils.ts
│   └── validation/
│       ├── common.ts / teamMember.ts / workTicket.ts / calendarEvent.ts
│       ├── workItem.ts          # 요청정보 + tickets 배열 + transferDateTo 범위 필터 포함
│       ├── workSystem.ts
│       └── workCategory.ts
├── db/
│   ├── dev.db.clean             # 최초 실행용 빈 DB 템플릿
│   └── dev.db                   # 로컬 개발 DB (덮어쓰기 금지)
├── docs/
│   └── DEVELOPMENT.md           # 개발 가이드 (API 패턴, 컨벤션)
├── .nvmrc                       # Node 22
├── package.json
├── tsconfig.json
├── next.config.js
├── PLAN.md
└── README.md
```

> 새 API를 작성할 때는 반드시 [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)의 컨벤션을 따를 것.
>
> Drizzle 전환 배경과 libsql 적용 메모는 [`docs/DRIZZLE_MIGRATION.md`](./docs/DRIZZLE_MIGRATION.md)를 참고.

## 개발 시작

Node 22.x에서 개발·빌드·마이그레이션을 모두 수행합니다. 기존 `.env`와 DB 파일이 있으면 그대로 사용합니다. 아래는 기본 DB 경로용 예제이며, 다른 경로를 쓴다면 migration 명령에도 같은 `DATABASE_URL` 환경변수를 명시하세요.

```bash
nvm install 22
nvm use
npm ci

# .env가 없을 때만 기본값 생성
node -e "const fs=require('node:fs'); if (fs.existsSync('.env') === false) fs.writeFileSync('.env', 'DATABASE_URL=file:./db/dev.db\n', {flag:'wx'});"

# DB가 없을 때만 템플릿 복사. COPYFILE_EXCL로 기존 파일 덮어쓰기 방지
node -e "const fs=require('node:fs'); if (fs.existsSync('db/dev.db') === false) fs.copyFileSync('db/dev.db.clean', 'db/dev.db', fs.constants.COPYFILE_EXCL);"

npm run db:migrate
npm run dev
```

`npm ci`는 lockfile의 버전을 재현합니다. 의존성을 의도적으로 변경할 때만 `npm install <패키지>@<버전>`을 사용하고 `package.json`과 lockfile을 함께 커밋합니다. [npm ci 문서](https://docs.npmjs.com/cli/v11/commands/npm-ci/)

로컬 SQLite는 플랫폼별 네이티브 패키지를 포함합니다. 설치 서버의 OS·아키텍처와 맞는 패키지가 필요하므로 다른 플랫폼의 `node_modules`를 복사하지 마세요. libsql은 `next.config.js`의 `serverExternalPackages`로 외부화합니다.

## 빌드 및 배포

운영 DB는 앱 배포 디렉터리 밖의 영속 경로에 둡니다. DB와 같은 디렉터리에 WAL/SHM 및 저장 백업이 생성될 수 있으므로 파일 하나가 아닌 디렉터리 전체의 쓰기 권한과 영속성을 확보합니다.

```text
/srv/cc-simply-tasks/
├── current/                  # 앱 코드와 빌드
└── shared/
    └── dev.db                # 영속 운영 DB
```

최초 배포와 업데이트 모두 **저장소에 커밋된 migration만 적용**합니다. `db:generate`는 개발자가 스키마를 변경할 때 실행하는 명령이며 배포 중에는 실행하지 않습니다.

```bash
nvm use
npm ci

# 앱 프로세스와 migration 명령에 같은 값을 전달
export DATABASE_URL="file:/srv/cc-simply-tasks/shared/dev.db"

# 최초 배포는 상위 영속 디렉터리를 먼저 생성하고 서비스 계정 쓰기 권한 부여
# 기존 서비스 업데이트라면 백업 후 쓰기 요청/앱 프로세스를 중지
npm run db:migrate
npm run build
npm run start
```

`drizzle.config.ts`는 프로세스의 `DATABASE_URL`을 읽습니다. Next가 읽는 `.env.production`이 migration CLI에도 자동으로 적용된다고 가정하지 말고, 배포 환경이나 위 예제처럼 명시적으로 전달하세요. 앱은 기본 3000 포트로 시작하며, 운영에서는 프로세스 관리자와 reverse proxy를 사용합니다.

기존 운영 DB를 `db/dev.db.clean`으로 덮어쓰거나 배포 디렉터리와 함께 삭제하지 마세요. 기존 DB를 변경하는 migration은 백업과 복원 절차를 확인한 뒤 적용합니다. [Drizzle migration 문서](https://orm.drizzle.team/docs/migrations)

## 스크립트와 검증

| 스크립트 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 빌드된 프로덕션 서버 |
| `npm run lint` | flat config 기반 `eslint . --max-warnings=0` |
| `npm run typecheck` | `next typegen` 후 `tsc --noEmit` |
| `npm run test:smoke` | Node 테스트 러너로 API·DB·백업 검증 |
| `npm run test:ui` | Playwright Chromium으로 UI 검증 (별도 실행) |
| `npm run check` | lint → typecheck → build → smoke 순서 실행 |
| `npm run db:generate` | 개발 스키마 변경에서 migration SQL 생성 |
| `npm run db:migrate` | 커밋된 migration 적용 |

Next 16에서는 `next lint`를 사용하지 않습니다. React Compiler는 켜지 않으며, 기존 비동기 데이터 로딩·폼 초기화 패턴을 유지하기 위해 `react-hooks/set-state-in-effect`만 비활성화합니다. `rules-of-hooks`, `exhaustive-deps` 및 나머지 규칙은 유지합니다. [Next 16 업그레이드 가이드](https://nextjs.org/docs/app/guides/upgrading/version-16)

```bash
npm run check

# UI 검증은 Chromium 설치 후 별도로 실행
npx playwright install chromium
npm run test:ui
```

API/UI 테스트는 빌드 결과를 사용해 임시 DB와 별도 서버를 생성합니다. `test:smoke` 또는 `test:ui`만 직접 실행할 때는 먼저 `npm run build`를 실행하세요. 테스트 스크립트는 기존 개발·운영 DB를 대상으로 사용하지 않습니다. 이 절은 실행 방법이며 검증 통과 기록은 아닙니다. [Playwright 브라우저 설치](https://playwright.dev/docs/browsers)

## 스키마 변경과 마이그레이션

1. 개발 환경에서 `lib/db/schema.ts`를 수정합니다.
2. 대상 DB를 백업하고 해당 DB에 쓰는 서버를 중지합니다.
3. 같은 Node 22 환경에서 migration을 생성하고 SQL을 검토한 뒤 적용합니다.

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

4. `drizzle/` SQL·메타데이터와 스키마를 함께 커밋합니다. `db/dev.db.clean`은 별도의 새 빈 DB에 migration을 적용해 갱신하며, 기존 개인 DB를 템플릿으로 복사하지 않습니다.
5. `npm run check`와 필요한 UI 검증 후 서버를 재시작합니다.

`database is locked`는 다른 연결이나 프로세스의 쓰기 경합을 확인하고 재시도합니다. `no such table` 또는 `no such column`은 실제 `DATABASE_URL`과 적용된 migration 이력을 먼저 확인합니다. ORM 스키마 파일을 수정하는 것만으로 DB 파일의 스키마는 바뀌지 않습니다.

## 백업 및 복구

설정 → **백업** 탭에서 즉시 다운로드하거나 서버에 저장된 백업을 관리합니다.

- `GET /api/backup`: `VACUUM INTO`로 임시 스냅샷을 만든 뒤 다운로드합니다. WAL에 남은 커밋을 포함하며 임시 파일은 요청 처리 후 정리합니다.
- `POST /api/backup/trigger`: DB와 같은 디렉터리에 `backup_YYYY-MM-DD_HH-mm-ss.db`를 저장합니다.
- `GET /api/backup/files`: 저장 백업 목록을 조회합니다. 파일명 경로로 개별 다운로드할 수 있습니다.
- `instrumentation.ts`: Node 서버 시작 시 cron을 등록합니다. `BACKUP_CRON` 기본값은 `0 0 2 * * *`이며 **서버 현지 시간 매일 02:00**입니다. 같은 프로세스에서 중복 등록과 실행 겹침을 방지하고, 저장 백업 생성 후 7일 이전 파일을 정리합니다.

프로세스가 종료되면 자동 백업도 실행되지 않습니다. 여러 서버/워커의 중복 실행은 현재 프로세스 내 가드로 막을 수 없으므로 단일 백업 실행 주체를 유지하세요. [node-cron 스케줄 옵션](https://nodecron.com/scheduling-options.html)

```bash
curl --fail --output backup.db http://localhost:3000/api/backup
```

복구할 때는 서버와 DB 연결을 모두 종료하고 현재 DB 및 남아 있는 `-wal`/`-shm` 파일을 별도 보관합니다. 백업의 `PRAGMA integrity_check` 결과를 확인한 후 `DATABASE_URL`이 가리키는 파일로 복원하고, 이전 DB의 WAL/SHM 파일을 복원된 DB와 섞어 사용하지 않습니다. 서버를 재시작한 뒤 주요 목록과 최근 데이터를 확인하세요. DB 본파일만 실행 중에 복사하면 WAL의 최신 데이터가 누락될 수 있습니다. [SQLite 백업 문서](https://www.sqlite.org/backup.html)

## Phase 진행 상황

> 기존 기능 구현 이력입니다. 전체 계획은 [`PLAN.md`](./PLAN.md)를 참고하며 현재 업그레이드 검증 결과와 구분합니다.

| Phase | 내용 | 상태 |
|---|---|---|
| **0** | 프로젝트 부트스트랩 (Next.js + SQLite + TS) | ✅ 완료 |
| **1** | 도메인 스키마 확정 (현재는 Drizzle 스키마 기준) | ✅ 완료 |
| **2** | 공통 인프라 (time, actor, audit, validation, http, pagination, DB bootstrap) | ✅ 완료 |
| **3** | API 라우트 (team-members, work-items, calendar-events, audit-logs 등) | ✅ 완료 |
| **4** | UI (디자인 토큰 + shadcn/ui + 테이블/드로어/Gantt/캘린더 + 대시보드) | ✅ 완료 |
| **4+** | 캘린더 개선 (주 보기, 드래그 이동, 팀원 필터, 카테고리 정리, 다중 담당자) | ✅ 완료 |
| **4++** | 대시보드 개편 (3열 레이아웃, 진행중인 작업, 작업 드로어 연동) | ✅ 완료 |
| **5** | 폴리싱 (설정 페이지, 상태값 개편, 분류 동적화, DatePicker, 캘린더 이관 표시 등) | ✅ 완료 |
| **5+** | UI 통일 · 캘린더 SSE · 필터 개선 · 날짜 포맷 통일 · DB 현황 등 | ✅ 완료 |
| **5++** | 칸반/간트 스크롤 UX · 간트 크로스헤어 · 날짜 컬러링 · 휴일 연동 | ✅ 완료 |
| **6** | Postgres 이관 준비 런북 | ⏳ 대기 |

---

## 핸드오프 메모 (다음 에이전트용)

### 현재 기준 (2026-10-15)

Node 22 / Next 16 / React 19 / Tailwind 4 / Zod 4로 실행 기준을 갱신했습니다. 아래 Phase 완료 내역은 기존 기능 구현 이력이며 이번 업그레이드의 검증 통과를 뜻하지 않습니다. 업그레이드 상세와 최종 검증 기록은 [`docs/UPGRADE_NODE22.md`](./docs/UPGRADE_NODE22.md)를 참고하세요.

### 알아야 할 결정사항

| 사항 | 내용 |
|---|---|
| Node 버전 | 개발·빌드·migration·운영에 Node 22.x 사용. 최소 버전은 `package.json`의 engines 기준. |
| enum 컬럼 | SQLite 미지원 → String 저장. `lib/enums.ts`가 유일한 소스 오브 트루스. |
| Status 8종 | `WAITING / IN_PROGRESS / INTERNAL_TEST / BUSINESS_TEST / QA_TEST / TRANSFER_READY / TRANSFERRED / HOLDING` |
| 작업 분류(category) | **동적**. `WorkCategory` 모델 → `/api/work-categories` CRUD. 설정 페이지 코드관리 탭에서 관리. |
| 한글 헤더 인코딩 | `x-actor-name`은 `encodeURIComponent` (클라이언트) / `decodeURIComponent` (서버) 처리됨. |
| 작업 목록 | `진행 작업 / 이관 완료` 2개 scope. 진행 작업은 테이블/칸반/간트, 이관 완료는 테이블 전용(칸반/간트 비활성). |
| 시스템 연동 | WorkTicket은 시스템 선택만으로 저장 가능, 티켓번호는 선택 입력. |
| 날짜/시간 | 저장: UTC ISO. 표시: KST. all-day 이벤트는 반열림 `[start, end)` 구간. |
| 동시 편집 | 현재 API는 `If-Match` 검증을 하지 않음. 409는 유니크 제약 등 충돌 응답이며 동시 편집 보호는 후속 과제. |
| SQLite 경로 | 현재 기본값은 `DATABASE_URL="file:./db/dev.db"`. |
| 감사 로그 | 모든 write는 transaction + `withAudit(tx, ...)` 패턴 필수. |
| 설정 탭 구조 | 서비스 / 멤버 / 코드관리(분류+시스템 코드) / 백업 4탭. |
| 대시보드 레이아웃 | 3열: 이번주 이관 예정 \| 진행중인 작업 \| 오늘 일정, 하단: 최근 활동. |
| 캘린더 이관 표시 | 월/주 보기에서 이관일이 있는 작업 건수를 `[이관] N건` emerald 칩으로 표시 (셀 최상단). |
| 캘린더 TODO 표시 | 월 보기 날짜 셀에 마감일 기준 미완료 TODO 건수를 `미완료 N건` amber 칩으로 표시. |
| 캘린더 카테고리 | 4종: HOLIDAY/WORK/ABSENCE/ETC. HOLIDAY는 팀원 필터 무관 항상 노출, 셀 핑크 배경. |
| 서비스명 | `Setting` 모델 DB 저장 (`key="service_name"`). 사이드바·설정에서 동기화, localStorage 캐시. |
| DatePicker | `components/ui/date-picker.tsx` — `DatePicker`(날짜 전용) + `DateTimePicker`(날짜+시간). 캘린더 팝오버 방식. |
| TODO UX | TODO 목록은 30건 cursor 기반 `더보기`. 드로어는 명시적 저장 버튼, 닫기/삭제 시 공통 Dialog 확인 팝업 사용. |
| 사이드바 TODO 뱃지 | `/todos` 메뉴 우측에 미완료 건수 배지 표시. `GET /api/todos/count`와 `todos-changed` CustomEvent로 갱신. |
| 날짜 포맷 | `formatDate` → `yyyy-mm-dd`, `formatDateTime` → `yyyy-mm-dd hh:mm:ss` (24h KST). `lib/client/format.ts` 단일화. |
| 캘린더 SSE | `GET /api/calendar-events/stream` — EventSource로 실시간 구독. POST/PATCH/DELETE 시 `emitCalendarChanged()` 호출. 단일 서버 한정. |
| 캘린더 주 보기 | 제거됨. 월 보기 전용으로 단순화. (`week-view.tsx` 삭제, `kstAddDays`/`kstWeekFetchRange` 제거) |
| 작업 필터 | 순서: 분류→상태→담당자(MemberFilter 드롭다운)→우선순위→이관일. 티켓번호 필터 제거. 초기화 버튼 항상 표시. 진행 작업은 상태 기본 선택 없음(전체 표시), 이관 완료는 `이관완료` 선택 상태로 시작. |
| 작업 scope API | `/api/work-items`는 `scope=active|transferred|all` 지원. active는 `TRANSFERRED` 제외, transferred는 `TRANSFERRED`만 조회. |
| 이관 완료 탭 | 50건 cursor 페이지네이션. 정렬은 `transferDate desc` 우선. 오래된 완료 데이터 누적에 대비한 아카이브 뷰 성격. |
| 진행 작업 테이블 정렬 | 테이블 보기에서는 `createdAt desc`로 표시. 칸반/간트의 시각적 정렬 기준과 분리됨. |
| 간트 그룹 내부 정렬 | 담당자별 작업 바는 `startDate asc`로 정렬. 같은 시작일이면 종료일, 제목 순으로 tie-break. |
| 요청 정보 | `WorkItem`에 `requestType / requestor / requestNumber / requestContent` 저장. 생성/수정 폼과 상세 드로어에서 함께 노출. |
| 시스템 연동 | 티켓 관리는 별도 서브 API/탭이 아니라 `WorkItem` 생성·수정 payload의 `tickets` 배열로 함께 처리. |
| 티켓 유니크 제약 | `WorkTicket`은 `workItemId + systemName` 유니크. 작업당 같은 시스템은 1개만 연결 가능. |
| 티켓 컬럼 변경 | `ticketUrl` 제거. 현재는 시스템 코드(`systemName`)와 작업번호(`ticketNumber`)만 저장. |
| 작업 폼 담당자 선택 | `MemberFilter`는 `mode="single"` 지원. 작업 폼에서는 단일 선택 팝오버로 사용. |
| 헤더 레이아웃 통일 | 모든 페이지 `text-xl font-semibold` + `py-6`. 작업/캘린더: 좌(타이틀)/가운데(컨트롤)/우(추가버튼) 3분할. |
| DB 현황 | `GET /api/db-stats` — 테이블별 전체 레코드 수. 설정→백업 탭 상단에 표시. |
| 코드 관리 복원 | 소프트 딜리트된 코드를 같은 코드로 재등록 시 `create` 대신 복원(`deletedAt=null`). |
| 칸반 스크롤 UX | 스크롤바 숨김(`scrollbarWidth:none`), 좌우 그라디언트 화살표(ResizeObserver로 가시 제어), 배경 클릭드래그 스크롤(카드 버튼은 제외). |
| 간트 담당자 고정 | 담당자 열 `sticky left-0 z-10 bg-card` — 가로 스크롤 시 항상 고정. |
| 간트 스크롤 UX | 좌측 화살표: 담당자 열 우측에 원형 버튼. 우측: 그라디언트 화살표. 배경 클릭드래그 스크롤. |
| 간트 크로스헤어 | 마우스 호버 시 해당 날짜 열(파란 틴트)과 담당자 행(accent bg) 동시 하이라이트. 교차점은 더 진하게. |
| 간트 날짜 컬러링 | 토요일: 연한 파랑, 일요일: 연한 레드, 오늘: 연한 회색(`bg-gray-200`). |
| 간트 휴일 연동 | 간트 마운트 시 윈도우 범위의 `HOLIDAY` 캘린더 이벤트 fetch → 일요일과 동일한 연한 레드로 표시. |

### 대시보드 카운트 API (2026-04-14)

`GET /api/work-items/count` — `groupBy` SQL로 상태별 카운트 반환 (`{ byStatus, total }`).
대시보드 `StatusStats`와 각 패널(이번주 이관 예정, 진행중인 작업)은 이제 별도 필터 API 호출로 정확한 전체 데이터 기반으로 동작.
| 항목 | 이전 | 이후 |
|---|---|---|
| 상태 카운트 | 첫 50건 클라이언트 집계 | `groupBy` SQL (전체) |
| 이번주 이관 예정 | 50건 클라이언트 filter | 날짜 범위 필터 API 호출 |
| 진행중인 작업 | 50건 클라이언트 filter | `status=IN_PROGRESS` 필터 API 호출 |

---

### Phase 5++ UX 개선 완료 내역 (2026-04-13)

- **칸반 스크롤 UX** — 스크롤바 숨김, 좌측/우측 그라디언트 화살표(ResizeObserver로 동적 표시), 배경 클릭드래그 스크롤(카드 버튼 제외)
- **간트 담당자 컬럼 고정** — `sticky left-0` 처리로 가로 스크롤 시에도 담당자 항상 표시
- **간트 스크롤 UX** — 좌측 원형 화살표 버튼(담당자 열 바로 우측), 우측 그라디언트 화살표, 배경 클릭드래그 스크롤
- **간트 크로스헤어 호버** — 마우스 위치 기준으로 날짜 열(열 전체 파란 틴트 + 헤더 강조)과 담당자 행(accent 배경) 동시 하이라이트. 교차점은 더 진하게 표시. 마우스 이탈 시 초기화.
- **간트 날짜 컬러링** — 토요일: 연한 파랑, 일요일: 연한 레드, 오늘: 연한 회색(헤더 bg-gray-200 + 회색 세로선)
- **간트 휴일 연동** — 윈도우 범위의 `HOLIDAY` 캘린더 이벤트 자동 fetch → 일요일과 동일한 연한 레드로 표시(다일 휴일도 날짜별 전개)

### Phase 5+ 완료 내역 (2026-04-13)

- **UI 헤더 통일** — 모든 페이지(홈/작업/캘린더/설정) `text-xl font-semibold` + `py-6` 통일
- **캘린더 헤더 재배치** — 좌(타이틀) / 가운데(월네비+오늘+팀원필터) / 우(이벤트추가) 3분할
- **작업 헤더 재배치** — 좌(타이틀) / 가운데(테이블·칸반·간트 뷰토글) / 우(작업추가) 3분할
- **캘린더 주 보기 제거** — `week-view.tsx` 삭제, 관련 유틸(`kstAddDays`, `kstWeekFetchRange`) 제거, 월 보기 전용으로 단순화
- **작업 필터 개선** — 순서 재정렬(분류→상태→담당자→우선순위→이관일), 티켓번호 필터 제거, 담당자를 `MemberFilter` 드롭다운으로 교체, 초기화 버튼 항상 표시
- **날짜/시간 포맷 통일** — `formatDate`→`yyyy-mm-dd`, `formatDateTime`→`yyyy-mm-dd hh:mm:ss` (24h KST). `lib/client/format.ts` 단일화, members-client 로컬 함수 제거
- **캘린더 SSE 실시간 동기화** — `lib/calendar-bus.ts` 서버 싱글톤 EventEmitter, `GET /api/calendar-events/stream` SSE 엔드포인트(25초 heartbeat), 캘린더 CRUD API에 `emitCalendarChanged()` 연동, `calendar-client.tsx`에 `EventSource` 구독 추가
- **설정 백업 탭 DB 현황** — `GET /api/db-stats`로 테이블별 레코드 수 조회, 백업 탭 상단 표 형태로 표시(새로고침 버튼 포함)
- **설정 멤버 탭 너비 제한** — `max-w-xl` 적용(다른 탭과 통일)
- **코드 관리 소프트 딜리트 복원 버그 수정** — 삭제 후 동일 코드 재등록 시 unique 제약 오류 → 소프트 딜리트 레코드 복원으로 처리 (WorkCategory, WorkSystem 공통)

### Phase 5 폴리싱 완료 내역 (2026-04-13)

- **설정 페이지** (`/settings`) — 4탭: 서비스명 관리 · 멤버 · 코드관리(분류+시스템코드) · 백업
- **서비스명 동적화** — `Setting` 모델 DB 저장, 사이드바 헤더 실시간 반영 (`settings-changed` CustomEvent)
- **DB 백업** — `GET /api/backup` → SQLite 스냅샷 다운로드
- **WorkSystem CRUD** — 티켓 등록 시 선택 가능한 시스템 코드 마스터 (`/api/work-systems`)
- **WorkCategory CRUD** — 작업 분류 동적 관리 (`/api/work-categories`), CATEGORIES enum 완전 제거
- **Status 8종 개편** — 대기/진행중/내부테스트/현업테스트/QA테스트/이관대기/이관완료/홀딩. CSS 변수 전면 교체.
- **MemberRole 정비** — WEB_DEV/APP_DEV/UI_DEV/PLANNING/DESIGN/ETC (웹개발/앱개발/UI개발/기획/디자인/기타)
- **멤버 탭 통합** — `/members` → `/settings?tab=members` 리다이렉트, 사이드바에서 멤버 항목 제거
- **DatePicker / DateTimePicker** — Radix Popover 기반 커스텀 날짜 선택기 (아이콘 우측 배치, X 클리어 버튼)
- **사이드바 개선** — 이름 변경 `window.prompt` → Dialog 팝업, 다크모드 두번 클릭 버그 수정 (`resolvedTheme`)
- **액터 이름 동기화** — ActorNameGate 저장 후 사이드바 즉시 반영 (`actor-name-changed` CustomEvent)
- **캘린더 이관 건수 표시** — 월/주 보기 각 셀 최상단에 emerald `[이관] N건` 칩
  - `GET /api/work-items?transferDate=&transferDateTo=` 범위 조회 지원 추가
- **TODO 모듈 추가/개선** — `/todos` 페이지, checklist CRUD, 30건 `더보기`, 체크리스트 Enter로 다음 항목 추가
- **TODO 드로어 저장 UX 개편** — 자동저장 제거, 명시적 저장 버튼, 닫기/삭제 시 공통 Dialog 확인
- **사이드바 TODO 배지 + 캘린더 미완료 칩** — 미완료 TODO 카운트 API(`/api/todos/count`)와 월 셀 `미완료 N건` 표시 추가
- **칸반 개선** (이전 세션) — PointerSensor(distance:8), 연속 드래그 CONFLICT 수정, 상태 필터 컬럼 연동

### Phase 4++ 대시보드 개편 완료 내역 (2026-04-12)
- **레이아웃 재편** — 상태 카드 5개 제거 → 3열: 이번주 이관 예정 · 진행중인 작업 · 오늘 일정
- **진행중인 작업 패널** — `IN_PROGRESS` 필터링, 클릭 → `WorkItemDrawer`
- **이벤트 정렬 통일** — 종일 우선 → 카테고리 → 제목 asc (대시보드·캘린더 공통 `sortEvents()`)

### Phase 4+ 캘린더 개선 완료 내역 (2026-04-12)
- **주 보기(Week view)** — 타임그리드 64px/hr, 종일 스트립, 겹치는 이벤트 컬럼 분할
- **드래그로 날짜 이동** — `@dnd-kit/core` + 낙관적 업데이트 → PATCH → 실패 시 롤백
- **팀원 필터** — `components/member-filter.tsx` (재사용 가능), 헤더에 배치
- **카테고리 정리** — 5종 → 4종 (HOLIDAY/WORK/ABSENCE/ETC), 구값 폴백
- **HOLIDAY 스페셜 처리** — 셀 핑크 배경, 일자 옆 제목, 팀원 필터 무관 항상 노출
- **다이얼로그 애니메이션** — 슬라이드업 커스텀 keyframe

### Phase 4 Step 5–7 완료 내역
- **Step 5** — Gantt 뷰: KST 자정 day 그리드, 담당자별 행 그룹, status semantic 색상 바
- **Step 6** — 캘린더 월 보기: 이전/다음/오늘 네비, 드래그, EventFormDialog
- **Step 7** — 홈 대시보드: 이관 예정 + 진행중 + 오늘 일정 + 최근 활동

---

## 운영 제약

- 내부망용이며 인증·권한 검증은 제공하지 않습니다. 외부 공개 전 별도 접근 제어가 필요합니다.
- SQLite, 캘린더 SSE, cron은 현재 단일 서버 프로세스 운영을 기준으로 합니다.
- 보안 점검은 설치된 lockfile과 실행 시점의 advisory로 판단합니다. `npm audit` 및 의존성별 공식 공지를 확인하며 과거 취약점 건수를 현재 상태로 재사용하지 않습니다.

## 설계 원칙 (요약)

- **모든 도메인 write는 `db.transaction` + `withAudit()`** 로 감사 로그와 묶음
- **Soft delete** (`deletedAt`) — 인증 없는 환경에서 복구 수단 확보
- **동시 편집 보호는 후속 과제** — 현재 API는 If-Match 헤더를 검증하지 않음
- **시간 저장은 UTC, 표시는 `Asia/Seoul`** — 한 곳(`lib/time.ts`)에서 관리
- **cursor 기반 페이지네이션** — 기본 50, 최대 200
- **Postgres 이관 대비**: `id`는 cuid2, JSON은 문자열로 저장; SQLite 전용 구문은 DB·백업 계층에 한정
