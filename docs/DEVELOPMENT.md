# Development Guide

이 문서는 현재 코드베이스의 서버/API 구현 규칙을 정리합니다. 기준 스택은 `Node 22 + Next.js 16 + React 19 + Drizzle ORM + @libsql/client + SQLite(file)`입니다. 정확한 버전은 [`package.json`](../package.json)과 lockfile을 기준으로 합니다.

- 레퍼런스 구현: [`app/api/work-items/`](../app/api/work-items/)
- DB 진입점: [`lib/db.ts`](../lib/db.ts)
- 스키마: [`lib/db/schema.ts`](../lib/db/schema.ts)
- 조회/관계 하이드레이션 헬퍼: [`lib/db/queries.ts`](../lib/db/queries.ts)
- 감사 로그: [`lib/audit.ts`](../lib/audit.ts)

## 실행 환경과 도구

- `.nvmrc`의 Node 22를 설치하고 `nvm use` 후 `npm ci`로 의존성을 설치합니다. 개발·빌드·migration·운영에 같은 Node 22 환경을 사용합니다.
- TypeScript 6.0.3 및 ESLint 9.39.5는 현재 typescript-eslint와 Next 플러그인 호환 범위에 맞춘 선택입니다. 최신 메이저를 독립적으로 올리지 않습니다.
- lint는 `eslint.config.mjs` flat config와 ESLint CLI를 사용합니다. `next lint`는 사용하지 않습니다.
- React Compiler는 사용하지 않으며 `react-hooks/set-state-in-effect`만 비활성화합니다. `rules-of-hooks`, `exhaustive-deps`와 나머지 린트 규칙은 유지합니다.
- Tailwind 4 토큰과 다크모드 정의는 `app/globals.css`의 `@theme inline`/CSS에 둡니다. PostCSS는 `@tailwindcss/postcss`, 애니메이션은 `tw-animate-css`를 사용하며 `tailwind.config.ts`는 만들지 않습니다.
- 브라우저 최소 기준은 Safari 16.4+, Chrome 111+, Firefox 128+입니다. [Tailwind 4 업그레이드](https://tailwindcss.com/docs/upgrade-guide)

## 1. 핵심 원칙

1. 모든 write는 `await db.transaction(async (tx) => { ... })` 안에서 실행한다.
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
- DB 연결은 `DATABASE_URL=file:...` 값을 `file://` URL로 변환해 `@libsql/client/node`에 전달한다. 표준 import를 사용하고 `@libsql/client`/`libsql`은 Next의 `serverExternalPackages`로 외부화한다. 연결 자체는 첫 DB 접근 때 생성한다.
- API 코드에서는 DB 접근 전 `await ensureSqlitePragma()`를 호출한다. 최초 호출 시 SQLite PRAGMA(`busy_timeout`, `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`)를 한 번 적용한다.
- libsql의 추가 풀 연결에도 잠금 대기 시간이 적용되도록 `createClient`에 `timeout: 5000`을 지정한다. `synchronous=NORMAL`은 최초 연결에 적용되며 새 풀 연결은 드라이버 기본값을 사용한다. 런타임 DB·백업을 배포 파일 추적에 포함하지 않는다.

### 3.2 스키마

- 테이블 정의는 [`lib/db/schema.ts`](../lib/db/schema.ts)만 소스 오브 트루스로 본다.
- 새 컬럼/테이블 추가 시 이 파일을 먼저 수정한다.
- enum 비슷한 값은 SQLite native enum이 없으므로 문자열 컬럼 + [`lib/enums.ts`](../lib/enums.ts) + zod 조합으로 관리한다.

### 3.3 쓰기 쿼리

`libsql` 기반 Drizzle에서는 모든 write를 `await`로 실행한다.

```ts
await tx.insert(teamMembers).values(row);
await tx.update(workItems).set(after).where(eq(workItems.id, id));
await tx.delete(calendarEventMembers).where(eq(calendarEventMembers.eventId, id));
```

`await`를 빼먹으면 의도한 순서대로 반영되지 않거나 감사 로그와 분리될 수 있다.

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

  const created = await db.transaction(async (tx) => {
    const row = {
      id: newId(),
      name: input.name,
      role: input.role,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    } satisfies typeof teamMembers.$inferInsert;

    await tx.insert(teamMembers).values(row);
    await withAudit(tx, {
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

Next 16의 동적 `params`는 Promise입니다. 핸들러에서 먼저 `await`한 뒤 사용합니다. `cookies()`/`headers()`를 새로 사용할 때도 비동기 API 규칙을 따릅니다. `new URL(req.url).searchParams`는 별도의 동기 URL API입니다. [Next 16 마이그레이션](https://nextjs.org/docs/app/guides/upgrading/version-16)

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

type Params = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(
  async (_req: NextRequest, { params }: Params) => {
    const { id } = await params;
    await ensureSqlitePragma();
    const row = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.id, id), isNull(teamMembers.deletedAt)))
      .limit(1);

    if (!row[0]) throw new HttpError("NOT_FOUND", "팀원을 찾을 수 없습니다");
    return NextResponse.json(row[0]);
  },
);

export const PATCH = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    const { id } = await params;
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = teamMemberUpdateSchema.parse(await req.json());
    const updatedAt = now();

    const updated = await db.transaction(async (tx) => {
      const beforeRows = await tx
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.id, id), isNull(teamMembers.deletedAt)))
        .limit(1);
      const before = beforeRows[0];
      if (!before) throw new HttpError("NOT_FOUND", "팀원을 찾을 수 없습니다");

      const after = {
        ...before,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        updatedAt,
      };

      await tx.update(teamMembers).set(after).where(eq(teamMembers.id, id));
      await withAudit(tx, {
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
- `await insert/update/delete`
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
- SQLite unique 에러는 `withErrorHandler`가 Drizzle 오류의 `cause` 체인까지 확인해 `CONFLICT`로 매핑한다.
- Zod 4는 `flattenError(err)`로 `details.formErrors`/`details.fieldErrors` 응답 구조를 유지한다. 신규 스키마는 `z.iso.datetime`, `z.url`과 `error` 옵션을 사용한다. [Zod 4 변경점](https://zod.dev/v4/changelog)
- `If-Match` 헤더는 검사하지 않는다. TODO PATCH만 선택적 `expectedUpdatedAt`을 트랜잭션에서 비교하며 불일치는 409다. 공식 TODO 드로어는 항상 버전을 전달한다. 다른 API와 버전 생략 호출은 동시 편집 보호 대상이 아니다.

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
- 작업/TODO/감사 로그의 커서 없는 첫 페이지는 SQL `LIMIT take + 1`로 조회한 뒤 `toPage()`로 응답한다.
- 기존 ID 커서가 있는 후속 페이지는 정렬 결과를 `slicePageAfterCursor()`로 자른다. 이 경로는 전체 조회 비용이 남아 있다. 커서가 삭제되거나 필터에 없으면 400이며 클라이언트는 처음부터 재조회한다.
- 기본 50, 최대 10,000행이다. 전건이 필요한 담당자 선택·월 집계는 `api.getAll<T>()`로 200행씩 마지막 페이지까지 순회한다.
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

### 5.8 카운트 API와 클라이언트 변경 이벤트

- DB 상태를 그대로 보여줘야 하는 카운트/통계 GET 라우트는 Next Route Handler 캐시가 끼지 않게 명시한다.
- 예: [`GET /api/work-items/count`](../app/api/work-items/count/route.ts)는 `dynamic = "force-dynamic"`, `revalidate = 0`, `Cache-Control: no-store`를 함께 둔다.
- Next 16의 GET Route Handler는 기본적으로 캐시하지 않는다. 통계·백업처럼 항상 최신 상태가 필요한 라우트는 이 의도를 `dynamic`/`revalidate`와 응답 헤더로 명시하고, 클라이언트 fetch wrapper도 `cache: "no-store"`를 사용한다.
- 작업 생성/수정/삭제/상태 변경처럼 다른 화면의 통계에 영향을 주는 write 성공 후에는 [`emitWorkItemsChanged()`](../lib/client/api.ts)를 호출한다.
- 대시보드처럼 같은 탭에서 오래 열려 있을 수 있는 화면은 `WORK_ITEMS_CHANGED_EVENT`, `focus`, `visibilitychange`에서 필요한 데이터를 다시 조회한다.
- TODO 뱃지는 같은 패턴으로 `emitTodosChanged()` / `TODOS_CHANGED_EVENT`를 사용한다.

## 6. 관계 조회 규칙

관계 응답은 한 번에 암묵적으로 끌어오지 않고, 현재 코드처럼 명시적으로 하이드레이션한다.

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

## 8. 마이그레이션 / DB 파일 / 백업

- 개발 기본 DB는 `db/dev.db`, 초기 빈 템플릿은 `db/dev.db.clean`이다. 템플릿은 대상 파일이 없을 때만 `fs.copyFileSync(..., fs.constants.COPYFILE_EXCL)`로 복사한다.
- 운영 `DATABASE_URL`은 배포 산출물 밖의 영속 디렉터리를 가리킨다. WAL/SHM와 백업을 위해 디렉터리 쓰기 권한도 필요하다.
- `drizzle.config.ts`는 쉘 환경변수 `DATABASE_URL`을 읽는다. `.env.production`의 자동 로딩을 가정하지 않는다.
- 개발자가 스키마를 변경할 때만 다음 명령으로 SQL을 생성하고 검토 후 적용한다. 실행 중인 쓰기 작업은 먼저 중지한다.

```bash
nvm use
npm run db:generate
npm run db:migrate
```

배포에서는 `npm ci` 후 **커밋된 migration을 `npm run db:migrate`로 적용**한다. 배포 중 `db:generate`를 실행하지 않는다. migration이 추가되면 별도 새 DB에서 `db/dev.db.clean`을 다시 만들고 SQL·메타데이터와 함께 커밋한다.

백업 생성은 `lib/backup.ts`의 `createSqliteSnapshot`이 `VACUUM INTO`로 처리한다. `/api/backup` 다운로드는 임시 스냅샷을 만들고 항상 정리하며, 저장 백업과 cron은 `runBackup`을 공유한다. 실행 중인 DB 본파일만 복사하면 WAL의 최신 커밋이 누락될 수 있다. [SQLite VACUUM INTO](https://www.sqlite.org/lang_vacuum.html)

`instrumentation.ts`는 `NEXT_RUNTIME === "nodejs"` 분기 내부에서 모듈을 동적으로 import한다. cron은 프로세스 내 중복 등록과 실행 겹침을 방지하며, `BACKUP_CRON` 기본값은 서버 현지 시간 02:00이다. 여러 프로세스 사이의 중복 실행을 조정하는 기능은 없다. [Next instrumentation](https://nextjs.org/docs/app/guides/instrumentation)

## 자동 검증

```bash
npm run check                 # lint → typecheck → build → API smoke → regression
npx playwright install chromium
npm run test:ui               # 별도 UI 검증
```

`typecheck`는 `next typegen && tsc --noEmit`이며, smoke/UI 스크립트는 Node 테스트 러너를 사용한다. UI는 Playwright Chromium 설치가 필요하다. 테스트는 빌드 결과와 임시 DB/별도 서버를 사용하므로 단독 실행 전 `npm run build`를 수행한다. 실행 방법만 기재하며 통과 여부는 각 실행 로그와 업그레이드 기록으로 확인한다.

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

- [ ] write가 모두 `await db.transaction(async (tx) => ...)` 안에 있다
- [ ] write 쿼리에 `await`가 빠진 곳이 없다
- [ ] `withAudit(tx, ...)`가 write와 같은 트랜잭션에 있다
- [ ] 동적 route의 `params`를 `await`한다
- [ ] 입력은 Zod 4로 검증하고 오류 응답 구조를 유지한다
- [ ] soft delete 필터가 필요한 곳에 `isNull(deletedAt)`가 있다
- [ ] 에러 처리는 `withErrorHandler` / `HttpError`를 따른다
- [ ] 관계 응답 shape가 기존 클라이언트 기대와 일치한다
- [ ] 카운트/통계 라우트는 캐시 차단과 변경 이벤트 갱신 경로가 있다
- [ ] README / 관련 문서도 함께 갱신했다

## 11. 안티 패턴

```ts
// ❌ transaction 밖 write + audit 분리
await db.insert(workItems).values(row);
withAudit(tx, ...);

// ❌ write builder만 만들고 실행 안 함
tx.insert(teamMembers).values(row);

// ❌ soft delete 필터 누락
db.select().from(workItems);

// ❌ 라우트마다 관계 조립 로직 복붙
const tickets = await db.select().from(workTickets) ...
const assignees = await db.select().from(teamMembers) ...
```


## 출시 검수에서 추가한 규칙

- 기간 PATCH는 입력 필드뿐 아니라 기존 행과 병합한 최종 날짜 범위를 트랜잭션 안에서 검증한다. 작업은 같은 시작/종료일 및 null 해제를 허용하며, 일정은 종료 시각이 시작보다 뒤여야 한다. 날짜 필터는 실재 날짜와 순서를 검증한다.
- TODO PATCH의 `checklist` 생략은 기존 항목 유지, 배열 제공은 해당 순서로 전체 대체다. 기존 항목은 ID를 유지하고, 다른 TODO·삭제된 항목 ID 및 중복 ID를 거부한다. 부모·자식·각 감사 로그는 한 트랜잭션에서 반영한다.
- TODO 드로어는 `expectedUpdatedAt`을 보낸다. TODO PATCH와 자식 쓰기 모두 부모 `updatedAt`을 `max(now, previous + 1ms)`로 갱신해 같은 밀리초에도 버전이 달라진다. 충돌 시 409이며 클라이언트 초안을 유지한다.
- 비동기 목록·상세 조회는 이전 요청을 취소하고 최신 응답만 반영한다. 폼 초기화 effect는 부모가 재렌더할 때 바뀌는 콜백에 의존하지 않는다.
- 캘린더·간트의 `eventDayKeys` 호출에는 KST 자정 기준 `[fromMs, toMs)` 표시 범위를 넘겨 긴 기간 일정을 화면 밖까지 펼치지 않는다.
- 로딩, 조회 실패, 필터 결과 없음은 다른 상태다. 오류에서 다시 시도할 수 있어야 하며, 실패를 데이터가 없다는 뜻으로 표시하지 않는다.
- 페이지 전체에 최소 데스크톱 폭을 강제하지 않는다. 넓은 표·캘린더만 내부 스크롤하며, 팝오버는 화면의 사용 가능한 높이/폭 안에 둔다.
- 수동 검수 기록과 실제 실행 결과는 [출시 검수 기록](RELEASE_AUDIT_20261022.md)에 둔다.
