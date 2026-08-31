type JsonObject = Record<string, unknown>;
type SchemaDirection = "request" | "response";

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
] as const;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const objectAt = (value: JsonObject, key: string): JsonObject | undefined => {
  const candidate = value[key];
  return isObject(candidate) ? candidate : undefined;
};

const arrayAt = (value: JsonObject, key: string): unknown[] => {
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : [];
};

const hasBearerSecurity = (value: unknown): boolean =>
  Array.isArray(value) && value.some((requirement) =>
    isObject(requirement) && Array.isArray(requirement.bearerAuth)
  );

const componentSchemas = (document: JsonObject): JsonObject =>
  objectAt(objectAt(document, "components") ?? {}, "schemas") ?? {};

const resolveSchema = (
  document: JsonObject,
  schema: unknown,
): JsonObject | undefined => {
  if (!isObject(schema)) return undefined;
  if (typeof schema.$ref !== "string") return schema;
  const match = /^#\/components\/schemas\/([^/]+)$/.exec(schema.$ref);
  const resolved = match?.[1] ? componentSchemas(document)[match[1]] : undefined;
  return isObject(resolved) ? resolved : undefined;
};

const validateMediaContent = (
  content: unknown,
  path: string,
  label: string,
  issues: string[],
) => {
  if (!isObject(content) || Object.keys(content).length === 0) {
    issues.push(`${path} ${label} content must be a non-empty object`);
    return;
  }
  for (const [mediaType, media] of Object.entries(content)) {
    if (!isObject(media) || !isObject(media.schema)) {
      issues.push(`${path} ${label} media type ${mediaType} must declare a schema`);
    }
  }
};

const validateParameter = (
  parameter: unknown,
  path: string,
  templateNames: Set<string>,
  issues: string[],
) => {
  if (!isObject(parameter)) {
    issues.push(`${path} parameter must be an object`);
    return;
  }
  const name = parameter.name;
  const location = parameter.in;
  if (!nonEmptyString(name)) issues.push(`${path} parameter name must be a non-empty string`);
  if (!new Set(["path", "query", "header"]).has(String(location))) {
    issues.push(`${path} parameter location must be path, query, or header`);
  }
  if (!isObject(parameter.schema)) {
    issues.push(`${path} parameter schema must be an object`);
  }
  if (location === "path" && nonEmptyString(name)) {
    if (parameter.required !== true) {
      issues.push(`${path} path parameter ${name} must be required`);
    }
    if (!templateNames.has(name)) {
      issues.push(`${path} path parameter ${name} is not present in the path template`);
    }
  }
};

const validateOperation = (
  operation: JsonObject,
  operationPath: string,
  route: string,
  operationIds: Map<string, string>,
  issues: string[],
) => {
  const operationId = operation.operationId;
  if (!nonEmptyString(operationId)) {
    issues.push(`${operationPath}.operationId must be a non-empty string`);
  } else if (operationIds.has(operationId)) {
    issues.push(`${operationPath} has duplicate operationId ${operationId}`);
  } else {
    operationIds.set(operationId, operationPath);
  }
  if (!nonEmptyString(operation.summary)) {
    issues.push(`${operationPath}.summary must be a non-empty string`);
  }
  if (!Array.isArray(operation.tags) || operation.tags.length === 0 ||
      operation.tags.some((tag) => !nonEmptyString(tag))) {
    issues.push(`${operationPath}.tags must be a non-empty array of strings`);
  }
  if (!hasBearerSecurity(operation.security)) {
    issues.push(`${operationPath}.security must require bearerAuth`);
  }

  const templateNames = new Set(
    [...route.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!),
  );
  const seenPathParameters = new Set<string>();
  for (const [index, parameter] of arrayAt(operation, "parameters").entries()) {
    validateParameter(parameter, `${operationPath}.parameters[${index}]`, templateNames, issues);
    if (isObject(parameter) && parameter.in === "path" && typeof parameter.name === "string") {
      seenPathParameters.add(parameter.name);
    }
  }
  for (const name of templateNames) {
    if (!seenPathParameters.has(name)) {
      issues.push(`${operationPath} is missing path parameter ${name}`);
    }
  }

  if (operation.requestBody !== undefined) {
    if (!isObject(operation.requestBody)) {
      issues.push(`${operationPath}.requestBody must be an object`);
    } else {
      validateMediaContent(
        operation.requestBody.content,
        `${operationPath}.requestBody`,
        "request",
        issues,
      );
    }
  }

  const responses = objectAt(operation, "responses");
  if (!responses || Object.keys(responses).length === 0) {
    issues.push(`${operationPath}.responses must be a non-empty object`);
    return;
  }
  for (const [status, response] of Object.entries(responses)) {
    const responsePath = `${operationPath}.responses.${status}`;
    if (!isObject(response)) {
      issues.push(`${responsePath} must be an object`);
      continue;
    }
    if (!nonEmptyString(response.description)) {
      issues.push(`${responsePath} response description must be a non-empty string`);
    }
    if (response.content !== undefined) {
      validateMediaContent(response.content, responsePath, "response", issues);
    }
  }
};

const collectReferenceIssues = (
  value: unknown,
  schemas: JsonObject,
  path: string,
  issues: string[],
) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectReferenceIssues(item, schemas, `${path}[${index}]`, issues)
    );
    return;
  }
  if (!isObject(value)) return;
  if (typeof value.$ref === "string") {
    if (/^https?:\/\//i.test(value.$ref)) {
      issues.push(`${path} remote references are forbidden`);
    } else {
      const match = /^#\/components\/schemas\/([^/]+)$/.exec(value.$ref);
      if (!match) {
        issues.push(`${path} only local component schema references are supported`);
      } else if (!isObject(schemas[match[1]!])) {
        issues.push(`${path} has unresolved schema reference ${value.$ref}`);
      }
    }
  }
  for (const [key, child] of Object.entries(value)) {
    collectReferenceIssues(child, schemas, `${path}.${key}`, issues);
  }
};

export const collectOpenApiValidationIssues = (value: unknown): readonly string[] => {
  const issues: string[] = [];
  if (!isObject(value)) return ["$ must be an object"];
  if (typeof value.openapi !== "string" || !value.openapi.startsWith("3.1.")) {
    issues.push("$.openapi must start with 3.1.");
  }
  const info = objectAt(value, "info");
  if (!info) {
    issues.push("$.info must be an object");
  } else {
    if (!nonEmptyString(info.title)) issues.push("$.info.title must be a non-empty string");
    if (!nonEmptyString(info.version)) issues.push("$.info.version must be a non-empty string");
  }
  const paths = objectAt(value, "paths");
  if (!paths) issues.push("$.paths must be an object");
  const components = objectAt(value, "components");
  if (!components) issues.push("$.components must be an object");
  const schemas = components ? objectAt(components, "schemas") : undefined;
  if (!schemas) issues.push("$.components.schemas must be an object");
  const securitySchemes = components
    ? objectAt(components, "securitySchemes")
    : undefined;
  const bearer = securitySchemes ? objectAt(securitySchemes, "bearerAuth") : undefined;
  if (!bearer || bearer.type !== "http" || String(bearer.scheme).toLowerCase() !== "bearer") {
    issues.push("$.components.securitySchemes.bearerAuth must be an HTTP bearer scheme");
  }

  const operationIds = new Map<string, string>();
  if (paths) {
    for (const [route, pathItem] of Object.entries(paths)) {
      const path = `$.paths.${route}`;
      if (!route.startsWith("/api/v1/")) {
        issues.push(`${path} must use the /api/v1 prefix`);
      }
      if (!isObject(pathItem)) {
        issues.push(`${path} must be an object`);
        continue;
      }
      let operations = 0;
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (operation === undefined) continue;
        operations += 1;
        if (!isObject(operation)) {
          issues.push(`${path}.${method} must be an object`);
          continue;
        }
        validateOperation(operation, `${path}.${method}`, route, operationIds, issues);
      }
      if (operations === 0) issues.push(`${path} must declare an HTTP operation`);
    }
  }
  collectReferenceIssues(value, schemas ?? {}, "$", issues);
  return issues;
};

export const listOpenApiOperations = (value: unknown): readonly string[] => {
  if (!isObject(value)) return [];
  const paths = objectAt(value, "paths");
  if (!paths) return [];
  const operations: string[] = [];
  for (const route of Object.keys(paths).sort()) {
    const pathItem = paths[route];
    if (!isObject(pathItem)) continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (isObject(operation) && nonEmptyString(operation.operationId)) {
        operations.push(`${method.toUpperCase()} ${route} (${operation.operationId})`);
      }
    }
  }
  return operations;
};

const parameterMap = (operation: JsonObject): Map<string, JsonObject> => {
  const result = new Map<string, JsonObject>();
  for (const parameter of arrayAt(operation, "parameters")) {
    if (isObject(parameter) && typeof parameter.name === "string" &&
        typeof parameter.in === "string") {
      result.set(`${parameter.in}:${parameter.name}`, parameter);
    }
  }
  return result;
};

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const compareConstraint = (
  baseline: JsonObject,
  candidate: JsonObject,
  key: "minimum" | "exclusiveMinimum" | "minLength" | "maximum" | "exclusiveMaximum" | "maxLength",
  direction: SchemaDirection,
  path: string,
  issues: string[],
) => {
  const before = baseline[key];
  const after = candidate[key];
  if (direction === "response") {
    if (!sameValue(before, after)) issues.push(`${path} changed response ${key}`);
    return;
  }
  if (typeof before !== "number" || typeof after !== "number") {
    if (before === undefined && after !== undefined) {
      issues.push(`${path} added request ${key}`);
    }
    return;
  }
  const isMinimum = key === "minimum" || key === "exclusiveMinimum" || key === "minLength";
  if ((isMinimum && after > before) || (!isMinimum && after < before)) {
    issues.push(`${path} ${isMinimum ? "increased" : "decreased"} request ${key}`);
  }
};

const compareSchemas = (
  baselineDocument: JsonObject,
  candidateDocument: JsonObject,
  baselineInput: unknown,
  candidateInput: unknown,
  direction: SchemaDirection,
  path: string,
  issues: string[],
  visited: Set<string>,
) => {
  const baseline = resolveSchema(baselineDocument, baselineInput);
  const candidate = resolveSchema(candidateDocument, candidateInput);
  if (!baseline || !candidate) {
    issues.push(`${path} removed ${direction} schema`);
    return;
  }
  const baselineReference = isObject(baselineInput) && typeof baselineInput.$ref === "string"
    ? baselineInput.$ref
    : undefined;
  const candidateReference = isObject(candidateInput) && typeof candidateInput.$ref === "string"
    ? candidateInput.$ref
    : undefined;
  const visitKey = baselineReference && candidateReference
    ? `${direction}:${baselineReference}:${candidateReference}`
    : `${direction}:inline:${path}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);

  if (!sameValue(baseline.type, candidate.type)) {
    issues.push(`${path} changed ${direction} type`);
  }
  if (!sameValue(baseline.format, candidate.format)) {
    issues.push(`${path} changed ${direction} format`);
  }
  if (!sameValue(baseline.pattern, candidate.pattern)) {
    issues.push(`${path} changed ${direction} pattern`);
  }
  if (!sameValue(baseline.const, candidate.const)) {
    issues.push(`${path} changed ${direction} const`);
  }
  for (const key of [
    "minimum", "exclusiveMinimum", "minLength",
    "maximum", "exclusiveMaximum", "maxLength",
  ] as const) {
    compareConstraint(baseline, candidate, key, direction, path, issues);
  }

  const baselineEnum = Array.isArray(baseline.enum) ? baseline.enum : undefined;
  const candidateEnum = Array.isArray(candidate.enum) ? candidate.enum : undefined;
  if (baselineEnum) {
    if (!candidateEnum) {
      if (direction === "response") issues.push(`${path} removed response enum guarantee`);
    } else if (direction === "request") {
      for (const value of baselineEnum) {
        if (!candidateEnum.some((item) => sameValue(item, value))) {
          issues.push(`${path} request enum no longer accepts ${String(value)}`);
        }
      }
    } else {
      for (const value of candidateEnum) {
        if (!baselineEnum.some((item) => sameValue(item, value))) {
          issues.push(`${path} response enum added unsupported value ${String(value)}`);
        }
      }
    }
  } else if (candidateEnum && direction === "request") {
    issues.push(`${path} added request enum restriction`);
  }

  const baselineProperties = objectAt(baseline, "properties") ?? {};
  const candidateProperties = objectAt(candidate, "properties") ?? {};
  const baselineRequired = new Set(
    arrayAt(baseline, "required").filter((item): item is string => typeof item === "string"),
  );
  const candidateRequired = new Set(
    arrayAt(candidate, "required").filter((item): item is string => typeof item === "string"),
  );
  for (const [name, property] of Object.entries(baselineProperties)) {
    if (!(name in candidateProperties)) {
      issues.push(`${path} removed ${direction} property ${name}`);
      continue;
    }
    compareSchemas(
      baselineDocument,
      candidateDocument,
      property,
      candidateProperties[name],
      direction,
      `${path}.properties.${name}`,
      issues,
      visited,
    );
  }
  if (direction === "request") {
    for (const name of candidateRequired) {
      if (!baselineRequired.has(name)) {
        issues.push(`${path} added required request property ${name}`);
      }
    }
  } else {
    for (const name of baselineRequired) {
      if (!candidateRequired.has(name)) {
        issues.push(`${path} response property ${name} is no longer required`);
      }
    }
  }
  if (baseline.items !== undefined) {
    compareSchemas(
      baselineDocument,
      candidateDocument,
      baseline.items,
      candidate.items,
      direction,
      `${path}.items`,
      issues,
      visited,
    );
  }
};

const compareContent = (
  baselineDocument: JsonObject,
  candidateDocument: JsonObject,
  baselineContent: JsonObject,
  candidateContent: JsonObject,
  direction: SchemaDirection,
  path: string,
  issues: string[],
) => {
  for (const [mediaType, baselineMedia] of Object.entries(baselineContent)) {
    const candidateMedia = candidateContent[mediaType];
    if (!isObject(candidateMedia)) {
      issues.push(`${path} removed ${direction} media type ${mediaType}`);
      continue;
    }
    compareSchemas(
      baselineDocument,
      candidateDocument,
      isObject(baselineMedia) ? baselineMedia.schema : undefined,
      candidateMedia.schema,
      direction,
      `${path}.${mediaType}`,
      issues,
      new Set(),
    );
  }
};

const compareOperation = (
  baselineDocument: JsonObject,
  candidateDocument: JsonObject,
  baseline: JsonObject,
  candidate: JsonObject,
  operationLabel: string,
  issues: string[],
) => {
  if (baseline.operationId !== candidate.operationId) {
    issues.push(`${operationLabel} changed operationId for ${operationLabel}`);
  }
  if (hasBearerSecurity(baseline.security) && !hasBearerSecurity(candidate.security)) {
    issues.push(`${operationLabel} weakened bearer security for ${operationLabel}`);
  }
  const baselineParameters = parameterMap(baseline);
  const candidateParameters = parameterMap(candidate);
  for (const [key, parameter] of baselineParameters) {
    const next = candidateParameters.get(key);
    if (!next) {
      issues.push(`${operationLabel} removed parameter ${key}`);
      continue;
    }
    if (parameter.required !== true && next.required === true) {
      issues.push(`${operationLabel} made parameter ${key} required`);
    }
    compareSchemas(
      baselineDocument,
      candidateDocument,
      parameter.schema,
      next.schema,
      "request",
      `${operationLabel}.parameters.${key}`,
      issues,
      new Set(),
    );
  }
  for (const [key, parameter] of candidateParameters) {
    if (!baselineParameters.has(key) && parameter.required === true) {
      issues.push(`${operationLabel} added required parameter ${key}`);
    }
  }

  const baselineBody = objectAt(baseline, "requestBody");
  const candidateBody = objectAt(candidate, "requestBody");
  if (baselineBody) {
    if (!candidateBody) {
      issues.push(`${operationLabel} removed request body`);
    } else {
      if (baselineBody.required !== true && candidateBody.required === true) {
        issues.push(`${operationLabel} made request body required`);
      }
      compareContent(
        baselineDocument,
        candidateDocument,
        objectAt(baselineBody, "content") ?? {},
        objectAt(candidateBody, "content") ?? {},
        "request",
        `${operationLabel}.requestBody`,
        issues,
      );
    }
  }

  const baselineResponses = objectAt(baseline, "responses") ?? {};
  const candidateResponses = objectAt(candidate, "responses") ?? {};
  for (const [status, response] of Object.entries(baselineResponses)) {
    const next = candidateResponses[status];
    if (!isObject(next)) {
      issues.push(`${operationLabel} removed response ${status}`);
      continue;
    }
    const baselineContent = isObject(response) ? objectAt(response, "content") : undefined;
    if (baselineContent) {
      compareContent(
        baselineDocument,
        candidateDocument,
        baselineContent,
        objectAt(next, "content") ?? {},
        "response",
        `${operationLabel}.responses.${status}`,
        issues,
      );
    }
  }
};

export const collectOpenApiCompatibilityIssues = (
  baselineValue: unknown,
  candidateValue: unknown,
): readonly string[] => {
  const issues: string[] = [];
  if (!isObject(baselineValue) || !isObject(candidateValue)) {
    return ["baseline and candidate must be OpenAPI objects"];
  }
  const baselinePaths = objectAt(baselineValue, "paths") ?? {};
  const candidatePaths = objectAt(candidateValue, "paths") ?? {};
  for (const [route, baselinePath] of Object.entries(baselinePaths)) {
    const candidatePath = candidatePaths[route];
    if (!isObject(candidatePath)) {
      issues.push(`removed path ${route}`);
      continue;
    }
    if (!isObject(baselinePath)) continue;
    for (const method of HTTP_METHODS) {
      const baselineOperation = baselinePath[method];
      if (!isObject(baselineOperation)) continue;
      const candidateOperation = candidatePath[method];
      const operationLabel = `${method.toUpperCase()} ${route}`;
      if (!isObject(candidateOperation)) {
        issues.push(`removed operation ${operationLabel}`);
        continue;
      }
      compareOperation(
        baselineValue,
        candidateValue,
        baselineOperation,
        candidateOperation,
        operationLabel,
        issues,
      );
    }
  }
  return issues;
};
