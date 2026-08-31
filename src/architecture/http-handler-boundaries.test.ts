import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { privateRequestHandlers } from "../http/handlers/index.js";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const httpRoot = join(sourceRoot, "http");
const serverPath = join(httpRoot, "server.ts");

const expectedModules = [
  "private-api.ts",
  "transport.ts",
  "document-session-upgrade.ts",
  "handlers/index.ts",
  "handlers/session.ts",
  "handlers/search.ts",
  "handlers/monitoring-subjects.ts",
  "handlers/alerts.ts",
  "handlers/cases.ts",
  "handlers/publications.ts",
];

describe("HTTP handler boundaries", () => {
  it("keeps each private API capability outside the root server", () => {
    const missing = expectedModules
      .map((path) => join(httpRoot, path))
      .filter((path) => !existsSync(path))
      .map((path) => relative(sourceRoot, path));

    expect(missing).toEqual([]);
  });

  it("keeps the root server focused on transport composition", () => {
    const source = readFileSync(serverPath, "utf8");
    const productionLines = source.split("\n").length;

    expect(productionLines).toBeLessThanOrEqual(500);
    expect(source).not.toMatch(/from ["']\.\.\/(?:application|domain|infrastructure)\//);
    expect(source).not.toMatch(/const handle(?:Private|Authenticated|Publication|Monitoring)/);
    expect(source).toContain("for (const handler of privateRequestHandlers)");
  });

  it("keeps route precedence explicit and stable", () => {
    expect(privateRequestHandlers.map((handler) => handler.name)).toEqual([
      "handlePrivateSession",
      "handlePrivateBilling",
      "handleAccountData",
      "handlePublicationProxy",
      "handleMonitoringProfiles",
      "handlePrivateAlerts",
      "handlePrivateCases",
      "handleAuthenticatedSearch",
    ]);
  });
});
