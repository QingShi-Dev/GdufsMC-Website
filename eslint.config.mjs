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
  ]),
  // scripts/** 是 Node CLI 工具 (sharp/jimp/fs/spawn), 不进浏览器 bundle
  //   - require() 是合理用法 (cjs 传统)
  //   - next.js 的 ESLint 默认规则假设浏览器 ESM, 对 scripts 是误报
  //   - 选择 override + disable 而非 ignore: 保留其他 lint 检查 (no-unused-vars 等)
  {
    files: ["scripts/**/*.{cjs,mjs}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
