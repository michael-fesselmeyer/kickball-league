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
      ],
    },
  },
  {
    // domain/ is pure TypeScript: no framework, database or app imports.
    // See docs/architecture.md, "Code layout".
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*", "!@/domain", "!@/domain/**"],
              message: "domain/ may only import from domain/.",
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
                "domain/ must stay pure TypeScript with no framework or I/O imports.",
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
