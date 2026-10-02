# 보안·성능·UI 유지보수 기록

기준일: 2026-10-02. 기능 분석과 재현 결과를 바탕으로 현재 구현을 개선했습니다. 기존 스키마·데이터 형식은 유지하며 migration이 필요하지 않습니다.

## 개선과 근거

| 영역 | 확인한 문제 | 적용한 개선 |
|---|---|---|
| DB 현황 | 프로덕션 빌드 때 0건으로 고정되어 생성 후에도 갱신되지 않음 | DB API의 정적 캐시 차단 |
| 목록 성능 | 필터에 맞는 전체 행을 가져온 뒤 메모리에서 페이지를 자름 | 정렬값 cursor + SQL LIMIT, 페이지의 관계만 조회 |
| 작업 화면 | 진행 작업 50건 이후 조회 경로가 없고 집계 화면도 첫 페이지만 사용 | 테이블 커서 페이지, 보드·간트·집계 전페이지 조회, 취소·반복 cursor 방어 |
| 날짜 | 시작·종료 중 한 필드만 수정하면 역전 범위를 저장할 수 있음 | 기존 행과 병합한 최종 상태의 날짜 검사 |
| TODO 저장 | 본문과 체크리스트를 여러 요청으로 저장해 중간 실패 시 일부만 반영 | 한 PATCH·트랜잭션으로 저장, 상세 응답 재사용 |
| 감사 로그 | 티켓·일정 멤버 변경 전후가 부족하고 no-op 로그가 쌓임 | 관계 값의 이전·이후 기록, updatedAt만 바뀐 diff 제외 |
| 백업 | WAL 커밋이 DB 원본 다운로드에 빠짐, 자동·수동 구현 중복 | 공통 VACUUM INTO 스냅샷, 생성·스트림·스케줄 분리, 취소·실패 정리 |
| 요청 보호 | 다른 사이트의 쓰기 요청·큰 JSON·잘못된 JSON 처리 부족 | 출처 검사, JSON 타입·256 KiB 실제 바이트 제한, 표준 오류 |
| UI 피드백 | 로딩·오류·빈 결과 혼동, 취소·중복 요청·접근성 부족 | 오류 재시도, AbortSignal, 처리 중 차단, 키보드·라벨·보조 버튼 보완 |
| 문서·환경 | 오래된 If-Match·Postgres 설명, 완료 이력 중복, 환경 파일 추적 | 현재 기능·규칙·운영·계획으로 정리, 예시 환경 파일 제공 |

성능 개선은 응용 프로세스로 읽어 오는 목록 행과 응답 크기를 제한합니다. 모든 쿼리가 인덱스만 사용하거나 일정한 실행 시간이라는 의미는 아닙니다. 실서비스 데이터 규모에서의 부하·쿼리 계획 측정은 후속 작업입니다.

## 의존성 점검

`npm audit` 기준 영향 패키지 수는 최초 45개에서 1차 개선 후 5개, Node 22·안정 모듈 전환 후 4개로 줄었습니다. 현재 production 의존성의 감사 항목은 0개입니다. 같은 원인이 상위 패키지에도 집계되므로 이 숫자는 독립 취약점 수와 같지 않습니다.

- Drizzle ORM은 SQL 식별자 escaping 수정이 포함된 0.45.3으로 업데이트했습니다.
- PostCSS 8.5.28을 앱과 Next.js 내부 의존성에 동일하게 적용했습니다.
- WebSocket·glob 관련 패키지·YAML·selector parser·browser mapping 등 호환 범위의 하위 패키지를 갱신했습니다.
- Next.js 16.3.8·React 19.3.0·Tailwind 4.3.3·Zod 4.6.5·libSQL 0.18.0 등 정식 안정 릴리스로 전환했습니다. 직접 의존성은 고정하고 오래된 minimatch override는 제거했습니다.

남은 4개는 Drizzle CLI의 오래된 esbuild에 연결된 moderate 등급입니다. Next.js의 critical 항목은 현재 감사 결과에서 해소됐습니다. Drizzle CLI의 개발 서버 기능은 사용하지 않지만 도구 의존성 위험은 남겨 둡니다. CLI를 외부에 노출하지 않습니다.

초기 개선에서는 Node 16 제약을 유지했고 Next.js 13의 critical 항목과 일부 engine 경고가 남았습니다. 이후 사용자가 런타임 변경을 승인하고 Node 22 LTS를 지정해 현재 기준을 22.23.3으로 바꿨습니다. TypeScript 6 선택과 ESLint 10 플러그인 전환 근거는 [의존성 가이드](DEPENDENCIES.md)에 기록합니다. 사용하지 않는 이미지 optimizer는 계속 비활성화합니다.

근거: [Next.js 지원 정책](https://nextjs.org/support-policy), [Node.js 릴리스 정책](https://nodejs.org/en/about/previous-releases), [Drizzle 보안 공지](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9). 취약점 상태는 시간에 따라 달라지므로 배포 때 `npm audit`를 다시 실행합니다.

## 확인한 운영 제약

- 로그인·사용자별 권한은 구현하지 않았습니다. 내부망·VPN·조직 접근 제어가 필요합니다.
- 표시 이름·IP는 클라이언트/프록시 제공값으로 인증 증거가 아닙니다.
- 동시 편집은 마지막 저장 반영 정책이며 버전 조건 잠금은 없습니다.
- same-origin 검사와 JSON 제한은 인증·프록시 rate limiting을 대체하지 않습니다.
- 칸반·간트·월 집계는 전체 목록을 순회합니다. 대량 데이터에는 집계 API·가상화를 고려합니다.
- 자동 백업은 프로세스 단위입니다. 다중 프로세스 운영 시 스케줄러 실행 주체를 정해야 합니다.
- 페이지당 최대 200, 자식 배열 최대 1000, JSON 최대 256 KiB입니다. 한도를 넘는 기존 대형 입력은 분할하거나 별도 기능으로 처리해야 합니다.

## 재현 가능한 검증

```bash
npm run typecheck
npm run lint
npm run test:lint
npm test
npm run test:integration
npm audit
```

단위 검사는 날짜·잘못된 필터·자식 중복·cursor SQL 파라미터·NULL 정렬·기존 cursor 호환·감사 diff·Origin/Referer와 TLS 프록시·프론트 전페이지 조회와 취소를 포함합니다. 실제 임시 SQLite를 이용해 WAL·백업 충돌·DB 실제 경로 보존을 확인하며, 다운로드 완료·취소·읽기·응답 생성·정리 실패도 검사합니다.

통합 검사는 빈 템플릿을 복제한 임시 DB와 프로덕션 빌드에서 실제 HTTP로 주요 페이지, 최신 DB 건수, 한쪽 날짜 수정 거부, 관계 감사 기록, 50건을 넘는 목록 순회, TODO rollback, 출처·본문 제한, WAL을 포함한 스냅샷 복구와 파일 다운로드를 확인합니다. 개발·운영 DB는 사용하지 않습니다.

1차 리팩토링 때인 2026-10-02, Node 16.20.2에서 다음 검증을 완료했습니다. 이 결과는 아래 Node 22 전환의 검증과 구분합니다.

- TypeScript와 ESLint 검사 통과(경고·오류 없음).
- backend·backup·file-download·frontend·security 단위 검사 5개 파일 통과.
- 별도 DB의 프로덕션 빌드와 HTTP 통합 검사 통과. Content-Length 없이 보낸 256 KiB 초과 요청도 413으로 응답합니다. Next.js 요청 스트림을 취소하면 응답 전에 교착·연결 종료가 발생하는 문제를 재현해 제거했습니다.
- 새 임시 디렉터리에서 Node 16.20.2·npm 8.19.4의 `npm ci` 완료, lockfile 및 PostCSS override 적용 확인(위 engine 경고 유지).
- 브라우저에서 작업 65건의 테이블 50/15 페이지, 칸반 대기 22·진행 22·홀딩 21, 검색 후 첫 페이지 복귀, Enter로 상세 열기를 확인했습니다.
- 할 일의 담당자 선택 시 미제출, 본문·기존/신규 체크리스트 동시 저장과 목록 반영을 확인했습니다.
- 홈의 전체 65건, 캘린더의 이관/미완료 할 일 65건, 빠른 월 이동 뒤 최신 월 반영을 확인했습니다. 해당 브라우저 세션의 console 오류·경고는 없었습니다.

UI 검사는 별도 DB의 데스크톱 화면에서 수행했습니다. 실제 서비스 부하, 다중 프로세스 백업, 모든 모바일 화면·드래그·스크린리더 조합의 검증을 대신하지 않습니다.

## Node 22·안정 모듈 전환 검증

같은 날 Node 22.23.3·Next 16.3.8·React 19.3.0·Tailwind 4.3.3 기준으로 다시 확인했습니다.

- 최초 Node 22 전환 시 npm 10.9.9의 새 임시 설치에서 `npm ci` 완료. 당시 ESLint 9 지원 종료 경고는 이후 아래 ESLint 10 전환으로 해소했습니다. Drizzle loader의 deprecated 안내는 남습니다.
- TypeScript 6.0.3 타입 검사, flat config ESLint 검사, 단위 검사 5개 모듈 통과.
- Turbopack의 프로덕션 빌드와 HTTP 통합 검사에서 동적 params, 최신 DB 건수, 날짜·감사·cursor, TODO rollback, 출처·큰 chunked 요청·일관된 백업 다운로드를 확인했습니다.
- Turbopack 격리를 위해 통합 검사 의존성은 외부 symlink 대신 별도 파일 복제로 구성합니다. 지원 파일시스템에서는 copy-on-write를 사용합니다.
- 런타임 DB 경로를 빌드 파일 추적에서 제외하고 Tailwind 설정을 CJS로 명시해 관련 빌드 경고를 정리했습니다.
- 별도 DB의 브라우저에서 라이트/다크, Input 포커스, 중앙 Dialog·Sheet, 담당자·날짜 Popover, 기존/신규 체크리스트 동시 저장, 토스트, 저장 뒤 dirty 상태 해제를 확인했습니다. 작업 목록에 홀딩을 포함한 3개 상태도 표시됐습니다. console 오류·경고는 없었습니다.

자세한 버전 선택·브라우저 요구 사항·남은 개발 의존성 제한은 [의존성 가이드](DEPENDENCIES.md)를 따릅니다.

## ESLint 10 전환 검증

기존 React·import·접근성 플러그인은 이미 최신 정식 버전이었지만 ESLint 10 peer를 허용하지 않았습니다. Next 공개 플러그인을 직접 구성하고 지원되는 React·import-x·a11y-x 정식 배포본으로 교체했습니다. 앱 동작 코드는 변경하지 않았습니다.

- Node 22.23.3·npm 10.9.9의 새 임시 폴더에서 `npm ci --strict-peer-deps` 완료. 최종 `npm ls --all`에도 peer 충돌이 없습니다. 설치 안내는 기존 Drizzle loader 2개만 남으며 ESLint 지원 종료 경고는 없어졌습니다.
- ESLint 10.11.0 lint, TypeScript 6.0.3 타입 검사, 단위 검사 5개 모듈 통과.
- `test:lint`: 오류 코드 22개 검출, 정상 코드 7개 허용, TypeScript 오류 코드 3개 확인. Next·Hooks·접근성 규칙의 기존 심각도·옵션도 이전 설정과 비교했습니다.
- 분리된 DB의 프로덕션 빌드와 HTTP 통합 검사도 통과했습니다. production audit는 0개, 개발용 Drizzle CLI의 moderate 영향 패키지 4개는 이전과 같습니다.
- 기존과 달라진 React 규칙 대응·한계는 [의존성 가이드](DEPENDENCIES.md)에 명시합니다.
