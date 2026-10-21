import { defineConfig, globalIgnores } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
import react from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import { importX } from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([".next/**", "out/**", "build/**", "output/playwright/**", "next-env.d.ts"]),
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "@next/next": nextPlugin,
      "@eslint-react": react,
      "react-hooks": reactHooks,
      "import-x": importX,
      "jsx-a11y-x": jsxA11y,
    },
    settings: react.configs.all.settings,
    rules: {
      // Compose the supported plugins directly; eslint-config-next still bundles
      // React/import/a11y packages whose published peers stop at ESLint 9.
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      "@eslint-react/no-missing-component-display-name": "error",
      "@eslint-react/no-missing-key": "error",
      "@eslint-react/jsx-no-comment-textnodes": "error",
      "@eslint-react/jsx-no-children-prop": "error",
      "@eslint-react/dom-no-dangerously-set-innerhtml-with-children": "error",
      "@eslint-react/no-direct-mutation-state": "error",
      "@eslint-react/no-component-will-mount": "error",
      "@eslint-react/no-component-will-receive-props": "error",
      "@eslint-react/no-component-will-update": "error",
      "@eslint-react/dom-no-find-dom-node": "error",
      "@eslint-react/dom-no-render": "error",
      "@eslint-react/dom-no-hydrate": "error",
      "@eslint-react/dom-no-render-return-value": "error",
      "no-undef": "error",
      // Keep legacy JSX safeguards without an unsupported plugin or custom rule.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXText[raw=/['\">}]/]",
          message: "Escape quotes, apostrophes, >, and } in JSX text with entities or expressions.",
        },
        {
          selector: "JSXAttribute[name.name='ref'] > Literal[raw=/^[\"']/], JSXAttribute[name.name='ref'] > JSXExpressionContainer > Literal[raw=/^[\"']/]",
          message: "Use a callback or ref object instead of a string ref.",
        },
        {
          selector: "CallExpression[callee.object.type='ThisExpression'][callee.property.name='isMounted']",
          message: "Do not call the obsolete isMounted API.",
        },
        {
          selector: "UpdateExpression:has(MemberExpression[object.type='ThisExpression'][property.name='state'])",
          message: "Use setState instead of in-place updates involving this.state.",
        },
        {
          selector: "CallExpression[arguments.length>=3]:matches([callee.name='createElement'], [callee.property.name='createElement']) > ObjectExpression.arguments:nth-child(2) > Property:matches([key.name='dangerouslySetInnerHTML'], [key.value='dangerouslySetInnerHTML'])",
          message: "Do not combine dangerouslySetInnerHTML with createElement children.",
        },
        {
          selector: "CallExpression:matches([callee.name='createElement'], [callee.property.name='createElement']) > ObjectExpression.arguments:nth-child(2):has(Property:matches([key.name='children'], [key.value='children'])) > Property:matches([key.name='dangerouslySetInnerHTML'], [key.value='dangerouslySetInnerHTML'])",
          message: "Do not combine dangerouslySetInnerHTML with children in createElement props.",
        },
      ],
      "import-x/no-anonymous-default-export": "warn",
      "jsx-a11y-x/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y-x/aria-props": "warn",
      "jsx-a11y-x/aria-proptypes": "warn",
      "jsx-a11y-x/aria-unsupported-elements": "warn",
      "jsx-a11y-x/role-has-required-aria-props": "warn",
      "jsx-a11y-x/role-supports-aria-props": "warn",
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: { parser: tseslint.parser },
    // TypeScript checks undefined JSX names and duplicate props. ESLint's core
    // no-undef does not understand TypeScript's type-only declarations.
    rules: { "no-undef": "off" },
  },
  {
    files: ["**/*.{jsx,tsx}"],
    // Named exports preserve component names, including default memo wrappers.
    rules: { "import-x/no-anonymous-default-export": ["error", { allowCallExpression: false }] },
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/client/**/*.{ts,tsx}"],
    // React Compiler is disabled. Effects synchronize hydration, form resets,
    // and request progress; the other Hooks checks remain enabled.
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
]);
