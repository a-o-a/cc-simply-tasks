# cc-simply-tasks

내부망용 업무 관리 애플리케이션입니다. 작업·이관·할 일·팀 일정과 변경 이력을 관리합니다.

## 시작하기

실행·빌드·DB 마이그레이션은 Node.js 22 LTS를 사용합니다. `.nvmrc`는 검증 기준인 22.23.3을 선택하며 `engines`도 22 계열로 제한합니다.

```bash
nvm install
nvm use
npm ci
cp .env.example .env
# 새 환경에서만 복사합니다. 기존 DB를 덮어쓰지 않습니다.
cp db/dev.db.clean db/dev.db
npm run dev
```

기본 주소는 `http://localhost:3000`입니다. 최초 접속 시 입력하는 이름은 변경 기록용 표시 이름입니다. 로그인이나 접근 권한을 제공하지 않습니다.

## 기능과 코드 위치

| 기능 | 화면 구현 | API |
|---|---|---|
| 홈 | `components/dashboard` | 작업 건수·작업·일정·감사 로그 |
| 작업 | `components/work-items` | `/api/work-items` |
| 이관 | `components/transfer` | 작업 조회·`/api/work-items/bulk-status` |
| 할 일·체크리스트 | `components/todos` | `/api/todos` |
| 월 캘린더·드래그·실시간 알림 | `components/calendar` | `/api/calendar-events`, `/stream` |
| 서비스명·팀원·분류·시스템·백업 | `components/settings` | settings·team-members·work-categories·work-systems·backup |

화면 경로는 `/`, `/work-items`, `/transfer`, `/todos`, `/calendar`, `/settings`입니다. `/members`는 설정으로 이동합니다. 작업은 테이블·칸반·간트 보기와 진행/이관완료 범위를 제공합니다.

## 구조

- `app/`: 페이지 셸과 Next.js Route Handler.
- `components/`: 기능별 화면, 폼, 드로어와 공통 UI.
- `lib/client/`: API 호출, 클라이언트 타입, 날짜 표시.
- `lib/db.ts`, `lib/db/`: Drizzle 연결, SQLite 스키마, 관계 조회.
- `lib/validation/`, `lib/http.ts`, `lib/errors.ts`: 입력·날짜 검증, 요청 보호, 공통 오류.
- `lib/pagination.ts`: DB에서 페이지 크기를 제한하는 커서 조회.
- `lib/audit.ts`, `lib/diff.ts`: 트랜잭션 안에서 변경 이력 저장.
- `lib/backup.ts`: SQLite 스냅샷 생성·목록·보관 정책.
- `lib/file-download.ts`: 파일 스트리밍과 완료·취소·실패 시 자원 정리.
- `lib/backup-scheduler.ts`, `instrumentation.ts`: 자동 백업 스케줄 등록.
- `drizzle/`, `db/dev.db.clean`: 마이그레이션과 빈 개발 DB 템플릿.
- `tests/`, `scripts/`: 회귀 검사와 임시 DB를 사용하는 프로덕션 통합 검사.

Next.js 16.3.8, React 19.3.0, TypeScript 6.0.3, Tailwind 4.3.3/Radix UI, Drizzle ORM, `@libsql/client`를 사용합니다. 기본 개발·빌드는 Turbopack입니다. 현재 DB 연결은 로컬 SQLite `file:` URL만 지원합니다. Postgres 전환에는 드라이버·스키마·쿼리 변경이 필요합니다.

## 개발·검증 명령

| 명령 | 용도 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build`, `npm start` | 프로덕션 빌드·실행 |
| `npm run typecheck` | TypeScript 검사 |
| `npm run lint` | 설정된 ESLint 검사 |
| `npm run test:lint` | React·Hooks·Next·접근성·타입 검사 오류 검출 확인 |
| `npm test` | 검증·커서·감사 diff·요청 보호 회귀 검사 |
| `npm run test:integration` | 임시 체크아웃·DB에서 빌드와 실제 HTTP API 검사 |
| `npm run db:generate`, `npm run db:migrate` | 마이그레이션 생성·적용 |
| `npm audit` | 설치된 의존성 취약점 확인 |

통합 검사는 기존 `.next`와 개발·운영 DB에 접근하지 않고, 완료 후 임시 서버와 파일을 정리합니다.

## 운영과 백업

운영 `DATABASE_URL`은 배포 디렉터리 밖의 영속 경로를 사용하세요. `.env.production.example`을 참고합니다. 기존 환경 파일은 로컬에 보관하고 Git에는 예시 파일만 포함합니다.

```dotenv
DATABASE_URL="file:/srv/cc-simply-tasks/shared/dev.db"
BACKUP_CRON="0 0 2 * * *"
APP_ALLOWED_ORIGINS=""
```

- 자동 백업은 서버 시간 기준 매일 02:00이며 `BACKUP_CRON`으로 변경합니다.
- 백업 파일은 실제 DB와 같은 디렉터리에 저장하고 7일 이전 날짜의 파일을 정리합니다.
- 설정의 현재 DB 다운로드와 수동·자동 백업 모두 `VACUUM INTO`로 일관된 스냅샷을 만듭니다. 열린 WAL DB의 본체만 복사하지 않습니다.
- 복구는 서버를 중지하고 현재 DB를 별도 보관한 뒤, DB 파일과 기존 WAL/SHM 파일을 함께 처리하여 백업으로 교체하고 재시작합니다. 상세 절차는 [운영 가이드](docs/OPERATIONS.md)를 참고하세요.

## 작업 규칙과 제한

모든 쓰기는 Zod 검증, DB 트랜잭션, 감사 로그를 함께 적용합니다. 주요 엔티티는 soft delete합니다. 시간은 UTC timestamp로 저장하고 KST로 표시합니다. 상세 규칙은 [개발 가이드](docs/DEVELOPMENT.md)에 있습니다.

현재 동시 편집은 마지막 저장을 반영합니다. `If-Match` 기반 충돌 보호는 구현되어 있지 않습니다. 표시 이름과 IP는 인증된 사용자 증명이 아닙니다.

브라우저의 다른 출처에서 보내는 변경 요청을 차단하고 JSON 본문은 256 KiB로 제한합니다. 출처의 scheme·host·port를 비교하며 Origin이 없으면 Referer를 검사합니다. TLS 종료 프록시나 Host를 바꾸는 프록시는 `APP_ALLOWED_ORIGINS`에 정확한 공개 origin을 지정합니다. 이 보호는 로그인·권한 관리의 대체 수단이 아닙니다.

의존성은 정식 안정 릴리스의 호환 조합으로 고정합니다. 프레임워크 전환·도구 버전 선택과 남은 개발 의존성 위험은 [의존성 가이드](docs/DEPENDENCIES.md)를 확인하세요.

- [개발 가이드](docs/DEVELOPMENT.md)
- [운영·백업·복구](docs/OPERATIONS.md)
- [Drizzle 마이그레이션](docs/DRIZZLE_MIGRATION.md)
- [보안·성능·UI 개선 기록](docs/MAINTENANCE.md)
- [의존성·런타임 버전](docs/DEPENDENCIES.md)
- [후속 계획](PLAN.md)
