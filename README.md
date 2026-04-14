# cc-simply-tasks

내부용 작업(업무) 관리 시스템. Next.js 13.5 (app router) + Prisma + SQLite로 시작하며, 이후 Postgres 이관을 염두에 둔 구조로 설계됨.

## 목적

- 담당자별/이관일별로 작업(WorkItem)을 관리
- 작업별 요청 정보와 외부 시스템 연동 번호(WorkTicket) 추적
- 팀원(TeamMember) 관리 및 캘린더 이벤트(CalendarEvent) 표시
- 모든 쓰기(write)에 대한 감사 로그(AuditLog) 남기기 (익명 액터 기반)
- 1차 범위: 내부망, 인증 없음 (추후 확장)

## 기술 스택

| 항목 | 버전 / 선택 | 비고 |
|---|---|---|
| Node.js | **16 고정** | 사내 제약. `.nvmrc` / `engines` 명시 |
| Next.js | 13.5.11 | 13.5 라인 최신. Node 16.14+ 지원 |
| React | 18.2.0 | |
| TypeScript | 5.2.x strict | |
| Prisma | 5.10.2 | Node 16 호환 마지막 안전권 |
| DB (1차) | SQLite (file) | WAL + busy_timeout PRAGMA |
| DB (이후) | Postgres | `DATABASE_URL` 교체 가능하게 raw SQL 금지 |
| 검증 | zod 3.23 | |
| UI | Tailwind 3.4 + shadcn/ui (Radix) | zinc 뉴트럴 + blue-600 강조, 다크모드 |
| 테마 | next-themes 0.2 | system / light / dark |
| 아이콘 | lucide-react | |

## 디렉터리 구조 (현재)

```
.
├── app/
│   ├── layout.tsx
│   ├── page.tsx                 # 홈 대시보드
│   ├── globals.css
│   ├── work-items/page.tsx      # 작업 목록 (테이블/칸반/간트 토글)
│   ├── calendar/page.tsx        # 캘린더 (월 보기, 드래그 이동)
│   ├── settings/page.tsx        # 설정 (서비스명/멤버/코드관리/백업)
│   ├── members/page.tsx         # → /settings 리다이렉트
│   └── api/
│       ├── work-items/          # 레퍼런스 구현
│       │   ├── route.ts         # GET(list+필터+범위), POST(+tickets)
│       │   └── [id]/route.ts    # GET, PATCH(If-Match, tickets 전체대체), DELETE(soft)
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
│       ├── backup/route.ts      # GET — SQLite DB 파일 다운로드
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
│   │   ├── date-picker.tsx      # DatePicker (yyyy-MM-dd) + DateTimePicker (yyyy-MM-ddTHH:mm)
│   │   └── popover.tsx          # Radix Popover
│   ├── work-items/
│   │   ├── work-items-client.tsx  # 헤더(좌:타이틀/가운데:뷰토글/우:추가) + 필터바
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
│   └── (members-client.tsx → app/members/ 아래)
├── lib/
│   ├── client/
│   │   ├── api.ts               # fetch wrapper (If-Match, x-actor-name, SERVICE_NAME_STORAGE_KEY)
│   │   ├── use-toast.ts
│   │   ├── types.ts             # 클라이언트용 도메인 타입 (WorkCategory, WorkSystem, AppSettings 포함)
│   │   ├── format.ts            # KST 날짜/시간 포맷 — formatDate(yyyy-mm-dd) / formatDateTime(yyyy-mm-dd hh:mm:ss)
│   │   └── calendar.ts          # KST 월 그리드, eventDayKeys, kstWeekContaining
│   ├── db.ts                    # Prisma 싱글톤 + SQLite PRAGMA
│   ├── calendar-bus.ts          # SSE용 서버 싱글톤 EventEmitter (globalThis 보관)
│   ├── enums.ts                 # enum 소스 오브 트루스 (Status 8종, Priority, MemberRole 등)
│   ├── enum-labels.ts           # enum → 한글 라벨 (표시 전용, CATEGORY_LABELS 제거됨)
│   ├── time.ts / actor.ts / diff.ts / audit.ts / http.ts
│   ├── pagination.ts            # cursor 기반 (기본 50, 최대 200)
│   ├── optimisticLock.ts
│   ├── utils.ts
│   └── validation/
│       ├── common.ts / teamMember.ts / workTicket.ts / calendarEvent.ts
│       ├── workItem.ts          # 요청정보 + tickets 배열 + transferDateTo 범위 필터 포함
│       ├── workSystem.ts
│       └── workCategory.ts
├── prisma/
│   ├── schema.prisma            # TeamMember/WorkItem/WorkTicket/CalendarEvent/
│   │                            #   Setting/WorkSystem/WorkCategory/AuditLog
│   └── migrations/
├── docs/
│   └── DEVELOPMENT.md           # 개발 가이드 (API 패턴, 컨벤션)
├── .nvmrc                       # node 16
├── .env.example
├── package.json
├── tsconfig.json
├── next.config.js
├── PLAN.md
└── README.md
```

> 새 API를 작성할 때는 반드시 [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)의 컨벤션을 따를 것.

## 개발 시작

```bash
# Node 16 사용 (nvm 설치 권장)
nvm use                 # .nvmrc 따름

cp .env.example .env
npm install
npx prisma migrate dev
npm run dev
```

## 스크립트

| 스크립트 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 프로덕션 서버 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:generate` | Prisma client 생성 |
| `npm run prisma:migrate` | 스키마 마이그레이션 |
| `npm run prisma:studio` | Prisma Studio |

## 백업 및 복구

### 백업

설정 페이지 → **백업** 탭에서 SQLite DB 파일을 직접 다운로드.

또는 API 직접 호출:
```bash
curl -O http://localhost:3000/api/backup
```

### 복구

1. 백업 파일(`dev.db`)을 `prisma/dev.db`에 덮어씁니다.
2. 서버를 재시작합니다:
   ```bash
   npm run dev
   ```

> **주의**: 기존 데이터가 모두 덮어씌워지므로 복구 전 현재 DB를 별도 보관하세요.

## Phase 진행 상황

> 전체 계획은 [`PLAN.md`](./PLAN.md) 참고.

| Phase | 내용 | 상태 |
|---|---|---|
| **0** | 프로젝트 부트스트랩 (Next.js + Prisma + SQLite + TS) | ✅ 완료 |
| **1** | Prisma 스키마 확정 (도메인 모델 + enum + 인덱스) | ✅ 완료 |
| **2** | 공통 인프라 (time, actor, audit, validation, http, pagination, optimistic lock, SQLite PRAGMA) | ✅ 완료 |
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

### 현재 상태 (2026-04-14)

Phase 0–5++ 완료. 현재 작업 브랜치에는 작업 요청 정보 필드와 시스템 연동 단순화가 반영되어 있음.

### 알아야 할 결정사항

| 사항 | 내용 |
|---|---|
| Node 버전 | **16 고정** (사내 제약). 로컬에서 Node 23 사용해도 동작하나 프로덕션은 16. |
| enum 컬럼 | SQLite 미지원 → String 저장. `lib/enums.ts`가 유일한 소스 오브 트루스. |
| Status 8종 | `WAITING / IN_PROGRESS / INTERNAL_TEST / BUSINESS_TEST / QA_TEST / TRANSFER_READY / TRANSFERRED / HOLDING` |
| 작업 분류(category) | **동적**. `WorkCategory` 모델 → `/api/work-categories` CRUD. 설정 페이지 코드관리 탭에서 관리. |
| 한글 헤더 인코딩 | `x-actor-name`은 `encodeURIComponent` (클라이언트) / `decodeURIComponent` (서버) 처리됨. |
| 작업 목록 | 테이블 / 칸반 / 간트 3가지 보기 모두 유지. |
| 날짜/시간 | 저장: UTC ISO. 표시: KST. all-day 이벤트는 반열림 `[start, end)` 구간. |
| 낙관적 락 | PATCH/DELETE 전에 If-Match 헤더 필수 (이전 GET의 `updatedAt`). 409 충돌 시 토스트 + 자동 재로드. |
| SQLite 경로 | `prisma/schema.prisma` 기준 상대경로. `DATABASE_URL="file:./dev.db"`. |
| 감사 로그 | 모든 write는 `$transaction` + `withAudit(tx, ...)` 패턴 필수. |
| 설정 탭 구조 | 서비스 / 멤버 / 코드관리(분류+시스템 코드) / 백업 4탭. |
| 대시보드 레이아웃 | 3열: 이번주 이관 예정 \| 진행중인 작업 \| 오늘 일정, 하단: 최근 활동. |
| 캘린더 이관 표시 | 월/주 보기에서 이관일이 있는 작업 건수를 `[이관] N건` emerald 칩으로 표시 (셀 최상단). |
| 캘린더 카테고리 | 4종: HOLIDAY/WORK/ABSENCE/ETC. HOLIDAY는 팀원 필터 무관 항상 노출, 셀 핑크 배경. |
| 서비스명 | `Setting` 모델 DB 저장 (`key="service_name"`). 사이드바·설정에서 동기화, localStorage 캐시. |
| DatePicker | `components/ui/date-picker.tsx` — `DatePicker`(날짜 전용) + `DateTimePicker`(날짜+시간). 캘린더 팝오버 방식. |
| 날짜 포맷 | `formatDate` → `yyyy-mm-dd`, `formatDateTime` → `yyyy-mm-dd hh:mm:ss` (24h KST). `lib/client/format.ts` 단일화. |
| 캘린더 SSE | `GET /api/calendar-events/stream` — EventSource로 실시간 구독. POST/PATCH/DELETE 시 `emitCalendarChanged()` 호출. 단일 서버 한정. |
| 캘린더 주 보기 | 제거됨. 월 보기 전용으로 단순화. (`week-view.tsx` 삭제, `kstAddDays`/`kstWeekFetchRange` 제거) |
| 작업 필터 | 순서: 분류→상태→담당자(MemberFilter 드롭다운)→우선순위→이관일. 티켓번호 필터 제거. 초기화 버튼 항상 표시. |
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

### 남은 작업 (Phase 6, 선택)

- `[ ]` 대시보드 전체 카운트용 dedicated count API (`/api/work-items/count`)
- `[ ]` CSV export (`/api/work-items/export.csv`)
- `[ ]` Gantt 드래그 reorder / 바 리사이즈
- `[ ]` 이관완료 내역 별도 탭/페이지 (날짜 범위 필터 + 페이지네이션)
- `[ ]` Audit log 보존 정책 / archive
- `[ ]` Postgres 이관 런북 (DATABASE_URL 교체 → `prisma migrate` → seed)

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
- **DB 백업** — `GET /api/backup` → SQLite 파일 직접 다운로드
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

## 알려진 리스크 / 이슈

- **Next.js 13.5.x 잔존 보안 advisory (high 4건)**: Next 14/15/16에서 패치됐으나 Node 16 제약과 충돌. 내부망 한정으로 리스크 감내.
- **minimatch (transitive)**: ReDoS 관련, 빌드 타임 dev 의존성. 런타임 미사용.
- 로컬 Node 버전이 23인 경우 `EBADENGINE` 경고 발생 — 동작에는 영향 없음.

## 설계 원칙 (요약)

- **모든 write는 `$transaction` + `withAudit()`** 로 감사 로그와 묶음
- **Soft delete** (`deletedAt`) — 인증 없는 환경에서 복구 수단 확보
- **낙관적 락** (`If-Match: updatedAt`) — 동시 편집 충돌 방어
- **시간 저장은 UTC, 표시는 `Asia/Seoul`** — 한 곳(`lib/time.ts`)에서 관리
- **cursor 기반 페이지네이션** — 기본 50, 최대 200
- **Postgres 이관 대비**: `id`는 cuid, JSON은 문자열로 저장, raw SQL 금지
