import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // React Compiler is not enabled. Existing client-side fetch loading states
      // and dialog drafts intentionally synchronize with external data in effects.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([".next/**", ".claude/**", ".codex/**", "out/**", "build/**", "next-env.d.ts"]),
]);
