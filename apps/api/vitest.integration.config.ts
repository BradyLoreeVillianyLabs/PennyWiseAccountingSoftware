import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const configDirectory = process.cwd();

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@clearledger\/accounting-core$/,
        replacement: resolve(configDirectory, "../../packages/accounting-core/src/index.ts")
      },
      {
        find: /^@clearledger\/db\/test-utils$/,
        replacement: resolve(configDirectory, "../../packages/db/src/test-utils.ts")
      },
      {
        find: /^@clearledger\/db$/,
        replacement: resolve(configDirectory, "../../packages/db/src/index.ts")
      },
      {
        find: /^@clearledger\/shared$/,
        replacement: resolve(configDirectory, "../../packages/shared/src/index.ts")
      }
    ]
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000
  }
});
