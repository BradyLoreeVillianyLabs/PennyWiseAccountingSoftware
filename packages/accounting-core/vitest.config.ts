import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const configDirectory = process.cwd();

export default defineConfig({
  resolve: {
    alias: {
      "@clearledger/shared": resolve(configDirectory, "../shared/src/index.ts")
    }
  },
  test: {
    environment: "node"
  }
});
