# 의존성·런타임 기준

2026-10-02 기준 npm registry의 정식 릴리스를 확인했습니다. beta·rc·canary는 사용하지 않습니다. 직접 의존성은 버전을 고정하고 전이 의존성은 `package-lock.json`으로 재현합니다.

## 주요 버전

| 항목 | 적용 버전 |
|---|---|
| Node.js | 22.23.3 LTS (`.nvmrc`, 22 계열만 허용) |
| Next.js / @next/eslint-plugin-next | 16.3.8 |
| React / React DOM / React 타입 | 19.3.0 |
| Tailwind CSS / PostCSS 플러그인 | 4.3.3 |
| tailwind-merge | 3.7.0 |
| TypeScript | 6.0.3 |
| ESLint | 10.11.0 |
| libSQL client | 0.18.0 |
| Drizzle ORM / Kit | 0.45.3 / 0.31.11 |
| Zod | 4.6.5 |
| CUID2 / cron | 3.3.0 / 4.6.0 |

Radix UI, Lucide, next-themes, CVA, clsx도 정식 최신 버전으로 갱신했습니다. dnd-kit·tailwindcss-animate·Drizzle ORM·PostCSS는 이미 최신 정식 버전이었습니다. 전체 목록은 [package.json](../package.json)을 기준으로 합니다. Node 타입은 런타임과 같은 22 계열입니다.

## 호환성 결정

- **Next 16:** Route Handler의 params를 Promise+await로 변경했습니다. native SQLite와 cron은 `serverExternalPackages`에 지정해 정적 import하며, 옛 instrumentation 플래그를 제거했습니다. 개발·빌드는 기본 Turbopack을 사용합니다.
- **React 19 / Tailwind 4:** public 타입·ref·외부 store 구독을 보완했습니다. PostCSS는 `@tailwindcss/postcss`로 전환하고 HSL 토큰·컨테이너·반경·포커스 스타일을 보존했습니다. 별도 autoprefixer와 오래된 cron 타입 패키지는 제거했습니다.
- **TypeScript 6:** 최신 7의 JavaScript compiler API 제거와 typescript-eslint의 `<6.1.0` 지원 범위 때문에 호환되는 6 계열의 최신 패치를 사용합니다. Next의 native compiler CLI 통합도 아직 experimental이므로 빌드에서 기존 API 방식을 지정합니다.
- **ESLint 10:** Next의 공개 플러그인을 직접 구성하고, React·import·접근성 검사는 ESLint 10을 지원하는 정식 배포 패키지로 전환했습니다. `eslint-config-next`와 지원 종료된 ESLint 9를 제거했습니다. 아래 규칙 대응과 `test:lint`를 함께 유지합니다.
- **React Compiler 규칙:** Compiler는 활성화하지 않습니다. 기존 hydration·폼 초기화·요청 진행 효과를 허용하도록 `set-state-in-effect` 규칙만 클라이언트 범위에서 해제합니다. Hooks 순서·의존성·refs·purity 규칙은 유지하며 실제 위반은 코드로 교정했습니다.

근거: [Next 16 전환](https://nextjs.org/docs/app/guides/upgrading/version-16), [TypeScript 7 안내](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [typescript-eslint 지원 범위](https://typescript-eslint.io/users/dependency-versions/), [Tailwind 4 전환](https://tailwindcss.com/docs/upgrade-guide). 플러그인의 peer 범위는 설치 시점 npm registry와 lockfile에서도 확인합니다.

Tailwind 4의 브라우저 기준은 Safari 16.4+, Chrome/Edge 111+, Firefox 128+입니다. 사내 브라우저도 이 기준을 확인하세요.

## ESLint 10 구성

기존 세 플러그인의 `package.json`에 있는 `peerDependencies.eslint`가 10을 허용하지 않았습니다. 2026-10-02 npm `latest` 확인 결과 이미 각각 최신 정식 버전이었으므로 같은 패키지의 버전을 올리는 것만으로 해결되지 않습니다. import 플러그인의 저장소에는 10 지원이 반영됐지만 아직 `Unreleased`입니다. `--force`, `--legacy-peer-deps`, peer override 없이 아래 정식 배포본으로 전환했습니다.

| 기존 패키지 | 현재 패키지·버전 |
|---|---|
| eslint-plugin-react 7.37.5 | @eslint-react/eslint-plugin 5.23.3 |
| eslint-plugin-import 2.32.0 | eslint-plugin-import-x 4.17.1 |
| eslint-plugin-jsx-a11y 6.10.2 | eslint-plugin-jsx-a11y-x 0.2.0 |
| eslint-config-next 16.3.8 | @next/eslint-plugin-next 16.3.8 직접 구성 |

React Hooks 7.1.1, typescript-eslint 8.71.0, globals 17.13.0도 직접 의존성으로 고정했습니다. Node 22.23.3은 ESLint 10과 새 React 플러그인의 실행 기준을 충족합니다. a11y-x는 0.x 정식 배포본이므로 다음 업데이트에서도 고정 버전·변경 내역·검증을 확인합니다.

[eslint.config.mjs](../eslint.config.mjs)는 새 recommended preset을 통째로 추가하지 않고 기존 검사 목적을 명시적으로 구성합니다. Next Core Web Vitals 22개와 Hooks 규칙·클라이언트 예외, 접근성 6개의 심각도와 옵션은 보존합니다. 사용하지 않는 import resolver도 제거했습니다. CJS 운영·검사 스크립트까지 lint 범위를 넓혔습니다.

| 기존 React 검사 | 현재 대응 |
|---|---|
| display-name | 새 display-name 검사 + JSX 파일의 익명 default export 금지 |
| jsx-key / jsx-no-comment-textnodes / no-children-prop | 대응하는 새 React 규칙 |
| jsx-no-duplicate-props / jsx-no-undef | TypeScript 검사; JS의 미정의 이름은 ESLint `no-undef` |
| jsx-uses-react / jsx-uses-vars | 현대 JSX runtime과 ESLint 10의 JSX 참조 추적 |
| no-danger-with-children | 새 DOM 규칙 + inline createElement props의 HTML·children 충돌 금지 |
| no-deprecated | lifecycle·DOM render/hydrate 규칙 + React 19 타입 검사 |
| no-direct-mutation-state / no-is-mounted | 새 상태 변경 규칙 + 상태 증감·isMounted 호출의 core 검사 |
| no-find-dom-node / no-render-return-value | 대응하는 새 DOM 규칙 |
| no-string-refs / no-unescaped-entities | `no-restricted-syntax`로 문자열 ref·이스케이프 누락 검사 |
| require-render-return | TypeScript의 React Component 반환 타입 검사 |

검사 구현이 완전히 같지는 않습니다. JSX 파일의 익명 default export와 `this.state`가 포함된 증감식은 더 엄격하게 금지합니다. createElement의 core 보완은 inline props 대상이며 변수·spread를 통한 동적 props는 같은 수준의 추적을 보장하지 않습니다. 타입 검사를 우회한 `any`도 검사 한계가 있으므로 클래스 컴포넌트·createElement를 새로 도입할 때 해당 사례를 검증합니다. 현재 앱은 TSX 함수 컴포넌트로 구성되어 있습니다.

`npm run lint`와 `npm run typecheck`를 함께 실행합니다. [test-lint.cjs](../scripts/test-lint.cjs)의 `npm run test:lint`는 잘못된 Hooks·Next·React·ARIA·ref·JSX 코드가 실제 검출되는지, 정상 코드가 허용되는지, TypeScript가 중복 props·미정의 JSX·반환 없는 render를 검출하는지 확인합니다.

근거: [Next 플러그인 직접 구성](https://nextjs.org/docs/app/api-reference/config/eslint#using-the-plugin-directly), [ESLint 10 전환과 JSX 추적](https://eslint.org/docs/latest/use/migrate-to-10.0.0), [ESLint React](https://github.com/Rel1cx/eslint-react), [import-x](https://github.com/un-ts/eslint-plugin-import-x), [a11y-x 전환](https://github.com/es-tooling/eslint-plugin-jsx-a11y-x), [기존 import의 미배포 변경](https://github.com/import-js/eslint-plugin-import/blob/main/CHANGELOG.md#unreleased).

## 보안과 업데이트 절차

업데이트 후 `npm audit`는 production 의존성 0개, 전체에서는 Drizzle CLI의 esbuild 계열 moderate 영향 패키지 4개를 보고합니다. CLI Studio 서버는 사용하지 않습니다. 이는 인증·네트워크 접근 제어의 안전성을 보증하는 결과가 아닙니다.

1. `.nvmrc`의 Node 22 버전을 적용하고 `npm ci`로 설치합니다.
2. beta·rc 태그를 제외하고 엔진·peer·변경 사항을 확인합니다.
3. 타입·lint·`test:lint`·단위·임시 DB 통합 검사를 실행합니다.
4. UI 라이브러리 변경은 라이트/다크·폼·팝오버·저장을 브라우저에서 확인합니다.
5. audit 결과와 남은 제약을 갱신하고 배포 호스트의 Node도 같은 기준으로 맞춥니다.

이번 업그레이드는 DB 스키마를 변경하지 않습니다. 기존 DB를 새 템플릿으로 덮어쓰지 않습니다.
