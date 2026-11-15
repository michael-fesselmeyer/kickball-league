import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // eslint-config-next registers the jsx-a11y plugin with a handful of
    // rules as warnings. The WCAG target needs the full recommended set.
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // Type assertions hide mistakes from the compiler. Read untrusted input
    // with parseId, isOneOf or Zod; take single rows with one(). A double
    // assertion through unknown is never needed in this codebase, and an
    // assertion the compiler can already prove is noise.
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "TSAsExpression > TSAsExpression[typeAnnotation.type='TSUnknownKeyword']",
          message:
            "Do not assert through unknown. Narrow the value with a type guard, parseId or Zod instead.",
        },
        {
          selector: "TSAsExpression[typeAnnotation.type='TSNeverKeyword']",
          message:
            "Do not assert to never. Build a value of the right type, for example with parseId.",
        },
      ],
    },
  },
  {
    // domain/ and i18n/ are pure TypeScript: no framework, database or app
    // imports. i18n/ holds the message catalogs and formatting the domain's
    // words come from (ADR 0065). See docs/architecture.md, "Code layout".
    files: ["src/domain/**/*.{ts,tsx}", "src/i18n/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/*",
                "!@/domain",
                "!@/domain/**",
                "!@/i18n",
                "!@/i18n/**",
              ],
              message:
                "domain/ and i18n/ may only import from domain/ and i18n/.",
            },
            {
              group: [
                "next",
                "next/*",
                "react",
                "react/*",
                "react-dom",
                "drizzle-orm",
                "drizzle-orm/*",
                "**/app/**",
                "**/db/**",
                "**/services/**",
                "**/components/**",
                "**/jobs/**",
              ],
              message:
                "domain/ and i18n/ must stay pure TypeScript with no framework or I/O imports.",
            },
          ],
        },
      ],
    },
  },
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
