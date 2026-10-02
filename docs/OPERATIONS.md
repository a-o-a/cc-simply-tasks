# 운영·백업·복구

## 실행 환경과 DB 경로

앱 실행·빌드·DB 마이그레이션은 Node 22 LTS를 사용합니다. 검증 기준은 22.23.3이며 배포 호스트도 `.nvmrc`와 `package.json`의 `engines`에 맞춥니다. Node 16에서는 실행하지 않습니다. 의존성 조합과 남은 제한은 [의존성 가이드](DEPENDENCIES.md)에 명시합니다.

운영 DB는 `/srv/cc-simply-tasks/shared/dev.db` 같은 영속 경로에 둡니다. 배포 릴리스 폴더와 함께 교체하지 않습니다. 앱 프로세스에는 DB와 백업 디렉터리의 읽기·쓰기 권한이 필요합니다. SQLite WAL은 같은 호스트의 로컬 파일시스템에서 사용합니다.

`.env.production.example`을 복사해 운영 값을 설정합니다. 환경 파일과 실제 DB·백업은 커밋하지 않습니다. `DATABASE_URL`은 `file:` URL만 지원합니다.

## 배포

1. 새 릴리스에 코드를 배치하고 `npm ci`로 lockfile 기준 의존성을 설치합니다.
2. 스키마 변경이 있으면 먼저 백업하고 서버를 중지한 뒤 준비된 migration을 적용합니다. 배포 서버에서 새 migration을 즉석 생성하지 않습니다.
3. 스키마가 있는 DB 경로를 지정해 `npm run build`를 실행합니다.
4. 앱을 시작하고 주요 화면·count API·백업을 확인합니다.

```bash
npm run typecheck
npm run lint
npm run test:lint
npm test
npm run test:integration
npm run build
npm start
```

통합 검사는 별도 임시 DB를 사용합니다. 운영 DB에 대한 테스트로 대체하지 않습니다.

## 내부망 접근과 프록시

현재 로그인과 사용자별 권한이 없습니다. 공개 인터넷에 직접 노출하지 않고, 조직이 승인한 내부망·VPN·접근 제어 프록시를 사용합니다. 액터 이름과 전달된 IP 헤더는 신원 인증 자료가 아닙니다.

앱은 브라우저의 cross-site 변경 요청을 거부하고 출처의 scheme·host·port를 비교합니다. Origin이 없으면 Referer를 검사합니다. 프록시는 공개 Host를 유지하는 것이 기본입니다. TLS를 종료하거나 Host를 변경하는 프록시는 공개 origin을 `APP_ALLOWED_ORIGINS`에 정확하게 지정합니다. 값은 `https://tasks.example.internal` 형태이며 쉼표로 구분합니다. 임의 origin을 반사하거나 와일드카드를 허용하지 않습니다.

CLI 요청은 Origin이 없어도 지원합니다. 따라서 출처 검사는 인증을 대체하지 않습니다. 프록시에서 요청 크기·동시 연결·속도 제한을 적용하고 필요하다면 인증을 제공합니다. SSE 사용 시 프록시 버퍼링을 끄고 연결 유지 시간을 충분히 설정합니다.

HTTPS와 HSTS는 운영 프록시에서 설정합니다. 개발 서버는 로컬 인터페이스에만 바인딩하세요.

```bash
npm run dev -- --hostname 127.0.0.1
```

## 백업

`BACKUP_CRON`은 6필드 cron이며 기본 `0 0 2 * * *`는 서버 시간의 매일 02:00입니다. 앱 프로세스마다 스케줄러가 있으므로 여러 프로세스로 운영하면 한 프로세스만 자동 백업을 맡도록 운영 구성을 정해야 합니다.

- 설정의 **현재 DB 다운로드**: 임시 스냅샷을 만들고 스트리밍하며 완료·취소 시 파일을 정리합니다.
- **지금 백업**·자동 백업: DB와 같은 디렉터리에 `backup_YYYY-MM-DD_HH-mm-ss_<suffix>.db`를 생성합니다.
- 같은 프로세스의 동시 백업 요청은 하나의 스냅샷 생성 작업을 공유합니다.
- 파일 이름을 중복하지 않고 기존 백업을 덮어쓰지 않습니다. 7일 이전 날짜의 백업을 정리합니다.
- 새 스냅샷 파일은 0600 권한으로 만듭니다. 목록과 다운로드는 허용된 백업 파일 이름을 검사하고 심볼릭 링크를 제외합니다.

WAL 파일에는 아직 본체로 checkpoint되지 않은 커밋이 있을 수 있습니다. 열린 DB의 본체만 복사하면 최신 데이터가 빠질 수 있으므로 모든 앱 백업은 `VACUUM INTO`를 사용합니다. [SQLite WAL 문서](https://www.sqlite.org/wal.html), [VACUUM INTO 문서](https://www.sqlite.org/lang_vacuum.html)를 참고하세요.

앱 디스크의 백업만으로 디스크 장애를 복구할 수 없습니다. 조직의 보관 정책에 따라 스냅샷을 별도 저장소로 복사하고 복구 검증을 수행하세요.

## 복구

1. 앱과 해당 DB를 사용하는 모든 프로세스를 중지합니다.
2. 현재 DB와 같은 이름의 `-wal`, `-shm` 파일을 **모두 별도 디렉터리에 보관**합니다. 현재 DB 본체만 남기고 WAL을 삭제하면 기존 상태를 잃을 수 있습니다.
3. 복구할 스냅샷의 `PRAGMA integrity_check`와 스키마 버전을 확인합니다.
4. 보관을 마친 뒤 원래 경로에 백업 DB를 배치합니다. 이전 DB에 속한 WAL/SHM 파일을 새 DB 옆에 남기지 않습니다.
5. 소유자·권한·`DATABASE_URL`을 확인하고 앱을 시작합니다.
6. 작업·TODO·일정·감사 로그와 count API를 확인합니다.

복구는 기존 데이터를 대체합니다. 검증된 스냅샷과 별도 보관된 기존 파일을 확보한 뒤 수행합니다.

## 흔한 오류

| 증상 | 점검 |
|---|---|
| `no such table` | 경로가 올바른지, schema/migration이 적용됐는지 확인 |
| `database is locked` | 같은 DB를 사용하는 프로세스·긴 트랜잭션·동시 migration 확인 |
| 변경 요청 403 | Origin·Host·APP_ALLOWED_ORIGINS 확인 |
| 요청 413 | JSON 본문 256 KiB 제한과 프록시 제한 확인 |
| count가 갱신되지 않음 | 배포된 API가 동적 라우트인지와 프록시 캐시 확인 |
| 백업 실패 | DB·백업 디렉터리 권한, 디스크 공간, cron 표현식 확인 |
