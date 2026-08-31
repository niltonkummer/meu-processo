import { describe, expect, it, vi } from "vitest";

import {
  TenantDataLifecycleRequestValidationError,
  TenantDataLifecycleService,
  type TenantDataLifecycleRequestRepository,
} from "./tenant-data-lifecycle.js";

const context = {
  userId: "00000000-0000-7000-8000-000000000001",
  tenantId: "10000000-0000-7000-8000-000000000001",
};
const requestId = "20000000-0000-7000-8000-000000000001";
const requestedAt = new Date("2026-08-31T12:00:00.000Z");

const createRepository = (): TenantDataLifecycleRequestRepository => ({
  get: vi.fn().mockResolvedValue(null),
  requestExport: vi.fn().mockResolvedValue({
    requestId,
    requestType: "export",
    state: "pending",
    requestedAt,
  }),
  requestDeletion: vi.fn().mockResolvedValue({
    requestId,
    requestType: "deletion",
    state: "pending",
    requestedAt,
  }),
});

describe("TenantDataLifecycleService", () => {
  it("gets an authorized request and validates lookup context", async () => {
    const repository = createRepository();
    vi.mocked(repository.get).mockResolvedValue({
      requestId, requestType: "export", state: "pending", requestedAt,
      completedAt: null, artifactSizeBytes: null, artifactExpiresAt: null,
      artifactObjectId: null, artifactSha256: null,
    });
    const service = new TenantDataLifecycleService(repository);
    await expect(service.get(context, requestId)).resolves.toMatchObject({ requestId });
    await expect(service.get(context, "invalid")).rejects.toBeInstanceOf(TenantDataLifecycleRequestValidationError);
  });
  it("requests an export using only trusted context", async () => {
    const repository = createRepository();
    const service = new TenantDataLifecycleService(repository);

    await expect(service.requestExport(context, { requestId, requestedAt }))
      .resolves.toMatchObject({ requestType: "export", state: "pending" });
    expect(repository.requestExport).toHaveBeenCalledWith(
      context, { requestId, requestedAt },
    );
  });

  it("requires explicit confirmation before delegating deletion", async () => {
    const repository = createRepository();
    const service = new TenantDataLifecycleService(repository);

    await expect(service.requestDeletion(context, {
      requestId, requestedAt, confirmed: false,
    })).rejects.toBeInstanceOf(TenantDataLifecycleRequestValidationError);
    expect(repository.requestDeletion).not.toHaveBeenCalled();

    await expect(service.requestDeletion(context, {
      requestId, requestedAt, confirmed: true,
    })).resolves.toMatchObject({ requestType: "deletion", state: "pending" });
    expect(repository.requestDeletion).toHaveBeenCalledWith(
      context, { requestId, requestedAt, confirmed: true },
    );
  });

  it.each([
    [{ ...context, tenantId: "not-a-uuid" }, { requestId, requestedAt }],
    [context, { requestId: "not-a-uuid", requestedAt }],
    [context, { requestId, requestedAt: new Date("invalid") }],
  ])("rejects invalid export input", async (invalidContext, input) => {
    const repository = createRepository();
    const service = new TenantDataLifecycleService(repository);
    await expect(service.requestExport(invalidContext, input))
      .rejects.toBeInstanceOf(TenantDataLifecycleRequestValidationError);
    expect(repository.requestExport).not.toHaveBeenCalled();
  });

  it("accepts the existing active request returned for an idempotent retry", async () => {
    const repository = createRepository();
    vi.mocked(repository.requestExport).mockResolvedValue({
      requestId: "20000000-0000-7000-8000-000000000002",
      requestType: "export",
      state: "pending",
      requestedAt,
    });
    const service = new TenantDataLifecycleService(repository);
    await expect(service.requestExport(context, { requestId, requestedAt }))
      .resolves.toMatchObject({
        requestId: "20000000-0000-7000-8000-000000000002",
        requestType: "export",
      });
  });

  it("rejects a malformed repository request identity", async () => {
    const repository = createRepository();
    vi.mocked(repository.requestExport).mockResolvedValue({
      requestId: "not-a-uuid",
      requestType: "export",
      state: "pending",
      requestedAt,
    });
    const service = new TenantDataLifecycleService(repository);
    await expect(service.requestExport(context, { requestId, requestedAt }))
      .rejects.toBeInstanceOf(TenantDataLifecycleRequestValidationError);
  });
});
