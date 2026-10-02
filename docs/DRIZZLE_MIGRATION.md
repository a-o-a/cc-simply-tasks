# Drizzle 스키마·마이그레이션

현재 데이터 계층은 Drizzle ORM + `@libsql/client` + SQLite 파일입니다. 이전 ORM 전환 이력보다 현재 개발 절차를 기준으로 합니다.

## 변경 절차

1. `lib/db/schema.ts`를 수정합니다.
2. 앱과 같은 Node 22 LTS 환경에서 `npm run db:generate`를 실행합니다.
3. `drizzle/` SQL과 snapshot을 검토합니다. 기존 데이터 손실·DEFAULT·인덱스·외래키 영향을 확인합니다.
4. 앱을 중지하고 복제된 테스트 DB에 `npm run db:migrate`를 적용합니다.
5. 타입·회귀·통합 검사와 기존 데이터 호환성을 확인합니다.
6. 새 환경용 `db/dev.db.clean`을 같은 migration 기준으로 재생성합니다.
7. 운영 백업·적용·복구 계획과 함께 코드·migration·빈 DB 템플릿을 전달합니다.

`db:generate`는 SQL 파일 생성이며 DB를 변경하지 않습니다. `db:migrate`는 준비된 migration을 DB에 적용합니다. 배포 서버에서 migration을 즉석 생성하지 않습니다.

## 규칙

- DB 시간 컬럼은 epoch 밀리초/Drizzle `Date`이며 UI만 KST로 표시합니다.
- enum 값은 문자열 + `lib/enums.ts` + Zod로 관리합니다.
- 관계는 스키마 외래키와 명시적 조회 헬퍼로 관리합니다.
- 주요 엔티티의 삭제는 `deletedAt` 갱신입니다.
- `file:` URL의 상대 경로는 프로젝트 현재 작업 디렉터리 기준입니다. 운영에는 절대 경로를 사용합니다.
- 기존 DB·WAL·백업 파일을 Git에 넣지 않습니다.

현재 Postgres 드라이버나 스키마는 구현되어 있지 않습니다. 전환하려면 SQLite 전용 타입·PRAGMA·마이그레이션·백업·NULL 정렬·커서 쿼리를 함께 변경해야 합니다. URL 변경만으로 전환할 수 없습니다.

이번 유지보수는 조회·검증·감사·백업·UI 코드 변경이며 테이블 구조를 바꾸지 않습니다.
