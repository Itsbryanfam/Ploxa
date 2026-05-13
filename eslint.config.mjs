import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Per-developer Claude Code state, including worktrees that carry
    // their own checked-out copies of repo code + .next/ build output.
    // Without this, lint recurses into every worktree and reports the
    // same errors N times. Mirrors .gitignore.
    ".claude/**",
  ]),
  // Honor the underscore convention for intentionally-unused parameters
  // (e.g. interface methods that must accept an arg the impl ignores).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Playwright fixtures take a callback called `use(value)` — that's the
  // fixture API contract, not React 19's `use()` hook. ESLint's
  // react-hooks/rules-of-hooks can't distinguish the two and false-flags
  // every fixture. Disable the rule under tests/fixtures/ since no React
  // hooks live there.
  {
    files: ["tests/fixtures/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);

export default eslintConfig;
