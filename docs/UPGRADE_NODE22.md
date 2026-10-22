# Node 22 및 라이브러리 업그레이드

기준일: 2026-10-15. 출발 커밋: `cffac9f`.

## 적용 버전

| 항목 | 이전 | 변경 후 |
|---|---|---|
| Node.js | `>=16.14 <17` | `>=22.13.0`, `.nvmrc`: `22` |
| Next.js | 13.5.11 | 16.4.1 |
| React / React DOM | 18.2.0 | 19.3.1 |
| TypeScript | 5.2.2 | 6.0.3 |
| ESLint / Next 설정 | 8.57.0 / 13.5.11 | 9.39.5 / 16.4.1 |
| Tailwind CSS | 3.4.19 | 4.3.3 |
| Zod | 3.23.8 | 4.6.7 |
| Drizzle ORM / Kit | 0.44.5 / 0.31.4 지정 | 0.45.4 / 0.31.11 |
| libsql client | 0.15.15 지정 | 0.18.0 |
| node-cron | 4.2.1 지정 | 4.6.0 |
| next-themes | 0.2.1 | 0.4.6 |
| lucide-react | 0.344.0 | 1.57.0 |
| tailwind-merge | 2.2.1 | 3.7.0 |

Radix, cuid2, React/Node 타입 정의 및 나머지 직접 의존성도 호환 버전으로 갱신하고 정확한 버전을 지정했습니다. 이미 최신인 dnd-kit 패키지는 유지했습니다. 설치 재현 기준은 `package-lock.json`입니다.

- Node 22.13.0 최소값은 설치된 개발 도구의 `eslint-visitor-keys` 등 엔진 요구사항을 반영합니다. `.npmrc`의 `engine-strict=true`로 미지원 런타임 설치를 차단합니다.
- TypeScript 7.0은 컴파일러 API를 제공하지 않아 현재 typescript-eslint와 직접 호환되지 않습니다. 별도 컴파일러를 이중 설치하는 대신 6.0.3을 사용합니다. [TypeScript 공식 설명](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0)
- ESLint 10은 현재 Next 설정이 사용하는 import/react/jsx-a11y 플러그인의 peer 범위 밖입니다. 9.39.5를 고정했으며, ESLint 9의 지원 종료 경고는 남습니다. 플러그인 호환 범위가 갱신되면 함께 올려야 합니다.

## 코드 대응

- 동적 API 9개 파일의 `params`를 Promise로 받고 `await`합니다. NextRequest의 제거된 `ip` 대신 프록시 전달 헤더를 읽습니다. 프록시가 해당 헤더를 덮어써야 하며 인증 용도로 사용하지 않습니다.
- Next의 실험적 instrumentation/서버 외부화 설정을 정식 설정으로 교체합니다. libsql의 `eval` 로딩을 표준 import로 바꿉니다.
- libsql 0.18이 추가로 여는 연결에도 잠금 대기 5초가 적용되도록 클라이언트의 `timeout`을 지정합니다. DB·백업·환경파일을 Next 배포 파일 추적에서 제외합니다.
- `next lint`를 ESLint CLI와 flat config로 교체하고 `next typegen`을 타입 검사에 포함합니다. React Compiler는 사용하지 않습니다. 기존 fetch 로딩·폼 초깃값 동기화를 유지하기 위해 `react-hooks/set-state-in-effect`만 비활성화하며 다른 Hook 규칙은 유지합니다.
- Zod 4의 날짜·URL·오류 API를 사용하면서 기존 `{ error: { code, message, details } }`와 `formErrors`/`fieldErrors` 형식을 유지합니다. Drizzle이 감싼 UNIQUE 오류도 원인 체인을 따라 409로 반환합니다.
- Tailwind 4 설정을 `app/globals.css`로 통합하고 `@tailwindcss/postcss`/`tw-animate-css`로 교체합니다. 기존 디자인 토큰과 둥글기·그림자·포커스 스타일을 보존합니다.
- next-themes의 공개 타입을 사용합니다. TODO의 렌더 중 ref 접근은 상태로 바꾸고, 날짜 초깃값과 Dialog/Drawer 접근성 설명을 정리합니다.
- 백업 다운로드는 `VACUUM INTO` 임시 스냅샷으로 전환해 WAL에 남은 커밋을 포함합니다. 자동/수동 백업은 공통 함수를 사용하며 cron의 프로세스 내 중복 등록과 실행 겹침을 방지합니다.

[Next 16 마이그레이션](https://nextjs.org/docs/app/guides/upgrading/version-16), [Zod 4 변경사항](https://zod.dev/v4/changelog), [Tailwind 4 마이그레이션](https://tailwindcss.com/docs/upgrade-guide)을 기준으로 적용했습니다.

## 검증

macOS arm64, Node **22.23.3**에서 확인했습니다. Node **24.21.0**에서도 동일한 API 스모크 155개 검사를 통과했습니다. 실제 사용자 DB 대신 임시 디렉터리의 DB와 별도 로컬 서버를 사용했습니다.

| 검사 | 결과 |
|---|---|
| `npm ci` | Node 22에서 lockfile 재설치 성공 |
| `npm run lint` | 오류·경고 없음 |
| `npm run typecheck` | 통과 |
| `npm run build` | Next 16 Turbopack 프로덕션 빌드 통과 |
| `npm run test:smoke` | 10개 시나리오, 155개 HTTP 검사 통과 |
| `npm run test:ui` | Chromium의 3개 시나리오 통과, console/pageerror 없음 |
| 빈 DB `db:migrate`와 재실행 | 2개 migration 적용, 재실행 시 중복 없음, integrity_check 정상 |
| `db:generate` | 스키마 변경 없음 |
| Next 배포 파일 추적 | 모든 서버 NFT에서 로컬 DB·백업·환경파일 제외 확인 |

API 검사는 7개 화면/JS 응답, 마스터 CRUD·복원, 작업·티켓·페이지네이션·일괄 상태·이관, TODO·체크리스트, 캘린더·SSE, 통계·감사로그, 입력 오류 및 백업의 최신 데이터·무결성·외래 키를 포함합니다. 8건 동시 생성·조회·감사로그 확인과 동시 삭제·집계 복원도 검증했습니다.

브라우저 검사는 이름 등록, 설정·멤버·코드 관리, 테마 전환·유지, 작업 생성·테이블/칸반/간트 보기, 날짜 선택, Drawer/Dialog 위치, TODO Enter 저장·한글 조합 중 제출 방지·빈 체크리스트 제외·수정, 종일 캘린더 일정 및 백업 다운로드를 포함합니다. 실제 마우스 드래그로 칸반 상태와 캘린더 날짜를 이동한 뒤 서버 저장값과 화면 위치도 확인했습니다.

재실행:

```bash
nvm use
npm ci
npm run check
npx playwright install chromium
npm run test:ui
```

`check`는 lint → typecheck → build → API smoke 순서입니다. 브라우저 설치가 필요한 UI 검사는 별도로 실행합니다. 테스트는 기존 서버나 DB URL을 받아 쓰지 않으며 자체 서버·DB를 만들고 정리합니다.

## 남은 제약

- 배포 의존성 `npm audit --omit=dev` 결과는 **0건**입니다. 전체 audit에는 개발 도구의 `braces` 의존 경로에서 **high 5건**이 남습니다. 직접 원인은 `braces` 1개이며 `micromatch → fast-glob → @next/eslint-plugin-next → eslint-config-next`로 영향이 전파되어 집계됩니다. 확인 당시 최신 `braces` 3.0.3에도 패치가 없으므로, 기능이 깨지는 Next 설정 다운그레이드는 적용하지 않았습니다. [해당 advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- Drizzle의 구형 개발 로더가 쓰는 esbuild는 `overrides`로 0.28.2를 지정하고 tsx도 호환 범위 최신으로 갱신했습니다. 해당 override는 상위 의존성에서 패치 버전을 지원하면 제거할 수 있습니다.
- Chromium 자동 검증 결과이며 Safari·Firefox·Windows에서의 직접 실행 검증은 수행하지 않았습니다. Tailwind 4 최소 브라우저 기준은 Safari 16.4+, Chrome 111+, Firefox 128+입니다.
- 서버의 `If-Match` 동시 수정 검증은 이번 작업 이전부터 구현되어 있지 않았습니다. 기존 문서의 구현 완료 주장을 정정했으며 이 업그레이드에서 새 충돌 제어 기능을 추가하지 않았습니다.
- 자동 백업 중복 방지는 한 프로세스 범위입니다. 다중 서버 운영 시 백업 실행 주체는 하나로 구성해야 합니다.

이번 변경은 DB 스키마를 바꾸지 않습니다. 배포 시 기존 영속 DB 경로를 유지하고 기본 템플릿으로 덮어쓰지 마세요.
