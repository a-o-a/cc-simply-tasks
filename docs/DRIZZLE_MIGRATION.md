# Drizzle Migration Notes

이 문서는 `Prisma + SQLite`에서 현재 `Drizzle ORM + @libsql/client + SQLite(file)` 구조로 전환한 결과를 기록합니다.

## 최종 상태

- Prisma 의존성 제거
- 런타임 ORM을 Drizzle로 통일
- SQLite 드라이버를 `@libsql/client`로 통일
- 개발 DB 기본 경로를 `db/dev.db`로 정리
- API write 경로를 모두 `await db.transaction(async (tx) => { ... })` 패턴으로 통일
- 감사 로그를 `withAudit(tx, ...)`로 같은 트랜잭션 안에서 기록

## 왜 이렇게 바꿨나

기존 Prisma 구성은 사내 Windows / Linux 환경에서 엔진 바이너리 다운로드 제약이 컸습니다.

이후 `better-sqlite3` 기반 Drizzle도 잠시 검토했지만, 내부망 Windows에서 `node-gyp`, Python, Node headers 다운로드 이슈가 다시 생길 수 있었습니다.

현재 구조는 그 문제를 피하기 위해 `@libsql/client`를 사용합니다.

- Prisma 엔진 다운로드 없음
- `better-sqlite3` 같은 네이티브 빌드 체인 의존성 회피
- `npm install` 중심의 배포 흐름 유지

## 주요 변경점

### DB 레이어

- [`lib/db.ts`](../lib/db.ts)
  - `DATABASE_URL=file:...`를 실제 파일 경로로 해석
  - `file://` URL로 변환해 `@libsql/client` 생성
  - Drizzle 인스턴스를 글로벌 싱글톤처럼 재사용

- [`lib/db/schema.ts`](../lib/db/schema.ts)
  - 현재 DB 스키마의 소스 오브 트루스

- [`lib/db/queries.ts`](../lib/db/queries.ts)
  - `WorkItem`, `CalendarEvent` 등의 관계 하이드레이션 공통화

### API 레이어

다음 write API들은 모두 async transaction 패턴으로 재작성했습니다.

- `app/api/settings/route.ts`
- `app/api/team-members/**`
- `app/api/work-categories/**`
- `app/api/work-systems/**`
- `app/api/work-items/**`
- `app/api/calendar-events/**`

### 감사 로그

- [`lib/audit.ts`](../lib/audit.ts)
  - ORM 전용 타입 결합 제거
  - Drizzle transaction에서 직접 호출 가능한 형태로 정리

## 운영 메모

- 개발 기본값은 `.env`의 `DATABASE_URL="file:./db/dev.db"`입니다.
- 운영에서는 배포 디렉터리 바깥의 영속 경로를 사용해야 합니다.
- `npm run build` 시 `.env.production`이 빈 SQLite 파일을 가리키면 정적 생성 단계에서 `no such table` 로그가 남을 수 있습니다.
  - 빌드 자체는 성공할 수 있지만,
  - 실제 운영에서는 빌드 시점에도 스키마가 반영된 DB를 가리키는 편이 안전합니다.

## 검증 내역

- `npm install`
- `npm run typecheck`
- 개발 서버 기준 주요 API smoke test
  - `settings`
  - `db-stats`
  - `team-members`
  - `work-categories`
  - `work-systems`
  - `work-items`
  - `calendar-events`
  - `audit-logs`
  - `calendar-events/stream`

## 참고

- 현재 개발/운영 규칙은 [`docs/DEVELOPMENT.md`](./DEVELOPMENT.md)를 기준으로 봅니다.
- 이 문서는 “전환 배경과 결과”를 남기는 메모이며, 구현 규칙의 소스 오브 트루스는 아닙니다.
