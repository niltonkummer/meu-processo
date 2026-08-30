import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    coverage: {
      reportsDirectory: process.env.COVERAGE_DIRECTORY ?? "coverage",
      include: [
        "src/domain/**/*.ts",
        "src/application/**/*.ts",
        "web/src/document-session-client.ts",
        "web/src/target-storage.ts",
      ],
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    setupFiles: ["./web/src/test-setup.ts"],
  },
});
