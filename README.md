# cc-simply-tasks

내부용 작업(업무) 관리 시스템. Next.js 13.5 (app router) + Prisma + SQLite로 시작하며, 이후 Postgres 이관을 염두에 둔 구조로 설계됨.

## 목적

- 담당자별/이관일별로 작업(WorkItem)을 관리
- 작업에 연결된 외부 티켓(WorkTicket) 추적
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
│   ├── calendar/page.tsx        # 캘린더 (월 보기)
│   ├── members/page.tsx         # 멤버 관리
│   └── api/
│       ├── work-items/          # 레퍼런스 구현
│       │   ├── route.ts         # GET(list+5필터), POST
│       │   └── [id]/
│       │       ├── route.ts     # GET, PATCH(If-Match), DELETE(soft)
│       │       └── tickets/
│       │           ├── route.ts             # GET, POST
│       │           └── [ticketId]/route.ts  # PATCH, DELETE
│       ├── team-members/
│       │   ├── route.ts         # GET(list), POST
│       │   └── [id]/route.ts    # GET, PATCH, DELETE
│       ├── calendar-events/
│       │   ├── route.ts         # GET(range ?from&to), POST
│       │   └── [id]/route.ts    # GET, PATCH, DELETE
│       └── audit-logs/
│           └── route.ts         # GET(read-only, ?entityType&entityId 등)
├── components/
│   ├── app-shell.tsx            # 사이드바 + 게이트 + 토스터 셸 (h-screen 레이아웃)
│   ├── sidebar.tsx              # 좌측 네비게이션 (240/64 collapsible)
│   ├── member-filter.tsx        # 재사용 팀원 필터 (Radix Popover, 5열 그리드 멀티셀렉트)
│   ├── actor-name-gate.tsx      # 액터 이름 강제 모달 (ESC/바깥 차단)
│   ├── toaster.tsx
│   ├── theme-provider.tsx / theme-toggle.tsx
│   ├── ui/                      # shadcn 프리미티브
│   │   ├── button.tsx / input.tsx / label.tsx / select.tsx / textarea.tsx
│   │   ├── badge.tsx / dialog.tsx / sheet.tsx / tabs.tsx / toast.tsx
│   ├── work-items/
│   │   ├── work-items-client.tsx  # 필터바 + 보기 토글 진입점
│   │   ├── table-view.tsx
│   │   ├── kanban-view.tsx
│   │   ├── gantt-view.tsx
│   │   ├── work-item-drawer.tsx   # 우측 sheet (상세/티켓/활동 탭)
│   │   ├── work-item-form-dialog.tsx
│   │   └── status-badge.tsx
│   ├── calendar/
│   │   ├── calendar-client.tsx    # 오케스트레이터 (DnD 컨텍스트, 상태, 레이아웃)
│   │   ├── month-view.tsx         # 월 보기 그리드 (draggable 칩 + droppable 셀)
│   │   ├── week-view.tsx          # 주 보기 타임그리드
│   │   ├── event-form-dialog.tsx  # 생성/수정/삭제 통합
│   │   ├── use-calendar-drag.ts   # @dnd-kit 드래그 훅 (낙관적 업데이트)
│   │   └── calendar-sidebar.tsx   # 미니 캘린더 사이드바 (현재 미사용)
│   ├── dashboard/
│   │   └── dashboard-client.tsx   # 이번주 이관 예정 | 진행중인 작업 | 오늘 일정 + 최근 활동
│   └── members/
│       └── (members-client.tsx는 app/members/ 아래에 위치)
├── lib/
│   ├── client/
│   │   ├── api.ts               # fetch wrapper (x-actor-name encodeURIComponent, If-Match)
│   │   ├── use-toast.ts         # 모듈 스코프 토스트 store
│   │   ├── types.ts             # 클라이언트용 도메인 타입 (Prisma import 금지)
│   │   ├── format.ts            # KST 날짜/시간 포맷 + date input ↔ ISO 변환
│   │   └── calendar.ts          # KST 월 그리드, eventDayKeys, weekdayLabel
│   ├── db.ts                    # Prisma 싱글톤 + SQLite PRAGMA
│   ├── enums.ts                 # enum 소스 오브 트루스 + union 타입
│   ├── enum-labels.ts           # enum → 한글 라벨 (표시 전용)
│   ├── time.ts                  # KST/UTC 변환, all-day 반열림 정규화
│   ├── actor.ts                 # getActorContext (x-actor-name decodeURIComponent)
│   ├── diff.ts                  # before/after 변경 필드 추출
│   ├── audit.ts                 # withAudit (Prisma.TransactionClient 강제)
│   ├── http.ts                  # 표준 에러 응답 + withErrorHandler
│   ├── pagination.ts            # cursor 기반 (기본 50, 최대 200)
│   ├── optimisticLock.ts        # If-Match 낙관적 락
│   ├── utils.ts                 # cn (clsx + tailwind-merge)
│   └── validation/              # zod 스키마 (common/teamMember/workItem/workTicket/calendarEvent)
│       # calendar.ts — kstMonthGrid, kstWeekContaining, kstAddDays, eventDayKeys
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── docs/
│   └── DEVELOPMENT.md           # 개발 가이드 (API 패턴, 컨벤션)
├── .nvmrc                       # node 16
├── .env.example
├── package.json
├── tsconfig.json
├── next.config.js
├── PLAN.md                      # 전체 실행 계획 + 완료 체크
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

설정 페이지에서 "Backup" 탭을 통해 전체 데이터베이스와 마이그레이션 히스토리를 ZIP 파일로 다운로드할 수 있습니다.

또는 API를 직접 호출:
```bash
curl -O http://localhost:3000/api/backup
```

### 복구

1. 백업 ZIP 파일을 다운로드받아 압축을 해제합니다.
2. `prisma/` 폴더 전체를 프로젝트 루트의 `prisma/` 폴더에 덮어씌웁니다.
3. Prisma 클라이언트를 재생성합니다:
   ```bash
   npx prisma generate
   ```
4. 마이그레이션을 적용합니다 (필요한 경우):
   ```bash
   npx prisma migrate deploy
   ```
5. 개발 서버를 재시작합니다:
   ```bash
   npm run dev
   ```

> **주의**: 복구 시 기존 데이터가 모두 덮어씌워지므로 백업을 미리 받아두세요.

## Phase 진행 상황

> 전체 계획은 [`PLAN.md`](./PLAN.md) 참고.

| Phase | 내용 | 상태 |
|---|---|---|
| **0** | 프로젝트 부트스트랩 (Next.js + Prisma + SQLite + TS) | ✅ 완료 |
| **1** | Prisma 스키마 확정 (도메인 모델 + enum + 인덱스) | ✅ 완료 |
| **2** | 공통 인프라 (time, actor, audit, validation, http, pagination, optimistic lock, SQLite PRAGMA) | ✅ 완료 |
| **3** | API 라우트 (team-members, work-items, work-tickets, calendar-events, audit-logs) | ✅ 완료 |
| **4** | UI (디자인 토큰 + shadcn/ui + 테이블/드로어/Gantt/캘린더 + 대시보드) | ✅ 완료 |
| **4+** | 캘린더 개선 (주 보기, 드래그 이동, 팀원 필터, 카테고리 정리, 다중 담당자) | ✅ 완료 |
| **4++** | 대시보드 개편 (3열 레이아웃, 진행중인 작업, 작업 드로어 연동) | ✅ 완료 |
| **5** | 폴리싱 (작업 탭 개선, CSV export 등 선택) | ⏳ 진행 중 |
| **6** | Postgres 이관 준비 런북 | ⏳ 대기 |

---

## 핸드오프 메모 (다음 에이전트용)

### 현재 상태 (2026-04-12)

Phase 0–4 + 캘린더 개선 + 대시보드 개편 완료. `tsc --noEmit` 통과.

### 알아야 할 결정사항

| 사항 | 내용 |
|---|---|
| Node 버전 | **16 고정** (사내 제약). 로컬에서 Node 23 사용해도 동작하나 프로덕션은 16. |
| enum 컬럼 | SQLite 미지원 → String 저장. `lib/enums.ts`가 유일한 소스 오브 트루스. |
| 한글 헤더 인코딩 | `x-actor-name`은 `encodeURIComponent` (클라이언트) / `decodeURIComponent` (서버) 처리됨. |
| 작업 목록 | 테이블 / 칸반 / 간트 3가지 보기 모두 유지. 한 쪽만 줄이는 방향은 먼저 꺼내지 말 것. |
| 날짜/시간 | 저장: UTC ISO. 표시: KST. all-day 이벤트는 반열림 `[start, end)` 구간. |
| 낙관적 락 | PATCH/DELETE 전에 If-Match 헤더 필수 (이전 GET의 `updatedAt`). 409 충돌 시 "다른 사용자가 먼저 수정했습니다" 토스트 + 자동 재로드. |
| SQLite 경로 | `prisma/schema.prisma` 기준 상대경로로 해석됨. 로컬 SQLite는 `DATABASE_URL="file:./dev.db"` 사용. |
| 감사 로그 | 모든 write는 `$transaction` + `withAudit(tx, ...)` 패턴 필수. `tx`가 `Prisma.TransactionClient`임을 타입으로 강제. |
| 대시보드 레이아웃 | 3열: 이번주 이관 예정 \| 진행중인 작업 \| 오늘 일정, 하단: 최근 활동. 작업 클릭 → `WorkItemDrawer` 오픈. |
| 대시보드 카운트 | work-items 첫 페이지(50건) 기준. 전체 카운트는 Phase 5에서 `/api/work-items/count` 별도 API 추가 예정. |
| 캘린더 카테고리 | 4종: HOLIDAY/WORK/ABSENCE/ETC. DB에 구값(MEETING 등) 잔존 가능 → `getCategoryBadge()` 폴백 처리. |
| HOLIDAY 이벤트 | 스페셜 취급: 팀원 필터 무관 항상 노출, 셀 핑크 배경, 일자 옆 제목 표시, 칩은 별도 미표시. |
| AppShell 레이아웃 | `h-screen overflow-hidden` + main `overflow-y-auto`. 캘린더 페이지는 `h-full`로 주 보기 내부 스크롤 처리. |
| MemberFilter | `components/member-filter.tsx` — Radix Popover 기반, 재사용 가능. 캘린더 헤더에 배치. |

### 남은 작업 (Phase 5–6, 선택)

- `[ ]` **작업 탭 개선** (Phase 5 진행 중)
- `[ ]` 대시보드 전체 카운트용 dedicated count API
- `[ ]` CSV export (`/api/work-items/export.csv`)
- `[ ]` Gantt 드래그 reorder / 바 리사이즈
- `[ ]` 캘린더 — 휴일 전용 관리 (일반 이벤트와 분리, 공휴일 자동 연동 등 검토 중)
- `[ ]` 캘린더 — 작업 목록에 MemberFilter 적용
- `[ ]` Audit log 보존 정책 / archive
- `[ ]` Postgres 이관 런북 (DATABASE_URL 교체 → `prisma migrate` → seed)

---

### Phase 4++ 대시보드 개편 완료 내역 (2026-04-12)
- **레이아웃 재편** — 상태 카드 5개 제거 → 3열 동일 비율: 이번주 이관 예정 · 진행중인 작업 · 오늘 일정
- **진행중인 작업 패널** — `IN_PROGRESS` 필터링, 제목·담당자 표시
- **작업 클릭 → WorkItemDrawer** — 이번주 이관 예정·진행중인 작업 양쪽에서 드로어 오픈, 드로어 내 수정/삭제 후 목록 자동 갱신
- **이벤트 정렬 통일** — 종일 우선 → 카테고리(HOLIDAY→WORK→ABSENCE→ETC) → 제목 asc (대시보드·캘린더 공통 `sortEvents()` 적용)

### Phase 5 작업 탭 폴리싱 완료 내역 (2026-04-12)
- **SQLite 연결 경로 수정** — `.env`, `.env.example`의 `DATABASE_URL`을 `file:./dev.db`로 정리해 Prisma가 실제 DB 파일 `prisma/dev.db`를 바라보도록 수정
- **SQLite PRAGMA 초기화 정리** — `lib/db.ts`에서 `journal_mode`, `busy_timeout`, `foreign_keys`를 모두 query 방식으로 호출해 dev 서버 경고 제거
- **칸반 카드 클릭 복구** — `@dnd-kit/core` `PointerSensor(distance:8)` 적용으로 클릭은 드로어 오픈, 실제 드래그 시에만 상태 이동
- **칸반 연속 상태 변경 충돌 수정** — 드래그 성공 후 PATCH 응답의 최신 `updatedAt`을 목록 상태에 반영해 자기 자신의 직전 변경과 충돌하지 않도록 수정
- **칸반 상태 필터 반영** — 선택한 상태 컬럼만 렌더링하고, 선택되지 않은 상태 컬럼 껍데기는 숨김. 컬럼 수는 선택 개수에 맞춰 자동 조정

### Phase 4+ 캘린더 개선 완료 내역 (2026-04-12)
- **주 보기(Week view)** — 타임그리드 64px/hr, 종일 스트립, 겹치는 이벤트 컬럼 분할, 마운트 시 8시 자동 스크롤
- **드래그로 날짜 이동** — `@dnd-kit/core` + `PointerSensor(distance:8)`, 낙관적 업데이트 → PATCH → 실패 시 롤백
- **팀원 필터** — `components/member-filter.tsx` (재사용 가능), 헤더에 배치, 5열 그리드 드롭다운
- **카테고리 정리** — 5종 → 4종 (HOLIDAY/WORK/ABSENCE/ETC), 구값 폴백(`getCategoryBadge`)
- **HOLIDAY 스페셜 처리** — 셀 핑크 배경, 일자 옆 제목, 팀원 필터 무관 항상 노출, 칩 제외
- **이벤트 폼** — 카테고리 최상단 배치, 다중 담당자 체크박스 선택
- **다이얼로그 애니메이션** — 슬라이드업 커스텀 keyframe (`globals.css`)
- **AppShell** — `h-screen overflow-hidden` 레이아웃으로 변경 (주 보기 내부 스크롤 지원)
- **CalendarEvent 스키마** — 다대다 담당자(`CalendarEventMember` 조인 테이블), `category` 컬럼 추가

### Phase 4 Step 5–7 완료 내역
- **Step 5 — Gantt 뷰** (`components/work-items/gantt-view.tsx`)
  - KST 자정 day 그리드, 1일 = 32px, 작업 페이지의 3번째 보기로 통합 (테이블/칸반/간트)
  - 담당자별 행 그룹 + 미배정 마지막, 주말 muted 배경, status semantic 색상 바
  - 일정 없는 작업은 표시하지 않음 (테이블/칸반에서 확인)
  - 드래그 reorder는 Phase 5+ 후속
- **Step 6 — 캘린더 월 보기** (`components/calendar/`)
  - `lib/client/calendar.ts` — KST 월 그리드(6주 42칸), `eventDayKeys` (allDay 반열림 처리)
  - 이전/다음/오늘 네비, 셀 호버 [+] 버튼, 이벤트 칩 클릭 → 수정
  - `EventFormDialog` — 생성/수정/삭제 통합, allDay 토글 시 시간/날짜 입력 전환
  - 주/일 보기는 후속
- **Step 7 — 홈 대시보드** (`components/dashboard/dashboard-client.tsx`)
  - 상태별 카운트 카드 5개 (status semantic 색상, 클릭 → 작업 페이지)
  - 오늘 이관 예정 작업 리스트 (TRANSFERRED/CANCELED 제외)
  - 최근 활동 audit logs 10건
  - 1차는 work items 첫 페이지(50건) 기반 카운트, 정확한 전체 카운트는 후속의 dedicated count API로

### Phase 4 Step 4 완료 내역
- 프리미티브 추가: `textarea`, `badge`, `sheet`(우측 드로어), `tabs`
- `lib/client/types.ts` — 도메인 타입 (Prisma client를 클라이언트 번들로 끌어오지 않기 위해 별도 정의)
- `lib/client/format.ts` — KST 기준 일/시 포맷 + `<input type="date">` ↔ UTC ISO 변환 (KST 자정 보존)
- `components/work-items/status-badge.tsx` — `globals.css`의 status semantic CSS 변수를 그대로 사용
- `WorkItemFormDialog` — 생성/수정 통합, 5개 메타데이터(상태/우선순위/분류/담당자/기간/이관일/설명)
- `WorkItemDrawer` — 우측 sheet + Radix Tabs (상세 / 티켓 / 활동)
  - 티켓 탭: list/add/delete, P2002 → "이미 등록된 티켓" 토스트
  - 활동 탭: `/api/audit-logs?entityType=WorkItem&entityId=…` 타임라인
- `TableView` (행 클릭) / `KanbanView` (상태별 컬럼) — 보기 토글은 localStorage에 저장
- `WorkItemsClient` — 필터바(상태/담당자/분류/우선순위/티켓), 빈상태/스켈레톤/에러 일체
- 1차 범위에서는 첫 페이지(50건)만 표시. nextCursor 페이지 이동/드래그 reorder는 후속

### Phase 4 Step 3 완료 내역
- `lib/enum-labels.ts` — enum 값 → 한글 라벨 매핑 (`lib/enums.ts`가 값/타입 소스 오브 트루스, 이 파일은 표시 전용)
- `components/ui/select.tsx` — 네이티브 `<select>` 기반 (Radix Select는 필요할 때 교체)
- `app/members/members-client.tsx` — 멤버 목록/생성/수정/삭제, 스켈레톤/빈상태/에러 상태 일체
- 생성 + 수정 다이얼로그 통합 (mode 분기), `If-Match: updatedAt` 낙관적 락 자동 처리
- 낙관적 락 충돌(409) 처리: "다른 사용자가 먼저 수정했습니다" 토스트 + 자동 재로드
- 이 페이지의 패턴(목록 → 다이얼로그 → 토스트 → 재로드)은 다음 단계의 작업/캘린더에서 그대로 답습

### Phase 4 Step 2 완료 내역
- `lib/client/api.ts` — fetch wrapper. `x-actor-name`을 localStorage에서 자동 주입, PATCH/DELETE의 `If-Match` 헤더 처리, 표준 에러 응답을 `ApiError`로 매핑
- `lib/client/use-toast.ts` + `components/toaster.tsx` — 모듈 스코프 store 기반 토스트 (어디서든 `toast(...)` 호출 가능)
- shadcn 프리미티브 추가: `input`, `label`, `dialog`, `toast`
- `components/actor-name-gate.tsx` — localStorage에 actor name이 없으면 ESC/바깥 클릭이 차단된 모달로 입력 강제
- `components/sidebar.tsx` — 240/64px collapsible, 라우트 활성 매칭, 액터 이름 표시 + 변경, 다크 토글, collapsed 상태도 localStorage에 저장
- `components/app-shell.tsx` — `RootLayout`(서버 컴포넌트)에서 children을 받아 사이드바 + 게이트 + 토스터를 한 번에 감싸는 클라이언트 셸
- 스텁 페이지: `/work-items`, `/calendar`, `/members` (Step 3+에서 채워짐)
- `tsc --noEmit` / `next build` 통과

### Phase 0 완료 내역
- Node 16 런타임 선언 (`.nvmrc`, `engines`)
- Next.js 13.5.11 / React 18.2 / TypeScript 5.2 strict
- Prisma 5.10.2 + SQLite 연결, Prisma 싱글톤 (`lib/db.ts`)
- `next build` / `prisma generate` / `prisma migrate dev` 전부 통과

### Phase 1 완료 내역
- 도메인 모델: `TeamMember`, `WorkItem`, `WorkTicket`, `CalendarEvent`, `AuditLog`
- SQLite는 native enum 미지원 → enum 컬럼은 String 저장, `lib/enums.ts`가 소스 오브 트루스
- Soft delete 필드 (`deletedAt`) 전 모델 적용
- 인덱스: `WorkItem[assigneeId,status]`, `[transferDate]`, `[startDate,endDate]`, `WorkTicket@@unique([workItemId,systemName,ticketNumber])`, `AuditLog[entityType,entityId,createdAt]` 등
- 초기 migration `20260411144540_init` 적용 완료

### Phase 3 완료 내역
- **work-items** (레퍼런스): list/get/create/update(If-Match)/delete(soft) + 5개 필터 + 페이지네이션
- **work-items/:id/tickets**: list/create + ticket item PATCH/DELETE (유니크 제약 자동 매핑)
- **team-members**: list(`?role`)/get/create/update/delete
- **calendar-events**: range query(`?from&to&memberId`, [from,to) overlap)/get/create/update/delete
- **audit-logs** (read-only): list with `entityType/entityId/action/actorName` 필터
- 전체 API 9개 엔드포인트, 모두 `withErrorHandler` + `$transaction` + `withAudit` + `assertIfMatch` 패턴 통일
- `tsc --noEmit` / `next build` 통과

### Phase 2 완료 내역
- `lib/enums.ts` — 모든 enum 값의 소스 오브 트루스 (Status/Priority/Category/MemberRole/ActorType/AuditAction/AuditEntityType)
- `lib/db.ts` — Prisma 싱글톤 + `ensureSqlitePragma()` (WAL / busy_timeout / foreign_keys)
- `lib/time.ts` — KST/UTC 변환, all-day 반열림 구간 정규화
- `lib/actor.ts` — `getActorContext(req)` (x-forwarded-for / x-actor-name / user-agent)
- `lib/diff.ts` — before/after 변경 필드만 추출 + JSON 직렬화
- `lib/audit.ts` — `withAudit(tx, ...)` 헬퍼 (**`Prisma.TransactionClient` 타입 강제**로 트랜잭션 밖 호출 차단)
- `lib/http.ts` — 표준 에러 응답 포맷 + `withErrorHandler` + Prisma 에러 매핑 (P2002/P2025)
- `lib/pagination.ts` — cursor 기반 (기본 50, 최대 200)
- `lib/optimisticLock.ts` — `If-Match` 헤더 기반 낙관적 락
- `lib/validation/` — zod 스키마 (common, teamMember, workItem, workTicket, calendarEvent)
- `next build` / `tsc --noEmit` 통과

## 알려진 리스크 / 이슈

- **Next.js 13.5.x 잔존 보안 advisory (high 4건)**: 원인은 Next.js 서버 기능 관련 (SSRF, cache poisoning, DoS 등). 모두 Next.js 14/15/16에서 패치되었으나 Next 14+는 **Node 18.17+ 필수** → Node 16 제약과 충돌. 1차는 내부망 한정 사용으로 **리스크 감내**하고, 사내 Node 상향이 가능해지는 시점에 Next.js 상향으로 해소.
- **minimatch (transitive, `@typescript-eslint`)**: ReDoS 관련 advisory. 런타임에 미사용 (빌드 타임 dev 의존성). 영향 낮음.
- 로컬 Node 버전이 23인 경우 `npm install` 시 `EBADENGINE` 경고 발생 — advisory 경고로 동작에는 영향 없음. 프로덕션은 반드시 Node 16.

## 설계 원칙 (요약)

- **모든 write는 `$transaction` + `withAudit()`** 로 감사 로그와 묶음
- **Soft delete** (`deletedAt`) — 인증 없는 환경에서 복구 수단 확보
- **낙관적 락** (`If-Match: updatedAt`) — 동시 편집 충돌 방어
- **시간 저장은 UTC, 표시는 `Asia/Seoul`** — 한 곳(`lib/time.ts`)에서 관리
- **`category` 등 유한 값은 Prisma enum** — 필터/통계 안정성
- **cursor 기반 페이지네이션** — 기본 50, 최대 200
- **Postgres 이관 대비**: `id`는 cuid, JSON은 문자열로 저장, raw SQL 금지
