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
]);

export default eslintConfig;
