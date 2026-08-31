import { readFileSync } from "node:fs";

import {
  collectOpenApiCompatibilityIssues,
  collectOpenApiValidationIssues,
  listOpenApiOperations,
} from "./openapi-contract.js";

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown read error";
    throw new Error(`cannot read OpenAPI document ${path}: ${reason}`, {
      cause: error,
    });
  }
};

const printIssues = (heading: string, issues: readonly string[]) => {
  console.error(heading);
  for (const issue of issues) console.error(`- ${issue}`);
};

const validate = (path: string): unknown => {
  const document = readJson(path);
  const issues = collectOpenApiValidationIssues(document);
  if (issues.length > 0) {
    printIssues(`OpenAPI validation failed for ${path}:`, issues);
    throw new Error("OpenAPI validation failed");
  }
  return document;
};

const main = (args: readonly string[]): number => {
  const command = args[0] ?? "validate";
  if (command === "validate") {
    const candidatePath = args[1] ?? "api/openapi.v1.json";
    const candidate = validate(candidatePath);
    console.log(
      `OpenAPI contract valid: ${listOpenApiOperations(candidate).length} operations.`,
    );
    return 0;
  }
  if (command === "compare" && args[1] && args[2] && args.length === 3) {
    const baseline = validate(args[1]);
    const candidate = validate(args[2]);
    const issues = collectOpenApiCompatibilityIssues(baseline, candidate);
    if (issues.length > 0) {
      printIssues("OpenAPI compatibility check failed:", issues);
      return 1;
    }
    console.log("OpenAPI compatibility check passed.");
    return 0;
  }
  console.error(
    "Usage: openapi-contract-cli validate [candidate] | compare <baseline> <candidate>",
  );
  return 2;
};

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof Error && error.message === "OpenAPI validation failed")) {
    console.error(error instanceof Error ? error.message : "OpenAPI command failed");
  }
  process.exitCode = 1;
}
