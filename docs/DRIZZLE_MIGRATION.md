# Drizzle Migration Notes

이 문서는 과거 `Prisma + SQLite`에서 `Drizzle ORM + @libsql/client + SQLite(file)`로 전환한 배경과 현재 운영 방법을 기록합니다. 구현 규칙은 [개발 가이드](./DEVELOPMENT.md), Node 22 업그레이드 결과는 [업그레이드 기록](./UPGRADE_NODE22.md)을 기준으로 합니다.

## 현재 기준

- Node 22.x에서 설치·개발·빌드·마이그레이션·운영을 수행합니다. 최소 버전은 `package.json`의 `engines`를 따릅니다.
- Drizzle ORM 0.45.4, Drizzle Kit 0.31.11, `@libsql/client` 0.18.0을 사용합니다. 설치 버전의 기준은 `package.json`과 lockfile입니다.
- 개발 DB 기본 경로는 `db/dev.db`이며 `DATABASE_URL=file:...`만 지원합니다.
- API 도메인 쓰기와 감사 로그는 `await db.transaction(async (tx) => { ... })`와 `withAudit(tx, ...)`로 묶습니다.
- Prisma나 `better-sqlite3`를 런타임 ORM/드라이버로 사용하지 않습니다.

## 전환 배경

과거 Prisma 구성에서는 사내 Windows/Linux 환경에서 별도 ORM 엔진 다운로드가 문제가 되었습니다. `better-sqlite3` 검토 과정에서도 네이티브 빌드 도구와 Node 헤더 다운로드의 운영 부담을 고려했습니다.

현재는 libsql의 플랫폼별 패키지를 npm으로 설치합니다. 이는 네이티브 코드가 없다는 뜻은 아닙니다. 배포 대상 OS·CPU에 맞춰 `npm ci`를 실행하며, 다른 플랫폼에서 만든 `node_modules`를 복사하지 않습니다. 과거 Node 16 호환 제약은 더 이상 현재 실행 기준이 아닙니다.

## DB와 API 구조

- [`lib/db.ts`](../lib/db.ts): 파일 경로를 `file://` URL로 변환하고 Node용 libsql 드라이버를 표준 import합니다. 첫 DB 접근 때 연결을 만들고 프로세스 내에서 재사용합니다.
- [`next.config.js`](../next.config.js): `serverExternalPackages`로 `@libsql/client`와 `libsql`을 서버 번들에서 외부화합니다. 이전의 `eval("require")` 우회는 사용하지 않습니다.
- [`lib/db/schema.ts`](../lib/db/schema.ts): DB 스키마의 소스 오브 트루스입니다.
- [`lib/db/queries.ts`](../lib/db/queries.ts): 작업·캘린더·TODO의 관계 하이드레이션을 담당합니다.
- [`lib/audit.ts`](../lib/audit.ts): 동일 트랜잭션에서 변경 필드의 감사 로그를 기록합니다.
- [`lib/http.ts`](../lib/http.ts): Zod 4 오류를 기존 JSON 구조로 반환하고, Drizzle 오류의 `cause`에 있는 libsql 유니크 제약 위반도 409로 변환합니다.

Next 16의 동적 API 경로는 Promise `params`를 `await`해야 합니다. 새 route 예제는 [개발 가이드](./DEVELOPMENT.md#42-item-route)를 참고합니다. [Next 16 공식 안내](https://nextjs.org/docs/app/guides/upgrading/version-16)

## 최초 개발 DB 준비

```bash
nvm use
npm ci

# 대상 파일이 없을 때만 복사하며, 기존 파일은 절대 덮어쓰지 않음
node -e "const fs=require('node:fs'); if (fs.existsSync('db/dev.db') === false) fs.copyFileSync('db/dev.db.clean', 'db/dev.db', fs.constants.COPYFILE_EXCL);"
npm run db:migrate
```

템플릿 대신 완전히 새 DB를 만들 때는 빈 대상 경로를 지정한 뒤 커밋된 migration을 적용합니다. 기존 DB를 새 DB처럼 초기화하지 않습니다.

## 스키마 변경과 배포

개발자가 스키마를 변경하는 단계:

1. `lib/db/schema.ts`를 수정합니다.
2. 대상 DB를 백업하고 쓰기 작업을 중지합니다.
3. `npm run db:generate`로 SQL을 생성한 뒤 내용을 검토합니다.
4. 같은 Node 22 환경에서 `npm run db:migrate`를 실행합니다.
5. 스키마, `drizzle/` SQL과 메타데이터를 함께 커밋합니다. 초기 템플릿도 별도의 새 빈 DB에서 재생성합니다.

배포 단계는 생성과 구분합니다.

```bash
nvm use
npm ci
export DATABASE_URL="file:/srv/cc-simply-tasks/shared/dev.db"
# 최초 배포는 상위 디렉터리와 쓰기 권한을 먼저 준비
# 업데이트는 백업 후 앱의 쓰기 작업을 중지
npm run db:migrate
npm run build
npm run start
```

**배포 중 `db:generate`를 실행하지 않습니다.** 운영에는 검토·커밋된 migration만 적용합니다. `drizzle.config.ts`는 프로세스의 `DATABASE_URL`을 읽으므로 Next의 `.env.production`이 자동으로 migration CLI에 전달된다고 가정하지 않습니다. [Drizzle migration 문서](https://orm.drizzle.team/docs/migrations)

운영 DB는 앱 배포 디렉터리 밖에 보관합니다. 실행 중에는 WAL/SHM 파일도 생길 수 있으므로 DB 디렉터리 전체가 영속 경로여야 하며 서비스 계정에 필요한 쓰기 권한이 있어야 합니다.

## WAL과 백업

DB 초기화는 `busy_timeout=5000`, `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`을 적용합니다. 실행 중인 DB 본파일만 복사하면 아직 WAL에 남은 커밋이 빠질 수 있습니다.

`lib/backup.ts`의 `createSqliteSnapshot`이 매개변수화한 `VACUUM INTO`로 일관된 스냅샷을 만듭니다. 직접 다운로드는 임시 디렉터리에 생성한 후 정리하고, 수동 저장·cron은 공통 `runBackup`을 사용합니다. 스냅샷의 무결성과 최신 데이터 포함 여부는 API smoke 테스트의 검증 항목입니다. [SQLite VACUUM](https://www.sqlite.org/lang_vacuum.html)

cron은 Node 서버가 실행되는 동안만 동작합니다. 기본 스케줄은 서버 현지 시간 매일 02:00이며 저장 백업은 DB와 같은 디렉터리에 기록합니다. 중복 등록·겹침 방지는 한 프로세스 범위이므로 여러 서버의 실행 조정은 별도로 설계해야 합니다.

## 검증 방법

```bash
npm run check
npx playwright install chromium
npm run test:ui
```

`check`는 lint, typecheck, build, API smoke를 순서대로 실행합니다. smoke는 `node --test scripts/smoke.test.mjs`, UI는 `node --test scripts/ui.test.mjs`를 사용하며 임시 DB와 별도 서버에서 실행합니다. 위 명령은 검증 방법이며 이 문서 자체는 현재 업그레이드의 통과를 보증하지 않습니다.
