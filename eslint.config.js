import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["**/*.{js,cjs}"],
    languageOptions: {
      globals: {
        document: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        Headers: "readonly",
        HTMLElement: "readonly",
        Response: "readonly",
        sessionStorage: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        window: "readonly"
      }
    }
  },
  {
    files: ["distribution/wordpress-site/**/*.js"],
    languageOptions: {
      globals: {
        jQuery: "readonly",
        navigator: "readonly",
        wp: "readonly"
      }
    }
  },
  {
    files: ["distribution/windows-native/**/*.cjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        __dirname: "readonly",
        module: "readonly",
        process: "readonly",
        require: "readonly",
        setTimeout: "readonly"
      }
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-empty": "off"
    }
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-magic-numbers": "off",
      "@typescript-eslint/no-non-null-assertion": "off"
    }
  },
  {
    ignores: [
      "**/dist/**",
      "**/*.mjs",
      "**/*.config.ts",
      "**/.review-backup-*/**",
      "**/.tmp/**",
      "coverage/**",
      "dist/**",
      "distribution/public-beta/output/**",
      "distribution/windows-native/build/**",
      "eslint.config.js",
      "node_modules/**",
      "packages/db/generated/**",
      "packages/db/generated-client/**",
      "packages/db/generated-client-d5/**",
      "packages/db/generated-client-rebuilt/**",
      "packages/db/tmp-prisma-client/**",
      "playwright-report/**",
      "test-results/**",
      "tmp/**"
    ]
  }
);
