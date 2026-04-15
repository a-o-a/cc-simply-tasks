# Development Guide

이 문서는 현재 코드베이스의 서버/API 구현 규칙을 정리합니다. 기준 스택은 `Next.js + Drizzle ORM + SQLite`입니다.

- 레퍼런스 구현: [`app/api/work-items/`](../app/api/work-items/)
- DB 진입점: [`lib/db.ts`](../lib/db.ts)
- 스키마: [`lib/db/schema.ts`](../lib/db/schema.ts)
- 조회/관계 하이드레이션 헬퍼: [`lib/db/queries.ts`](../lib/db/queries.ts)
- 감사 로그: [`lib/audit.ts`](../lib/audit.ts)

## 1. 핵심 원칙

1. 모든 write는 `db.transaction((tx) => { ... })` 안에서 실행한다.
2. write와 감사 로그는 같은 트랜잭션 안에서 `withAudit(tx, ...)`로 묶는다.
3. Soft delete만 사용한다. 실제 삭제 대신 `deletedAt`을 업데이트한다.
4. 모든 외부 입력은 zod로 검증한다.
5. 에러 응답은 `withErrorHandler`로 통일한다.
6. 시간은 DB에 UTC `Date`, UI 표시는 KST로 처리한다.
7. SQLite 경로 기본값은 `.env`의 `DATABASE_URL="file:./db/dev.db"`다.

## 2. 디렉터리 규칙

```text
app/api/<resource>/route.ts
app/api/<resource>/[id]/route.ts
```

- collection route: `GET(list)`, `POST(create)`
- item route: `GET(detail)`, `PATCH(update)`, `DELETE(soft delete)`

복잡한 관계 조회는 라우트에서 직접 전부 풀지 말고 `lib/db/queries.ts` 같은 공통 헬퍼로 뺀다.

## 3. DB 레이어 규칙

### 3.1 연결

- 공용 DB 객체는 [`lib/db.ts`](../lib/db.ts) 의 `db`를 사용한다.
- SQLite PRAGMA는 DB 초기화 시 한 번 적용된다.
- API 코드에서는 관성적으로 `await ensureSqlitePragma()`를 호출해도 되지만, 현재는 no-op이다.

### 3.2 스키마

- 테이블 정의는 [`lib/db/schema.ts`](../lib/db/schema.ts)만 소스 오브 트루스로 본다.
- 새 컬럼/테이블 추가 시 이 파일을 먼저 수정한다.
- enum 비슷한 값은 SQLite native enum이 없으므로 문자열 컬럼 + [`lib/enums.ts`](../lib/enums.ts) + zod 조합으로 관리한다.

### 3.3 쓰기 쿼리

`better-sqlite3` 기반 Drizzle에서는 write 빌더를 만든 뒤 반드시 실행해야 한다.

```ts
tx.insert(teamMembers).values(row).run();
tx.update(workItems).set(after).where(eq(workItems.id, id)).run();
tx.delete(calendarEventMembers).where(eq(calendarEventMembers.eventId, id)).run();
```

`.run()`이 빠지면 실제 DB 반영이 되지 않는다.

## 4. 표준 라우트 패턴

### 4.1 Collection route

```ts
import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { newId, now } from "@/lib/db/helpers";
import { teamMembers } from "@/lib/db/schema";
import { withErrorHandler } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { parsePagination, slicePageAfterCursor } from "@/lib/pagination";
import {
  teamMemberCreateSchema,
  teamMemberListQuerySchema,
} from "@/lib/validation/teamMember";

export const GET = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const { searchParams } = new URL(req.url);
  const filters = teamMemberListQuerySchema.parse(
    Object.fromEntries(searchParams),
  );
  const { take, cursor } = parsePagination(searchParams);

  const rows = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        isNull(teamMembers.deletedAt),
        filters.role ? eq(teamMembers.role, filters.role) : undefined,
      ),
    )
    .orderBy(asc(teamMembers.name), asc(teamMembers.id));

  const { items, nextCursor } = slicePageAfterCursor(rows, cursor, take);
  return NextResponse.json({ items, nextCursor });
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = teamMemberCreateSchema.parse(await req.json());
  const createdAt = now();

  const created = db.transaction((tx) => {
    const row = {
      id: newId(),
      name: input.name,
      role: input.role,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    } satisfies typeof teamMembers.$inferInsert;

    tx.insert(teamMembers).values(row).run();
    withAudit(tx, {
      entityType: "TeamMember",
      entityId: row.id,
      action: "CREATE",
      after: row as unknown as Record<string, unknown>,
      actor,
    });
    return row;
  });

  return NextResponse.json(created, { status: 201 });
});
```

### 4.2 Item route

```ts
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { now } from "@/lib/db/helpers";
import { teamMembers } from "@/lib/db/schema";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { teamMemberUpdateSchema } from "@/lib/validation/teamMember";

type Params = { params: { id: string } };

export const GET = withErrorHandler(
  async (_req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const row = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.id, params.id), isNull(teamMembers.deletedAt)))
      .limit(1);

    if (!row[0]) throw new HttpError("NOT_FOUND", "팀원을 찾을 수 없습니다");
    return NextResponse.json(row[0]);
  },
);

export const PATCH = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = teamMemberUpdateSchema.parse(await req.json());
    const updatedAt = now();

    const updated = db.transaction((tx) => {
      const before = tx
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.id, params.id), isNull(teamMembers.deletedAt)))
        .limit(1)
        .get();
      if (!before) throw new HttpError("NOT_FOUND", "팀원을 찾을 수 없습니다");

      const after = {
        ...before,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        updatedAt,
      };

      tx.update(teamMembers).set(after).where(eq(teamMembers.id, params.id)).run();
      withAudit(tx, {
        entityType: "TeamMember",
        entityId: after.id,
        action: "UPDATE",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        actor,
      });
      return after;
    });

    return NextResponse.json(updated);
  },
);
```

패턴 요약:

- `ensureSqlitePragma`
- 입력 파싱
- write면 `getActorContext`
- `db.transaction`
- `before` 조회
- `insert/update/delete ... .run()`
- `withAudit`
- `NextResponse.json(...)`

## 5. 공통 규칙 상세

### 5.1 에러 처리

| 상황 | code | HTTP |
|---|---|---|
| zod 검증 실패 | `VALIDATION_ERROR` | 400 |
| 잘못된 요청 | `BAD_REQUEST` | 400 |
| 리소스 없음 | `NOT_FOUND` | 404 |
| 유니크 충돌 / 중복 | `CONFLICT` | 409 |
| 서버 내부 오류 | `INTERNAL` | 500 |

- 직접 에러 JSON을 만들기보다 `throw new HttpError(...)`를 사용한다.
- 라우트는 반드시 `withErrorHandler`로 감싼다.
- SQLite unique 에러는 `withErrorHandler`가 `CONFLICT`로 매핑한다.

### 5.2 성공 응답

| 동작 | status | body |
|---|---|---|
| list | 200 | `{ items, nextCursor }` 또는 `{ items }` |
| get | 200 | `row` |
| create | 201 | `row` |
| update | 200 | `row` |
| delete | 204 | empty |

페이지네이션이 없는 목록 API는 `{ items }`를 사용한다.

### 5.3 페이지네이션

- `parsePagination(searchParams)` → `{ take, cursor }`
- Drizzle에서는 cursor-skip을 DB에 직접 밀지 않고, 현재 코드베이스처럼 정렬된 결과를 `slicePageAfterCursor()`로 잘라낸다.
- 항상 안정 정렬을 유지한다.

### 5.4 Soft delete

- 삭제는 `deletedAt: now()` 업데이트다.
- 목록/상세 조회는 기본적으로 `isNull(table.deletedAt)`를 넣는다.
- soft delete된 레코드는 상세 조회에서 `404`로 본다.

### 5.5 감사 로그

- `CREATE`: `after`
- `UPDATE`: `before`, `after`
- `DELETE`: `before`, `after`
- 변경 diff가 비면 `UPDATE` 로그는 자동 스킵된다.
- 그래도 write 패턴에서는 `withAudit` 호출 자체를 유지한다.

### 5.6 시간 처리

- DB에는 `Date` 객체를 그대로 넣는다.
- all-day 여부와 KST/UTC 변환은 [`lib/time.ts`](../lib/time.ts)와 validation 레이어 기준으로 처리한다.
- 라우트에서 임의 시간대 계산을 반복하지 않는다.

### 5.7 액터 컨텍스트

- 모든 write API는 `getActorContext(req)`를 호출한다.
- `x-actor-name`, `x-forwarded-for`, `user-agent`를 사용한다.
- 인증이 없으므로 현재 `actorType`은 `ANONYMOUS`다.

## 6. 관계 조회 규칙

Prisma의 `include`처럼 한 번에 끝내기보다, 현재 코드는 명시적으로 하이드레이션한다.

예:

- WorkItem + assignee + tickets: [`hydrateWorkItems`](../lib/db/queries.ts)
- CalendarEvent + members: [`hydrateCalendarEvents`](../lib/db/queries.ts)

관계 응답 shape가 여러 라우트에서 반복되면 공통 헬퍼로 뺀다.

## 7. WorkItem 특화 규칙

- `tickets`는 공개 서브 리소스 API가 아니라 `WorkItem` payload 안에서 함께 처리한다.
- `PATCH`에서 `tickets`가 오면 부분 병합이 아니라 전체 대체다.
- 목록은 `scope=active|transferred|all`을 지원한다.
- `scope=transferred`는 `transferDate desc` 정렬을 우선한다.
- ticket/systemCode 필터는 `exists(...)` 서브쿼리로 구현한다.

## 8. 마이그레이션 / DB 파일

- 개발 기본 DB: `db/dev.db`
- 운영에서는 `DATABASE_URL`을 영속 경로로 바꿔 사용한다.
- 스키마 수정 후:

```bash
npm run db:generate
npm run db:migrate
```

- 백업/복구는 `DATABASE_URL`이 가리키는 실제 파일 기준으로 처리한다.

## 9. 수동 검증 체크리스트

```bash
# settings
curl -s localhost:3000/api/settings

# team member create
curl -sX POST localhost:3000/api/team-members \
  -H 'content-type: application/json' \
  -H 'x-actor-name: alice' \
  -d '{"name":"Alice","role":"WEB_DEV"}'

# work item list
curl -s 'localhost:3000/api/work-items?pageSize=20'

# work item detail
curl -s localhost:3000/api/work-items/<id>

# work item patch
curl -sX PATCH localhost:3000/api/work-items/<id> \
  -H 'content-type: application/json' \
  -H 'x-actor-name: alice' \
  -d '{"status":"IN_PROGRESS"}'

# calendar range
curl -s 'localhost:3000/api/calendar-events?from=2026-04-19T00:00:00Z&to=2026-04-21T00:00:00Z'

# audit
curl -s 'localhost:3000/api/audit-logs?pageSize=10'
```

## 10. 리뷰 체크리스트

- [ ] write가 모두 `db.transaction(...)` 안에 있다
- [ ] write 쿼리에 `.run()`이 빠진 곳이 없다
- [ ] `withAudit(tx, ...)`가 write와 같은 트랜잭션에 있다
- [ ] 입력은 zod로 검증한다
- [ ] soft delete 필터가 필요한 곳에 `isNull(deletedAt)`가 있다
- [ ] 에러 처리는 `withErrorHandler` / `HttpError`를 따른다
- [ ] 관계 응답 shape가 기존 클라이언트 기대와 일치한다
- [ ] README / 관련 문서도 함께 갱신했다

## 11. 안티 패턴

```ts
// ❌ transaction 밖 write + audit 분리
db.insert(workItems).values(row).run();
withAudit(tx, ...);

// ❌ write builder만 만들고 실행 안 함
tx.insert(teamMembers).values(row);

// ❌ soft delete 필터 누락
db.select().from(workItems);

// ❌ 라우트마다 관계 조립 로직 복붙
const tickets = await db.select().from(workTickets) ...
const assignees = await db.select().from(teamMembers) ...
```
