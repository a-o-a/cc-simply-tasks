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
| UI (예정) | Tailwind + shadcn/ui | Phase 4 |

## 디렉터리 구조 (현재)

```
.
├── app/                # Next.js app router
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── lib/
│   └── db.ts           # Prisma 싱글톤
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── .nvmrc              # node 16
├── .env.example
├── package.json
├── tsconfig.json
├── next.config.js
├── PLAN.md             # 전체 실행 계획
└── README.md
```

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

## Phase 진행 상황

> 전체 계획은 [`PLAN.md`](./PLAN.md) 참고.

| Phase | 내용 | 상태 |
|---|---|---|
| **0** | 프로젝트 부트스트랩 (Next.js + Prisma + SQLite + TS) | ✅ 완료 |
| **1** | Prisma 스키마 확정 (도메인 모델 + enum + 인덱스) | ✅ 완료 |
| **2** | 공통 인프라 (time, actor, audit, validation, http, pagination, optimistic lock, SQLite PRAGMA) | ✅ 완료 |
| **3** | API 라우트 (team-members, work-items, work-tickets, calendar-events, audit-logs) | ⏳ 대기 |
| **4** | UI (디자인 토큰 + shadcn/ui + 테이블/드로어/Gantt/캘린더) | ⏳ 대기 |
| **5** | 폴리싱 (대시보드, CSV export 등 선택) | ⏳ 대기 |
| **6** | Postgres 이관 준비 런북 | ⏳ 대기 |

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
