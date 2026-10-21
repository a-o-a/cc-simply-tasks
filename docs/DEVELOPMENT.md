# 개발 가이드

현재 코드를 기준으로 한 구현 규칙입니다. 기능·실행 방법은 [README](../README.md), 배포·복구는 [운영 가이드](OPERATIONS.md)를 참고합니다.

## 수정 진입점

페이지는 `app/*/page.tsx`, 화면 상태와 동작은 `components/<feature>`, HTTP 계약은 `app/api/<resource>`, DB 정의는 `lib/db/schema.ts`에 둡니다. 브라우저 타입은 `lib/client/types.ts`에 따로 정의합니다. 필드를 추가할 때 스키마·검증·응답 타입·폼 payload·표시를 함께 확인합니다.

Node 22 LTS와 Next.js 16을 기준으로 합니다. 동적 Route Handler의 `params`는 Promise이며 핸들러 안에서 먼저 `await`합니다. 버전별 변경은 설치된 `node_modules/next/dist/docs/`와 [의존성 가이드](DEPENDENCIES.md)를 확인합니다.

관계가 반복되는 조회는 `lib/db/queries.ts`로 모읍니다. API별 정렬·필터는 해당 라우트에서 명시합니다. 단순 차이를 숨기기 위한 범용 CRUD 프레임워크는 도입하지 않습니다.

## API 공통 흐름

1. `withErrorHandler`로 라우트를 감쌉니다. 이 단계에서 브라우저 변경 요청의 출처를 검사합니다.
2. DB 접근 전 `await ensureSqlitePragma()`를 호출합니다.
3. 본문은 `await readJsonBody(req)`, 쿼리는 Zod로 파싱합니다.
4. 쓰기는 `getActorContext(req)`로 액터를 읽고 `await db.transaction(...)` 안에서 수행합니다.
5. 기존 행을 읽고 입력을 병합한 최종 상태를 검증합니다.
6. 쓰기 쿼리와 `withAudit(tx, ...)`를 같은 트랜잭션에서 모두 `await`합니다.
7. 응답 형식에 맞춰 `NextResponse`를 반환합니다.

직접 DB 파일을 읽거나 예외 메시지·서버 절대경로를 클라이언트로 반환하지 않습니다. Next.js의 동적 렌더링 제어 예외는 일반 500으로 변환하지 않습니다.

프레임워크를 사용하지 않는 공통 모듈은 `lib/errors.ts`의 오류 타입을 사용합니다. 백업 스냅샷·파일 스트림·스케줄러를 별도 모듈로 유지하며 Route Handler에서 스트림과 응답을 연결합니다. 다운로드의 파일 핸들과 임시 디렉터리는 완료·취소·실패 모두에서 정리합니다.

## 응답과 오류

| 동작 | 응답 |
|---|---|
| 목록 | `200 { items, nextCursor }` 또는 페이지가 없는 `{ items }` |
| 상세·수정 | `200 row` |
| 생성 | `201 row` |
| 삭제 | `204` |

오류는 `{ error: { code, message, details? } }`입니다. `VALIDATION_ERROR`/`BAD_REQUEST`는 400, `FORBIDDEN`은 403, `NOT_FOUND`는 404, `CONFLICT`는 409, `PAYLOAD_TOO_LARGE`는 413, `INTERNAL`은 500입니다. 업무 오류는 `HttpError`, 필드 검증은 Zod를 사용합니다.

JSON 요청은 `application/json` 또는 `application/*+json`, 최대 256 KiB입니다. 실제 스트림 바이트도 제한하므로 Content-Length를 신뢰하지 않습니다. 티켓·체크리스트·멤버 배열의 항목 제한은 `MAX_CHILD_ITEMS`로 관리합니다.

## 조회·페이지네이션·캐시

실시간 DB 데이터를 반환하는 API는 `dynamic = "force-dynamic"`, `revalidate = 0`으로 정적 생성을 막습니다. 클라이언트의 `cache: "no-store"`만으로 서버 라우트 캐시를 해제할 수 없습니다.

목록은 기본 50, 최대 200건입니다. `createCursorPagination()`에서 정렬 키와 방향을 정의하고 같은 키를 쿼리 `orderBy`와 cursor 조건에 사용합니다. 항상 ID를 마지막 tie-breaker로 포함합니다.

- SQL에 cursor 조건과 `limit(take + 1)`을 적용합니다.
- 관계 하이드레이션은 반환할 페이지에만 수행합니다.
- 다음 cursor는 정렬값을 포함하는 `page:` 토큰입니다. 프론트는 내용을 해석하지 않습니다.
- 날짜의 NULL 정렬, 같은 timestamp, 삭제된 마지막 행을 고려합니다.
- 이전 버전의 ID cursor를 지원하지만 새 응답은 정렬값 cursor를 반환합니다.
- 필터·정렬이 바뀌면 클라이언트 페이지를 초기화합니다.

전체 집계가 필요할 때는 전용 count API를 우선 사용합니다. 전체 목록이 필요한 칸반·간트·월 집계는 `getAllPages`로 제한된 페이지를 순회하고 요청 취소와 반복 cursor 방어를 적용합니다. 거대한 단일 pageSize를 사용하지 않습니다.

## 트랜잭션과 감사 로그

주요 엔티티 삭제는 `deletedAt` 갱신입니다. 목록·상세는 삭제된 행을 제외합니다. 연결 테이블 재구성은 트랜잭션 안에서 처리합니다.

`withAudit`는 CREATE/UPDATE/DELETE/RESTORE의 이전·이후 변경값을 기록합니다. `updatedAt`만 바뀐 저장은 로그를 만들지 않습니다. 부모의 관계 변경도 before/after에 의미 있는 값이 있어야 합니다.

- 작업의 `tickets` 입력은 기존 티켓을 대체합니다. 부모 감사 diff에는 정렬된 시스템·티켓번호 목록을 넣습니다.
- 일정의 `memberIds` 변경은 이전·이후 멤버 ID를 기록합니다.
- TODO PATCH의 `checklist` 생략은 기존 목록 유지, `[]`는 전체 삭제, 배열은 전체 동기화입니다.
- checklist의 기존 항목은 `id`를 보내고 새 항목은 생략합니다. 다른 TODO에 속한 ID는 거부합니다.
- TODO 본문과 자식 변경은 한 번의 PATCH와 같은 트랜잭션으로 저장하고 상세 응답을 반환합니다. 기존 개별 checklist API도 유지합니다.
- 새 담당자·일정 참여자의 활성 여부는 `lib/db/member-validation.ts`로 같은 트랜잭션 안에서 검사합니다. 없는/삭제된 팀원은 필드 오류가 포함된 400 응답입니다. 기존 삭제 팀원의 연결을 유지하는 저장은 허용하며, 연결을 해제한 뒤 다시 지정하는 것은 허용하지 않습니다.

현재 `updatedAt`은 버전 비교용 잠금이 아닙니다. `If-Match` 자동 처리나 409 동시 편집 보호가 있다고 가정하지 않습니다.

## 날짜와 코드

DB 시간 컬럼은 UTC epoch 밀리초를 Drizzle `Date`로 다룹니다. 표시·날짜 입력은 KST 규칙을 `lib/time.ts`, `lib/client/format.ts`, validation에 모읍니다.

- 작업 시작·종료는 같은 날짜를 허용합니다.
- 일정 종료 시간은 시작 시간보다 뒤여야 합니다.
- 한쪽 날짜만 PATCH해도 기존 행과 병합한 전체 범위를 다시 검사합니다.
- 종일 일정은 종료일 다음 날을 제외하는 `[start, end)` 구간입니다.
- YYYY-MM-DD는 실제 존재하는 날짜인지 검사합니다.
- enum은 `lib/enums.ts`, 동적 분류·시스템은 코드 사전입니다. 사전 연결은 현재 문자열이며 DB 외래키가 아닙니다.

## UI와 접근성

수직 라벨과 입력칸은 `app/globals.css`의 `form-field` utility를 사용해 **5px** 간격으로 배치합니다. 인라인 `Label`에 `space-y-*`를 섞으면 실제 간격이 달라지므로 필드 wrapper에 `form-field`를 지정합니다. 검색 필터도 같은 기준입니다. 다열 폼은 가로 12px·세로 16px(`gap-x-3 gap-y-4`), 버튼 사이는 8px을 사용합니다. 체크박스 옆 라벨과 목록 행은 각각의 가로/밀집 배치를 유지합니다.

사용자 수정 성공 후 `emitWorkItemsChanged()` 또는 `emitTodosChanged()`를 호출합니다. 구독·focus·visibilitychange에서 재조회가 필요한 데이터를 새로 읽습니다. 일정은 SSE도 사용합니다.

요청은 가능한 한 AbortSignal을 전달하고 오래된 응답이 최신 필터 상태를 덮지 않도록 합니다. 취소는 오류 토스트로 표시하지 않습니다. 로딩·빈 결과·실패를 구분하며 실패 시 재시도 동작을 제공합니다.

아이콘 버튼에는 이름을 지정하고 폼 안의 보조 버튼은 `type="button"`을 사용합니다. 저장·삭제의 중복 실행을 막고 처리 중 상태를 알립니다.

모바일 셸은 `h-dvh`와 상단 메뉴를 사용합니다. 화면 전체의 최소 폭을 강제하지 않고, 테이블·월력 등 큰 보기의 내부 영역에서만 가로 스크롤합니다. 긴 편집 폼은 일반 `div`에 스크롤을 두고, 내부 `fieldset`은 비활성화만 담당합니다. Chromium의 fieldset 스크롤 문제를 피하기 위한 구조입니다.

달력의 `eventDayKeys(event, range)`는 표시 범위와 교집합인 날짜만 계산합니다. 월력은 42일 범위, 간트 휴일은 KST 기준 표시 기간을 전달합니다. 전체 일정 기간으로 매번 확장하지 않습니다. `node scripts/benchmark-calendar.cjs current`로 동일 조건의 날짜 계산만 측정할 수 있습니다.

저장 요청이 끝난 뒤 목록을 재조회할 때는 최신 필터의 콜백을 사용합니다. 작업·할 일은 `latestLoadItems` ref로 저장 중 변경된 검색 조건을 보존합니다. 모바일·날짜·폼 스크롤·이 경합의 브라우저 회귀 실행 방법은 [출시 검수 기록](RELEASE_REVIEW.md)을 참고하세요.

## 검증과 스키마 변경

```bash
npm run typecheck
npm run lint
npm run test:lint
npm test
npm run test:integration
```

`npm test`는 TypeScript CLI로 테스트를 임시 폴더에 컴파일해 Node assert로 실행합니다. 컴파일에는 NodeNext 해석을 사용하며 Node 22의 fetch·Web Streams를 사용합니다. 테스트와 순수 helper import는 상대경로를 사용합니다. 각 테스트 파일은 실행 함수 `run*`을 export해야 합니다. 추가 테스트 프레임워크는 필요하지 않습니다.

통합 검사는 임시 DB로 실제 프로덕션 빌드·HTTP 요청을 실행합니다. 커서 조회, 최신 DB 건수, 부분 날짜 수정, 관계 감사 로그, TODO 원자적 저장과 rollback, 요청 보호, 백업 무결성을 검사합니다.

### 대량 샘플 데이터

`scripts/seed-demo.cjs`는 2026-10-21 기준의 검수 샘플을 정상 HTTP API로 생성합니다. 작업 2,000건(활성 1,320·이관 완료 680), 팀원 12명·분류 6개·시스템 8개, 별도로 TODO 60건과 일정 36건을 구성합니다. 업무 날짜는 과거/현재/예정으로 분산하지만 생성·수정 시각은 실제 API 실행 시각입니다.

Node 22에서 아래 형식으로 실행합니다. **같은 DB를 사용하는 localhost 서버가 먼저 실행 중이어야 합니다.** `--db`에는 실재하는 임시 검수 DB를 지정하며 스크립트는 `/private/tmp/cc-build-size-*/db/qa.db` 경로만 허용합니다. 운영·개발 DB용 명령이 아닙니다.

```bash
node scripts/seed-demo.cjs --url http://127.0.0.1:3036 \
  --db /private/tmp/cc-build-size-XXXXXX/db/qa.db --confirm-demo-data
```

`DEMO-20261021-` 요청번호와 TODO/일정 메모의 샘플 표식으로 재실행 중복을 피합니다. 기존 레코드는 수정·삭제하지 않으며, API 전 페이지·고유 ID·관계·날짜·감사 로그·SQLite 무결성과 기존 행 보존을 검사합니다. 결과는 Git에서 제외된 `output/playwright/seed-data-summary.json`에 기록됩니다.

스키마 변경은 `lib/db/schema.ts` → migration 생성·검토 → 임시 DB 적용·검증 → 운영 적용 계획 순서입니다. migration을 추가했다면 `db/dev.db.clean`도 같은 기준으로 다시 생성합니다. 이번 유지보수 변경은 스키마 migration이 필요하지 않습니다.
