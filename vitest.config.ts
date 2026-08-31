import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/**/*.database.test.ts",
    ],
    coverage: {
      reportsDirectory: process.env.COVERAGE_DIRECTORY ?? "coverage",
      include: [
        "src/domain/**/*.ts",
        "src/application/**/*.ts",
        "src/configuration/gcs-bucket.ts",
        "src/composition/billing-composition-root.ts",
        "src/infrastructure/gcs-object-store.ts",
        "src/infrastructure/google-cloud-storage-gateway.ts",
        "src/infrastructure/postgres-runtime-pool.ts",
        "web/src/document-session-client.ts",
        "web/src/publication-copy-client.ts",
        "web/src/case-activity-client.ts",
        "web/src/persisted-portfolio-client.ts",
        "web/src/persisted-document-client.ts",
        "web/src/monitoring-profile-client.ts",
        "web/src/account-data-client.ts",
        "web/src/billing-client.ts",
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
