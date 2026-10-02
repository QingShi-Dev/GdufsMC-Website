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
    // Release staging trees produced by scripts/package-release.mjs, plus the
    // deploy scratch dirs. They are gitignored, but eslint does not read
    // .gitignore, so without these a local `pnpm lint` after a packaging
    // attempt lints the bundled, dereferenced stage and reports thousands of
    // bogus errors in vendored .js.
    //
    // Patterns are deliberately written WITHOUT a leading slash: in eslint flat
    // config `ignores` are relative to the config file's directory, and a
    // leading "/" does not anchor the way it does in .gitignore -- those
    // patterns silently match nothing.
    "outputs/**",
    ".release-stage/**",
    "content-tools/**",
    "logs/**",
    ".workbuddy/**",
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
