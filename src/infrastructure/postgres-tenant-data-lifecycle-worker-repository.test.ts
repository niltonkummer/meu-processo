import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  PostgresTenantDataLifecycleWorkerRepository,
  TenantDataLifecycleWorkerConflictError,
  TenantDataLifecycleWorkerPersistenceError,
  TenantDataLifecycleWorkerValidationError,
} from "./postgres-tenant-data-lifecycle-worker-repository.js";

const CLAIM = "60000000-0000-7000-8000-000000000001";
const REQUEST = "20000000-0000-7000-8000-000000000001";
const TENANT = "10000000-0000-7000-8000-000000000001";
const ARTIFACT = "30000000-0000-8000-8000-000000000001";
const TOKEN = "synthetic-lease-token-with-enough-entropy";
const NOW = new Date("2026-08-31T14:00:00.000Z");
const HASH = createHash("sha256").update(TOKEN).digest();
const claimed = {
  requestId: REQUEST,
  tenantId: TENANT,
  requestType: "export" as const,
  attemptCount: 1,
  leaseToken: TOKEN,
};

const repository = (query = vi.fn()) => ({
  query,
  instance: new PostgresTenantDataLifecycleWorkerRepository(
    { query }, () => CLAIM, () => TOKEN,
  ),
});

describe("PostgresTenantDataLifecycleWorkerRepository", () => {
  it("claims a bounded page and keeps lease plaintext outside PostgreSQL", async () => {
    const fixture = repository(vi.fn()
      .mockResolvedValueOnce({ rows: [{
        claim_id: CLAIM, request_id: REQUEST, tenant_id: TENANT,
        request_type: "export", attempt_count: 1,
      }] })
      .mockResolvedValueOnce({ rows: [] }));

    await expect(fixture.instance.claimDue({
      workerId: "lifecycle-worker", now: NOW, limit: 2,
      leaseDurationMs: 60_000,
    })).resolves.toEqual([claimed]);
    expect(fixture.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("claim_tenant_data_lifecycle"),
      [CLAIM, "lifecycle-worker", NOW, new Date(NOW.getTime() + 60_000), HASH],
    );
    expect(JSON.stringify(fixture.query.mock.calls)).not.toContain(TOKEN);
  });

  it("projects the claimed snapshot and object inventory", async () => {
    const snapshot = { schemaVersion: 1 };
    const documentObject =
      `documents/tenant/${TENANT}/50000000-0000-7000-8000-000000000001/${ARTIFACT}.pdf`;
    const exportObject = `exports/${TENANT}/${REQUEST}/${ARTIFACT}.json`;
    const fixture = repository(vi.fn()
      .mockResolvedValueOnce({ rows: [{ snapshot }] })
      .mockResolvedValueOnce({ rows: [
        { storage_object_id: documentObject },
        { storage_object_id: exportObject },
      ] }));
    await expect(fixture.instance.snapshotExport({
      ...claimed, generatedAt: NOW,
    })).resolves.toEqual(snapshot);
    await expect(fixture.instance.listDeletionObjectIds({
      ...claimed, requestType: "deletion", now: NOW,
    })).resolves.toEqual([documentObject, exportObject]);
    expect(fixture.query).toHaveBeenNthCalledWith(
      1, expect.stringContaining("snapshot_claimed_tenant_export"),
      [REQUEST, HASH, NOW],
    );
  });

  it("completes export and deletion only when PostgreSQL accepts the lease", async () => {
    const fixture = repository(vi.fn()
      .mockResolvedValueOnce({ rows: [{ accepted: true }] })
      .mockResolvedValueOnce({ rows: [{ accepted: true }] }));
    const objectId = `exports/${TENANT}/${REQUEST}/${ARTIFACT}.json`;
    await expect(fixture.instance.completeExport({
      ...claimed, completedAt: NOW, artifactId: ARTIFACT,
      storageObjectId: objectId, sha256: `sha256:${"a".repeat(64)}`,
      sizeBytes: 123,
    })).resolves.toBeUndefined();
    await expect(fixture.instance.completeDeletion({
      ...claimed, requestType: "deletion", deletedAt: NOW,
      purgedObjectCount: 2,
    })).resolves.toBeUndefined();
    expect(fixture.query).toHaveBeenNthCalledWith(
      1, expect.stringContaining("complete_tenant_data_export"),
      [REQUEST, HASH, NOW, ARTIFACT, `sha256:${"a".repeat(64)}`, 123],
    );
    expect(fixture.query).toHaveBeenNthCalledWith(
      2, expect.stringContaining("purge_personal_tenant_data"),
      [REQUEST, HASH, NOW, 2],
    );
  });

  it("records bounded retry state and expiration reconciliation", async () => {
    const objectId = `exports/${TENANT}/${REQUEST}/${ARTIFACT}.json`;
    const next = new Date(NOW.getTime() + 60_000);
    const fixture = repository(vi.fn()
      .mockResolvedValueOnce({ rows: [{ accepted: true }] })
      .mockResolvedValueOnce({ rows: [{
        request_id: REQUEST, tenant_id: TENANT, storage_object_id: objectId,
      }] })
      .mockResolvedValueOnce({ rows: [{ accepted: true }] }));
    await fixture.instance.fail({
      ...claimed, failedAt: NOW, failureCode: "STORAGE_FAILED",
      nextAttemptAt: next, terminal: false,
    });
    await expect(fixture.instance.listDueExpirations({ now: NOW, limit: 1 }))
      .resolves.toEqual([{ requestId: REQUEST, tenantId: TENANT,
        storageObjectId: objectId }]);
    await fixture.instance.expireExport({ requestId: REQUEST, expiredAt: NOW });
    expect(fixture.query).toHaveBeenNthCalledWith(
      1, expect.stringContaining("fail_tenant_data_lifecycle"),
      [REQUEST, HASH, NOW, "STORAGE_FAILED", next, false],
    );
    expect(fixture.query).toHaveBeenNthCalledWith(
      3, expect.stringContaining("expire_tenant_data_export"), [REQUEST, NOW],
    );
  });

  it("rejects malformed inputs and projections before unsafe state changes", async () => {
    const fixture = repository(vi.fn().mockResolvedValue({ rows: [{
      claim_id: CLAIM, request_id: REQUEST, tenant_id: TENANT,
      request_type: "unknown", attempt_count: 1,
    }] }));
    await expect(fixture.instance.claimDue({
      workerId: "bad worker", now: NOW, limit: 1, leaseDurationMs: 60_000,
    })).rejects.toBeInstanceOf(TenantDataLifecycleWorkerValidationError);
    await expect(fixture.instance.claimDue({
      workerId: "worker", now: NOW, limit: 1, leaseDurationMs: 60_000,
    })).rejects.toBeInstanceOf(TenantDataLifecycleWorkerConflictError);
  });

  it.each([
    ["22023", TenantDataLifecycleWorkerValidationError],
    ["42501", TenantDataLifecycleWorkerConflictError],
    ["99999", TenantDataLifecycleWorkerPersistenceError],
  ])("maps PostgreSQL %s without exposing its message", async (code, Expected) => {
    const fixture = repository(vi.fn().mockRejectedValue({
      code, message: "sensitive database detail",
    }));
    await expect(fixture.instance.expireExport({
      requestId: REQUEST, expiredAt: NOW,
    })).rejects.toBeInstanceOf(Expected);
  });
});
