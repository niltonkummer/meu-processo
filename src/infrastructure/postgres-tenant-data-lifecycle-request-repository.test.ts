import { describe, expect, it, vi } from "vitest";

import {
  TenantDataLifecycleProjectionError,
  TenantDataLifecycleRequestValidationError,
} from "../application/tenant-data-lifecycle.js";
import { RepositoryAccessDeniedError } from
  "../application/foundation-repository.js";
import { PostgresTenantDataLifecycleRequestRepository } from
  "./postgres-tenant-data-lifecycle-request-repository.js";

const USER = "00000000-0000-7000-8000-000000000001";
const TENANT = "10000000-0000-7000-8000-000000000001";
const REQUEST = "20000000-0000-7000-8000-000000000001";
const NOW = new Date("2026-08-31T12:00:00.000Z");
const context = { userId: USER, tenantId: TENANT };

const poolFor = (...results: unknown[]) => {
  const query = vi.fn();
  for (const result of results) query.mockResolvedValueOnce(result);
  const release = vi.fn();
  return {
    pool: { connect: vi.fn().mockResolvedValue({ query, release }) },
    query, release,
  };
};

describe("PostgresTenantDataLifecycleRequestRepository", () => {
  it("reads a complete private projection without exposing it to callers above", async () => {
    const row = {
      request_id: REQUEST, request_type: "export", state: "completed",
      requested_at: NOW, completed_at: NOW, artifact_size_bytes: "3",
      artifact_expires_at: new Date("2026-09-01T12:00:00.000Z"),
      artifact_object_id: `exports/${TENANT}/${REQUEST}/30000000-0000-7000-8000-000000000001.json`,
      artifact_sha256: `sha256:${"a".repeat(64)}`,
    };
    const fixture = poolFor({ rows: [] }, { rows: [] }, { rows: [row] }, { rows: [] });
    await expect(new PostgresTenantDataLifecycleRequestRepository(fixture.pool)
      .get(context, REQUEST)).resolves.toMatchObject({
        requestType: "export", state: "completed", artifactSizeBytes: 3,
      });
    expect(fixture.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining("get_tenant_data_lifecycle_request"), [REQUEST]);
  });

  it("returns null for an absent or foreign request", async () => {
    const fixture = poolFor({ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] });
    await expect(new PostgresTenantDataLifecycleRequestRepository(fixture.pool)
      .get(context, REQUEST)).resolves.toBeNull();
  });

  it.each([
    { request_type: "unknown" },
    { artifact_size_bytes: "not-a-number" },
    { artifact_sha256: "invalid" },
  ])("rejects malformed private status projections", async (change) => {
    const row = { request_id: REQUEST, request_type: "export", state: "completed",
      requested_at: NOW, completed_at: NOW, artifact_size_bytes: "3",
      artifact_expires_at: new Date("2026-09-01T12:00:00.000Z"),
      artifact_object_id: "private", artifact_sha256: `sha256:${"a".repeat(64)}`,
      ...change };
    const fixture = poolFor({ rows: [] }, { rows: [] }, { rows: [row] }, { rows: [] });
    await expect(new PostgresTenantDataLifecycleRequestRepository(fixture.pool)
      .get(context, REQUEST)).rejects.toBeInstanceOf(TenantDataLifecycleProjectionError);
  });
  it.each([
    ["requestExport", "request_tenant_data_export", "export", false],
    ["requestDeletion", "request_personal_tenant_deletion", "deletion", true],
  ] as const)("executes %s inside trusted tenant context", async (
    method, sqlFunction, requestType, confirmed,
  ) => {
    const fixture = poolFor(
      { rows: [] }, { rows: [] },
      { rows: [{ request_id: REQUEST, request_type: requestType,
        state: "pending", requested_at: NOW }] },
      { rows: [] },
    );
    const repository = new PostgresTenantDataLifecycleRequestRepository(
      fixture.pool,
    );
    const result = method === "requestExport"
      ? repository.requestExport(context, { requestId: REQUEST, requestedAt: NOW })
      : repository.requestDeletion(context, {
          requestId: REQUEST, requestedAt: NOW, confirmed,
        });
    await expect(result).resolves.toEqual({
      requestId: REQUEST, requestType, state: "pending", requestedAt: NOW,
    });
    expect(fixture.query).toHaveBeenNthCalledWith(
      3, expect.stringContaining(sqlFunction),
      method === "requestExport" ? [REQUEST, NOW] : [REQUEST, NOW, true],
    );
    expect(fixture.query).toHaveBeenLastCalledWith("commit");
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it.each([
    [{ rows: [] }],
    [{ rows: [{ request_id: "bad", request_type: "export",
      state: "pending", requested_at: NOW }] }],
    [{ rows: [
      { request_id: REQUEST, request_type: "export", state: "pending", requested_at: NOW },
      { request_id: REQUEST, request_type: "export", state: "pending", requested_at: NOW },
    ] }],
  ])("rejects malformed database projections", async (projected) => {
    const fixture = poolFor({ rows: [] }, { rows: [] }, projected, { rows: [] });
    await expect(new PostgresTenantDataLifecycleRequestRepository(fixture.pool)
      .requestExport(context, { requestId: REQUEST, requestedAt: NOW }))
      .rejects.toBeInstanceOf(TenantDataLifecycleProjectionError);
    expect(fixture.query).toHaveBeenLastCalledWith("rollback");
  });

  it("rejects invalid input before connecting", async () => {
    const connect = vi.fn();
    const repository = new PostgresTenantDataLifecycleRequestRepository({ connect });
    await expect(repository.requestExport(
      { ...context, userId: "bad" }, { requestId: REQUEST, requestedAt: NOW },
    )).rejects.toBeInstanceOf(TenantDataLifecycleRequestValidationError);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", RepositoryAccessDeniedError],
    ["22023", TenantDataLifecycleRequestValidationError],
    ["99999", Error],
  ])("maps PostgreSQL %s to a safe error", async (code, Expected) => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(Object.assign(new Error("sensitive"), { code }))
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresTenantDataLifecycleRequestRepository({
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    });
    const outcome = expect(repository.requestExport(
      context, { requestId: REQUEST, requestedAt: NOW },
    )).rejects;
    if (code === "99999") await outcome.toThrow("Tenant data lifecycle request failed.");
    else await outcome.toBeInstanceOf(Expected);
    expect(query).toHaveBeenLastCalledWith("rollback");
  });
});
