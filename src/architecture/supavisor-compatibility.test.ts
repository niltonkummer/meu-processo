import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const infrastructureRoot = join(sourceRoot, "infrastructure");

const postgresProductionFiles = (): string[] => readdirSync(
  infrastructureRoot,
  { withFileTypes: true },
).filter((entry) =>
  entry.isFile() && entry.name.startsWith("postgres-") &&
  entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"),
).map((entry) => join(infrastructureRoot, entry.name));

describe("Supavisor transaction mode compatibility", () => {
  it("does not use named prepared statements in PostgreSQL repositories", () => {
    const namedQuery = /\.query\s*\(\s*\{[\s\S]{0,300}?\bname\s*:/m;
    const violations = postgresProductionFiles()
      .filter((file) => namedQuery.test(readFileSync(file, "utf8")))
      .map((file) => relative(sourceRoot, file));

    expect(violations).toEqual([]);
  });
});
