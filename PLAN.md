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

### Phase 0 — 프로젝트 부트스트랩
- [ ] Next.js 13.5 (app router) + TypeScript + Prisma + SQLite 초기화
- [ ] `engines: { node: ">=18.18" }` 고정 (사내 제약 시 16 유지 + 명시)
- [ ] `prisma/schema.prisma` 초기 파일, `DATABASE_URL` 환경변수 기반
- [ ] `prisma/dev.db` gitignore, `.env.example` 작성
- [ ] `lib/db.ts` Prisma 클라이언트 싱글톤
- [ ] SQLite PRAGMA: `busy_timeout=5000`, `journal_mode=WAL`

### Phase 1 — 스키마 확정 (보완 반영)
- [ ] **enum**: `Status { DRAFT, IN_PROGRESS, READY_TO_TRANSFER, TRANSFERRED, CANCELED }`
- [ ] **enum**: `Priority { LOW, NORMAL, HIGH }`
- [ ] **enum**: `ActorType { ANONYMOUS /* 추후 USER */ }`
- [ ] `TeamMember { id, name, role, deletedAt }`
- [ ] `WorkItem { id, title, description, category, status, priority, order, assigneeId?, startDate?, endDate?, transferDate?, createdAt, updatedAt, deletedAt }`
  - 인덱스: `[assigneeId, status]`, `[transferDate]`, `[startDate, endDate]`, `[deletedAt]`
- [ ] `WorkTicket { id, workItemId, systemName, ticketNumber, ticketUrl?, createdAt, deletedAt }`
  - `@@unique([workItemId, systemName, ticketNumber])`
- [ ] `CalendarEvent { id, title, memberId?, startDateTime, endDateTime, allDay, note?, createdAt, updatedAt, deletedAt }`
  - 인덱스: `[startDateTime, endDateTime]`, `[memberId]`
  - 규칙: `allDay=true`면 `[start, end)` 반열림 + 00:00 UTC 정규화
- [ ] `AuditLog { id, entityType, entityId, action, beforeJson?, afterJson?, actorType, actorName?, actorIp?, userAgent?, createdAt }`
  - 인덱스: `[entityType, entityId, createdAt]`
  - `beforeJson`/`afterJson`은 **변경 필드만** 담는 diff (String, JSON stringified)
- [ ] `id`는 전부 `cuid()`

### Phase 2 — 공통 인프라
- [ ] `lib/time.ts` — 타임존 유틸 (UTC ↔ Asia/Seoul, all-day 정규화)
- [ ] `lib/actor.ts` — `getActorContext(req)`: `x-forwarded-for` → IP, `x-actor-name` header → 이름, UA 추출
- [ ] `lib/audit.ts` — `withAudit(tx, { entityType, entityId, action, before, after, actor })` 헬퍼. **Prisma `$transaction` 내부에서만 호출되도록 타입 강제** (`Prisma.TransactionClient` 파라미터)
- [ ] `lib/diff.ts` — before/after 객체에서 변경 필드만 추출
- [ ] `lib/validation/` — zod 스키마 (workItem, workTicket, calendarEvent, teamMember)
- [ ] `lib/http.ts` — `{ error: { code, message } }` 표준 응답 헬퍼
- [ ] `lib/pagination.ts` — cursor 기반 (기본 50, 최대 200)
- [ ] `lib/optimisticLock.ts` — `If-Match: updatedAt` 검증, 불일치 시 409

### Phase 3 — API 라우트 (app/api)
모든 write는 `$transaction` + `withAudit` + `getActorContext` 필수.

- [ ] `team-members` — GET(list) / POST / PATCH / DELETE(soft)
- [ ] `work-items`
  - GET(list): `?status&assigneeId&ticket&cursor&pageSize`, `deletedAt IS NULL`
  - POST / PATCH (If-Match) / DELETE(soft)
  - GET(:id): 상세 + tickets include
- [ ] `work-items/:id/tickets` — POST / PATCH / DELETE
- [ ] `calendar-events` — GET(range) / POST / PATCH(:id) / DELETE(:id)
- [ ] `audit-logs` — GET `?entityType&entityId&cursor` (읽기 전용)

### Phase 4 — UI (MVP)
- [ ] 액터 이름 강제 모달 (localStorage 미설정 시 차단) + fetch interceptor가 `x-actor-name` 자동 주입
- [ ] 레이아웃 + 네비게이션 (홈 / 작업 / 캘린더 / 멤버)
- [ ] 작업 목록 (필터: 상태/담당자/티켓번호 검색, 페이지네이션)
- [ ] 작업 드로어: 기본 정보 / 티켓 / **활동(감사 로그) 탭**
- [ ] Gantt 뷰: 담당자 그룹 + **Unassigned 그룹** 포함
- [ ] 캘린더 뷰 (월/주), all-day 구간 규칙 반영
- [ ] 멤버 관리 페이지
- [ ] 공통: 빈 상태 / 로딩 스켈레톤 / 에러 토스트 / 낙관적 락 충돌 토스트

### Phase 5 — 폴리싱 (2차, 선택)
- [ ] 대시보드 (상태별 카운트, 오늘 이관 예정)
- [ ] CSV export (`/api/work-items/export.csv`)
- [ ] WorkItem priority별 색상/정렬
- [ ] Audit log 보존 정책 (예: 1년 이후 archive)

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
1. **Node 버전**: **Node 16 고정** (사내 제약). `engines` 명시 + 의존성 버전을 16 호환으로 핀 고정. Next.js 13.5 / Prisma 버전 선정 시 Node 16.14+ 호환 여부 체크.
2. **category**: **enum 관리**. 1차 값: `FEATURE / BUGFIX / IMPROVEMENT / REFACTOR / OPS / ETC` (개발팀 중심, 추후 개선 예정).
3. **TeamMember 멀티롤**: **1차는 단일 role**. 멀티롤은 추후 조인 테이블로 확장.
4. **CSV export**: **2차로 분리** (1차 제외).
5. **감사 로그 보존 정책**: **추후 결정** (1차는 무제한 + diff 저장으로 진행).

## 6. 1차 범위 재조정
- 대시보드(상태별 카운트, 오늘 이관 예정)는 이전 논의대로 **1차 포함** 유지 — 필요 없으면 알려주세요.
- CSV export, 감사 로그 archive 정책은 Phase 5(폴리싱)로 이동.

## 7. 남은 TBD
- 없음 (1차 범위 확정 완료)
