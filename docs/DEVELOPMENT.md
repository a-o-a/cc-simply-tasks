# Development Guide

이 문서는 API 라우트와 비즈니스 로직을 작성할 때 **모든 개발자(사람 + 에이전트)가 반드시 따르는 컨벤션**을 정리합니다. Phase 3 API 구현 전에 반드시 숙지.

- 레퍼런스 구현: [`app/api/work-items/`](../app/api/work-items/) — 이 문서의 규칙이 실제로 어떻게 쓰이는지 확인용
- 스택/전체 계획: [`README.md`](../README.md), [`PLAN.md`](../PLAN.md)

---

## 1. 핵심 원칙 (절대 어기지 말 것)

1. **모든 write는 `prisma.$transaction` 안에서 `withAudit`과 함께 실행한다.**
   - `withAudit`은 `Prisma.TransactionClient` 타입만 받으므로 트랜잭션 밖 호출은 컴파일 에러가 된다. 이 타입 강제를 우회하지 말 것.
2. **raw SQL 금지.** Postgres 이관 대비. 예외는 SQLite PRAGMA(`lib/db.ts`의 `ensureSqlitePragma`)뿐.
3. **Soft delete만 사용.** 실제 `delete` 대신 `deletedAt: new Date()` 업데이트. 목록 쿼리는 전부 `where: { deletedAt: null }`.
4. **모든 외부 입력은 zod로 검증.** 라우트 핸들러의 첫 줄은 `schema.parse(body)` 또는 `schema.parse(Object.fromEntries(searchParams))`.
5. **PATCH/DELETE는 `If-Match` 헤더 필수.** `assertIfMatch(req, current.updatedAt)` 호출. 헤더 누락도 거부(`BAD_REQUEST`).
6. **에러 응답은 반드시 `withErrorHandler`로 감싸라.** 표준 포맷과 Prisma 에러 매핑을 자동 처리.
7. **시간은 DB에 UTC, UI에 KST.** 변환은 `lib/time.ts`에서만. 라우트 코드에서 직접 시간대 변환 금지.

---

## 2. 디렉터리 규칙

```
app/api/<resource>/route.ts          # collection: GET(list) / POST
app/api/<resource>/[id]/route.ts     # item: GET / PATCH / DELETE
```

- **예시**:
  - `app/api/work-items/route.ts` — list/create
  - `app/api/work-items/[id]/route.ts` — get/patch/delete

- 라우트 파일 안에 **비즈니스 로직을 직접 쓰지 말 것.** 복잡한 로직은 `lib/services/<resource>.ts`로 추출. 라우트는 "파싱 → 서비스 호출 → 응답"만.

---

## 3. 표준 라우트 스켈레톤

아래 템플릿을 **그대로 복사해서** 시작하면 규칙을 어길 일이 없다.

### 3.1 Collection route — `app/api/<resource>/route.ts`

```ts
import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { parsePagination, toPage } from "@/lib/pagination";
import {
  workItemCreateSchema,
  workItemListQuerySchema,
} from "@/lib/validation/workItem";

export const GET = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const { searchParams } = new URL(req.url);
  const filters = workItemListQuerySchema.parse(
    Object.fromEntries(searchParams),
  );
  const { take, cursor } = parsePagination(searchParams);

  const rows = await prisma.workItem.findMany({
    where: {
      deletedAt: null,
      ...(filters.status?.length ? { status: { in: filters.status } } : {}),
      ...(filters.assigneeId?.length ? { assigneeId: { in: filters.assigneeId } } : {}),
      ...(filters.category?.length ? { category: { in: filters.category } } : {}),
      ...(filters.priority?.length ? { priority: { in: filters.priority } } : {}),
      ...(filters.ticket
        ? {
            tickets: {
              some: {
                deletedAt: null,
                ticketNumber: { contains: filters.ticket },
              },
            },
          }
        : {}),
    },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ order: "asc" }, { createdAt: "desc" }, { id: "desc" }],
  });

  const { items, nextCursor } = toPage(rows, take);
  return NextResponse.json({ items, nextCursor });
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = workItemCreateSchema.parse(await req.json());

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.workItem.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        category: input.category,
        status: input.status,
        priority: input.priority,
        order: input.order,
        assigneeId: input.assigneeId ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        transferDate: input.transferDate ?? null,
        requestType: input.requestType ?? null,
        requestor: input.requestor ?? null,
        requestNumber: input.requestNumber ?? null,
        requestContent: input.requestContent ?? null,
      },
    });
    if (input.tickets?.length) {
      for (const t of input.tickets) {
        await tx.workTicket.create({
          data: {
            workItemId: row.id,
            systemName: t.systemName,
            ticketNumber: t.ticketNumber,
          },
        });
      }
    }
    await withAudit(tx, {
      entityType: "WorkItem",
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

### 3.2 Item route — `app/api/<resource>/[id]/route.ts`

```ts
import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { assertIfMatch } from "@/lib/optimisticLock";
import { workItemUpdateSchema } from "@/lib/validation/workItem";

type Params = { params: { id: string } };

export const GET = withErrorHandler(async (_req: NextRequest, { params }: Params) => {
  await ensureSqlitePragma();
  const row = await prisma.workItem.findFirst({
    where: { id: params.id, deletedAt: null },
    include: {
      tickets: { where: { deletedAt: null } },
      assignee: true,
    },
  });
  if (!row) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");
  return NextResponse.json(row);
});

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = workItemUpdateSchema.parse(await req.json());

  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.workItem.findFirst({
      where: { id: params.id, deletedAt: null },
    });
    if (!before) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");
    assertIfMatch(req, before.updatedAt);

    const after = await tx.workItem.update({
      where: { id: params.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.assigneeId !== undefined
          ? { assigneeId: input.assigneeId }
          : {}),
        ...(input.startDate !== undefined
          ? { startDate: input.startDate }
          : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
        ...(input.transferDate !== undefined
          ? { transferDate: input.transferDate }
          : {}),
        ...(input.requestType !== undefined
          ? { requestType: input.requestType }
          : {}),
        ...(input.requestor !== undefined
          ? { requestor: input.requestor }
          : {}),
        ...(input.requestNumber !== undefined
          ? { requestNumber: input.requestNumber }
          : {}),
        ...(input.requestContent !== undefined
          ? { requestContent: input.requestContent }
          : {}),
      },
    });
    if (input.tickets !== undefined) {
      await tx.workTicket.updateMany({
        where: { workItemId: params.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      for (const t of input.tickets) {
        await tx.workTicket.create({
          data: {
            workItemId: params.id,
            systemName: t.systemName,
            ticketNumber: t.ticketNumber,
          },
        });
      }
    }
    await withAudit(tx, {
      entityType: "WorkItem",
      entityId: after.id,
      action: "UPDATE",
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      actor,
    });
    return after;
  });

  return NextResponse.json(updated);
});

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);

  await prisma.$transaction(async (tx) => {
    const before = await tx.workItem.findFirst({
      where: { id: params.id, deletedAt: null },
    });
    if (!before) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");
    assertIfMatch(req, before.updatedAt);

    const after = await tx.workItem.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
    await withAudit(tx, {
      entityType: "WorkItem",
      entityId: after.id,
      action: "DELETE",
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      actor,
    });
  });

  return new NextResponse(null, { status: 204 });
});
```

> **패턴 요약**: `ensureSqlitePragma` → `getActorContext` → zod parse → `$transaction(async tx => { findFirst + assertIfMatch → update → withAudit })` → NextResponse.

### 3.3 WorkItem 확장 규칙

- `WorkItem` payload는 요청 정보 필드(`requestType`, `requestor`, `requestNumber`, `requestContent`)를 포함할 수 있다.
- 시스템 연동 번호는 별도 공개 서브 리소스 대신 `tickets` 배열로 함께 처리한다.
- `PATCH`에서 `tickets`가 전달되면 부분 수정이 아니라 **전체 대체**로 해석한다.
- `WorkTicket`은 `workItemId + systemName` 유니크다. 한 작업에 같은 시스템은 1개만 연결한다.
- `ticketUrl`은 더 이상 저장하지 않는다. 현재 저장값은 `systemName`, `ticketNumber`뿐이다.

---

## 4. 공통 규칙 상세

### 4.1 HTTP status / 에러

| 상황 | code | HTTP |
|---|---|---|
| zod 검증 실패 | `VALIDATION_ERROR` | 400 |
| 기타 잘못된 요청 (If-Match 누락 등) | `BAD_REQUEST` | 400 |
| 리소스 없음 | `NOT_FOUND` | 404 |
| 낙관적 락 충돌 / 유니크 위반 | `CONFLICT` | 409 |
| 서버 내부 오류 | `INTERNAL` | 500 |

- **직접 `NextResponse.json({ error: ... })` 쓰지 말 것.** `throw new HttpError("CONFLICT", "...")` 또는 `errorResponse(...)` 사용.
- Prisma `P2002`/`P2025`는 `withErrorHandler`가 자동 매핑하므로 catch 불필요.

### 4.2 성공 응답

| 동작 | status | body |
|---|---|---|
| list | 200 | `{ items, nextCursor }` |
| get | 200 | `row` |
| create | 201 | `row` |
| update | 200 | `row` |
| delete (soft) | 204 | (empty) |

- list 응답은 항상 `{ items, nextCursor }` 형태. 단일 배열 금지.

### 4.3 페이지네이션

- 쿼리 파라미터: `cursor`, `pageSize` (기본 50, 최대 200)
- `parsePagination(searchParams)` → `{ take, cursor }`
- `findMany` 호출 시 `take: take + 1` + cursor가 있으면 `skip: 1`
- `toPage(rows, take)` → `{ items, nextCursor }`
- **정렬 안정성 확보**: `orderBy`에 항상 tie-breaker(보통 `id` 또는 `createdAt`) 포함

### 4.4 낙관적 락 (`If-Match`)

- **모든 PATCH/DELETE 필수.** 헤더 누락도 `BAD_REQUEST`로 거부.
- 클라이언트는 직전 GET의 `updatedAt`(ISO)을 그대로 `If-Match`에 실어 보냄.
- PATCH 성공 뒤에는 응답 본문의 최신 `updatedAt`을 클라이언트 목록 상태에도 즉시 반영해야 함. 낙관적 업데이트만 하고 이전 `updatedAt`을 유지하면 다음 PATCH에서 자기 자신의 변경과 충돌할 수 있음.
- 서버는 `assertIfMatch(req, before.updatedAt)` 호출. 불일치 시 `CONFLICT` + `{ serverUpdatedAt }`.
- GET 응답 헤더에 `ETag: "<updatedAt ISO>"`는 1차에 필수 아님 (body의 `updatedAt`으로 충분).

### 4.4.1 SQLite 경로 / PRAGMA 메모

- SQLite `file:` 경로는 `schema.prisma` 기준 상대경로로 해석됨. 현재 로컬 개발 기본값은 `.env(.example)`의 `DATABASE_URL="file:./dev.db"`이며 실제 파일은 `prisma/dev.db`.
- SQLite PRAGMA 중 결과 row를 반환하는 항목(`journal_mode`, `busy_timeout`, `foreign_keys`)은 Prisma에서 `$queryRawUnsafe(...)`로 호출해야 dev 로그에 불필요한 에러가 남지 않음.

### 4.5 감사 로그

- `withAudit`의 `action`:
  - `CREATE` — `after`만 넘김
  - `UPDATE` — `before`, `after` 둘 다
  - `DELETE` — `before`, `after`(= deletedAt 찍힌 상태)
  - `RESTORE` — 1차 미사용 (UI에서 지원 시 추가)
- `entityId`는 쓰기 대상 레코드의 id. 서브 리소스(WorkTicket 등)는 자기 자신의 id.
- diff가 비면 UPDATE는 자동 스킵되지만, **그래도 `withAudit`을 호출해야 한다**. 패턴 깨지면 리뷰에서 반려.

### 4.6 Soft delete

- 필드: `deletedAt: DateTime?` (모든 도메인 모델 공통)
- 목록 쿼리: `where: { deletedAt: null, ... }`
- 상세 쿼리: `findFirst({ where: { id, deletedAt: null } })` — `findUnique` 쓰지 말 것 (deletedAt 조건을 `where`에 못 넣음)
- 삭제: `update({ data: { deletedAt: new Date() } })`
- 복구: `update({ data: { deletedAt: null } })` + `withAudit(action: "RESTORE")`

### 4.7 시간 처리

- **저장은 항상 UTC `Date` 객체.** DB 컬럼은 `DateTime`.
- **UI 표시는 KST.** 변환은 `lib/time.ts`에서만.
- all-day 이벤트:
  - 클라이언트는 `{ startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }` KST 날짜 문자열로 전송
  - 서버에서 `normalizeAllDayRange(startDate, endDate)` → `{ startDateTime, endDateTime }` UTC Date
  - 구간은 반열림 `[start, end)`
- 날짜 문자열 파싱/포맷을 라우트에 직접 쓰지 말 것.

### 4.8 액터 컨텍스트

- **모든 write 핸들러의 첫 줄에 `const actor = getActorContext(req)`.**
- 헤더 소스: `x-forwarded-for`(IP 첫 값) / `x-actor-name` / `user-agent`
- `actorName`이 null이어도 write는 허용 (1차). 대신 프론트에서 localStorage 강제 입력 모달로 null이 거의 없게 만든다.

---

## 5. 서비스 레이어 (선택)

- 단순 CRUD는 라우트에 바로 써도 됨.
- **분기/집계/여러 테이블을 엮는 로직은 `lib/services/<resource>.ts`로 분리.**
- 서비스 함수 시그니처는 `(tx: Prisma.TransactionClient, input, actor) => Promise<T>` — 트랜잭션을 밖에서 주입받도록.

---

## 6. 테스트 / 수동 검증

1차 범위에서는 자동화 테스트보다 **curl 시나리오 체크리스트**로 검증.

```bash
# list (빈 상태)
curl -s localhost:3000/api/work-items | jq

# create
curl -sX POST localhost:3000/api/work-items \
  -H 'content-type: application/json' \
  -H 'x-actor-name: alice' \
  -d '{"title":"첫 작업","category":"FEATURE"}' | jq

# get
curl -s localhost:3000/api/work-items/<id> | jq

# patch (If-Match 필수)
curl -sX PATCH localhost:3000/api/work-items/<id> \
  -H 'content-type: application/json' \
  -H 'x-actor-name: alice' \
  -H 'if-match: <updatedAt ISO>' \
  -d '{"status":"IN_PROGRESS"}' | jq

# delete (soft)
curl -sX DELETE localhost:3000/api/work-items/<id> \
  -H 'x-actor-name: alice' \
  -H 'if-match: <updatedAt ISO>' -i
```

각 API PR 설명에 위 체크리스트 결과를 붙인다.

---

## 7. 리뷰 체크리스트 (PR 머지 전)

- [ ] write가 전부 `$transaction` + `withAudit`으로 묶여 있다
- [ ] PATCH/DELETE가 `assertIfMatch`를 호출한다
- [ ] 모든 입력이 zod로 검증된다
- [ ] `where`에 `deletedAt: null` 필터가 빠진 곳이 없다
- [ ] raw SQL 없음 (PRAGMA 제외)
- [ ] 에러를 `throw new HttpError(...)` 또는 `withErrorHandler`로 처리 (직접 NextResponse 에러 금지)
- [ ] 시간 변환이 `lib/time.ts` 밖에 있지 않다
- [ ] 응답 포맷이 §4.2와 일치한다
- [ ] README.md / PLAN.md 해당 Phase 항목 업데이트

---

## 8. 하지 말 것 (안티 패턴)

```ts
// ❌ 트랜잭션 밖에서 감사 로그
await prisma.workItem.update(...);
await prisma.auditLog.create(...); // 정합성 깨질 수 있음

// ❌ withAudit 우회
await prisma.$transaction(async (tx) => {
  await tx.workItem.update(...);
  // 감사 로그 없음
});

// ❌ deletedAt 필터 누락
await prisma.workItem.findUnique({ where: { id } }); // 삭제된 것도 반환됨

// ❌ If-Match 없이 PATCH
export const PATCH = async (req) => {
  await prisma.workItem.update(...); // 덮어쓰기 경합 위험
};

// ❌ 시간 직접 변환
const kst = new Date(utc.getTime() + 9 * 60 * 60 * 1000); // lib/time.ts 사용

// ❌ raw SQL
await prisma.$queryRawUnsafe("UPDATE ..."); // Postgres 이관 깨짐
```
