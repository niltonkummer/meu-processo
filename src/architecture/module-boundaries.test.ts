import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const productionFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });

const relativeImports = (file: string): string[] => {
  const contents = readFileSync(file, "utf8");
  return [...contents.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
};

const resolvedLayer = (file: string, imported: string): string => {
  const resolved = resolve(dirname(file), imported);
  return relative(sourceRoot, resolved).split("/")[0] ?? "";
};

describe("module boundaries", () => {
  it("keeps domain independent from application, infrastructure and HTTP", () => {
    const violations = productionFiles(join(sourceRoot, "domain")).flatMap(
      (file) =>
        relativeImports(file)
          .map((imported) => resolvedLayer(file, imported))
          .filter((layer) =>
            ["application", "infrastructure", "http"].includes(layer),
          )
          .map((layer) => `${relative(sourceRoot, file)} -> ${layer}`),
    );

    expect(violations).toEqual([]);
  });

  it("keeps application independent from infrastructure and HTTP", () => {
    const violations = productionFiles(join(sourceRoot, "application")).flatMap(
      (file) =>
        relativeImports(file)
          .map((imported) => resolvedLayer(file, imported))
          .filter((layer) => ["infrastructure", "http"].includes(layer))
          .map((layer) => `${relative(sourceRoot, file)} -> ${layer}`),
    );

    expect(violations).toEqual([]);
  });

  it("prevents application and domain from reading process environment", () => {
    const violations = ["application", "domain"].flatMap((layer) =>
      productionFiles(join(sourceRoot, layer))
        .filter((file) => readFileSync(file, "utf8").includes("process.env"))
        .map((file) => relative(sourceRoot, file)),
    );

    expect(violations).toEqual([]);
  });
});
