import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Transitional debt controls: keep lint deterministic while legacy `any` and
      // CommonJS/Next test compatibility debt are burned down incrementally.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@next/next/no-assign-module-variable": "off",
      "react/no-unescaped-entities": "off",
      "prefer-const": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Repository-local generated/build artifacts:
    "landing/.next/**",
    "generated/**",
    "artifacts/**",
  ]),
]);

export default eslintConfig;
