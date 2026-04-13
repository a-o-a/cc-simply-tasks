# 작업 관리 시스템 - 타당성 분석 & 실행 계획

> 리뷰 대상: Next.js 13.5 + Prisma + SQLite 기반 내부용 작업 관리 시스템에 대한 에이전트 리뷰 응답 (상태/감사로그/Gantt/캘린더 포함).

---

## 1. 타당성 분석

### 1.1 전체 평가
리뷰 응답의 지적은 **대부분 타당**하며, 내부용 MVP로 바로 구현 가능한 실용적 수준의 보완 사항들입니다. 스펙을 폐기하고 다시 짜야 할 만큼의 구조적 결함은 없고, "운영 중 실제로 부딪힐 지점"을 선제적으로 잡아내는 성격의 피드백입니다.

### 1.2 항목별 타당성

| 구분 | 항목 | 타당성 | 판단 |
|---|---|---|---|
| 🔴 | Node 16 → Node 18 LTS | **높음** | Node 16은 EOL. 강제 제약이 아니라면 18/20 즉시 상향. |
| 🔴 | Status enum 완결성 (TRANSFERRED/CANCELED) | **높음** | 종결 상태 없으면 "완료 필터"가 불가. 즉시 반영. |
| 🔴 | 감사 로그 $transaction 강제 | **매우 높음** | 데이터 정합성 핵심. `withAudit()` 헬퍼로 반드시 강제. |
| 🔴 | actor_ip/actor_name 추출 표준화 | **높음** | `x-forwarded-for` 파싱 + localStorage 강제 입력. |
| 🔴 | Soft delete (`deletedAt`) | **높음** | 인증 없는 환경에서 삭제 복구 수단 필수. |
| 🟡 | WorkItem priority/order/인덱스 | **높음** | Gantt·칸반 UX와 쿼리 성능에 직결. |
| 🟡 | WorkTicket unique 제약 | **중간** | 중복 입력 방어용, 비용 낮음. |
| 🟡 | CalendarEvent 반열림 구간 / 인덱스 | **높음** | 캘린더 쿼리에서 빠지면 안 됨. |
| 🟡 | TeamMember 멀티롤 (배열/조인) | **낮음(1차)** | 단일 role + TODO로 보류 타당. |
| 🟡 | audit_logs diff 저장 + 인덱스 | **높음** | 풀 스냅샷은 용량 폭증 위험. |
| 🟡 | zod 검증 / 페이지네이션 / If-Match 낙관적 락 | **높음** | 동시 편집 충돌은 인증 없는 환경에서 실제로 발생. |
| 🟡 | 누락 API (event PATCH/DELETE, audit-logs 조회) | **높음** | 감사 로그를 쌓기만 하고 소비처가 없으면 가치 절반. |
| 🟡 | Unassigned 그룹 / 타임존 / 빈 상태 UX | **높음** | 내부툴이어도 UX 기본기는 필요. |
| 🟢 | Postgres 이관 대비 (cuid, DateTime 통일, JSON 문자열) | **높음** | 비용 없이 지금 반영 가능. |
| 🟢 | CSV export / 대시보드 / 검색 | **중간** | 유용하지만 1차 범위 밖으로 미뤄도 OK. |

### 1.3 이견 / 범위 조정 권고
- **Node 버전**: 사내 표준이 Node 16으로 고정돼 있다면 `engines` 명시만으로 충분. 아니라면 18 LTS.
- **멀티롤 `TeamMember.roles`**: 1차는 단일 role로 가고, 조인 테이블(`member_roles`)은 2차. 리뷰 응답도 같은 결론.
- **FTS5 검색**: 1차 제외. LIKE로 충분.
- **Rate limit**: 내부망이면 생략.
- **CSV export / 대시보드**: 1차 범위에 포함하면 공수가 늘어남. **2차(폴리싱)**로 분리.

### 1.4 리스크
1. **감사 로그 우회**: 헬퍼 없이 raw Prisma write를 허용하면 로그가 빠짐 → lint 규칙 또는 repository 레이어 강제.
2. **SQLite 동시 write**: 파일 lock 기반이라 write 경합 시 SQLITE_BUSY 발생 가능 → busy_timeout PRAGMA + 재시도.
3. **타임존**: UTC 저장 / `Asia/Seoul` 표시 원칙이 한 곳에서 깨지면 all-day 이벤트가 하루씩 어긋남.
4. **낙관적 락 미적용**: 동시 편집 시 마지막 write가 앞 write를 조용히 덮어씀.
5. **Postgres 이관 시 JSON 필드 타입 차이**: 지금부터 "JSON 문자열" 컨벤션으로 저장.

---

## 2. 실행 계획

### Phase 0 — 프로젝트 부트스트랩 ✅ 완료
- [x] Next.js 13.5.11 (app router) + TypeScript 5.2 strict + Prisma 5.10.2 + SQLite
- [x] `engines: { node: ">=16.14 <17" }` + `.nvmrc` (사내 Node 16 제약)
- [x] `prisma/schema.prisma`, `DATABASE_URL` 환경변수 기반
- [x] `prisma/dev.db` gitignore, `.env.example`
- [x] `lib/db.ts` Prisma 싱글톤
- [x] SQLite PRAGMA는 Phase 2에서 `ensureSqlitePragma()`로 배치

### Phase 1 — 스키마 확정 ✅ 완료
> SQLite는 native enum 미지원 → enum 컬럼은 String 저장, `lib/enums.ts`가 소스 오브 트루스.
> Postgres 이관 시 String → enum 타입으로 교체.

- [x] enum 값(`lib/enums.ts`):
  - Status: `WAITING / IN_PROGRESS / INTERNAL_TEST / BUSINESS_TEST / QA_TEST / TRANSFER_READY / TRANSFERRED / HOLDING`
  - Priority: `LOW / NORMAL / HIGH`
  - Category: **제거** — `WorkCategory` 모델로 동적 관리 (`/api/work-categories`)
  - MemberRole: `WEB_DEV / APP_DEV / UI_DEV / PLANNING / DESIGN / ETC`
  - ActorType: `ANONYMOUS` (추후 `USER`)
  - AuditAction: `CREATE / UPDATE / DELETE / RESTORE`
  - AuditEntityType: `WorkItem / WorkTicket / CalendarEvent / TeamMember / WorkSystem / WorkCategory`
- [x] `TeamMember { id, name, role, createdAt, updatedAt, deletedAt }`
- [x] `WorkItem { id, title, description, category(String), status, priority, order, assigneeId?, startDate?, endDate?, transferDate?, createdAt, updatedAt, deletedAt }`
  - `category`는 `WorkCategory.code` 참조 (String, 동적). 기본값 `""` (미분류).
  - 인덱스: `[assigneeId, status]`, `[transferDate]`, `[startDate, endDate]`, `[deletedAt]`, `[status]`
- [x] `WorkTicket { id, workItemId, systemName, ticketNumber, ticketUrl?, createdAt, updatedAt, deletedAt }`
  - `@@unique([workItemId, systemName, ticketNumber])` + `[workItemId]`, `[ticketNumber]` 인덱스
- [x] `CalendarEvent { id, title, category, startDateTime, endDateTime, allDay, note?, createdAt, updatedAt, deletedAt }`
  - `CalendarEventMember` 조인 테이블로 다대다 담당자 연결
  - 인덱스: `[startDateTime, endDateTime]`, `[deletedAt]`
  - 규칙: `allDay=true`면 `[start, end)` 반열림 + 00:00 UTC 정규화 (`lib/time.ts`)
- [x] `Setting { key String @id, value String, updatedAt }` — `service_name` 키 저장
- [x] `WorkSystem { id, code @unique, name, createdAt, updatedAt, deletedAt }` — 티켓 시스템 코드 마스터
- [x] `WorkCategory { id, code @unique, name, createdAt, updatedAt, deletedAt }` — 작업 분류 코드 마스터
- [x] `AuditLog { id, entityType, entityId, action, beforeJson?, afterJson?, actorType, actorName?, actorIp?, userAgent?, createdAt }`
  - 인덱스: `[entityType, entityId, createdAt]`, `[createdAt]`
  - `beforeJson`/`afterJson`은 **변경 필드만** 담는 diff (String, JSON stringified)
- [x] 모든 `id`는 `cuid()`
- [x] 초기 migration `20260411144540_init` 적용

### Phase 2 — 공통 인프라 ✅ 완료
- [x] `lib/enums.ts` — enum 값 상수 배열 + union 타입 export
- [x] `lib/db.ts` — `ensureSqlitePragma()`: `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON` (첫 연결 시 1회)
- [x] `lib/time.ts` — `APP_TIMEZONE`, `kstDateStringToUtc`, `utcToKstDateString`, `normalizeAllDayRange`, `kstTodayUtc`
- [x] `lib/actor.ts` — `getActorContext(req)`: `x-forwarded-for` 우선 → IP, `x-actor-name` → 이름, UA
- [x] `lib/audit.ts` — `withAudit(tx, ...)` 헬퍼. **`Prisma.TransactionClient` 타입 강제**로 트랜잭션 밖 호출 차단. UPDATE 시 diff 없음이면 스킵.
- [x] `lib/diff.ts` — `computeDiff` + `diffToJsonStrings` (Date ISO 정규화 포함)
- [x] `lib/http.ts` — `{ error: { code, message, details? } }` + `HttpError` + `withErrorHandler` (ZodError/Prisma P2002/P2025 매핑)
- [x] `lib/pagination.ts` — cursor 기반, 기본 50 / 최대 200, `parsePagination` + `toPage`
- [x] `lib/optimisticLock.ts` — `assertIfMatch(req, updatedAt)` 불일치 시 409 + serverUpdatedAt 반환
- [x] `lib/validation/` — zod: `common`, `teamMember`, `workItem`, `workTicket`, `calendarEvent`
- [x] `tsc --noEmit` + `next build` 통과

### Phase 3 — API 라우트 (app/api) ✅ 완료
모든 write는 `$transaction` + `withAudit` + `getActorContext` 필수.
개발 규칙: [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) 준수.
레퍼런스 구현: `app/api/work-items/*`.

- [x] **`work-items`**
  - [x] GET(list): `?status&assigneeId&category&priority&ticket&transferDate&transferDateTo&cursor&pageSize`
  - [x] POST / GET(:id) / PATCH(:id, If-Match) / DELETE(:id, soft)
- [x] **`work-items/:id/tickets`**
  - [x] GET / POST / PATCH(:ticketId) / DELETE(:ticketId)
- [x] **`team-members`**
  - [x] GET(list): `?role&cursor&pageSize`
  - [x] POST / GET(:id) / PATCH(:id, If-Match) / DELETE(:id, soft)
- [x] **`calendar-events`**
  - [x] GET(range): `?from&to&memberId` (반열림 [from, to) overlap)
  - [x] POST / GET(:id) / PATCH(:id, If-Match) / DELETE(:id, soft)
- [x] **`work-systems`**
  - [x] GET(list) / POST / PATCH(:id, If-Match) / DELETE(:id, soft)
- [x] **`work-categories`**
  - [x] GET(list) / POST / PATCH(:id, If-Match) / DELETE(:id, soft)
- [x] **`settings`**
  - [x] GET / PATCH (service_name)
- [x] **`backup`**
  - [x] GET — SQLite DB 파일 다운로드
- [x] **`audit-logs`** (읽기 전용)
  - [x] GET: `?entityType&entityId&action&actorName&cursor&pageSize`

### Phase 4 — UI (MVP) ✅ 완료
디자인 결정: shadcn/ui + Tailwind, zinc 뉴트럴 + blue-600 강조, **다크모드 1차 포함**, WorkItem 목록은 **칸반/테이블 토글**.

- [x] **Step 1 — 디자인 시스템 부트스트랩**
  - [x] Tailwind 3.4 + PostCSS + shadcn 의존성 설치 (Node 16 호환 버전 핀)
  - [x] `tailwind.config.ts` 디자인 토큰 (zinc + blue, status semantic)
  - [x] `app/globals.css` CSS 변수 (라이트/다크 모두)
  - [x] `lib/utils.ts` cn 헬퍼
  - [x] `components/theme-provider.tsx` (next-themes), `components/theme-toggle.tsx`
  - [x] `components/ui/button.tsx` (shadcn 표준 5 variant + 4 size)
  - [x] 임시 홈 페이지로 smoke test (버튼 + 상태 칩 + 다크 토글)
- [x] **Step 2 — 레이아웃 + 네비게이션 + 액터 이름 강제 모달**
  - [x] `lib/client/api.ts` fetch wrapper (`x-actor-name` 자동, `If-Match` 처리, 표준 에러 → `ApiError`)
  - [x] `lib/client/use-toast.ts` + `components/toaster.tsx` (모듈 스코프 store + Radix toast)
  - [x] shadcn 프리미티브: `input`, `label`, `dialog`, `toast`
  - [x] `components/actor-name-gate.tsx` — localStorage 비어있으면 모달 강제, ESC/바깥 클릭 차단
  - [x] `components/sidebar.tsx` — 240/64 collapsible, 라우트 활성 매칭, 액터 이름 표시/변경, 다크 토글
  - [x] `components/app-shell.tsx` — RootLayout(서버 컴포넌트)에서 children을 받아 사이드바/게이트/토스터로 감쌈
  - [x] 스텁 페이지: `/work-items`, `/calendar`, `/members`
  - [x] `tsc --noEmit` / `next build` 통과
- [x] **Step 3 — 멤버 관리 페이지** (가장 단순, 패턴 검증)
  - [x] `lib/enum-labels.ts` — enum 값 → 한글 라벨 매핑 (소스 오브 트루스는 `lib/enums.ts`)
  - [x] `components/ui/select.tsx` — 네이티브 `<select>` 기반 (Radix Select 도입은 필요할 때 교체)
  - [x] `app/members/members-client.tsx` — 목록 fetch / 빈상태 / 스켈레톤 / 에러
  - [x] 생성 + 수정 다이얼로그 (`MemberFormDialog`) — `If-Match: updatedAt` 자동 처리, 토스트 피드백
  - [x] 삭제 확인 다이얼로그 (`DeleteMemberDialog`) — soft delete + If-Match
  - [x] 낙관적 락 충돌(409) 처리 패턴: 토스트 + 자동 재로드
  - [x] `tsc --noEmit` / `next build` 통과 (members 페이지 5.7kB)
- [x] **Step 4 — 작업 목록 (테이블 + 칸반 토글) + 필터 + 드로어 + 활동 탭**
  - [x] 프리미티브: `textarea`, `badge`, `sheet`(우측 드로어), `tabs`
  - [x] `lib/client/types.ts` — 도메인 타입 (Prisma client 직접 import 금지)
  - [x] `lib/client/format.ts` — KST 일/시 포맷 + `<input type=date>` ↔ ISO 변환
  - [x] `components/work-items/status-badge.tsx` — globals.css의 status semantic 변수 사용
  - [x] `WorkItemFormDialog` — 생성/수정 통합, KST 자정 → UTC ISO 직렬화
  - [x] `WorkItemDrawer` — 우측 sheet, 탭 (상세 / 티켓 / 활동)
    - 상세: 메타데이터 + 설명
    - 티켓: list/add/delete (CONFLICT는 "이미 등록된 티켓" 토스트로 매핑)
    - 활동: `/api/audit-logs?entityType=WorkItem&entityId=...` 타임라인
  - [x] `TableView` / `KanbanView` — 행/카드 클릭 → 드로어
  - [x] `WorkItemsClient` — 필터바 (status/assignee/category/priority/ticket), 보기 토글(localStorage), 빈상태/스켈레톤/에러
  - [x] `tsc --noEmit` / `next build` 통과 (work-items 페이지 13.7 kB)
- [x] **Step 5 — Gantt 뷰** (담당자 그룹 + Unassigned)
  - [x] `components/work-items/gantt-view.tsx` — KST 자정 day 그리드, 1일 = 32px
  - [x] 작업 페이지의 3번째 보기로 통합 (테이블 / 칸반 / 간트 토글)
  - [x] 일정이 설정된 작업만 표시 (start/end가 둘 다 없으면 제외)
  - [x] 미배정은 마지막 그룹, 주말 칼럼은 muted 배경
  - [x] 드래그 reorder/리사이즈는 Phase 5+ 후속
- [x] **Step 6 — 캘린더 뷰** (월/주, all-day 규칙 반영)
  - [x] `lib/client/calendar.ts` — KST 월 그리드(6주 42칸), `eventDayKeys` (allDay 반열림 처리)
  - [x] `components/calendar/calendar-client.tsx` — 월 보기, 이전/다음/오늘 네비
  - [x] `components/calendar/event-form-dialog.tsx` — 생성/수정/삭제 통합, allDay 토글 + 시간 입력
  - [x] 셀 호버 시 [+] 버튼, 이벤트 칩 클릭 → 수정 모달
  - [x] 주/일 보기는 Phase 5+ 후속
- [x] **Step 7 — 홈 대시보드** (상태별 카운트, 오늘 이관 예정)
  - [x] `components/dashboard/dashboard-client.tsx`
  - [x] 상태별 카운트 카드 5개 (status semantic 색상, 클릭 → 작업 페이지) → Step 7+ 에서 재편
  - [x] 오늘 이관 예정 작업 리스트 (TRANSFERRED/CANCELED 제외)
  - [x] 최근 활동 (audit-logs 최근 10건)
  - [x] 1차는 work items 첫 페이지(50건) 기반 카운트, 정확한 전체 카운트는 후속에서 dedicated count API로
- [x] **Step 7+ — 대시보드 개편** (3열 레이아웃, 작업 드로어 연동)
  - [x] 상태 카드 5개 → 이번주 이관 예정 \| 진행중인 작업 \| 오늘 일정 3열로 재편
  - [x] 진행중인 작업 패널: `IN_PROGRESS` 필터, 클릭 → `WorkItemDrawer`
  - [x] 이번주 이관 예정도 클릭 → `WorkItemDrawer` (드로어 내 수정·삭제 지원)
  - [x] 이벤트 정렬: 종일 우선 → 카테고리 → 제목 asc (calendar `sortEvents()` 로직과 통일)
- [x] **공통**: 빈 상태 / 스켈레톤 로딩 / 에러 토스트 / 낙관적 락 충돌 토스트 (모든 페이지에 적용 완료)
- [x] **버그픽스**: `x-actor-name` 헤더에 한국어 이름 전송 시 `TypeError: String contains non ISO-8859-1 code point` 오류 수정
  - 클라이언트(`lib/client/api.ts`): `encodeURIComponent(actorName)` 적용
  - 서버(`lib/actor.ts`): `decodeURIComponent(rawName)` 적용

### Phase 5 — 폴리싱 ✅ 완료

- [x] **설정 페이지** (`/settings`) — 서비스명 / 멤버 / 코드관리(분류+시스템코드) / 백업 4탭
- [x] **서비스명 동적화** — `Setting` 모델 DB 저장, 사이드바 실시간 반영
- [x] **DB 백업** — `GET /api/backup` SQLite 파일 직접 다운로드
- [x] **WorkSystem CRUD** — 티켓 시스템 코드 마스터
- [x] **WorkCategory CRUD** — 작업 분류 동적화. `CATEGORIES` enum 완전 제거.
- [x] **Status 8종 개편** — 대기/진행중/내부테스트/현업테스트/QA테스트/이관대기/이관완료/홀딩
- [x] **MemberRole 정비** — WEB_DEV/APP_DEV/UI_DEV/PLANNING/DESIGN/ETC
- [x] **멤버 탭 통합** — `/members` → `/settings` 리다이렉트
- [x] **DatePicker / DateTimePicker** — Radix Popover 기반 커스텀 날짜 선택기
- [x] **사이드바 개선** — 이름 변경 Dialog, 다크모드 resolvedTheme 수정, 액터 이름 즉시 반영
- [x] **캘린더 이관 건수 표시** — 월/주 보기 셀 최상단 `[이관] N건` emerald 칩
- [x] **칸반 개선** — PointerSensor(distance:8), 연속 드래그 CONFLICT 수정, 상태 필터 컬럼 연동
- [ ] 대시보드 전체 카운트용 dedicated count API
- [ ] CSV export (`/api/work-items/export.csv`)
- [ ] Audit log 보존 정책

### Phase 6 — Postgres 이관 대비 체크
- [ ] raw SQL 금지 규칙 (schema.prisma로만)
- [ ] JSON 필드는 "JSON 문자열" 컨벤션 유지
- [ ] DateTime 컬럼 통일 (Date 타입 미사용)
- [ ] 이관 런북 작성: `DATABASE_URL` 교체 → `prisma migrate` → seed

---

## 3. 구현 순서 권고
1. **Phase 0 → 1 → 2** 를 한 번에 완주 (스키마·인프라가 흔들리면 뒤에서 재작업 발생).
2. **Phase 3** 는 `work-items` 부터 (가장 복잡한 audit/락 경로를 먼저 뚫어 템플릿화).
3. **Phase 4** UI는 목록 → 드로어 → Gantt → 캘린더 순서 (가치 큰 것부터).
4. Phase 5/6은 1차 릴리즈 후.

## 4. 완료 기준 (1차)
- 모든 write가 감사 로그와 한 트랜잭션에 묶임 (테스트로 검증)
- 동시 편집 시 409 반환되고 UI에서 재시도 가능
- Soft delete된 레코드는 목록에서 제외, 감사 로그로 복구 경로 존재
- 타임존 유틸 1곳에서만 관리, all-day 이벤트가 KST/UTC 경계에서 하루씩 밀리지 않음
- Unassigned 포함 Gantt 동작
- WorkItem/Ticket/Event/Member CRUD 전 엔드포인트 zod 검증 통과

---

## 5. 확정된 결정사항
1. **Node 버전**: **Node 16 고정** (사내 제약). `engines` 명시 + 의존성 버전을 16 호환으로 핀 고정.
2. **category**: **동적 관리**. `WorkCategory` 모델 + `/api/work-categories` CRUD. 설정 > 코드관리 탭에서 등록.
3. **TeamMember 멀티롤**: **1차는 단일 role**. 멀티롤은 추후 조인 테이블로 확장.
4. **CSV export**: **후속 작업** (Phase 6 또는 선택).
5. **감사 로그 보존 정책**: **추후 결정** (1차는 무제한 + diff 저장).

## 6. 1차 범위 재조정
- 대시보드(상태별 카운트, 오늘 이관 예정)는 이전 논의대로 **1차 포함** 유지 — 필요 없으면 알려주세요.
- CSV export, 감사 로그 archive 정책은 Phase 5(폴리싱)로 이동.

## 7. 남은 TBD
- 없음 (1차 범위 확정 완료)
