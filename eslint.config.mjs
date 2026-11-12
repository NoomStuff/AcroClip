import js from "@eslint/js";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
export default ts.config(
   {
      ignores: ["out/**", "release/**", "resources/**", "work/**", "test-results/**", ".cache/**", "native/**", "build/**", "playwright-report/**"],
   },
   js.configs.recommended,
   ...ts.configs.recommended,
   {
      // The packaging hook is shared with AttaCut and Deduup, and electron-builder loads it with require.
      files: ["scripts/after-pack.cjs"],
      languageOptions: { sourceType: "commonjs", globals: { require: "readonly", module: "writable", __dirname: "readonly", console: "readonly" } },
      rules: { "@typescript-eslint/no-require-imports": "off" },
   },
   {
      files: ["**/*.{ts,tsx}"],
      rules: { "@typescript-eslint/consistent-type-imports": "error", "@typescript-eslint/no-explicit-any": "error" },
   },
   {
      files: ["src/renderer/**/*.{ts,tsx}"],
      plugins: { "react-hooks": hooks },
      rules: {
         "react-hooks/rules-of-hooks": "error",
         "react-hooks/exhaustive-deps": "error",
         "@typescript-eslint/no-restricted-imports": [
            "error",
            {
               patterns: [
                  { group: ["electron", "node:*", "**/main/**", "**/preload/**"], message: "Use the desktop bridge for privileged operations." },
                  {
                     group: ["zod", "**/shared/validation", "**/shared/stats-log"],
                     allowTypeImports: true,
                     message: "Main validates. Importing a schema here puts zod in the window's startup bundle.",
                  },
               ],
            },
         ],
      },
   },
   {
      files: ["src/main/**/*.ts"],
      rules: {
         "no-restricted-imports": [
            "error",
            {
               patterns: [
                  {
                     group: ["**/renderer/**", "**/preload/**"],
                     message: "Put cross-process contracts in shared; main must not depend on renderer implementation.",
                  },
               ],
            },
         ],
      },
   },
   {
      files: ["src/shared/**/*.ts"],
      rules: {
         "no-restricted-imports": [
            "error",
            {
               patterns: [
                  {
                     group: ["electron", "node:*", "react", "react-dom", "react-dom/*", "**/main/**", "**/renderer/**", "**/preload/**"],
                     message: "Shared contracts and algorithms must remain independent of either process.",
                  },
               ],
            },
         ],
      },
   }
);
