import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectOpenApiCompatibilityIssues,
  collectOpenApiValidationIssues,
  listOpenApiOperations,
} from "./openapi-contract.js";

type JsonObject = Record<string, unknown>;

const validContract = (): JsonObject => ({
  openapi: "3.1.0",
  info: { title: "Synthetic API", version: "1.0.0" },
  paths: {
    "/api/v1/widgets/{widgetId}": {
      get: {
        operationId: "getWidget",
        summary: "Read a synthetic widget",
        tags: ["Widgets"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "widgetId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          "200": {
            description: "Widget",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WidgetResponse" },
              },
            },
          },
          "401": {
            description: "Authentication required",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
      patch: {
        operationId: "updateWidget",
        summary: "Update a synthetic widget",
        tags: ["Widgets"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "widgetId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WidgetRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Widget updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WidgetResponse" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      WidgetRequest: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: {
          label: { type: "string", minLength: 1, maxLength: 80 },
          state: { type: "string", enum: ["active", "inactive"] },
        },
      },
      WidgetResponse: {
        type: "object",
        additionalProperties: false,
        required: ["widgetId", "label", "state"],
        properties: {
          widgetId: { type: "string", format: "uuid" },
          label: { type: "string" },
          state: { type: "string", enum: ["active", "inactive"] },
        },
      },
      Error: {
        type: "object",
        additionalProperties: false,
        required: ["code", "message"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
        },
      },
    },
  },
});

const clone = <T>(value: T): T => structuredClone(value);

const at = (value: JsonObject, ...segments: string[]): JsonObject => {
  let current: unknown = value;
  for (const segment of segments) {
    current = (current as JsonObject)[segment];
  }
  return current as JsonObject;
};

describe("OpenAPI contract validation", () => {
  it("accepts a complete offline OpenAPI 3.1 bearer contract", () => {
    const contract = validContract();

    expect(collectOpenApiValidationIssues(contract)).toEqual([]);
    expect(listOpenApiOperations(contract)).toEqual([
      "GET /api/v1/widgets/{widgetId} (getWidget)",
      "PATCH /api/v1/widgets/{widgetId} (updateWidget)",
    ]);
  });

  it.each([
    ["non-object root", null, "$ must be an object"],
    ["unsupported version", { ...validContract(), openapi: "3.0.3" }, "$.openapi must start with 3.1."],
    ["missing info", { ...validContract(), info: null }, "$.info must be an object"],
    ["missing paths", { ...validContract(), paths: null }, "$.paths must be an object"],
    ["missing components", { ...validContract(), components: null }, "$.components must be an object"],
  ])("rejects %s", (_label, contract, issue) => {
    expect(collectOpenApiValidationIssues(contract)).toContain(issue);
  });

  it("rejects incomplete operations, duplicate ids and invalid path parameters", () => {
    const contract = validContract();
    const get = at(contract, "paths", "/api/v1/widgets/{widgetId}", "get");
    get.summary = "";
    get.tags = [];
    get.security = [];
    get.responses = {};
    at(contract, "paths", "/api/v1/widgets/{widgetId}", "patch").operationId = "getWidget";
    const parameters = get.parameters as JsonObject[];
    parameters[0]!.required = false;
    parameters.push({
      name: "ghost",
      in: "path",
      required: true,
      schema: { type: "string" },
    });

    const issues = collectOpenApiValidationIssues(contract);
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining("summary must be a non-empty string"),
      expect.stringContaining("tags must be a non-empty array"),
      expect.stringContaining("security must require bearerAuth or a required webhook signature"),
      expect.stringContaining("responses must be a non-empty object"),
      expect.stringContaining("duplicate operationId getWidget"),
      expect.stringContaining("path parameter widgetId must be required"),
      expect.stringContaining("path parameter ghost is not present in the path template"),
    ]));
  });

  it("accepts an explicitly public webhook only with a required signature", () => {
    const contract = validContract();
    const operation = at(contract, "paths", "/api/v1/widgets/{widgetId}", "get");
    operation.security = [];
    (operation.parameters as JsonObject[]).push({
      name: "Stripe-Signature", in: "header", required: true,
      schema: { type: "string", minLength: 1 },
    });
    expect(collectOpenApiValidationIssues(contract)).toEqual([]);
  });

  it("rejects remote, malformed and unresolved references", () => {
    const contract = validContract();
    at(contract, "components", "schemas", "WidgetRequest").properties = {
      remote: { $ref: "https://example.invalid/schema.json" },
      missing: { $ref: "#/components/schemas/Missing" },
      malformed: { $ref: "#/components/parameters/Unknown" },
    };

    expect(collectOpenApiValidationIssues(contract)).toEqual(expect.arrayContaining([
      expect.stringContaining("remote references are forbidden"),
      expect.stringContaining("unresolved schema reference"),
      expect.stringContaining("only local component schema references are supported"),
    ]));
  });

  it("rejects malformed parameters, request bodies, responses and security schemes", () => {
    const contract = validContract();
    const get = at(contract, "paths", "/api/v1/widgets/{widgetId}", "get");
    get.parameters = [{ name: "limit", in: "cookie", required: false }];
    get.requestBody = { content: { "application/json": {} } };
    get.responses = { "200": { description: "", content: { "application/json": {} } } };
    at(contract, "components", "securitySchemes").bearerAuth = {
      type: "apiKey",
      scheme: "basic",
    };

    const issues = collectOpenApiValidationIssues(contract);
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining("parameter location must be path, query, or header"),
      expect.stringContaining("parameter schema must be an object"),
      expect.stringContaining("request media type application/json must declare a schema"),
      expect.stringContaining("response description must be a non-empty string"),
      expect.stringContaining("response media type application/json must declare a schema"),
      "$.components.securitySchemes.bearerAuth must be an HTTP bearer scheme",
    ]));
  });
});

describe("OpenAPI v1 compatibility", () => {
  it("accepts additive compatible request and response evolution", () => {
    const baseline = validContract();
    const candidate = clone(baseline);
    at(candidate, "components", "schemas", "WidgetRequest", "properties").note = {
      type: "string",
    };
    const response = at(candidate, "components", "schemas", "WidgetResponse");
    at(response, "properties").createdAt = { type: "string", format: "date-time" };
    (response.required as string[]).push("createdAt");
    const requestState = at(
      candidate,
      "components",
      "schemas",
      "WidgetRequest",
      "properties",
      "state",
    );
    (requestState.enum as string[]).push("paused");

    expect(collectOpenApiCompatibilityIssues(baseline, candidate)).toEqual([]);
  });

  it.each([
    ["path removal", (candidate: JsonObject) => {
      delete at(candidate, "paths")["/api/v1/widgets/{widgetId}"];
    }, "removed path /api/v1/widgets/{widgetId}"],
    ["method removal", (candidate: JsonObject) => {
      delete at(candidate, "paths", "/api/v1/widgets/{widgetId}").get;
    }, "removed operation GET /api/v1/widgets/{widgetId}"],
    ["operation id change", (candidate: JsonObject) => {
      at(candidate, "paths", "/api/v1/widgets/{widgetId}", "get").operationId = "readWidget";
    }, "changed operationId for GET /api/v1/widgets/{widgetId}"],
    ["security weakening", (candidate: JsonObject) => {
      at(candidate, "paths", "/api/v1/widgets/{widgetId}", "get").security = [];
    }, "weakened bearer security for GET /api/v1/widgets/{widgetId}"],
    ["parameter removal", (candidate: JsonObject) => {
      const operation = at(candidate, "paths", "/api/v1/widgets/{widgetId}", "get");
      operation.parameters = (operation.parameters as JsonObject[]).slice(0, 1);
    }, "removed parameter query:limit"],
    ["new required parameter", (candidate: JsonObject) => {
      (at(candidate, "paths", "/api/v1/widgets/{widgetId}", "get").parameters as JsonObject[]).push({
        name: "cursor",
        in: "query",
        required: true,
        schema: { type: "string" },
      });
    }, "added required parameter query:cursor"],
    ["optional parameter becomes required", (candidate: JsonObject) => {
      const parameters = at(candidate, "paths", "/api/v1/widgets/{widgetId}", "get").parameters as JsonObject[];
      parameters[1]!.required = true;
    }, "made parameter query:limit required"],
    ["request body becomes required", (candidate: JsonObject) => {
      at(candidate, "paths", "/api/v1/widgets/{widgetId}", "patch", "requestBody").required = true;
    }, "made request body required"],
    ["request media removal", (candidate: JsonObject) => {
      delete at(candidate, "paths", "/api/v1/widgets/{widgetId}", "patch", "requestBody", "content")["application/json"];
    }, "removed request media type application/json"],
    ["response removal", (candidate: JsonObject) => {
      delete at(candidate, "paths", "/api/v1/widgets/{widgetId}", "get", "responses")["401"];
    }, "removed response 401"],
    ["response media removal", (candidate: JsonObject) => {
      delete at(candidate, "paths", "/api/v1/widgets/{widgetId}", "get", "responses", "200", "content")["application/json"];
    }, "removed response media type application/json"],
  ])("blocks %s", (_label, mutate, expected) => {
    const baseline = validContract();
    const candidate = clone(baseline);
    mutate(candidate);

    expect(collectOpenApiCompatibilityIssues(baseline, candidate)).toEqual(
      expect.arrayContaining([expect.stringContaining(expected)]),
    );
  });

  it("blocks incompatible request schema changes", () => {
    const baseline = validContract();
    const candidate = clone(baseline);
    const request = at(candidate, "components", "schemas", "WidgetRequest");
    delete at(request, "properties").label;
    (request.required as string[]).push("state");
    const state = at(request, "properties", "state");
    state.enum = ["active"];
    const label = at(baseline, "components", "schemas", "WidgetRequest", "properties", "label");
    label.pattern = "^[a-z]+$";
    at(candidate, "components", "schemas", "WidgetRequest", "properties").label = {
      type: "string",
      minLength: 2,
      maxLength: 40,
      pattern: "^[A-Z]+$",
    };

    const issues = collectOpenApiCompatibilityIssues(baseline, candidate);
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining("added required request property state"),
      expect.stringContaining("request enum no longer accepts inactive"),
      expect.stringContaining("increased request minLength"),
      expect.stringContaining("decreased request maxLength"),
      expect.stringContaining("changed request pattern"),
    ]));
  });

  it("blocks response guarantees and enum/type/format changes", () => {
    const baseline = validContract();
    const candidate = clone(baseline);
    const response = at(candidate, "components", "schemas", "WidgetResponse");
    delete at(response, "properties").label;
    response.required = ["widgetId", "state"];
    at(response, "properties", "state").enum = ["active", "inactive", "paused"];
    at(response, "properties", "widgetId").format = "uri";
    at(response, "properties", "state").type = "integer";

    const issues = collectOpenApiCompatibilityIssues(baseline, candidate);
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining("removed response property label"),
      expect.stringContaining("response property label is no longer required"),
      expect.stringContaining("response enum added unsupported value paused"),
      expect.stringContaining("changed response format"),
      expect.stringContaining("changed response type"),
    ]));
  });

  it("blocks changes to request and response constants", () => {
    const baseline = validContract();
    const candidate = clone(baseline);
    const baselineRequestState = at(baseline, "components", "schemas", "WidgetRequest", "properties", "state");
    const candidateRequestState = at(candidate, "components", "schemas", "WidgetRequest", "properties", "state");
    baselineRequestState.const = "active";
    candidateRequestState.const = "inactive";
    const baselineResponseState = at(baseline, "components", "schemas", "WidgetResponse", "properties", "state");
    const candidateResponseState = at(candidate, "components", "schemas", "WidgetResponse", "properties", "state");
    baselineResponseState.const = "active";
    candidateResponseState.const = "inactive";

    expect(collectOpenApiCompatibilityIssues(baseline, candidate)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("changed request const"),
        expect.stringContaining("changed response const"),
      ]),
    );
  });

  it("compares recursive local schemas without unbounded recursion", () => {
    const baseline = validContract();
    const recursive = {
      type: "object",
      properties: { child: { $ref: "#/components/schemas/Recursive" } },
    };
    at(baseline, "components", "schemas").Recursive = recursive;
    at(baseline, "paths", "/api/v1/widgets/{widgetId}", "get", "responses", "200", "content", "application/json").schema = {
      $ref: "#/components/schemas/Recursive",
    };
    const candidate = clone(baseline);

    expect(collectOpenApiCompatibilityIssues(baseline, candidate)).toEqual([]);
  });
});

describe("versioned Meu Processo contract", () => {
  it("documents every current public HTTP v1 operation", () => {
    const contract = JSON.parse(
      readFileSync(resolve(process.cwd(), "api/openapi.v1.json"), "utf8"),
    ) as unknown;

    expect(collectOpenApiValidationIssues(contract)).toEqual([]);
    expect(listOpenApiOperations(contract)).toEqual([
      "POST /api/v1/account/data-exports (requestAccountDataExport)",
      "GET /api/v1/account/data-exports/{requestId} (getAccountDataExport)",
      "GET /api/v1/account/data-exports/{requestId}/download (downloadAccountDataExport)",
      "POST /api/v1/account/deletion-requests (requestAccountDeletion)",
      "GET /api/v1/alerts (listAlerts)",
      "PATCH /api/v1/alerts/{alertId}/read (markAlertRead)",
      "POST /api/v1/billing/checkout-sessions (createBillingCheckoutSession)",
      "POST /api/v1/billing/portal-sessions (createBillingPortalSession)",
      "GET /api/v1/billing/subscription (getBillingSubscription)",
      "GET /api/v1/cases (listCases)",
      "GET /api/v1/cases/{caseId} (getCase)",
      "GET /api/v1/cases/{caseId}/documents (listCaseDocuments)",
      "GET /api/v1/cases/{caseId}/documents/{documentId}/content (downloadCaseDocument)",
      "POST /api/v1/cases/{caseId}/documents/{documentId}/materializations (requestDocumentMaterialization)",
      "GET /api/v1/cases/{caseId}/events (listCaseEvents)",
      "GET /api/v1/monitoring/subjects (listMonitoringSubjects)",
      "POST /api/v1/monitoring/subjects (createMonitoringSubject)",
      "DELETE /api/v1/monitoring/subjects/{subjectId} (archiveMonitoringSubject)",
      "GET /api/v1/processes/{cnjNumber}/communications/{communicationNumber}/document (openPublicationDocument)",
      "POST /api/v1/processes/{cnjNumber}/communications/{communicationNumber}/document/challenge (completePublicationDocumentChallenge)",
      "GET /api/v1/processes/{cnjNumber}/communications/{communicationNumber}/publication-copy (downloadDjenPublicationCopy)",
      "POST /api/v1/searches (searchProcesses)",
      "GET /api/v1/session (getSession)",
      "POST /api/v1/webhooks/stripe (receiveStripeBillingWebhook)",
    ]);
  });
});
