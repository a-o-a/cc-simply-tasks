# Drizzle Migration Guide

이 문서는 현재 코드베이스를 `Prisma + SQLite`에서 `Drizzle + SQLite`로 옮길 때의 현실적인 범위와 순서를 정리합니다.

대상 코드베이스:

- Next.js 13.5 app router
- Node.js 16 고정
- SQLite 사용
- Prisma 5.10.2 사용
- API write는 감사 로그(`withAudit`)와 트랜잭션에 묶여 있음

## 왜 Drizzle인가

현재 Prisma는 내부망에서 엔진 바이너리 다운로드가 막히면 `install`, `generate`, `migrate` 단계가 모두 영향을 받습니다.

Drizzle은 이 점에서 유리합니다.

- Rust 엔진 다운로드가 없음
- npm 패키지와 SQLite 드라이버만으로 동작 가능
- TypeScript 친화적이고 Next.js 조합이 좋음
- SQL에 가까워 디버깅이 쉬움

이 프로젝트에서는 `Kysely`도 후보가 될 수 있지만, 스키마 선언과 마이그레이션 도구까지 함께 가져가려면 Drizzle이 더 자연스럽습니다.

## 추천 구성

SQLite를 유지한다면 아래 조합을 권장합니다.

- `drizzle-orm`
- `drizzle-kit`
- `better-sqlite3`

핵심 변화:

- `lib/db.ts`: `PrismaClient` 싱글톤 대신 `better-sqlite3` 연결 + Drizzle 인스턴스 생성
- 레거시 Prisma 산출물은 제거하고 현재 Drizzle 스키마만 유지

## 공수 체감

현재 구조에서는 "설정 몇 줄 변경"으로 끝나지 않습니다.

- 최소 공수 PoC: 반나절~1일
- 일부 API를 Drizzle로 병행 전환: 1~2일
- Prisma 제거 + 마이그레이션 체계 정리 + 회귀 검증: 2~4일

공수가 생기는 이유:

- Prisma 사용이 API 전반에 퍼져 있음
- `withAudit`가 `Prisma.TransactionClient` 타입에 직접 결합돼 있음
- `groupBy`, relation include, soft delete 패턴을 새 쿼리로 다시 써야 함
- `lib/db.ts`의 SQLite PRAGMA 적용을 유지해야 함

## 영향 범위

우선 변경 대상은 아래가 핵심입니다.

- `lib/db.ts`
- `lib/audit.ts`
- `app/api/work-items/**`
- `app/api/team-members/**`
- `app/api/calendar-events/**`
- `app/api/work-categories/**`
- `app/api/work-systems/**`
- `app/api/settings/route.ts`
- `app/api/db-stats/route.ts`
- `app/api/audit-logs/route.ts`

특히 아래 패턴이 전환 포인트입니다.

1. `prisma.$transaction(async (tx) => ...)`
2. `findMany / findFirst / create / update / updateMany / upsert / count / groupBy`
3. relation include
4. `deletedAt: null` soft delete 필터
5. `ensureSqlitePragma()`

## 가장 안전한 전환 전략

한 번에 Prisma를 제거하지 말고, 아래 순서로 병행 운영하는 편이 안전합니다.

### 1. Drizzle 기반 DB 레이어 추가

예상 파일:

- `lib/db/drizzle.ts`
- `lib/db/schema.ts`
- `lib/db/types.ts`

여기서 먼저 할 일:

- SQLite 연결 생성
- PRAGMA 적용
- Drizzle DB export
- 테이블 스키마 정의

이 단계에서는 기존 Prisma 코드는 그대로 둡니다.

### 2. 감사 로그 헬퍼 추상화

현재 `lib/audit.ts`는 `Prisma.TransactionClient`만 받습니다.

이 부분은 아래처럼 추상화해야 Drizzle에서도 재사용할 수 있습니다.

- `withAuditPrisma(tx, params)`
- `withAuditDrizzle(tx, params)`

또는 더 간단하게:

- diff 계산은 공통 함수로 유지
- 실제 `auditLog` insert만 ORM별 어댑터로 분리

전환 초반에는 이 작업이 가장 중요합니다. write 경로의 규칙이 여기에 걸려 있기 때문입니다.

### 3. 단순 읽기 API부터 전환

추천 순서:

1. `app/api/db-stats/route.ts`
2. `app/api/work-categories/route.ts`
3. `app/api/work-systems/route.ts`
4. `app/api/settings/route.ts`
5. `app/api/audit-logs/route.ts`

이 구간은 relation 처리와 write 트랜잭션 부담이 작아서 패턴 정리에 좋습니다.

### 4. 그 다음 목록/상세 API 전환

추천 순서:

1. `team-members`
2. `calendar-events`
3. `work-items`

`work-items`를 마지막에 두는 이유:

- 필터가 가장 많음
- tickets relation 조회가 있음
- 생성/수정 시 하위 레코드 처리까지 필요

### 5. 마지막에 마이그레이션 체계 정리

Prisma를 완전히 제거할 시점까지는 기존 DB 파일과 기존 스키마를 유지하는 편이 낫습니다.

마지막 단계에서 결정:

- Prisma migration 계속 유지하고 런타임만 Drizzle로 전환
- Drizzle migration으로 완전 이전

사내 환경 제약이 크면, 런타임만 Drizzle로 바꾸고 마이그레이션은 나중에 분리하는 것도 충분히 현실적인 전략입니다.

## 코드 패턴 비교

### Prisma

```ts
const rows = await prisma.teamMember.findMany({
  where: { deletedAt: null },
  orderBy: [{ name: "asc" }, { id: "asc" }],
});
```

### Drizzle

```ts
const rows = await db
  .select()
  .from(teamMembers)
  .where(isNull(teamMembers.deletedAt))
  .orderBy(asc(teamMembers.name), asc(teamMembers.id));
```

핵심 차이:

- Prisma는 모델 중심 API
- Drizzle은 SQL에 가까운 조합식 API
- 복잡한 조건 조립은 Drizzle 쪽이 더 명시적

## 이 프로젝트에서 까다로운 포인트

### 1. `groupBy`

현재 `app/api/work-items/count/route.ts`는 Prisma `groupBy`를 사용합니다.

Drizzle에서는 보통 아래처럼 다시 씁니다.

```ts
const rows = await db
  .select({
    status: workItems.status,
    count: sql<number>`count(*)`,
  })
  .from(workItems)
  .where(isNull(workItems.deletedAt))
  .groupBy(workItems.status);
```

### 2. relation include

Prisma의 `include`는 편하지만, Drizzle에서는 join 또는 별도 쿼리 조합으로 바뀝니다.

예:

- `calendarEvent` + `members`
- `workItem` + `assignee` + `tickets`

이 부분은 응답 shape를 유지하도록 신중하게 맞춰야 합니다.

### 3. upsert

`app/api/settings/route.ts`의 `upsert`는 Drizzle에서 SQLite `onConflictDoUpdate`로 바꾸는 식으로 대응합니다.

### 4. PRAGMA

현재 `ensureSqlitePragma()`는 Prisma raw query로 PRAGMA를 적용합니다.

Drizzle로 옮기면 `better-sqlite3` 연결 직후에 아래 식으로 처리하면 됩니다.

```ts
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");
```

### 5. 타입 결합

현재 `withAudit`는 Prisma 타입에 직접 묶여 있습니다.

전환 작업에서 가장 먼저 해야 할 리팩터링은 "도메인 규칙"과 "ORM 구현"을 분리하는 일입니다.

## 추천 마이그레이션 체크리스트

1. Node 16에서 쓸 SQLite 드라이버 조합 확정
2. `lib/db/drizzle.ts` 추가
3. PRAGMA 로직 이전
4. Drizzle 스키마 선언
5. `withAudit` ORM 의존성 분리
6. 읽기 전용 API 1개 전환
7. write API 1개 전환
8. 트랜잭션/감사 로그 회귀 확인
9. 나머지 API 순차 전환
10. Prisma 제거 여부 최종 결정

## 추천 결론

이 프로젝트에서는 아래 전략이 가장 무난합니다.

- 단기: Prisma 유지, 내부망 우회 또는 엔진 반입
- 중기: Drizzle 병행 도입
- 장기: 충분히 안정화되면 Prisma 제거

내부망 이슈 때문에 "지금 당장 npm만으로 돌고 싶다"가 목표라면, 처음부터 전면 교체하기보다 `db-stats`, `settings`, `work-categories`, `work-systems` 같은 쉬운 API부터 Drizzle로 옮기는 편이 가장 비용 대비 효과가 좋습니다.
